import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

/** Records everything `createPetWindow` does to a real BrowserWindow. */
class FakeWindow {
  /** Result the next `loadURL` returns; consumed once, so a rejection cannot leak between tests. */
  static nextLoadResult: Promise<void> | null = null;
  readonly calls: string[] = [];
  readonly ignoreMouse: { ignore: boolean; forward?: boolean }[] = [];
  readonly onceHandlers = new Map<string, Handler>();
  readonly wcHandlers = new Map<string, Handler>();
  destroyed = false;
  position: [number, number] = [100, 100];
  windowOpenHandler: (() => { action: string }) | null = null;
  readonly webContents = {
    on: (event: string, cb: Handler) => this.wcHandlers.set(event, cb),
    setWindowOpenHandler: (h: () => { action: string }) => {
      this.windowOpenHandler = h;
    },
  };

  constructor(readonly options: Record<string, unknown>) {}

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.calls.push('destroy');
  }

  setAlwaysOnTop(): void {}
  setVisibleOnAllWorkspaces(): void {}

  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    this.ignoreMouse.push({ ignore, forward: options?.forward });
  }

  getPosition(): [number, number] {
    return this.position;
  }

  setPosition(x: number, y: number): void {
    this.position = [x, y];
  }

  loadURL(url: string): Promise<void> {
    this.calls.push(`loadURL:${url}`);
    const result = FakeWindow.nextLoadResult ?? Promise.resolve();
    FakeWindow.nextLoadResult = null;
    return result;
  }

  once(event: string, cb: Handler): void {
    this.onceHandlers.set(event, cb);
  }

  emitOnce(event: string, ...args: unknown[]): void {
    this.onceHandlers.get(event)?.(...args);
  }

  emitWebContents(event: string, ...args: unknown[]): void {
    this.wcHandlers.get(event)?.(...args);
  }
}

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ds-test-userdata' },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea }] },
  BrowserWindow: FakeWindow,
}));

const { createPetWindow, handleLoadFailure, moveBy, PET_SIZE, setClickThrough } = await import('./pet-window');

function build(overrides: { onReadyToShow?: () => void; onLoadFailure?: (err: unknown) => void } = {}) {
  const onReadyToShow = overrides.onReadyToShow ?? vi.fn();
  const onLoadFailure = overrides.onLoadFailure ?? vi.fn();
  const win = createPetWindow({ onReadyToShow, onLoadFailure }) as unknown as FakeWindow;
  return { win, onReadyToShow, onLoadFailure };
}

beforeEach(() => {
  FakeWindow.nextLoadResult = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ELECTRON_RENDERER_URL;
});

describe('createPetWindow', () => {
  it('never shows itself — ready-to-show only calls the supplied callback', () => {
    const { win, onReadyToShow } = build();
    // The whole point of F1: no `showInactive` anywhere in this file.
    expect(win.calls.some((c) => c.startsWith('show'))).toBe(false);
    win.emitOnce('ready-to-show');
    expect(onReadyToShow).toHaveBeenCalledTimes(1);
  });

  it('starts click-through and loads the production pet URL', () => {
    const { win } = build();
    expect(win.ignoreMouse[0]).toEqual({ ignore: true, forward: true });
    expect(win.calls).toContain('loadURL:app://local/pet.html');
    expect(win.options.show).toBe(false);
  });

  it('places the window inside the work area, not the display bounds', () => {
    const { win } = build();
    expect(win.options.x).toBe(1920 - PET_SIZE.w - 24);
    expect(win.options.y).toBe(1040 - PET_SIZE.h - 24);
  });

  it('denies window.open', () => {
    const { win } = build();
    expect(win.windowOpenHandler?.()).toEqual({ action: 'deny' });
  });

  it('allows navigation to the pet origin and blocks anything else', () => {
    const { win } = build();
    const attempt = (url: string): boolean => {
      let prevented = false;
      win.emitWebContents('will-navigate', { url, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    expect(attempt('app://local/pet.html')).toBe(false);
    expect(attempt('app://other/pet.html')).toBe(true);
    expect(attempt('https://evil.example/')).toBe(true);
    expect(attempt('app://local:1/pet.html')).toBe(true);
  });

  it('allows navigation to the configured dev origin', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    const { win } = build();
    let prevented = false;
    win.emitWebContents('will-navigate', {
      url: 'http://localhost:5173/pet.html',
      preventDefault: () => { prevented = true; },
    });
    expect(prevented).toBe(false);
    expect(win.calls).toContain('loadURL:http://localhost:5173/pet.html');
  });

  it('restores click-through on a main-frame navigation', () => {
    const { win } = build();
    setClickThrough(win as never, false); // the renderer said the cursor is on the avatar
    expect(win.ignoreMouse.at(-1)).toEqual({ ignore: false, forward: undefined });

    win.emitWebContents('did-start-navigation', { isMainFrame: true, url: 'app://local/pet.html' });
    expect(win.ignoreMouse.at(-1)).toEqual({ ignore: true, forward: true });
  });

  it('leaves click-through alone for a subframe navigation', () => {
    const { win } = build();
    setClickThrough(win as never, false);
    win.emitWebContents('did-start-navigation', { isMainFrame: false, url: 'app://local/frame.html' });
    expect(win.ignoreMouse.at(-1)).toEqual({ ignore: false, forward: undefined });
  });

  it('restores click-through when the render process dies', () => {
    const { win } = build();
    setClickThrough(win as never, false);
    win.emitWebContents('render-process-gone', {}, { reason: 'crashed' });
    expect(win.ignoreMouse.at(-1)).toEqual({ ignore: true, forward: true });
  });

  it('routes a rejected loadURL to onLoadFailure', async () => {
    const boom = new Error('ERR_FILE_NOT_FOUND');
    FakeWindow.nextLoadResult = Promise.reject(boom);
    const { win, onLoadFailure } = build();
    // The listeners are registered before the load is observed, never after awaiting it.
    expect(win.onceHandlers.has('ready-to-show')).toBe(true);
    expect(win.wcHandlers.has('will-navigate')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(onLoadFailure).toHaveBeenCalledWith(boom);
  });
});

describe('handleLoadFailure', () => {
  it('tears the startup down in dependency order and quits', () => {
    const order: string[] = [];
    handleLoadFailure(new Error('nope'), {
      destroyWindow: () => order.push('destroyWindow'),
      stopCursor: () => order.push('stopCursor'),
      stopForeground: () => order.push('stopForeground'),
      destroyTray: () => order.push('destroyTray'),
      quit: () => order.push('quit'),
    });
    expect(order).toEqual(['destroyWindow', 'stopCursor', 'stopForeground', 'destroyTray', 'quit']);
  });

  it('still quits when an earlier cleanup step throws', () => {
    const order: string[] = [];
    handleLoadFailure(new Error('nope'), {
      destroyWindow: () => { throw new Error('already destroyed'); },
      stopCursor: () => order.push('stopCursor'),
      stopForeground: () => order.push('stopForeground'),
      destroyTray: () => { throw new Error('no tray'); },
      quit: () => order.push('quit'),
    });
    expect(order).toEqual(['stopCursor', 'stopForeground', 'quit']);
  });
});

describe('moveBy', () => {
  it('keeps a grabbable margin of her inside the work area, never fully off', () => {
    const { win } = build();
    win.position = [1000, 200];
    moveBy(win as never, 100000, 100000);
    // A live drag may hang off the edge (like any window) but 48 px stay grabbable — not 101000/100200.
    expect(win.position).toEqual([1920 - 48, 1040 - 48]);

    moveBy(win as never, -100000, -100000);
    expect(win.position).toEqual([-(PET_SIZE.w - 48), -(PET_SIZE.h - 48)]);
  });

  it('applies an ordinary delta unchanged', () => {
    const { win } = build();
    win.position = [500, 200];
    moveBy(win as never, 12, -7);
    expect(win.position).toEqual([512, 193]);
  });

  it('does nothing once the window is destroyed', () => {
    const { win } = build();
    win.position = [500, 200];
    win.destroyed = true;
    moveBy(win as never, 10, 10);
    expect(win.position).toEqual([500, 200]);
  });
});
