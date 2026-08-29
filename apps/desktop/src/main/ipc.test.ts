import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Channels } from '@ds/protocol';

type Listener = (event: unknown, payload: unknown) => void;
const listeners = new Map<string, Listener>();
const ipcMain = { on: (channel: string, cb: Listener) => listeners.set(channel, cb) };

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: (channel: string, cb: Listener) => ipcMain.on(channel, cb) },
}));

const { isFromPet, onFromPet, sendToPet } = await import('./ipc');

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
