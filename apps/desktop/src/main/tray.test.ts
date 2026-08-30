import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeImage = { isEmpty: () => boolean; source: string };
/** Only the fields the menu assertions read; `Menu.buildFromTemplate` is mocked to pass it through. */
type MenuItemTemplate = {
  label?: string; type?: string; checked?: boolean; click?: () => void; submenu?: MenuItemTemplate[];
};

/** Flipped per test: `createFromPath` returns an *empty* image when the file is missing. */
let pathIconEmpty = false;
const built: { icon: FakeImage; guid?: string; menu?: MenuItemTemplate[]; handlers: Record<string, () => void> }[] = [];

vi.mock('electron', () => ({
  app: { isPackaged: false },
  Menu: { buildFromTemplate: (template: unknown) => template },
  nativeImage: {
    createFromPath: (): FakeImage => ({ isEmpty: () => pathIconEmpty, source: 'path' }),
    createFromDataURL: (url: string): FakeImage => ({ isEmpty: () => false, source: url }),
  },
  Tray: class {
    constructor(icon: FakeImage, guid?: string) {
      built.push({ icon, guid, handlers: {} });
    }
    setToolTip(): void {}
    setContextMenu(menu: MenuItemTemplate[]): void {
      built[built.length - 1].menu = menu;
    }
    on(event: string, cb: () => void): void {
      built[built.length - 1].handlers[event] = cb;
    }
  },
}));

const { createTray, DND_FOREVER_WALL, DND_HOUR_MS } = await import('./tray');
// R3-38: the ONE home for the local-midnight rule is Task 3's packages/sim/src/phases.ts. The tray
// imports it; this test imports the same function, so 别打扰 ▸ 今天 and the reducer's midnight reset
// are asserted against one implementation and cannot drift by an hour across a DST boundary.
// Deep path, same reason as tray.ts: `@ds/sim`'s barrel is Task 9's, a batch-3 sibling.
const { nextLocalMidnight } = await import('@ds/sim/src/phases.ts');

/** The shared literal: every member of §3.5's signature, or `tsc -p tsconfig.json` fails. */
const makeActions = () => ({
  toggleVisible: vi.fn(), toggleDebug: vi.fn(), openChat: vi.fn(), openKey: vi.fn(), quit: vi.fn(),
  setLiveliness: vi.fn(), getLiveliness: vi.fn(() => 0.3),
  setDnd: vi.fn(), getDnd: vi.fn((): number | null => null),
  setMode: vi.fn(), getMode: vi.fn((): 'character' | 'plain' => 'character'),
  setWorkMode: vi.fn(), getWorkMode: vi.fn(() => false),
  setMuted: vi.fn(), getMuted: vi.fn(() => false),
  exportMemory: vi.fn(), wipeMemory: vi.fn(),
});
const actions = makeActions();

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

  const labels = (menu: MenuItemTemplate[]) => menu.map((i) => i.label ?? i.type);
  const sub = (menu: MenuItemTemplate[], label: string) => menu.find((i) => i.label === label)?.submenu ?? [];

  it('builds the fixed Phase 3 menu order (§3.5)', () => {
    createTray(actions);
    expect(labels(built[0].menu ?? [])).toEqual([
      '显示/隐藏', '打开对话', 'separator', '活泼度', '别打扰', '普通模式', '工作模式', '静音', 'separator',
      '记忆', '设置 API Key', '调试面板', 'separator', '退出',
    ]);
  });

  it('wires the Phase 2 items unchanged', () => {
    const local = makeActions();
    createTray(local);
    const menu = built[0].menu ?? [];
    menu.find((i) => i.label === '打开对话')?.click?.();
    menu.find((i) => i.label === '设置 API Key')?.click?.();
    menu.find((i) => i.label === '退出')?.click?.();
    expect(local.openChat).toHaveBeenCalledTimes(1);
    expect(local.openKey).toHaveBeenCalledTimes(1);
    expect(local.quit).toHaveBeenCalledTimes(1);
  });

  it('活泼度 ▸ 安静 / 默认 / 活泼 — radio against getLiveliness, values LIVELINESS_PRESETS (§3.5)', () => {
    const local = makeActions();
    createTray(local);
    const items = sub(built[0].menu ?? [], '活泼度');
    expect(items.map((i) => [i.label, i.type, i.checked])).toEqual([
      ['安静', 'radio', false], ['默认', 'radio', true], ['活泼', 'radio', false],
    ]);
    items[2].click?.();
    expect(local.setLiveliness).toHaveBeenCalledWith('lively');
  });

  it('别打扰 ▸ 1 小时 / 今天 / 关闭主动说话 — untilWall values; the checked item clears (§3.10.4)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 30, 14, 0, 0));
    const now = Date.now();
    const local = makeActions();
    createTray(local);
    const items = sub(built[0].menu ?? [], '别打扰');
    expect(items.map((i) => [i.label, i.type, i.checked])).toEqual([
      ['1 小时', 'radio', false], ['今天', 'radio', false], ['关闭主动说话', 'radio', false],
    ]);
    items[0].click?.();
    expect(local.setDnd).toHaveBeenLastCalledWith(now + DND_HOUR_MS);
    items[1].click?.();
    expect(local.setDnd).toHaveBeenLastCalledWith(new Date(2026, 7, 31, 0, 0, 0).getTime());
    // R3-38: the value the tray sends IS @ds/sim's, not a second local derivation.
    expect(nextLocalMidnight(now)).toBe(new Date(2026, 7, 31, 0, 0, 0).getTime());
    expect(local.setDnd).toHaveBeenLastCalledWith(nextLocalMidnight(now));
    items[2].click?.();
    expect(local.setDnd).toHaveBeenLastCalledWith(DND_FOREVER_WALL);
    expect(DND_FOREVER_WALL).toBe(8.64e15);

    // re-checked: the menu is rebuilt on right-click from the live getters, and the checked item clears
    local.getDnd.mockReturnValue(DND_FOREVER_WALL);
    built[0].handlers['right-click']();
    const again = sub(built[0].menu ?? [], '别打扰');
    expect(again.map((i) => i.checked)).toEqual([false, false, true]);
    again[2].click?.();
    expect(local.setDnd).toHaveBeenLastCalledWith(null);
    local.getDnd.mockReturnValue(now + DND_HOUR_MS);
    built[0].handlers['right-click']();
    expect(sub(built[0].menu ?? [], '别打扰').map((i) => i.checked)).toEqual([true, false, false]);
    vi.useRealTimers();
  });

  it('普通模式 / 工作模式 / 静音 are checkboxes reading their getters and toggling through their setters', () => {
    const local = makeActions();
    local.getMode.mockReturnValue('plain');
    local.getMuted.mockReturnValue(true);
    createTray(local);
    const menu = built[0].menu ?? [];
    const item = (l: string) => menu.find((i) => i.label === l) as MenuItemTemplate;
    expect([item('普通模式').type, item('普通模式').checked]).toEqual(['checkbox', true]);
    expect([item('工作模式').type, item('工作模式').checked]).toEqual(['checkbox', false]);
    expect([item('静音').type, item('静音').checked]).toEqual(['checkbox', true]);
    item('普通模式').click?.();
    expect(local.setMode).toHaveBeenCalledWith('character');
    item('工作模式').click?.();
    expect(local.setWorkMode).toHaveBeenCalledWith(true);
    item('静音').click?.();
    expect(local.setMuted).toHaveBeenCalledWith(false);
  });

  it('记忆 ▸ 导出… / 清空… (§8.9)', () => {
    const local = makeActions();
    createTray(local);
    const items = sub(built[0].menu ?? [], '记忆');
    expect(items.map((i) => i.label)).toEqual(['导出…', '清空…']);
    items[0].click?.();
    items[1].click?.();
    expect(local.exportMemory).toHaveBeenCalledTimes(1);
    expect(local.wipeMemory).toHaveBeenCalledTimes(1);
  });
});

// R3-61: batch 3 widened TrayActions while its only caller (index.ts) is wired in batch 6. The
// Phase 3 group is offered only when all twelve actions are present — never half-wired, never faked.
describe('Phase 3 group gating (R3-61)', () => {
  const labels = (menu: MenuItemTemplate[]) => menu.map((i) => i.label ?? i.type);
  /** The Phase 1/2 five, exactly as index.ts passes them until Task 15 lands. */
  const phase2Only = () => ({
    toggleVisible: vi.fn(), toggleDebug: vi.fn(), openChat: vi.fn(), openKey: vi.fn(), quit: vi.fn(),
  });

  it('omits the whole Phase 3 group when none of the twelve is wired', () => {
    createTray(phase2Only());
    expect(labels(built[0].menu ?? [])).toEqual([
      '显示/隐藏', '打开对话', 'separator', '设置 API Key', '调试面板', 'separator', '退出',
    ]);
  });

  it('still wires the Phase 2 items when the group is omitted', () => {
    const local = phase2Only();
    createTray(local);
    const menu = built[0].menu ?? [];
    menu.find((i) => i.label === '打开对话')?.click?.();
    menu.find((i) => i.label === '退出')?.click?.();
    expect(local.openChat).toHaveBeenCalledTimes(1);
    expect(local.quit).toHaveBeenCalledTimes(1);
  });

  it('treats a half-wired set as unwired instead of crashing on the missing getter', () => {
    const half: Record<string, unknown> = { ...makeActions() };
    delete half.getMuted;
    expect(() => createTray(half as never)).not.toThrow();
    expect(labels(built[0].menu ?? [])).not.toContain('活泼度');
  });
});
