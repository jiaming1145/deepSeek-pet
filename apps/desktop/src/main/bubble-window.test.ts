import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

/** Records everything `createBubbleWindow` does to a real BrowserWindow. */
class FakeWindow {
  static nextLoadResult: Promise<void> | null = null;
  readonly calls: string[] = [];
  readonly ignoreMouse: boolean[] = [];
  readonly wcHandlers = new Map<string, Handler[]>();
  destroyed = false;
  readonly webContents = {
    on: (event: string, cb: Handler) => {
      this.wcHandlers.set(event, [...(this.wcHandlers.get(event) ?? []), cb]);
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
  setAlwaysOnTop(): void {}
  setVisibleOnAllWorkspaces(): void {}
  setIgnoreMouseEvents(ignore: boolean): void {
    this.ignoreMouse.push(ignore);
  }
  loadURL(url: string): Promise<void> {
    this.calls.push(`loadURL:${url}`);
    const result = FakeWindow.nextLoadResult ?? Promise.resolve();
    FakeWindow.nextLoadResult = null;
    return result;
  }
  once(): void {}
  emitWebContents(event: string, ...args: unknown[]): void {
    for (const h of this.wcHandlers.get(event) ?? []) h(...args);
  }
}

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: FakeWindow,
  screen: {},
}));

const { createBubbleWindow } = await import('./bubble-window');

function build(loadResult: Promise<void> | null = null) {
  FakeWindow.nextLoadResult = loadResult;
  const hooks = {
    onLoadFailure: vi.fn(),
    onCrash: vi.fn(),
    onReloaded: vi.fn(),
    onUnrecoverable: vi.fn(),
  };
  const win = createBubbleWindow(hooks) as unknown as FakeWindow;
  return { win, hooks };
}

const crash = (win: FakeWindow): void => win.emitWebContents('render-process-gone', {}, { reason: 'crashed' });

describe('G2-6: the bubble load is observed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a rejected loadURL to onLoadFailure', async () => {
    const err = Object.assign(new Error('ERR_FILE_NOT_FOUND'), { errno: -6 });
    const { hooks } = build(Promise.reject(err));
    await vi.waitFor(() => expect(hooks.onLoadFailure).toHaveBeenCalledWith(err));
  });

  it('ignores ERR_ABORTED (a superseded or destroyed load)', async () => {
    const { hooks } = build(Promise.reject(Object.assign(new Error('aborted'), { errno: -3 })));
    await new Promise((r) => setTimeout(r, 0));
    expect(hooks.onLoadFailure).not.toHaveBeenCalled();
  });
});

describe('CX-6: bubble render-process-gone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('first death: click-through, onCrash BEFORE the reload, one reload, onReloaded when the page is back', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { win, hooks } = build();
    const order: string[] = [];
    hooks.onCrash.mockImplementation(() => order.push('onCrash'));
    win.calls.length = 0;
    win.ignoreMouse.length = 0;

    crash(win);
    expect(win.ignoreMouse).toEqual([true]);
    expect(hooks.onCrash).toHaveBeenCalledTimes(1);
    expect(win.calls).toEqual(['reload']);
    expect([...order, ...win.calls]).toEqual(['onCrash', 'reload']);
    expect(hooks.onUnrecoverable).not.toHaveBeenCalled();

    win.emitWebContents('did-finish-load');
    expect(hooks.onReloaded).toHaveBeenCalledTimes(1);
  });

  it('a page that comes back normally before any crash does not fire onReloaded', () => {
    const { win, hooks } = build();
    win.emitWebContents('did-finish-load');
    expect(hooks.onReloaded).not.toHaveBeenCalled();
  });

  it('second death after the reload: onUnrecoverable, no second reload', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { win, hooks } = build();
    win.calls.length = 0;
    crash(win);
    crash(win);
    expect(hooks.onCrash).toHaveBeenCalledTimes(2);
    expect(win.calls).toEqual(['reload']);
    expect(hooks.onUnrecoverable).toHaveBeenCalledTimes(1);
  });

  it('the reload itself failing (main frame, not aborted) is unrecoverable; other did-fail-loads are not', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { win, hooks } = build();
    // Before any crash the startup load's own promise owns failures.
    win.emitWebContents('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'app://local/bubble.html', true);
    expect(hooks.onUnrecoverable).not.toHaveBeenCalled();
    crash(win);
    win.emitWebContents('did-fail-load', {}, -3, 'ABORTED', 'app://local/bubble.html', true);
    win.emitWebContents('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'app://local/x', false); // subframe
    expect(hooks.onUnrecoverable).not.toHaveBeenCalled();
    win.emitWebContents('did-fail-load', {}, -6, 'FILE_NOT_FOUND', 'app://local/bubble.html', true);
    expect(hooks.onUnrecoverable).toHaveBeenCalledTimes(1);
  });

  it('a window destroyed by onCrash is not reloaded', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { win, hooks } = build();
    hooks.onCrash.mockImplementation(() => {
      win.destroyed = true;
    });
    win.calls.length = 0;
    crash(win);
    expect(win.calls).toEqual([]);
  });
});
