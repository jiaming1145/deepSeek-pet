import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels, InvokeChannels } from '@ds/protocol';

type Listener = (event: unknown, payload: unknown) => void;
type InvokeHandler = (event: unknown, payload: unknown) => Promise<unknown>;
const listeners = new Map<string, Listener>();
const handlers = new Map<string, InvokeHandler>();
const ipcMain = {
  on: (channel: string, cb: Listener) => listeners.set(channel, cb),
  handle: (channel: string, cb: InvokeHandler) => handlers.set(channel, cb),
  removeHandler: (channel: string) => handlers.delete(channel),
};

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  ipcMain: {
    on: (channel: string, cb: Listener) => ipcMain.on(channel, cb),
    handle: (channel: string, cb: InvokeHandler) => ipcMain.handle(channel, cb),
    removeHandler: (channel: string) => ipcMain.removeHandler(channel),
  },
}));

const { isFromPet, isFromWindow, onFromAny, onFromPet, sendTo, sendToPet } = await import('./ipc');
const { handleInvoke } = await import('./invoke');

/** A pet window whose main frame sits on the production origin. */
function fakePet(url = 'app://local/pet.html') {
  const mainFrame = { url };
  const webContents = { isDestroyed: () => false, mainFrame, send: vi.fn() };
  return { pet: { isDestroyed: () => false, webContents }, webContents, mainFrame };
}

describe('isFromPet', () => {
  it('accepts the pet main frame on the production origin', () => {
    const { pet, webContents, mainFrame } = fakePet();
    expect(isFromPet({ sender: webContents, senderFrame: mainFrame }, pet)).toBe(true);
  });

  it('rejects the webContents of a different window', () => {
    const { pet, mainFrame } = fakePet();
    const other = { isDestroyed: () => false, mainFrame, send: vi.fn() };
    expect(isFromPet({ sender: other, senderFrame: mainFrame }, pet)).toBe(false);
  });

  it('rejects a subframe of the pet document', () => {
    const { pet, webContents } = fakePet();
    const iframe = { url: 'app://local/pet.html' }; // right origin, wrong frame
    expect(isFromPet({ sender: webContents, senderFrame: iframe }, pet)).toBe(false);
  });

  it('rejects a missing sender frame (the frame died mid-flight)', () => {
    const { pet, webContents } = fakePet();
    expect(isFromPet({ sender: webContents, senderFrame: null }, pet)).toBe(false);
  });

  it.each(['app://other/pet.html', 'https://evil.example/pet.html', 'app://local:1/pet.html'])(
    'rejects the pet main frame after it navigated to %s',
    (url) => {
      const { pet, webContents, mainFrame } = fakePet(url);
      expect(isFromPet({ sender: webContents, senderFrame: mainFrame }, pet)).toBe(false);
    },
  );

  it('rejects everything once the window or its webContents is destroyed', () => {
    const { webContents, mainFrame } = fakePet();
    const dead = { isDestroyed: () => true, webContents };
    expect(isFromPet({ sender: webContents, senderFrame: mainFrame }, dead)).toBe(false);

    const deadContents = { isDestroyed: () => true, mainFrame, send: vi.fn() };
    const alive = { isDestroyed: () => false, webContents: deadContents };
    expect(isFromPet({ sender: deadContents, senderFrame: mainFrame }, alive)).toBe(false);
  });
});

describe('onFromPet', () => {
  beforeEach(() => {
    listeners.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes the callback for a valid event from the pet main frame', () => {
    const { pet, webContents, mainFrame } = fakePet();
    const cb = vi.fn();
    onFromPet(pet as never, Channels.avatarHover, cb);
    listeners.get(Channels.avatarHover)?.({ sender: webContents, senderFrame: mainFrame }, { inside: true });
    expect(cb).toHaveBeenCalledWith({ inside: true }, pet);
  });

  /** Registers the hover handler for `pet` and delivers one raw event to it. */
  function deliver(pet: unknown, event: unknown, payload: unknown = { inside: true }): ReturnType<typeof vi.fn> {
    const cb = vi.fn();
    onFromPet(pet as never, Channels.avatarHover, cb);
    listeners.get(Channels.avatarHover)?.(event, payload);
    return cb;
  }

  it('never invokes the callback for an event from another window', () => {
    const f = fakePet();
    const other = fakePet();
    expect(deliver(f.pet, { sender: other.webContents, senderFrame: other.mainFrame })).not.toHaveBeenCalled();
  });

  it('never invokes the callback for an event from a subframe', () => {
    const f = fakePet();
    // Same webContents and same origin, but not the main frame.
    expect(deliver(f.pet, { sender: f.webContents, senderFrame: { url: f.mainFrame.url } })).not.toHaveBeenCalled();
  });

  it('never invokes the callback for an event from an app://other document', () => {
    const foreign = fakePet('app://other/pet.html');
    expect(deliver(foreign.pet, { sender: foreign.webContents, senderFrame: foreign.mainFrame })).not.toHaveBeenCalled();
  });

  it('never invokes the callback after the pet navigates to an https page', () => {
    const f = fakePet();
    const cb = vi.fn();
    onFromPet(f.pet as never, Channels.avatarDrag, cb);
    f.mainFrame.url = 'https://evil.example/pet.html'; // top-level navigation happened
    listeners.get(Channels.avatarDrag)?.({ sender: f.webContents, senderFrame: f.mainFrame }, { dx: 1, dy: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('still rejects a malformed payload from a trusted sender', () => {
    const f = fakePet();
    const cb = vi.fn();
    onFromPet(f.pet as never, Channels.avatarDrag, cb);
    listeners.get(Channels.avatarDrag)?.(
      { sender: f.webContents, senderFrame: f.mainFrame },
      { dx: Number.POSITIVE_INFINITY, dy: 0 },
    );
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('sendToPet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a validated payload', () => {
    const send = vi.fn();
    const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
    sendToPet(win, Channels.gazeCursor, { x: 1, y: 2 });
    expect(send).toHaveBeenCalledWith(Channels.gazeCursor, { x: 1, y: 2 });
  });

  it('is a no-op — not a throw — when the webContents is destroyed', () => {
    const send = vi.fn();
    const win = { isDestroyed: () => false, webContents: { isDestroyed: () => true, send } };
    expect(() => sendToPet(win, Channels.gazeCursor, { x: 1, y: 2 })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('is a no-op when the window itself is destroyed', () => {
    const send = vi.fn();
    const win = { isDestroyed: () => true, webContents: { isDestroyed: () => false, send } };
    expect(() => sendToPet(win, Channels.gazeCursor, { x: 1, y: 2 })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows a send that throws mid-teardown', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const win = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: () => { throw new Error('Object has been destroyed'); },
      },
    };
    expect(() => sendToPet(win, Channels.gazeCursor, { x: 1, y: 2 })).not.toThrow();
  });

  it('still throws on a payload that does not match its schema (a main-process bug)', () => {
    const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } };
    expect(() => sendToPet(win, Channels.gazeCursor, { x: Number.NaN, y: 0 })).toThrow(/refusing to send/);
  });
});

describe('isFromWindow / sendTo / onFromAny', () => {
  beforeEach(() => {
    listeners.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the same predicate isFromPet uses, generalised to any window', () => {
    const { pet, webContents, mainFrame } = fakePet();
    const event = { sender: webContents, senderFrame: mainFrame };
    expect(isFromWindow(event, pet)).toBe(true);
    expect(isFromWindow(event, pet)).toBe(isFromPet(event, pet));
    expect(isFromWindow({ sender: {}, senderFrame: mainFrame }, pet)).toBe(false);
  });

  it('sendTo is a no-op on a null window instead of throwing', () => {
    expect(() => sendTo(null, Channels.brainState, { state: 'idle', turnId: 't1' })).not.toThrow();
  });

  it('onFromAny accepts an event from any window in the list and hands that window back', () => {
    const a = fakePet();
    const b = fakePet();
    const cb = vi.fn();
    onFromAny([a.pet as never, b.pet as never], Channels.bubbleHover, cb);
    listeners.get(Channels.bubbleHover)?.({ sender: b.webContents, senderFrame: b.mainFrame }, { inside: true });
    expect(cb).toHaveBeenCalledWith({ inside: true }, b.pet);
  });

  it('onFromAny rejects an event from a window that is not in the list', () => {
    const a = fakePet();
    const stranger = fakePet();
    const cb = vi.fn();
    onFromAny([a.pet as never], Channels.bubbleHover, cb);
    listeners.get(Channels.bubbleHover)?.(
      { sender: stranger.webContents, senderFrame: stranger.mainFrame },
      { inside: true },
    );
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('handleInvoke', () => {
  beforeEach(() => {
    handlers.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an event whose sender is not in its windows list (D14)', async () => {
    const owner = fakePet();
    const stranger = fakePet();
    handleInvoke(InvokeChannels.historyDelete, [owner.pet as never], async () => ({ ok: true, deleted: 1 }));
    await expect(
      handlers.get(InvokeChannels.historyDelete)?.(
        { sender: stranger.webContents, senderFrame: stranger.mainFrame },
        { turnId: 't1' },
      ),
    ).rejects.toThrow(/untrusted sender/);
  });

  it('rejects a malformed request before the handler runs', async () => {
    const owner = fakePet();
    const cb = vi.fn(async () => ({ ok: true as const, deleted: 1 }));
    handleInvoke(InvokeChannels.historyDelete, [owner.pet as never], cb);
    await expect(
      handlers.get(InvokeChannels.historyDelete)?.(
        { sender: owner.webContents, senderFrame: owner.mainFrame },
        { turnId: '' },
      ),
    ).rejects.toThrow(/rejected history:delete/);
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns the parsed response for a valid request from a listed window', async () => {
    const owner = fakePet();
    handleInvoke(InvokeChannels.historyDelete, [owner.pet as never], async ({ turnId }) => {
      expect(turnId).toBe('t1');
      return { ok: true as const, deleted: 2 };
    });
    await expect(
      handlers.get(InvokeChannels.historyDelete)?.(
        { sender: owner.webContents, senderFrame: owner.mainFrame },
        { turnId: 't1' },
      ),
    ).resolves.toEqual({ ok: true, deleted: 2 });
  });
});
