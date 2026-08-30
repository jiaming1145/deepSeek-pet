import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

class FakeWindow {
  static nextLoadResult: Promise<void> | null = null;
  readonly calls: string[] = [];
  readonly wcHandlers = new Map<string, Handler[]>();
  destroyed = false;
  visible = false;
  readonly webContents = {
    on: (event: string, cb: Handler) => {
      this.wcHandlers.set(event, [...(this.wcHandlers.get(event) ?? []), cb]);
    },
    setWindowOpenHandler: () => {},
  };

  constructor(readonly options: Record<string, unknown>) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }
  isVisible(): boolean {
    return this.visible;
  }
  show(): void {
    this.visible = true;
    this.calls.push('show');
  }
  focus(): void {
    this.calls.push('focus');
  }
  hide(): void {
    this.visible = false;
    this.calls.push('hide');
  }
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
}

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: FakeWindow,
}));

const { createKeyWindow, openKeyWindow } = await import('./key-window');

function build(loadResult: Promise<void> | null = null) {
  FakeWindow.nextLoadResult = loadResult;
  const hooks = { onLoadFailure: vi.fn(), onCrash: vi.fn() };
  const win = createKeyWindow(hooks) as unknown as FakeWindow;
  return { win, hooks };
}

describe('CX-7: key window load and crash', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads key.html and routes a rejected load to onLoadFailure (ERR_ABORTED ignored)', async () => {
    expect(build().win.calls).toContain('loadURL:app://local/key.html');
    const err = Object.assign(new Error('ERR_FILE_NOT_FOUND'), { errno: -6 });
    const { hooks } = build(Promise.reject(err));
    await vi.waitFor(() => expect(hooks.onLoadFailure).toHaveBeenCalledWith(err));
    const aborted = build(Promise.reject(Object.assign(new Error('aborted'), { errno: -3 })));
    await new Promise((r) => setTimeout(r, 0));
    expect(aborted.hooks.onLoadFailure).not.toHaveBeenCalled();
  });

  it('a dead renderer hides the window and reports onCrash so the next open recreates it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { win, hooks } = build();
    openKeyWindow(win as never, 'user');
    expect(win.visible).toBe(true);
    win.emitWebContents('render-process-gone', {}, { reason: 'crashed' });
    expect(win.visible).toBe(false);
    expect(hooks.onCrash).toHaveBeenCalledTimes(1);
  });
});
