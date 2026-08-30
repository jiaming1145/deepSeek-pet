import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// `pnpm --filter @ds/desktop run test:e2e:electron` runs with cwd = apps/desktop, and the config's
// testDir resolves from the same place. Assert it rather than trusting it.
export const DESKTOP = process.cwd();
if (!existsSync(join(DESKTOP, 'electron.vite.config.ts'))) {
  throw new Error(`run this suite from apps/desktop (cwd is ${DESKTOP})`);
}
export const REPO = resolve(DESKTOP, '..', '..');
export const EVIDENCE = join(REPO, 'docs', 'evidence', 'phase2');
export const RESULTS = join(DESKTOP, 'test-results');
export const MAIN = join(DESKTOP, 'out', 'main', 'index.cjs');

export interface Bounds { x: number; y: number; width: number; height: number; scaleFactor: number }
export interface LaunchOptions { devKey?: string; fakeBrain?: boolean; theme?: 'light' | 'dark' }

/**
 * Launches the built app against a throwaway user-data directory, so every run is a first run:
 * no ds.sqlite, no key.bin, `kv.first_run_done` unset, which is what makes `first_mes` fire.
 * `--user-data-dir` is the Chromium switch Electron honours; APPDATA is set as a belt so
 * `app.getPath('appData')` lands in the same throwaway tree either way.
 */
export async function launchApp(opts: LaunchOptions = {}): Promise<{ app: ElectronApplication; userData: string; launchedAt: number }> {
  mkdirSync(EVIDENCE, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  if (!existsSync(MAIN)) throw new Error(`missing ${MAIN}: run \`pnpm --filter @ds/desktop build\` first`);

  const userData = mkdtempSync(join(tmpdir(), 'ds-e2e-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  // The app must never read the eval/test key (contracts.md 6.5), and every launch starts
  // key-less unless the test explicitly asks for a dev key.
  delete env.DS_DEV_DEEPSEEK_KEY;
  delete env.DEEPSEEK_API_KEY;
  delete env.DS_FAKE_BRAIN;
  env.APPDATA = userData;
  if (opts.devKey) env.DS_DEV_DEEPSEEK_KEY = opts.devKey;
  if (opts.fakeBrain) env.DS_FAKE_BRAIN = '1';

  const launchedAt = Date.now();
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], cwd: DESKTOP, env });
  // `electron.launch` resolves before the main process has a window; an `app.evaluate` issued in
  // that gap dies with "Resulting promise was garbage collected". Waiting for the first window is
  // the handshake that makes every later evaluate reliable.
  await app.firstWindow();
  if (opts.theme) {
    // All four windows are created eagerly at startup (contracts 6.1); wait for them so the theme
    // reaches every renderer, not only whichever one happened to open first.
    const deadline = Date.now() + 10_000;
    while (app.windows().length < 4 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    await setTheme(app, opts.theme);
  }
  return { app, userData, launchedAt };
}

/** The page whose URL contains `needle`, e.g. 'bubble.html'. All four windows exist from startup. */
export async function windowByUrl(app: ElectronApplication, needle: string, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const page of app.windows()) if (page.url().includes(needle)) return page;
    if (Date.now() > deadline) {
      throw new Error(`no window URL contains ${needle}; saw: ${app.windows().map((p) => p.url()).join(' | ')}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function isVisible(app: ElectronApplication, needle: string): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, n) =>
    BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes(n) && w.isVisible()), needle);
}

/**
 * Sets the theme for BOTH halves of the app.
 *
 * `nativeTheme.themeSource` is the app-level switch and is set first, but on this Electron build it
 * does not reach the renderers' `prefers-color-scheme` — verified in a probe run:
 * `nativeTheme.shouldUseDarkColors` was true in main while `matchMedia('(prefers-color-scheme:
 * dark)').matches` was false in the bubble page. Every Phase 2 page themes itself from that media
 * query (`tokens.css` line 143), so the pages are emulated as well. That is the same lever T7/T8's
 * browser harness pulls for their light/dark sheets.
 */
export async function setTheme(app: ElectronApplication, theme: 'light' | 'dark'): Promise<void> {
  await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; return t; }, theme);
  for (const page of app.windows()) await page.emulateMedia({ colorScheme: theme });
}

/** Screen rectangle (DIP) covering every *visible* window whose URL matches one of `needles`. */
export async function unionBounds(app: ElectronApplication, needles: string[]): Promise<Bounds> {
  return app.evaluate(({ BrowserWindow, screen }, ns) => {
    const wins = BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.isVisible() && ns.some((n) => w.webContents.getURL().includes(n)));
    if (wins.length === 0) throw new Error(`no visible window matched ${ns.join(',')}`);
    const b = wins.map((w) => w.getBounds());
    const x = Math.min(...b.map((r) => r.x));
    const y = Math.min(...b.map((r) => r.y));
    const right = Math.max(...b.map((r) => r.x + r.width));
    const bottom = Math.max(...b.map((r) => r.y + r.height));
    return { x, y, width: right - x, height: bottom - y, scaleFactor: screen.getDisplayMatching(b[0]).scaleFactor };
  }, needles);
}

/** The DIP bounds of the first visible window matching `needle`, plus its display's scale factor. */
export async function boundsOf(app: ElectronApplication, needle: string): Promise<Bounds> {
  return unionBounds(app, [needle]);
}

/** Composited desktop capture of `bounds` — what the user actually sees — via scripts/capture-region.ps1. */
export function captureRegion(bounds: Bounds, out: string, pad = 24): void {
  const file = join(RESULTS, 'bounds.json');
  writeFileSync(file, JSON.stringify({ ...bounds, pad }), 'utf8');
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'scripts', 'capture-region.ps1'), '-BoundsFile', file, '-Out', out],
    { stdio: 'inherit' },
  );
}

/** Appends one CPU/RSS row to docs/evidence/phase2/resources.md. Blocks for `seconds`. */
export function sampleResources(label: string, seconds: number): void {
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'scripts', 'sample-resources.ps1'),
      '-Out', join(EVIDENCE, 'resources.md'), '-Label', label, '-Seconds', String(seconds),
      '-PathLike', join(REPO, 'node_modules', '*')],
    { stdio: 'inherit' },
  );
}

/** Nearest-rank median, duplicated here so the spec needs no cross-package import at runtime. */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median: empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil(0.5 * sorted.length)) - 1];
}

/** Appends one line to the Task 10 in-app check log that the report quotes. */
export function logCheck(line: string): void {
  mkdirSync(RESULTS, { recursive: true });
  const path = join(RESULTS, 'inapp-checks.log');
  const prefix = `${new Date().toISOString()} `;
  try {
    appendFileSync(path, `${prefix}${line}\n`, 'utf8');
  } catch {
    /* the log is evidence, never a reason to fail a test */
  }
  console.log(`[check] ${line}`);
}
