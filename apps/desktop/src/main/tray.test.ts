import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeImage = { isEmpty: () => boolean; source: string };

/** Flipped per test: `createFromPath` returns an *empty* image when the file is missing. */
let pathIconEmpty = false;
const built: { icon: FakeImage; guid?: string }[] = [];

vi.mock('electron', () => ({
  app: { isPackaged: false },
  Menu: { buildFromTemplate: (template: unknown) => template },
  nativeImage: {
    createFromPath: (): FakeImage => ({ isEmpty: () => pathIconEmpty, source: 'path' }),
    createFromDataURL: (url: string): FakeImage => ({ isEmpty: () => false, source: url }),
  },
  Tray: class {
    constructor(icon: FakeImage, guid?: string) {
      built.push({ icon, guid });
    }
    setToolTip(): void {}
    setContextMenu(): void {}
  },
}));

const { createTray } = await import('./tray');

const actions = { toggleVisible: vi.fn(), toggleDebug: vi.fn(), quit: vi.fn() };

beforeEach(() => {
  built.length = 0;
  pathIconEmpty = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTray', () => {
  it('uses the on-disk icon when it decodes', () => {
    createTray(actions);
    expect(built).toHaveLength(1);
    expect(built[0].icon.source).toBe('path');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('falls back to a non-empty built-in icon when the file is missing, and still creates the tray', () => {
    pathIconEmpty = true;
    const tray = createTray(actions);
    expect(tray).toBeDefined();
    expect(built).toHaveLength(1);
    // An empty NativeImage gives a tray entry with no clickable target — never construct with one.
    expect(built[0].icon.isEmpty()).toBe(false);
    expect(built[0].icon.source).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(console.warn).toHaveBeenCalled();
  });

  it('embeds a decodable 16x16 PNG as the fallback', () => {
    pathIconEmpty = true;
    createTray(actions);
    const base64 = built[0].icon.source.replace('data:image/png;base64,', '');
    const png = Buffer.from(base64, 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG signature
    expect(png.readUInt32BE(16)).toBe(16); // IHDR width
    expect(png.readUInt32BE(20)).toBe(16); // IHDR height
  });
});
