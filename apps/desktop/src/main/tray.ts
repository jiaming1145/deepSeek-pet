import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { LIVELINESS_PRESETS, type LivelinessPreset, type PersonaModeIpc } from '@ds/protocol';
// R3-38: one home for the local-midnight rule (Task 3, packages/sim/src/phases.ts, §3.9). Batch 3
// makes Task 3 a merged dependency, so this is an import, not a second implementation.
//
// The specifier is the FILE, not the package root, and that is deliberate: `@ds/sim`'s package.json
// points `main`/`types` at `src/index.ts`, and that barrel is **Task 9's** (a batch-3 sibling this
// task does not depend on) — a bare package-root import would resolve to a file that does not exist
// and fail with TS2307 / "Failed to resolve entry for package @ds/sim". The deep path needs nothing
// from Task 9, and `moduleResolution: "Bundler"` + `allowImportingTsExtensions` (already set in
// apps/desktop/tsconfig.json, Phase 2 C1a) resolve it through the pnpm workspace link.
import { nextLocalMidnight } from '@ds/sim/src/phases.ts';
import { join } from 'node:path';

// Stable tray GUID for the *packaged* app only (spec §7). Generated once with
// `node -e "console.log(require('crypto').randomUUID())"` and hard-coded — it must stay the
// same across builds so Windows recognizes this as the same tray icon (e.g. to restore a
// user's "always show" preference in the systray overflow). Never regenerate at runtime.
const TRAY_GUID = '204bbcbc-4990-403d-83b2-577785f13b41';

/**
 * A 16x16 white disc, PNG, base64. Embedded rather than read from disk because it exists precisely
 * for the case where the on-disk icon is missing or unreadable: `new Tray(emptyImage)` produces a
 * tray entry with no clickable target at all, and with `skipTaskbar` and the pet hidden, that
 * leaves the process with no show or quit control whatsoever.
 */
const FALLBACK_ICON_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANklEQVR42mP4//8/AyUYlwQuQJQBhABeA4gFWA0gFaAY'
  + 'QC4YNYCaBlAcjVRJSFRJylTJTCRhAJIsmJISbBmQAAAAAElFTkSuQmCC';

/** Never returns an empty image: an invisible tray icon is an unusable app, not a cosmetic bug. */
function loadTrayIcon(iconPath: string): NativeImage {
  // createFromPath() returns an *empty* image (not a thrown error) when the file is missing.
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) return icon;
  console.warn('[tray] icon missing or undecodable at', iconPath, '— using the built-in fallback');
  return nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_PNG}`);
}

/** §3.5: the Phase 2 five plus the twelve Phase 3 members. Every one appears in tray.test.ts's literal. */
export interface TrayActions {
  // Phase 1/2, unchanged
  toggleVisible(): void; toggleDebug(): void; openChat(): void; openKey(): void; quit(): void;
  // Phase 3
  setLiveliness(preset: LivelinessPreset): void;   // §3.5   活泼度 ▸ 安静 / 默认 / 活泼
  getLiveliness(): number;                          // §3.5   radio check state
  setDnd(untilWall: number | null): void;           // §3.10.4 别打扰 ▸ 1 小时 / 今天 / 关闭主动说话
  getDnd(): number | null;                          // §3.10.4 radio check state
  setMode(mode: PersonaModeIpc): void;              // §9.5   普通模式 (checkbox)
  getMode(): PersonaModeIpc;                        // §9.5
  setWorkMode(on: boolean): void;                   // §5.9   工作模式 (checkbox)
  getWorkMode(): boolean;                           // §5.9
  setMuted(on: boolean): void;                      // §5.12  静音 (checkbox) — a NEW item
  getMuted(): boolean;                              // §5.12
  exportMemory(): void;                             // §8.9   记忆 ▸ 导出…
  wipeMemory(): void;                               // §8.9   记忆 ▸ 清空…
}

/** §3.10.4: 关闭主动说话 = the ES max date, "off forever" until re-enabled. */
export const DND_FOREVER_WALL = 8.64e15;
export const DND_HOUR_MS = 3_600_000;

// `nextLocalMidnight(nowWall)` is NOT declared here (R3-38). It is `@ds/sim`'s
// (packages/sim/src/phases.ts, §3.9), imported above and never re-exported: the tray's 今天 and the
// reducer's midnight counter reset must be the same rule or they drift by an hour across DST.

const LIVELINESS_ITEMS: readonly { label: string; preset: LivelinessPreset }[] = [
  { label: '安静', preset: 'quiet' }, { label: '默认', preset: 'default' }, { label: '活泼', preset: 'lively' },
];

function template(actions: TrayActions): MenuItemConstructorOptions[] {
  const now = Date.now();
  const liveliness = actions.getLiveliness();
  const dnd = actions.getDnd();
  const active = dnd !== null && dnd > now;
  const midnight = nextLocalMidnight(now);
  const dndChecked = {
    hour: active && dnd !== midnight && dnd !== DND_FOREVER_WALL,
    today: active && dnd === midnight,
    forever: active && dnd === DND_FOREVER_WALL,
  };
  // The same item again, when checked, clears the mute (§3.10.4's last row).
  const dndItem = (label: string, checked: boolean, value: () => number): MenuItemConstructorOptions => ({
    label, type: 'radio', checked, click: () => actions.setDnd(checked ? null : value()),
  });
  return [
    { label: '显示/隐藏', click: actions.toggleVisible },
    { label: '打开对话', click: actions.openChat },
    { type: 'separator' },
    { label: '活泼度', submenu: LIVELINESS_ITEMS.map((i) => ({
      label: i.label, type: 'radio', checked: liveliness === LIVELINESS_PRESETS[i.preset],
      click: () => actions.setLiveliness(i.preset),
    })) },
    { label: '别打扰', submenu: [
      dndItem('1 小时', dndChecked.hour, () => Date.now() + DND_HOUR_MS),
      dndItem('今天', dndChecked.today, () => nextLocalMidnight(Date.now())),
      dndItem('关闭主动说话', dndChecked.forever, () => DND_FOREVER_WALL),
    ] },
    { label: '普通模式', type: 'checkbox', checked: actions.getMode() === 'plain',
      click: () => actions.setMode(actions.getMode() === 'plain' ? 'character' : 'plain') },
    { label: '工作模式', type: 'checkbox', checked: actions.getWorkMode(),
      click: () => actions.setWorkMode(!actions.getWorkMode()) },
    { label: '静音', type: 'checkbox', checked: actions.getMuted(),
      click: () => actions.setMuted(!actions.getMuted()) },
    { type: 'separator' },
    { label: '记忆', submenu: [
      { label: '导出…', click: actions.exportMemory },
      { label: '清空…', click: actions.wipeMemory },
    ] },
    { label: '设置 API Key', click: actions.openKey },
    { label: '调试面板', click: actions.toggleDebug },
    { type: 'separator' },
    { label: '退出', click: actions.quit },
  ];
}

export function createTray(actions: TrayActions): Tray {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png');
  const icon = loadTrayIcon(iconPath);
  // GUID only when packaged: Windows binds a tray GUID to the *executable path* that first
  // registered it and refuses the icon for any other path (Shell_NotifyIcon fails, no icon at
  // all). Dev runs node_modules/.../electron.exe while a packaged build runs ds.exe, so passing
  // the same GUID in dev would let a dev run claim it and poison the packaged app's tray identity
  // on that machine. In dev we construct the tray without a GUID; the packaged app always gets
  // the fixed GUID above so its identity (and any OS-remembered icon preference) is stable across
  // updates.
  const tray = app.isPackaged ? new Tray(icon, TRAY_GUID) : new Tray(icon);
  tray.setToolTip('ds');
  const rebuild = (): void => { tray.setContextMenu(Menu.buildFromTemplate(template(actions))); };
  rebuild();
  // The radio/checkbox states come from live getters (kv-backed stores that a chat command, the
  // proactive controller or a restart may change without the tray knowing), so the menu is
  // rebuilt every time it is about to open. Electron emits 'right-click' before it pops the
  // context menu set here, so the user always sees the current state.
  tray.on('right-click', rebuild);
  return tray;
}
