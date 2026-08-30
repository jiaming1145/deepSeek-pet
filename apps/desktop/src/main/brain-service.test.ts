import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Channels, InvokeChannels } from '@ds/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { HistoryStore } from '@ds/memory';
import type { KeyStore } from './key-store';

// ---- fakes -----------------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

/** The slice of BrowserWindow BrainService touches, recording every send. */
class FakeWindow {
  readonly name: string;
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  readonly listeners = new Map<string, Handler[]>();
  readonly wcOnce = new Map<string, Handler[]>();
  visible = false;
  loading = false;
  destroyed = false;
  readonly webContents = {
    isDestroyed: () => this.destroyed,
    isLoading: () => this.loading,
    send: (channel: string, payload: unknown) => {
      this.sent.push({ channel, payload });
      calls.push(`send:${this.name}:${channel}`);
    },
    once: (event: string, cb: Handler) => {
      this.wcOnce.set(event, [...(this.wcOnce.get(event) ?? []), cb]);
    },
    removeListener: (event: string, cb: Handler) => {
      calls.push(`removeListener:${this.name}:${event}`);
      this.wcOnce.set(event, (this.wcOnce.get(event) ?? []).filter((h) => h !== cb));
    },
  };

  constructor(name: string) {
    this.name = name;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 100, height: 100 };
  }

  hide(): void {
    this.visible = false;
  }

  on(event: string, cb: Handler): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
  }

  removeListener(event: string, cb: Handler): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((h) => h !== cb));
  }

  fireWebContentsOnce(event: string): void {
    const hs = this.wcOnce.get(event) ?? [];
    this.wcOnce.set(event, []);
    for (const h of hs) h();
  }

  payloads(channel: string): unknown[] {
    return this.sent.filter((s) => s.channel === channel).map((s) => s.payload);
  }
}

type TurnListener = (payload: unknown) => void;

/** Stands in for TurnRunner: the test emits events itself; cancel() resolves when the test says. */
class FakeTurnRunner {
  static instances: FakeTurnRunner[] = [];
  readonly listeners = new Map<string, Set<TurnListener>>();
  cancelCalls = 0;
  cancelGate: Promise<void> = Promise.resolve();
  readonly shown: Array<[string, number]> = [];
  readonly turnsShown: string[] = [];

  constructor() {
    FakeTurnRunner.instances.push(this);
  }

  on(event: string, cb: TurnListener): () => void {
    const set = this.listeners.get(event) ?? new Set<TurnListener>();
    set.add(cb);
    this.listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  }

  emit(event: string, payload: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  send(): Promise<string> {
    return Promise.resolve('t1');
  }

  cancel(): Promise<void> {
    this.cancelCalls++;
    calls.push('runner.cancel');
    return this.cancelGate;
  }

  sentenceShown(turnId: string, seq: number): void {
    this.shown.push([turnId, seq]);
  }

  turnShown(turnId: string): void {
    this.turnsShown.push(turnId);
  }
}

/** A global call log, so ORDER between modules can be asserted (reposition before show, etc.). */
let calls: string[] = [];
const ipcHandlers = new Map<string, (payload: unknown, from: unknown) => void>();
const invokeHandlers = new Map<string, (payload: unknown) => Promise<unknown>>();
const bubbleVisible: boolean[] = [];

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    removeHandler: () => {},
    removeAllListeners: () => {},
  },
}));

vi.mock('./ipc', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./ipc')>();
  return {
    ...orig,
    onFromAny: (_windows: unknown, channel: string, cb: (payload: unknown, from: unknown) => void) => {
      ipcHandlers.set(channel, cb);
    },
  };
});

vi.mock('./invoke', () => ({
  handleInvoke: (channel: string, _windows: unknown, cb: (payload: unknown) => Promise<unknown>) => {
    invokeHandlers.set(channel, cb);
  },
}));

vi.mock('./bubble-window', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./bubble-window')>();
  const placement = { x: 0, y: 0, side: 'left' as const, arrowOffset: 10 };
  return {
    ...orig,
    placeBubbleWindow: () => {
      calls.push('placeBubbleWindow');
      return placement;
    },
    repositionBubble: () => {
      calls.push('repositionBubble');
      return placement;
    },
    setBubbleClickThrough: (_bubble: unknown, ignore: boolean) => {
      calls.push(`clickThrough:${ignore}`);
    },
  };
});

vi.mock('./chat-window', () => ({
  resizeChat: () => {},
  setChatComposing: () => {},
}));

vi.mock('@ds/brain', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@ds/brain')>();
  return { ...orig, TurnRunner: FakeTurnRunner };
});

const { parseCharacterBundle } = await import('@ds/brain');
const { KV_FIRST_RUN_DONE, getKv, openDb, setKv } = await import('@ds/memory');
const { BUBBLE_HIDE_DELAY_MS, BUBBLE_LINGER_MS } = await import('./bubble-window');
const { BrainService, HINT_TTL_MS } = await import('./brain-service');

const bundle = parseCharacterBundle(
  JSON.parse(readFileSync(join(__dirname, '../../../../characters/haru/character.json'), 'utf8')),
);

// ---- harness ---------------------------------------------------------------------------------

let dir: string;
let db: DatabaseSync;
let pet: FakeWindow;
let bubble: FakeWindow;
let chat: FakeWindow;
let key: FakeWindow;
let keyListeners: Array<(s: { present: boolean; source: string }) => void>;
let keyStore: KeyStore;
let appendImpl: () => Promise<void>;
let appends: Array<[string, string, unknown]>;
let store: HistoryStore;
let openKeyWindow: ReturnType<typeof vi.fn>;

function makeService(): InstanceType<typeof BrainService> {
  return new BrainService({
    pet: pet as unknown as BrowserWindow,
    bubble: bubble as unknown as BrowserWindow,
    chat: chat as unknown as BrowserWindow,
    key: key as unknown as BrowserWindow,
    store,
    keyStore,
    bundle,
    db,
    setBubbleVisible: (on) => {
      bubbleVisible.push(on);
      calls.push(`setBubbleVisible:${on}`);
      bubble.visible = on;
    },
    openKeyWindow,
  });
}

const runner = (): FakeTurnRunner => {
  const r = FakeTurnRunner.instances.at(-1);
  if (!r) throw new Error('no runner constructed');
  return r;
};

beforeEach(() => {
  // Never a real DeepSeekClient here: a stored-key `key:test` would hit the network.
  process.env.DS_FAKE_BRAIN = '1';
  dir = mkdtempSync(join(tmpdir(), 'ds-brain-service-'));
  db = openDb(join(dir, 'ds.sqlite'));
  calls = [];
  ipcHandlers.clear();
  invokeHandlers.clear();
  bubbleVisible.length = 0;
  FakeTurnRunner.instances = [];
  pet = new FakeWindow('pet');
  bubble = new FakeWindow('bubble');
  chat = new FakeWindow('chat');
  key = new FakeWindow('key');
  keyListeners = [];
  keyStore = {
    get: () => 'sk-test-key-000000000000000000000',
    source: () => 'store',
    onChange: (cb: (s: { present: boolean; source: string }) => void) => {
      keyListeners.push(cb);
      return () => {};
    },
    set: () => {},
    clear: () => {},
    hasStored: () => true,
  } as unknown as KeyStore;
  appends = [];
  appendImpl = () => Promise.resolve();
  store = {
    append: (role: string, content: string, meta: unknown) => {
      appends.push([role, content, meta]);
      return appendImpl();
    },
    list: () => [],
    deleteTurn: () => 0,
    lastMessageTs: () => null,
  } as unknown as HistoryStore;
  openKeyWindow = vi.fn();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.DS_FAKE_BRAIN;
  vi.useRealTimers();
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---- tests -----------------------------------------------------------------------------------

describe('BrainService', () => {
  it('M-7: a KeyStore change nulls lastTest before the key:status it pushes (contracts §2.3)', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    // A completed key:test on the stored client sets lastTest.
    const keyTest = invokeHandlers.get(InvokeChannels.keyTest);
    expect(keyTest).toBeDefined();
    await keyTest!({});
    const afterTest = key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown };
    expect(afterTest.lastTest).toEqual({ ok: true, at: expect.any(Number) });

    // 清除 → KeyStore.onChange → rebuildClient: lastTest describes the key stored NOW, i.e. none.
    for (const cb of keyListeners) cb({ present: false, source: 'none' });
    const afterClear = key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown; present: boolean };
    expect(afterClear).toEqual({ present: true, source: 'store', lastTest: null });
    expect(chat.payloads(Channels.keyStatus).at(-1)).toEqual(afterClear);
    await service.dispose();
  });

  it('G-7: an error before the first sentence keeps its hint up for HINT_TTL_MS even though idle follows', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const r = runner();
    r.emit('state', { state: 'thinking', turnId: 't1' });
    r.emit('error', { turnId: 't1', code: 'network', message: 'boom' });
    r.emit('state', { state: 'idle', turnId: 't1' });
    expect(bubble.payloads(Channels.hintShow)).toHaveLength(1);
    expect(bubbleVisible.at(-1)).toBe(true);

    vi.advanceTimersByTime(HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS - 1);
    expect(bubbleVisible.at(-1)).toBe(true); // the idle fallback must NOT have replaced the hint timer
    vi.advanceTimersByTime(1);
    expect(bubbleVisible.at(-1)).toBe(false);
    await service.dispose();
  });

  it('G-7: a turn that emits no sentence and no error still hides via the idle fallback', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const r = runner();
    r.emit('state', { state: 'thinking', turnId: 't1' });
    r.emit('state', { state: 'idle', turnId: 't1' });
    vi.advanceTimersByTime(BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);
    await service.dispose();
  });

  it('G-9: the greeting is persisted and marked seen only after the bubble reports playback:turnDone', async () => {
    const service = makeService();
    service.start();
    expect(bubble.payloads(Channels.brainSentence)).toHaveLength(1);
    expect(pet.payloads(Channels.brainSentence)).toHaveLength(1);
    expect(chat.payloads(Channels.brainTurnDone)).toHaveLength(1);
    expect(bubbleVisible.at(-1)).toBe(true);
    // Not yet: quitting before the reveal must greet again next time.
    expect(appends).toEqual([]);
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe(null);

    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 'first-mes' }, bubble);
    await Promise.resolve();
    await Promise.resolve();
    expect(appends).toEqual([['assistant', expect.any(String), { turnId: 'first-mes', kind: 'system' }]]);
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe('1');
    expect(runner().turnsShown).toEqual([]); // 'first-mes' never reaches the runner
    await service.dispose();
  });

  it('G-9: a failing greeting append sets no marker and raises no unhandled rejection', async () => {
    appendImpl = () => Promise.reject(new Error('disk full'));
    const service = makeService();
    service.start();
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 'first-mes' }, bubble);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(appends).toHaveLength(1);
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe(null);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[brain] first message'), expect.any(Error));
    await service.dispose();
  });

  it('G-9: a second playback:turnDone for first-mes does not append twice', async () => {
    const service = makeService();
    service.start();
    const done = ipcHandlers.get(Channels.playbackTurnDone)!;
    done({ turnId: 'first-mes' }, bubble);
    done({ turnId: 'first-mes' }, bubble);
    await Promise.resolve();
    await Promise.resolve();
    expect(appends).toHaveLength(1);
    await service.dispose();
  });

  it('G-9: the first message waits for the bubble document and replays through setBubbleVisible', () => {
    bubble.loading = true;
    const service = makeService();
    service.start();
    expect(bubble.payloads(Channels.brainSentence)).toHaveLength(0);
    bubble.fireWebContentsOnce('did-finish-load');
    expect(bubble.payloads(Channels.brainSentence)).toHaveLength(1);
    expect(bubbleVisible).toEqual([true]);
    void service.dispose();
  });

  it('I-9: dispose() is a barrier — it resolves only after runner.cancel() settles, and removes the did-finish-load listener', async () => {
    bubble.loading = true;
    const service = makeService();
    service.start();
    const r = runner();
    let release: () => void = () => {};
    r.cancelGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let disposed = false;
    const disposing = service.dispose().then(() => {
      disposed = true;
      calls.push('disposed');
    });
    await Promise.resolve();
    expect(r.cancelCalls).toBe(1);
    expect(disposed).toBe(false);
    expect(calls).toContain('removeListener:bubble:did-finish-load');
    expect(bubble.wcOnce.get('did-finish-load')).toEqual([]);

    release();
    await disposing;
    expect(disposed).toBe(true);
    expect(calls.indexOf('runner.cancel')).toBeLessThan(calls.indexOf('disposed'));

    // A late did-finish-load (the listener is gone, but belt and braces) sends nothing after dispose.
    bubble.fireWebContentsOnce('did-finish-load');
    expect(bubble.payloads(Channels.brainSentence)).toHaveLength(0);
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe(null);
  });

  it('I-9: dispose() is idempotent and delayed callbacks are inert afterwards', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    ipcHandlers.get(Channels.chatComposing)!({ on: true }, chat);
    ipcHandlers.get(Channels.chatComposing)!({ on: false }, chat); // arms the 250 ms falling edge
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    runner().emit('state', { state: 'idle', turnId: 't1' }); // arms the empty-turn hide
    const sendsBefore = pet.sent.length;
    const visibleBefore = bubbleVisible.length;
    await service.dispose();
    await service.dispose();
    expect(runner().cancelCalls).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(pet.sent.length).toBe(sendsBefore);
    expect(bubbleVisible.length).toBe(visibleBefore);
  });

  it('G-3: reportError never logs or forwards an upstream message raw — keys are redacted, the log is bounded', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const secret = 'sk-' + 'a'.repeat(32);
    const message = `upstream said Authorization: Bearer ${secret} ` + 'x'.repeat(2000);
    runner().emit('error', { turnId: 't1', code: 'server', message });

    const logged = (console.error as ReturnType<typeof vi.fn>).mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain(secret);
    expect(logged).toContain('server');
    expect(logged.length).toBeLessThan(600);

    for (const win of [chat, bubble]) {
      const p = win.payloads(Channels.brainError).at(-1) as { code: string; message: string };
      expect(p.code).toBe('server');
      expect(p.message).not.toContain(secret);
    }
    await service.dispose();
  });

  it('M-10: the bubble is re-placed BEFORE it is shown on thinking, on an error hint and on the first message', async () => {
    const service = makeService();
    service.start();
    const order = calls.filter((c) => c === 'repositionBubble' || c === 'setBubbleVisible:true');
    expect(order).toEqual(['repositionBubble', 'setBubbleVisible:true']); // first message, bubble hidden
    bubble.visible = false;
    calls = [];
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    expect(calls.filter((c) => c === 'repositionBubble' || c === 'setBubbleVisible:true'))
      .toEqual(['repositionBubble', 'setBubbleVisible:true']);
    expect(bubble.payloads(Channels.bubblePlace).length).toBeGreaterThan(0);
    bubble.visible = false;
    calls = [];
    runner().emit('error', { turnId: 't1', code: 'network', message: 'x' });
    expect(calls.filter((c) => c === 'repositionBubble' || c === 'setBubbleVisible:true'))
      .toEqual(['repositionBubble', 'setBubbleVisible:true']);
    await service.dispose();
  });

  it('M-10: reposition() without force still respects the hidden guard (drag while hidden is a no-op)', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    bubble.visible = false;
    calls = [];
    service.reposition();
    expect(calls).not.toContain('repositionBubble');
    await service.dispose();
  });

  it('M-8: bubbleHidden() clears the hover pin, restores click-through and re-arms the owed hide', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    runner().emit('sentence', { turnId: 't1', seq: 0, text: '你好。', emotion: 'neutral' });
    ipcHandlers.get(Channels.bubbleHover)!({ inside: true }, bubble); // pinned, click-through off
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 't1' }, bubble); // hide owed, deferred by the pin
    calls = [];

    // A verdict-driven hide lands under the pointer; no pointerleave will ever be delivered.
    bubble.visible = false;
    service.bubbleHidden();
    expect(calls).toContain('clickThrough:true');

    // The pin is gone, so the debt is re-armed instead of being stranded forever.
    vi.advanceTimersByTime(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);

    // Next show is click-through and NOT pinned: a fresh turnDone hides on schedule.
    bubbleVisible.length = 0;
    runner().emit('state', { state: 'thinking', turnId: 't2' });
    runner().emit('sentence', { turnId: 't2', seq: 0, text: '再见。', emotion: 'neutral' });
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 't2' }, bubble);
    vi.advanceTimersByTime(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);
    await service.dispose();
  });

  it('M-8: bubbleHidden() while not pinned and nothing owed changes nothing but click-through', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    calls = [];
    service.bubbleHidden();
    expect(calls).toEqual(['clickThrough:true']);
    await service.dispose();
  });
});
