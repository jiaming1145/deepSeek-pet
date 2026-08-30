/**
 * CX-6 end to end inside main: a REAL TurnRunner over a controllable stream and a REAL
 * HistoryStore, with only the Electron surface faked. A simulated bubble crash mid-playback must
 * leave the runner idle, emit turnDone, and persist what the user saw.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Channels, InvokeChannels } from '@ds/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { ChatClient, StreamChunk } from '@ds/brain';
import type { KeyStore } from './key-store';

class FakeWindow {
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  visible = false;
  readonly webContents = {
    isDestroyed: () => false,
    isLoading: () => false,
    send: (channel: string, payload: unknown) => {
      this.sent.push({ channel, payload });
    },
    once: () => {},
    removeListener: () => {},
  };
  isDestroyed(): boolean {
    return false;
  }
  isVisible(): boolean {
    return this.visible;
  }
  getBounds() {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  on(): void {}
  removeListener(): void {}
  payloads<T = unknown>(channel: string): T[] {
    return this.sent.filter((s) => s.channel === channel).map((s) => s.payload as T);
  }
}

const ipcHandlers = new Map<string, (payload: unknown, from: unknown) => void>();
const invokeHandlers = new Map<string, (payload: unknown) => Promise<unknown>>();
const bubbleVisible: boolean[] = [];

/**
 * The stream under test: the first sentence at once, then the rest only when the test says so.
 * `holdRest = true` keeps the request on the wire (a crash mid-stream); `false` finishes at once
 * (a crash after the stream settled, while the runner waits for the bubble's acknowledgement).
 */
let holdRest = true;
let releaseRest: () => void = () => {};
const FIRST = '你好呀。';
// The runner holds a sentence as `pending` until the NEXT one completes (§3.11.2's lint-on-pair), so
// two whole sentences plus the head of a third have to be on the wire before the first is emitted.
const SECOND = '今天过得怎么样？';
const REST_HEAD = '那';
const REST_TAIL = '我们聊聊。';
const REST = `${SECOND}${REST_HEAD}${REST_TAIL}`;

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { removeHandler: () => {}, removeAllListeners: () => {} },
}));
vi.mock('./ipc', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./ipc')>();
  return {
    ...orig,
    onFromAny: (_w: unknown, channel: string, cb: (payload: unknown, from: unknown) => void) => {
      ipcHandlers.set(channel, cb);
    },
  };
});
vi.mock('./invoke', () => ({
  handleInvoke: (channel: string, _w: unknown, cb: (payload: unknown) => Promise<unknown>) => {
    invokeHandlers.set(channel, cb);
  },
}));
vi.mock('./bubble-window', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./bubble-window')>();
  const placement = { x: 0, y: 0, side: 'left' as const, arrowOffset: 10 };
  return {
    ...orig,
    placeBubbleWindow: () => placement,
    repositionBubble: () => placement,
    setBubbleClickThrough: () => {},
  };
});
vi.mock('./chat-window', () => ({ resizeChat: () => {}, setChatComposing: () => {} }));
vi.mock('./fake-client', async () => {
  const { CancelledError } = await import('@ds/brain');
  const client: ChatClient = {
    async *stream(_req, signal): AsyncIterable<StreamChunk> {
      yield { kind: 'delta', text: `<|ACT emotion=happy motion=nod|>${FIRST}` };
      yield { kind: 'delta', text: `${SECOND}${REST_HEAD}` };
      if (holdRest) {
        await new Promise<void>((resolve, reject) => {
          releaseRest = resolve;
          signal.addEventListener('abort', () => reject(new CancelledError()), { once: true });
        });
      }
      yield { kind: 'delta', text: REST_TAIL };
      yield { kind: 'usage', usage: { promptTokens: 10, cacheHit: 0, cacheMiss: 10, completionTokens: 8 } };
      yield { kind: 'done' };
    },
    complete: async () => ({ text: '', usage: { promptTokens: 0, cacheHit: 0, cacheMiss: 0, completionTokens: 0 } }),
    testKey: async () => ({ ok: true as const }),
  };
  return { useFakeBrain: () => true, createFakeClient: () => client, FAKE_BRAIN_ENV: 'DS_FAKE_BRAIN' };
});

const { parseCharacterBundle } = await import('@ds/brain');
const { HistoryStore, KV_FIRST_RUN_DONE, RunningSummary, openDb, setKv } = await import('@ds/memory');
const { BrainService } = await import('./brain-service');

const bundle = parseCharacterBundle(
  JSON.parse(readFileSync(join(__dirname, '../../../../characters/haru/character.json'), 'utf8')),
);

let dir: string;
let db: DatabaseSync;
let store: InstanceType<typeof HistoryStore>;
let pet: FakeWindow;
let bubble: FakeWindow;
let chat: FakeWindow;
let key: FakeWindow;
let service: InstanceType<typeof BrainService>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ds-brain-crash-'));
  db = openDb(join(dir, 'ds.sqlite'));
  setKv(db, KV_FIRST_RUN_DONE, '1');
  store = new HistoryStore({ db, summary: new RunningSummary(db), summarize: async () => '' });
  ipcHandlers.clear();
  invokeHandlers.clear();
  bubbleVisible.length = 0;
  holdRest = true;
  pet = new FakeWindow();
  bubble = new FakeWindow();
  chat = new FakeWindow();
  key = new FakeWindow();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  service = new BrainService({
    pet: pet as unknown as BrowserWindow,
    bubble: bubble as unknown as BrowserWindow,
    chat: chat as unknown as BrowserWindow,
    key: key as unknown as BrowserWindow,
    store,
    keyStore: { get: () => null, source: () => 'none', onChange: () => () => {} } as unknown as KeyStore,
    bundle,
    db,
    setBubbleVisible: (on) => {
      bubbleVisible.push(on);
      bubble.visible = on;
    },
    openKeyWindow: () => {},
  });
  service.start();
});

afterEach(async () => {
  await service.dispose();
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Sends a message and waits until the first sentence reached the bubble and was shown. */
async function speakFirstSentence(): Promise<{ turnId: string; text: string }> {
  const res = (await invokeHandlers.get(InvokeChannels.userText)!({ text: '今天好累' })) as { ok: boolean; turnId: string };
  expect(res.ok).toBe(true);
  await vi.waitFor(() => expect(bubble.payloads(Channels.brainSentence).length).toBeGreaterThan(0));
  const first = bubble.payloads<{ turnId: string; seq: number; text: string }>(Channels.brainSentence)[0];
  expect(first.turnId).toBe(res.turnId);
  expect(first.text).toBe(FIRST);
  ipcHandlers.get(Channels.playbackSentenceDone)!({ turnId: res.turnId, seq: first.seq }, bubble);
  expect(bubbleVisible.at(-1)).toBe(true);
  return { turnId: res.turnId, text: first.text };
}

const lastState = (): { state: string; turnId: string } | undefined =>
  pet.payloads<{ state: string; turnId: string }>(Channels.brainState).at(-1);

describe('CX-6: a bubble crash mid-playback, with the real TurnRunner', () => {
  it('mid-stream: the turn is retired as interrupted — idle + turnDone emitted, the shown prefix persisted as [中断]', async () => {
    const { turnId, text } = await speakFirstSentence();
    expect(lastState()?.state).toBe('speaking');

    service.bubbleCrashed(); // the request is still on the wire

    await vi.waitFor(() => expect(lastState()).toEqual({ state: 'idle', turnId }));
    expect(chat.payloads<{ turnId: string }>(Channels.brainTurnDone).map((p) => p.turnId)).toContain(turnId);
    expect(bubbleVisible.at(-1)).toBe(false);

    await vi.waitFor(() => {
      const assistant = store.list({}).find((r) => r.role === 'assistant' && r.turnId === turnId);
      expect(assistant).toBeDefined();
      expect(assistant!.interrupted).toBe(true);
      expect(assistant!.content).toBe(text); // the shown prefix only, never the unrevealed rest
    });
    expect(store.list({}).some((r) => r.role === 'user' && r.turnId === turnId && r.content === '今天好累')).toBe(true);

    // A late playback echo from the dead page is ignored: nothing changes, nothing throws.
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId }, bubble);
    await service.dispose();
    const metrics = db.prepare('SELECT turn_id FROM metrics').all() as Array<{ turn_id: string }>;
    expect(metrics.map((m) => m.turn_id)).toContain(turnId);
  });

  it('after the stream settled: the runner is acknowledged on behalf of the dead bubble and reaches idle', async () => {
    holdRest = false;
    const { turnId } = await speakFirstSentence();
    // The whole reply is in; the runner waits in `speaking` for a playback:turnDone that will never come.
    await vi.waitFor(() => expect(store.list({}).some((r) => r.role === 'assistant' && r.turnId === turnId)).toBe(true));
    expect(lastState()).toEqual({ state: 'speaking', turnId });

    service.bubbleCrashed();

    await vi.waitFor(() => expect(lastState()).toEqual({ state: 'idle', turnId }));
    expect(bubbleVisible.at(-1)).toBe(false);
    const assistant = store.list({}).find((r) => r.role === 'assistant' && r.turnId === turnId)!;
    expect(assistant.interrupted).toBe(false); // the reply was complete when it settled
    expect(assistant.content).toBe(`${FIRST}${REST}`);
    // The runner is free: a new turn is admitted and starts thinking.
    releaseRest();
    const res = (await invokeHandlers.get(InvokeChannels.userText)!({ text: '再来' })) as { ok: boolean; turnId: string };
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(lastState()?.turnId).toBe(res.turnId));
  });
});
