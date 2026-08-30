import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeImage = { isEmpty: () => boolean; source: string };
/** Only the fields the menu assertions read; `Menu.buildFromTemplate` is mocked to pass it through. */
type MenuItemTemplate = { label?: string; type?: string; click?: () => void };

/** Flipped per test: `createFromPath` returns an *empty* image when the file is missing. */
let pathIconEmpty = false;
const built: { icon: FakeImage; guid?: string; menu?: MenuItemTemplate[] }[] = [];

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
    setContextMenu(menu: MenuItemTemplate[]): void {
      built[built.length - 1].menu = menu;
    }
  },
}));

const { createTray } = await import('./tray');

const actions = {
  toggleVisible: vi.fn(), toggleDebug: vi.fn(), openChat: vi.fn(), openKey: vi.fn(), quit: vi.fn(),
};

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

  it('offers 打开对话 and 设置 API Key above the separator, wired to their actions', () => {
    // Fresh spies: the shared `actions` literal is never reset between cases.
    const local = {
      toggleVisible: vi.fn(), toggleDebug: vi.fn(), openChat: vi.fn(), openKey: vi.fn(), quit: vi.fn(),
    };
    createTray(local);
    const menu = built[0].menu ?? [];
    expect(menu.map((i) => i.label ?? i.type)).toEqual([
      '显示/隐藏', '打开对话', '设置 API Key', '调试面板', 'separator', '退出',
    ]);
    menu.find((i) => i.label === '打开对话')?.click?.();
    menu.find((i) => i.label === '设置 API Key')?.click?.();
    expect(local.openChat).toHaveBeenCalledTimes(1);
    expect(local.openKey).toHaveBeenCalledTimes(1);
  });
});
