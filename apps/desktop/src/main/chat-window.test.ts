import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

class FakeWindow {
  static nextLoadResult: Promise<void> | null = null;
  readonly calls: string[] = [];
  readonly wcHandlers = new Map<string, Handler[]>();
  readonly wcOnce = new Map<string, Handler[]>();
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  destroyed = false;
  visible = false;
  loading = false;
  readonly webContents = {
    isDestroyed: () => this.destroyed,
    isLoading: () => this.loading,
    on: (event: string, cb: Handler) => {
      this.wcHandlers.set(event, [...(this.wcHandlers.get(event) ?? []), cb]);
    },
    once: (event: string, cb: Handler) => {
      this.wcOnce.set(event, [...(this.wcOnce.get(event) ?? []), cb]);
    },
    removeListener: (event: string, cb: Handler) => {
      this.wcOnce.set(event, (this.wcOnce.get(event) ?? []).filter((h) => h !== cb));
    },
    send: (channel: string, payload: unknown) => {
      this.sent.push({ channel, payload });
    },
    setWindowOpenHandler: () => {},
    reload: () => {
      this.calls.push('reload');
    },
  };

  constructor(readonly options: Record<string, unknown>) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }
  isVisible(): boolean {
    return this.visible;
  }
  setAlwaysOnTop(): void {}
  show(): void {
    this.visible = true;
    this.calls.push('show');
  }
  focus(): void {}
  hide(): void {
    this.visible = false;
    this.calls.push('hide');
  }
  getBounds() {
    return { x: 0, y: 0, width: 100, height: 100 };
  }
  setBounds(): void {}
  loadURL(url: string): Promise<void> {
    this.calls.push(`loadURL:${url}`);
    const result = FakeWindow.nextLoadResult ?? Promise.resolve();
    FakeWindow.nextLoadResult = null;
    return result;
  }
  on(): void {}
  once(): void {}
  emitWebContents(event: string, ...args: unknown[]): void {
    for (const h of this.wcHandlers.get(event) ?? []) h(...args);
  }
  fireOnce(event: string): void {
    const hs = this.wcOnce.get(event) ?? [];
    this.wcOnce.set(event, []);
    for (const h of hs) h();
  }
}

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: FakeWindow,
  screen: { getDisplayMatching: () => ({ workArea }) },
}));

const { createChatWindow, isChatComposing, openChat, setChatComposing } = await import('./chat-window');

function build(loadResult: Promise<void> | null = null) {
  FakeWindow.nextLoadResult = loadResult;
  const hooks = { onLoadFailure: vi.fn(), onUnrecoverable: vi.fn() };
  const win = createChatWindow(hooks) as unknown as FakeWindow;
  return { win, hooks };
}
const crash = (win: FakeWindow): void => win.emitWebContents('render-process-gone', {}, { reason: 'crashed' });
const pet = { getBounds: () => ({ x: 500, y: 300, width: 420, height: 720 }) } as never;

describe('G2-6: chat window load and crash recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setChatComposing(false);
  });

  it('routes a rejected loadURL to onLoadFailure and ignores ERR_ABORTED', async () => {
    const err = Object.assign(new Error('ERR_FILE_NOT_FOUND'), { errno: -6 });
    const { hooks } = build(Promise.reject(err));
    await vi.waitFor(() => expect(hooks.onLoadFailure).toHaveBeenCalledWith(err));
    const aborted = build(Promise.reject(Object.assign(new Error('aborted'), { code: 'ERR_ABORTED' })));
    await new Promise((r) => setTimeout(r, 0));
    expect(aborted.hooks.onLoadFailure).not.toHaveBeenCalled();
  });

  it('first death: hides the window, clears composing and the pending chat:opened, reloads once', () => {
    const { win, hooks } = build();
    win.loading = true;
    openChat(win as never, pet, true); // first open during the initial load: chat:opened is pending
    expect(win.visible).toBe(true);
    expect(win.wcOnce.get('did-finish-load')).toHaveLength(1);
    setChatComposing(true);
    win.calls.length = 0;

    crash(win);
    expect(win.visible).toBe(false);
    expect(isChatComposing()).toBe(false);
    expect(win.wcOnce.get('did-finish-load')).toEqual([]);
    expect(win.calls).toEqual(['hide', 'reload']);
    expect(hooks.onUnrecoverable).not.toHaveBeenCalled();

    // The reloaded page must not receive the stale open for a window that is now hidden.
    win.fireOnce('did-finish-load');
    expect(win.sent.filter((s) => s.channel === 'chat:opened')).toHaveLength(0);
  });

  it('second death after the reload, or a failed reload, is unrecoverable', () => {
    const { win, hooks } = build();
    win.calls.length = 0;
    crash(win);
    crash(win);
    expect(win.calls.filter((c) => c === 'reload')).toHaveLength(1);
    expect(hooks.onUnrecoverable).toHaveBeenCalledTimes(1);

    const other = build();
    crash(other.win);
    other.win.emitWebContents('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'app://local/chat.html', true);
    expect(other.hooks.onUnrecoverable).toHaveBeenCalledTimes(1);
  });

  it('a normal open after the page loaded sends chat:opened and leaves nothing pending', () => {
    const { win } = build();
    openChat(win as never, pet, false);
    expect(win.sent).toEqual([{ channel: 'chat:opened', payload: { focusComposer: false } }]);
    expect(win.wcOnce.get('did-finish-load') ?? []).toEqual([]);
  });
});
