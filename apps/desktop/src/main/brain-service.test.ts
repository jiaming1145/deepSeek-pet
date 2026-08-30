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
  turnId: string | null = null;
  state: 'idle' | 'thinking' | 'speaking' = 'idle';
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

/** GC-5 / GC-6: one controllable probe, shared by the stored-key client and literal-key probes. */
interface ProbeCall { apiKey: string | null; signal: AbortSignal | undefined; resolve: (r: unknown) => void }
const probeCalls: ProbeCall[] = [];
let probeAutoResolveOnAbort = true;
function controllableClient(apiKey: string | null): unknown {
  return {
    stream: () => { throw new Error('not used'); },
    complete: () => Promise.reject(new Error('not used')),
    testKey: (signal?: AbortSignal) =>
      new Promise((resolve) => {
        const call: ProbeCall = { apiKey, signal, resolve };
        probeCalls.push(call);
        signal?.addEventListener('abort', () => {
          if (probeAutoResolveOnAbort) resolve({ ok: false, code: 'network', message: 'aborted' });
        }, { once: true });
      }),
  };
}

vi.mock('./fake-client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./fake-client')>();
  return { ...orig, createFakeClient: () => controllableClient(null) };
});

vi.mock('@ds/brain', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@ds/brain')>();
  return { ...orig, TurnRunner: FakeTurnRunner };
});

const { parseCharacterBundle } = await import('@ds/brain');
const { KV_FIRST_RUN_DONE, getKv, openDb, setKv } = await import('@ds/memory');
const { BUBBLE_HIDE_DELAY_MS, BUBBLE_LINGER_MS } = await import('./bubble-window');
const { BrainService, HINT_TTL_MS, STORAGE_HINT_TEXT, USER_ROW_LABEL } = await import('./brain-service');

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
/** G2-2: what the fake store's `trimSettled()` hands back — pending when a trim is "on the wire". */
let trimGate: Promise<void>;
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
    probeClient: (apiKey: string) => controllableClient(apiKey) as never,
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
  probeCalls.length = 0;
  probeAutoResolveOnAbort = true;
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
  trimGate = Promise.resolve();
  store = {
    append: (role: string, content: string, meta: unknown) => {
      appends.push([role, content, meta]);
      return appendImpl();
    },
    trimSettled: () => trimGate,
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
    const pending = keyTest!({});
    await Promise.resolve();
    probeCalls[0].resolve({ ok: true });
    await pending;
    const afterTest = key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown };
    expect(afterTest.lastTest).toEqual({ ok: true, at: expect.any(Number) });

    // 清除 → KeyStore.onChange → rebuildClient: lastTest describes the key stored NOW, i.e. none.
    for (const cb of keyListeners) cb({ present: false, source: 'none' });
    const afterClear = key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown; present: boolean };
    expect(afterClear).toEqual({ present: true, source: 'store', lastTest: null });
    expect(chat.payloads(Channels.keyStatus).at(-1)).toEqual(afterClear);
    await service.dispose();
  });

  it('GC-5: a delayed test of literal key A, then a rotation to B, then A resolving -> B\'s status is untouched', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const keyTest = invokeHandlers.get(InvokeChannels.keyTest)!;
    const A = 'sk-' + 'a'.repeat(32);
    const B = 'sk-' + 'b'.repeat(32);
    const pending = keyTest({ apiKey: A });
    await Promise.resolve();
    expect(probeCalls).toHaveLength(1);
    expect(probeCalls[0].apiKey).toBe(A);
    // Rotation: the store now holds B and KeyStore.onChange fires.
    keyStore.get = () => B;
    for (const cb of keyListeners) cb({ present: true, source: 'store' });
    expect(probeCalls[0].signal?.aborted).toBe(true); // an in-flight test of the old generation is aborted
    const statusesBefore = key.payloads(Channels.keyStatus).length;
    probeCalls[0].resolve({ ok: false, code: 'auth', message: 'HTTP 401: the API key was rejected' });
    const res = await pending;
    expect(res).toMatchObject({ ok: false }); // the invoke caller still gets ITS result
    expect(key.payloads(Channels.keyStatus)).toHaveLength(statusesBefore); // no broadcast for a stale test
    const last = key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown };
    expect(last.lastTest).toBeNull();
    await service.dispose();
  });

  it('GC-5: testing an unsaved literal key never updates the stored key\'s status', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const keyTest = invokeHandlers.get(InvokeChannels.keyTest)!;
    const A = 'sk-' + 'a'.repeat(32); // the store holds sk-test-key-… (a different key)
    const pending = keyTest({ apiKey: A });
    await Promise.resolve();
    const statusesBefore = key.payloads(Channels.keyStatus).length;
    probeCalls[0].resolve({ ok: true });
    expect(await pending).toEqual({ ok: true });
    expect(key.payloads(Channels.keyStatus)).toHaveLength(statusesBefore);
    expect((key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown }).lastTest).toBeNull();
    // The literal key that IS the stored key does describe the stored key.
    const same = keyTest({ apiKey: 'sk-test-key-000000000000000000000' });
    await Promise.resolve();
    probeCalls[1].resolve({ ok: true });
    await same;
    expect((key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown }).lastTest).toEqual({ ok: true, at: expect.any(Number) });
    await service.dispose();
  });

  it('GC-5: a stored-key test that resolves after a rotation does not stamp the new key', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const keyTest = invokeHandlers.get(InvokeChannels.keyTest)!;
    const pending = keyTest({});
    await Promise.resolve();
    keyStore.get = () => 'sk-' + 'c'.repeat(32);
    for (const cb of keyListeners) cb({ present: true, source: 'store' });
    probeCalls[0].resolve({ ok: true });
    await pending;
    expect((key.payloads(Channels.keyStatus).at(-1) as { lastTest: unknown }).lastTest).toBeNull();
    await service.dispose();
  });

  it('GC-6: dispose() aborts a pending key:test, waits for it to settle and sends no key:status afterwards', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    probeAutoResolveOnAbort = false;
    const service = makeService();
    service.start();
    const keyTest = invokeHandlers.get(InvokeChannels.keyTest)!;
    const pending = keyTest({});
    await Promise.resolve();
    expect(probeCalls).toHaveLength(1);
    const held = probeCalls[0];
    let disposed = false;
    const disposing = service.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(held.signal?.aborted).toBe(true);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(disposed).toBe(false); // the drain includes the in-flight key test
    const statuses = key.payloads(Channels.keyStatus).length;
    held.resolve({ ok: true });
    await pending;
    await disposing;
    expect(disposed).toBe(true);
    expect(key.payloads(Channels.keyStatus)).toHaveLength(statuses); // no post-dispose refresh
    expect(chat.payloads(Channels.keyStatus)).toHaveLength(statuses);
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

  it('GC-3 / A-38: a persistFailed from the runner warns, sends brain:error{code:storage} to the chat and shows the storage hint; idle -> the hint owns the hide', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = makeService();
    service.start();
    const r = runner();
    r.state = 'idle';
    const secret = 'sk-' + 'b'.repeat(32);
    r.emit('persistFailed', { turnId: 't1', label: 'assistant row', message: `SQLITE_FULL ${secret}` });
    const hints = bubble.payloads(Channels.hintShow) as Array<{ text: string; level: string; ttlMs: number }>;
    expect(hints).toHaveLength(1);
    expect(hints[0].level).toBe('warn');
    expect(hints[0].text).toBe(STORAGE_HINT_TEXT);
    expect(hints[0].ttlMs).toBe(HINT_TTL_MS);
    expect(bubbleVisible.at(-1)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain(secret);
    expect(String(warn.mock.calls[0])).toContain('assistant row');
    // A-38: the chat window gets the error code; the payload carries the hint copy, never the raw error.
    const errs = chat.payloads(Channels.brainError) as Array<{ turnId?: string; code: string; message: string }>;
    expect(errs).toEqual([{ turnId: 't1', code: 'storage', message: STORAGE_HINT_TEXT }]);
    expect(JSON.stringify(errs)).not.toContain('SQLITE_FULL');
    // The bubble renderer's brain:error handler drops the live reveal; a storage failure must not.
    expect(bubble.payloads(Channels.brainError)).toHaveLength(0);
    expect(openKeyWindow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);
    // Mid-turn (speaking): the hint is shown, but the turn's own playback keeps the hide.
    r.state = 'speaking';
    r.emit('state', { state: 'thinking', turnId: 't2' });
    r.emit('persistFailed', { turnId: 't2', label: 'user row', message: 'SQLITE_FULL' });
    expect(bubble.payloads(Channels.hintShow)).toHaveLength(2);
    // Fix round 1: the user row is hint-only — the chat still holds only the assistant-row error.
    expect(chat.payloads(Channels.brainError)).toHaveLength(1);
    vi.advanceTimersByTime(HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS + 1);
    expect(bubbleVisible.at(-1)).toBe(true);
    await service.dispose();
  });

  it('RESIDUAL2 fix round 1: a failed USER row is hint-only — no brain:error reaches the chat while its send is still pending; assistant-side rows still do', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = makeService();
    service.start();
    const r = runner();
    r.state = 'speaking';
    r.emit('state', { state: 'thinking', turnId: 't1' });
    // The user row fails early, while the reply is still streaming and the composer holds the send.
    r.emit('persistFailed', { turnId: 't1', label: USER_ROW_LABEL, message: 'SQLITE_FULL (user)' });
    expect(chat.payloads(Channels.brainError)).toHaveLength(0);
    expect(bubble.payloads(Channels.brainError)).toHaveLength(0);
    const hints = bubble.payloads(Channels.hintShow) as Array<{ text: string; level: string }>;
    expect(hints).toEqual([{ text: STORAGE_HINT_TEXT, level: 'warn', ttlMs: HINT_TTL_MS }]);
    // Assistant-side rows are reported after turnDone/error cleared the pending send: chat is told.
    for (const label of ['assistant row', 'interrupted assistant row', 'canned line']) {
      r.emit('persistFailed', { turnId: 't1', label, message: 'SQLITE_FULL' });
    }
    const errs = chat.payloads(Channels.brainError) as Array<{ turnId?: string; code: string; message: string }>;
    expect(errs).toHaveLength(3);
    for (const e of errs) expect(e).toEqual({ turnId: 't1', code: 'storage', message: STORAGE_HINT_TEXT });
    expect(bubble.payloads(Channels.brainError)).toHaveLength(0);
    expect(bubble.payloads(Channels.hintShow)).toHaveLength(4);
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

  it('G2-2: dispose() also waits for an in-flight trim/summarise before resolving', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    let releaseTrim: () => void = () => {};
    trimGate = new Promise<void>((resolve) => {
      releaseTrim = resolve;
    });
    const service = makeService();
    service.start();
    let disposed = false;
    const disposing = service.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(runner().cancelCalls).toBe(1);
    expect(disposed).toBe(false); // cancel settled at once; the trim is what holds the barrier
    releaseTrim();
    await disposing;
    expect(disposed).toBe(true);
  });

  it('CX-6: bubbleCrashed() mid-playback cancels the turn, drops the pin/timers/greeting and takes the window down', async () => {
    vi.useFakeTimers();
    const service = makeService(); // first run: the greeting is pending on the bubble's turnDone
    service.start();
    expect(bubble.payloads(Channels.brainSentence)).toHaveLength(1); // the greeting was broadcast
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    runner().emit('sentence', { turnId: 't1', seq: 0, text: '你好。', emotion: 'neutral' });
    ipcHandlers.get(Channels.bubbleHover)!({ inside: true }, bubble); // pinned
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 't1' }, bubble); // hide owed, deferred by the pin
    calls = [];
    bubbleVisible.length = 0;

    service.bubbleCrashed();
    expect(runner().cancelCalls).toBe(1);
    expect(bubbleVisible).toEqual([false]);
    // The greeting can never report its turnDone now; a late one must not persist it.
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 'first-mes' }, bubble);
    await Promise.resolve();
    expect(appends).toHaveLength(0);
    expect(getKv(db, KV_FIRST_RUN_DONE)).toBe(null);

    // Nothing brings the window back on its own (the late turnDone above may re-arm a harmless
    // hide of an already hidden window), and the pin is gone: the next turn behaves normally.
    bubbleVisible.length = 0;
    vi.advanceTimersByTime(10_000);
    expect(bubbleVisible).not.toContain(true);
    bubbleVisible.length = 0;
    runner().emit('state', { state: 'thinking', turnId: 't2' });
    expect(bubbleVisible).toEqual([true]);
    runner().emit('sentence', { turnId: 't2', seq: 0, text: '再见。', emotion: 'neutral' });
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 't2' }, bubble);
    vi.advanceTimersByTime(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);
    await service.dispose();
  });

  it('CX-6: bubbleCrashed() after dispose() is inert', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    await service.dispose();
    bubbleVisible.length = 0;
    service.bubbleCrashed();
    expect(bubbleVisible).toEqual([]);
  });

  it('CX-6: replaceBubble() routes every later send and placement to the new window', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    const fresh = new FakeWindow('bubble2');
    service.replaceBubble(fresh as unknown as BrowserWindow);
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    runner().emit('sentence', { turnId: 't1', seq: 0, text: '你好。', emotion: 'neutral' });
    expect(fresh.payloads(Channels.brainState)).toHaveLength(1);
    expect(fresh.payloads(Channels.brainSentence)).toHaveLength(1);
    expect(fresh.payloads(Channels.bubblePlace)).toHaveLength(1); // reposition(true) on the show
    expect(bubble.payloads(Channels.brainState)).toHaveLength(0);
    await service.dispose();
  });

  it('G2-5: hover-inside → hide → show — cursor OUTSIDE: no re-emitted hover, the next hide lands on schedule', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    runner().emit('sentence', { turnId: 't1', seq: 0, text: '你好。', emotion: 'neutral' });
    ipcHandlers.get(Channels.bubbleHover)!({ inside: true }, bubble);
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 't1' }, bubble);
    // Verdict hide while the window was ALREADY down (a lock that landed between two replays):
    // index.ts now calls bubbleHidden() regardless, so the pin cannot survive.
    bubble.visible = false;
    calls = [];
    service.bubbleHidden();
    expect(calls).toEqual(['clickThrough:true']);
    // Show again (verdict cleared, brain still wants it): the renderer is resynced by index.ts and,
    // with the cursor outside, re-emits nothing. The owed hide fires on schedule.
    bubble.visible = true;
    bubbleVisible.length = 0;
    vi.advanceTimersByTime(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);
    await service.dispose();
  });

  it('G2-5: hover-inside → hide → show — cursor INSIDE: the re-emitted hover re-pins and defers the hide until it leaves', async () => {
    vi.useFakeTimers();
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    runner().emit('state', { state: 'thinking', turnId: 't1' });
    runner().emit('sentence', { turnId: 't1', seq: 0, text: '你好。', emotion: 'neutral' });
    ipcHandlers.get(Channels.bubbleHover)!({ inside: true }, bubble);
    ipcHandlers.get(Channels.playbackTurnDone)!({ turnId: 't1' }, bubble);
    bubble.visible = false;
    service.bubbleHidden();
    bubble.visible = true;
    // The resync makes the renderer recompute its DOM hit: the pointer is still on the band.
    calls = [];
    ipcHandlers.get(Channels.bubbleHover)!({ inside: true }, bubble);
    expect(calls).toEqual(['clickThrough:false']);
    bubbleVisible.length = 0;
    vi.advanceTimersByTime(10 * (BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS));
    expect(bubbleVisible).toEqual([]); // pinned: the hide is deferred, not forgotten
    ipcHandlers.get(Channels.bubbleHover)!({ inside: false }, bubble);
    vi.advanceTimersByTime(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    expect(bubbleVisible.at(-1)).toBe(false);
    await service.dispose();
  });

  it('CX-3: an auth failure asks index.ts for the key window through the gated dep, never show()+focus() itself', async () => {
    setKv(db, KV_FIRST_RUN_DONE, '1');
    const service = makeService();
    service.start();
    runner().emit('error', { turnId: 't1', code: 'auth', message: 'bad key' });
    expect(openKeyWindow).toHaveBeenCalledWith('auth');
    expect(key.listeners.size).toBe(0); // the service never touches the key window's show/focus
    await service.dispose();
  });
});
