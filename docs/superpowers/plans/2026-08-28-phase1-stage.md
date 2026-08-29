# Phase 1 — Live2D Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A transparent, always-on-top Electron pet window on Windows 11 that renders Live2D Haru with the official Cubism 5-r.5 Framework, reacts to hover (click-through toggles), follows the cursor with its gaze, can be dragged, plays expressions/motions from a debug panel, hides behind fullscreen apps, and quits from a tray icon.

**Architecture:** pnpm monorepo. `packages/protocol` holds zod-validated IPC event types. `packages/stage` is a browser-only wrapper around the vendored `CubismWebFramework` (git submodule @ 5-r.5) exposing `Live2DStage` (load model, expressions, motions, hit-test, gaze, mouth driver, fps). `apps/desktop` is an electron-vite app: main process owns the pet window, cursor polling, tray, fullscreen/lock hiding; the pet renderer is plain TypeScript (no React in Phase 1) that mounts `Live2DStage` and a debug panel. Proprietary Cubism Core and the sample models are downloaded by a script, never committed.

**Tech Stack:** Node 24.17 · pnpm 10 · TypeScript 5.9 · Electron **43.4.1** (pinned) · electron-vite · Vite · vitest · Playwright · zod 4 · koffi (FFI for `user32.GetForegroundWindow`) · Live2D CubismWebFramework 5-r.5 + Core 06.00 (from `CubismSdkForWeb-5-r.5.zip`).

**Spec:** `docs/superpowers/specs/2026-08-28-live2d-companion-design.md` (sections 1, 2, 4, 7, 9, 10 phase 1, 11).

## Global Constraints

- Electron pinned to exactly `43.4.1` (spec §1). Do not upgrade to 44.
- Renderer uses **WebGL2** only; Framework 5-r.5 requires `WebGL2RenderingContext`.
- `vendor/core/**`, `characters/*/model/**`, `apps/desktop/public/live2d/**` are gitignored. Never `git add -f` them (Live2D Proprietary Software License §5.3.2; Free Material License forbids redistributing raw model files).
- Cubism Core must come from the SDK zip (`Core 06.00`), never from the CDN (Core 5, incompatible).
- Pet window: `frame:false, transparent:true, alwaysOnTop:true ('screen-saver'), skipTaskbar:true, focusable:false, hasShadow:false, resizable:false, backgroundThrottling:false` (spec §7).
- Hover is driven by our own hit-test on forwarded `mousemove`, never CSS `:hover` (spec §4.4).
- All IPC payloads validated with zod at the boundary; unknown channels rejected (spec §2.2).
- Ticker: 30 FPS when idle and not hovered, 60 FPS while hovered/speaking (spec §4.6).
- Required credit line (spec §11) must appear in `README.md`: *This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion.*
- Commit after every task on `main`; commit messages end with the Co-Authored-By / Claude-Session trailers used in this repo (see `git log -1`).
- Every visual claim needs a screenshot of the real running window saved under `docs/evidence/phase1/` and committed.

---

## File structure (what Phase 1 creates)

```
D:\ds
  package.json                      pnpm workspace root, scripts
  pnpm-workspace.yaml
  tsconfig.base.json                shared strict TS options
  .gitignore  .gitmodules  NOTICE  README.md
  scripts/fetch-sdk.mjs             downloads SDK zip → vendor/core, characters/*/model, shaders
  scripts/sdk-layout.mjs            pure mapping: zip entry → destination (unit-tested)
  scripts/make-tray-icon.mjs        emits apps/desktop/resources/tray.png (16x16) without deps
  vendor/CubismWebFramework/        git submodule @ 5-r.5
  vendor/core/                      (gitignored) live2dcubismcore.min.js, live2dcubismcore.d.ts
  characters/haru/character.json    committed
  characters/haru/model/            (gitignored) Haru.model3.json, moc3, textures, expressions, motions…
  characters/hiyori/character.json  committed
  characters/hiyori/model/          (gitignored)
  packages/protocol/src/index.ts    channel names + zod schemas + Ipc types
  packages/protocol/src/index.test.ts
  packages/stage/src/character.ts   CharacterConfig schema + loader
  packages/stage/src/mouth.ts       MouthDriver interface, TextMouthDriver (IParameterProvider)
  packages/stage/src/view.ts        canvas↔view coordinate math (pure)
  packages/stage/src/companion-model.ts  CompanionModel extends CubismUserModel (async loader + updaters)
  packages/stage/src/stage.ts       Live2DStage: framework boot, GL, render loop, public API
  packages/stage/src/*.test.ts      unit tests for pure parts
  apps/desktop/electron.vite.config.ts
  apps/desktop/vite.browser.config.ts   plain-browser dev/test of the pet renderer
  apps/desktop/playwright.config.ts
  apps/desktop/src/main/index.ts          app lifecycle, single instance
  apps/desktop/src/main/pet-window.ts     window creation, click-through, drag, position persistence
  apps/desktop/src/main/cursor.ts         30 Hz cursor poll → gaze events
  apps/desktop/src/main/foreground.ts     koffi user32 fullscreen detection (+ pure shouldHide)
  apps/desktop/src/main/foreground.test.ts
  apps/desktop/src/main/tray.ts
  apps/desktop/src/main/ipc.ts            typed send/receive with zod validation
  apps/desktop/src/preload/pet.ts         contextBridge: window.ds
  apps/desktop/src/renderer/pet.html
  apps/desktop/src/renderer/pet/main.ts   mounts Live2DStage, hover hit-test, drag, debug panel
  apps/desktop/src/renderer/pet/debug-panel.ts
  apps/desktop/src/renderer/pet/hover.ts  pure hover/debounce state machine (tested)
  apps/desktop/tests/stage.spec.ts        Playwright smoke test (browser mode)
  apps/desktop/public/live2d/             (gitignored) core/, shaders/ copied by fetch-sdk
  apps/desktop/public/characters/         (gitignored) symlink/copy of characters/ made by fetch-sdk
  docs/evidence/phase1/*.png
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `NOTICE`, `README.md`, `vitest.workspace.ts`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/src/index.ts`, `packages/protocol/src/index.test.ts`

**Interfaces:**
- Produces: workspace commands `pnpm test` (vitest across packages), `pnpm typecheck`; package name `@ds/protocol`.

- [ ] **Step 1: Install pnpm and init the workspace**

```powershell
npm i -g pnpm@10
pnpm -v
```
Expected: prints `10.x.x`.

- [ ] **Step 2: Write root files**

`package.json`:
```json
{
  "name": "ds",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "fetch-sdk": "node scripts/fetch-sdk.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r --if-present typecheck",
    "dev": "pnpm --filter @ds/desktop dev",
    "build": "pnpm --filter @ds/desktop build"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```
After writing, run `pnpm -v` again and replace `pnpm@10.0.0` in `packageManager` with the exact installed version.

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": []
  }
}
```

`.gitignore`:
```
node_modules/
dist/
out/
*.log
.DS_Store
# Proprietary Live2D Core — never commit (Proprietary Software License §5.3.2)
vendor/core/
# Live2D sample models — Free Material License forbids redistribution
characters/*/model/
# generated copies for the renderer
apps/desktop/public/live2d/
apps/desktop/public/characters/
# downloaded SDK archive cache
.cache/
# playwright
apps/desktop/test-results/
apps/desktop/playwright-report/
```

`NOTICE`:
```
This repository's own source code is licensed under the MIT License (see LICENSE).

The following components are NOT covered by that license:

1. Live2D Cubism Core (vendor/core/live2dcubismcore.min.js, live2dcubismcore.d.ts)
   Proprietary. Distributed under the Live2D Proprietary Software License Agreement
   https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
   It is not stored in this repository; scripts/fetch-sdk.mjs downloads it from Live2D.

2. Live2D Cubism SDK for Web Framework (vendor/CubismWebFramework, git submodule)
   Live2D Open Software License Agreement
   https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html

3. Live2D sample models Haru and Hiyori (characters/*/model/)
   Live2D Free Material License Agreement / Sample Model Terms
   https://www.live2d.com/eula/live2d-sample-model-terms_en.html
   Not stored in this repository; downloaded by scripts/fetch-sdk.mjs.
   This content uses sample data owned and copyrighted by Live2D Inc. The sample data
   are utilized in accordance with terms and conditions set by Live2D Inc. This content
   itself is created at the author's sole discretion.
```

`README.md`:
```markdown
# ds — DeepSeek-driven Live2D desktop companion

Windows desktop pet with a Live2D avatar and a DeepSeek brain. Phase 1 = stage only.

## Setup
1. `npm i -g pnpm@10`
2. `git submodule update --init`
3. `pnpm install`
4. `pnpm fetch-sdk`  (downloads the Live2D Cubism SDK zip: proprietary Core + sample models; ~21 MB)
5. `pnpm dev`

## Credits
This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion.

See NOTICE for third-party licenses.
```

`vitest.workspace.ts`:
```ts
export default ['packages/*', 'apps/*'];
```

- [ ] **Step 3: Write the failing protocol test**

`packages/protocol/src/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Channels, parseEvent } from './index';

describe('protocol', () => {
  it('accepts a valid gaze:cursor event', () => {
    const r = parseEvent(Channels.gazeCursor, { x: 10, y: -3.5 });
    expect(r).toEqual({ ok: true, data: { x: 10, y: -3.5 } });
  });

  it('rejects an unknown channel', () => {
    const r = parseEvent('nope' as never, {});
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    const r = parseEvent(Channels.avatarHover, { inside: 'yes' });
    expect(r.ok).toBe(false);
  });
});
```

`packages/protocol/package.json`:
```json
{
  "name": "@ds/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "zod": "^4.0.0" }
}
```

`packages/protocol/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 4: Run test to verify it fails**

```powershell
pnpm install
pnpm test
```
Expected: FAIL — `Cannot find module './index'` (or similar).

- [ ] **Step 5: Implement the protocol**

`packages/protocol/src/index.ts`:
```ts
import { z } from 'zod';

/** Channel names. main→renderer channels are prefixed with the emitter's domain. */
export const Channels = {
  // main → pet renderer
  gazeCursor: 'gaze:cursor',
  shellVisibility: 'shell:visibility',
  stageSetFps: 'stage:setFps',
  debugExpression: 'debug:expression',
  debugMotion: 'debug:motion',
  // pet renderer → main
  avatarHover: 'avatar:hover',
  avatarTap: 'avatar:tap',
  avatarDrag: 'avatar:drag',
  avatarDragEnd: 'avatar:dragEnd',
  stageReady: 'stage:ready',
  stageError: 'stage:error',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];

export const Schemas = {
  [Channels.gazeCursor]: z.object({ x: z.number(), y: z.number() }), // window-local px, may be outside the window
  [Channels.shellVisibility]: z.object({
    hidden: z.boolean(),
    reason: z.enum(['fullscreen', 'locked', 'suspended', 'user', 'none']),
  }),
  [Channels.stageSetFps]: z.object({ fps: z.union([z.literal(30), z.literal(60)]) }),
  [Channels.debugExpression]: z.object({ name: z.string().nullable() }),
  [Channels.debugMotion]: z.object({ group: z.string(), index: z.number().int().nonnegative() }),
  [Channels.avatarHover]: z.object({ inside: z.boolean() }),
  [Channels.avatarTap]: z.object({ hitArea: z.string() }),
  [Channels.avatarDrag]: z.object({ dx: z.number(), dy: z.number() }), // screen px since last event
  [Channels.avatarDragEnd]: z.object({}),
  [Channels.stageReady]: z.object({
    character: z.string(),
    expressions: z.array(z.string()),
    motionGroups: z.record(z.string(), z.number().int()),
    hitAreas: z.array(z.string()),
  }),
  [Channels.stageError]: z.object({ message: z.string() }),
} satisfies Record<Channel, z.ZodTypeAny>;

export type Payload<C extends Channel> = z.infer<(typeof Schemas)[C]>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseEvent<C extends Channel>(channel: C, payload: unknown): ParseResult<Payload<C>> {
  const schema = (Schemas as Record<string, z.ZodTypeAny | undefined>)[channel];
  if (!schema) return { ok: false, error: `unknown channel ${String(channel)}` };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data as Payload<C> } : { ok: false, error: r.error.message };
}

export const RENDERER_TO_MAIN: readonly Channel[] = [
  Channels.avatarHover, Channels.avatarTap, Channels.avatarDrag, Channels.avatarDragEnd,
  Channels.stageReady, Channels.stageError,
];
export const MAIN_TO_RENDERER: readonly Channel[] = [
  Channels.gazeCursor, Channels.shellVisibility, Channels.stageSetFps,
  Channels.debugExpression, Channels.debugMotion,
];
```

- [ ] **Step 6: Run tests and typecheck**

```powershell
pnpm test
pnpm typecheck
```
Expected: 3 tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore: pnpm workspace scaffold + @ds/protocol IPC schemas"
```

---

### Task 2: Framework submodule + SDK fetch script

**Files:**
- Create: `.gitmodules` (via git), `vendor/CubismWebFramework/` (submodule)
- Create: `scripts/sdk-layout.mjs`, `scripts/sdk-layout.test.mjs`, `scripts/fetch-sdk.mjs`
- Create: `characters/haru/character.json`, `characters/hiyori/character.json`

**Interfaces:**
- Produces: after `pnpm fetch-sdk`: `vendor/core/live2dcubismcore.min.js`, `vendor/core/live2dcubismcore.d.ts`, `characters/haru/model/Haru.model3.json` (+ all Haru files), `characters/hiyori/model/Hiyori.model3.json` (+ files), `apps/desktop/public/live2d/core/live2dcubismcore.min.js`, `apps/desktop/public/live2d/shaders/*.vert|*.frag` (13 files), `apps/desktop/public/characters/<id>/…` (copy of `characters/<id>/` including `character.json`).
- Produces: `characters/<id>/character.json` conforming to `CharacterConfig` (defined in Task 3).

- [ ] **Step 1: Add the Framework submodule at tag 5-r.5**

```powershell
git submodule add https://github.com/Live2D/CubismWebFramework.git vendor/CubismWebFramework
git -C vendor/CubismWebFramework checkout 5-r.5
git add .gitmodules vendor/CubismWebFramework
git commit -m "chore: vendor CubismWebFramework 5-r.5 as submodule"
```
Verify: `git -C vendor/CubismWebFramework describe --tags` prints `5-r.5`; `ls vendor/CubismWebFramework/src/motion/cubismupdatescheduler.ts` exists.

- [ ] **Step 2: Write the failing layout test**

`scripts/sdk-layout.test.mjs` (vitest runs `.test.mjs` too — add `"include": ["packages/*/src/**/*.test.ts", "scripts/**/*.test.mjs", "apps/*/src/**/*.test.ts"]` to a root `vitest.config.ts` if the workspace file does not pick it up):
```js
import { describe, expect, it } from 'vitest';
import { destinationFor } from './sdk-layout.mjs';

const P = 'CubismSdkForWeb-5-r.5/';

describe('sdk layout', () => {
  it('routes Core files to vendor/core and the public copy', () => {
    expect(destinationFor(P + 'Core/live2dcubismcore.min.js')).toEqual([
      'vendor/core/live2dcubismcore.min.js',
      'apps/desktop/public/live2d/core/live2dcubismcore.min.js',
    ]);
    expect(destinationFor(P + 'Core/live2dcubismcore.d.ts')).toEqual(['vendor/core/live2dcubismcore.d.ts']);
    expect(destinationFor(P + 'Core/live2dcubismcore.js')).toEqual([]);
  });
  it('routes shaders', () => {
    expect(destinationFor(P + 'Framework/Shaders/WebGL/vertshadersrc.vert')).toEqual([
      'apps/desktop/public/live2d/shaders/vertshadersrc.vert',
    ]);
  });
  it('routes Haru and Hiyori model files, lowercase ids', () => {
    expect(destinationFor(P + 'Samples/Resources/Haru/Haru.moc3')).toEqual(['characters/haru/model/Haru.moc3']);
    expect(destinationFor(P + 'Samples/Resources/Haru/expressions/F01.exp3.json')).toEqual([
      'characters/haru/model/expressions/F01.exp3.json',
    ]);
    expect(destinationFor(P + 'Samples/Resources/Hiyori/motions/Hiyori_m01.motion3.json')).toEqual([
      'characters/hiyori/model/motions/Hiyori_m01.motion3.json',
    ]);
  });
  it('ignores everything else', () => {
    expect(destinationFor(P + 'Samples/Resources/Mao/Mao.moc3')).toEqual([]);
    expect(destinationFor(P + 'Samples/TypeScript/Demo/src/main.ts')).toEqual([]);
    expect(destinationFor(P + 'Core/')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

`pnpm test` → FAIL: cannot find `./sdk-layout.mjs`.

- [ ] **Step 4: Implement layout + fetch script**

`scripts/sdk-layout.mjs`:
```js
export const SDK_VERSION = '5-r.5';
export const SDK_URL = `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-${SDK_VERSION}.zip`;
export const MODELS = ['Haru', 'Hiyori'];

/** @param {string} entry zip entry name → list of repo-relative destinations (empty = skip) */
export function destinationFor(entry) {
  if (entry.endsWith('/')) return [];
  const m = entry.match(/^CubismSdkForWeb-[^/]+\/(.*)$/);
  if (!m) return [];
  const rel = m[1];

  if (rel === 'Core/live2dcubismcore.min.js') {
    return ['vendor/core/live2dcubismcore.min.js', 'apps/desktop/public/live2d/core/live2dcubismcore.min.js'];
  }
  if (rel === 'Core/live2dcubismcore.d.ts') return ['vendor/core/live2dcubismcore.d.ts'];

  const sh = rel.match(/^Framework\/Shaders\/WebGL\/([^/]+)$/);
  if (sh) return [`apps/desktop/public/live2d/shaders/${sh[1]}`];

  const md = rel.match(/^Samples\/Resources\/([^/]+)\/(.+)$/);
  if (md && MODELS.includes(md[1])) return [`characters/${md[1].toLowerCase()}/model/${md[2]}`];

  return [];
}
```

`scripts/fetch-sdk.mjs` (uses only Node built-ins; `unzip` via a small dependency-free approach is painful, so use `fflate`'s `unzipSync` — add `"fflate": "^0.8.2"` to root devDependencies):
```js
import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { SDK_URL, SDK_VERSION, destinationFor, MODELS } from './sdk-layout.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cacheDir = join(root, '.cache');
const zipPath = join(cacheDir, `CubismSdkForWeb-${SDK_VERSION}.zip`);

mkdirSync(cacheDir, { recursive: true });
if (!existsSync(zipPath)) {
  console.log(`downloading ${SDK_URL}`);
  const res = await fetch(SDK_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}

const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
let written = 0;
for (const [name, bytes] of Object.entries(entries)) {
  for (const dest of destinationFor(name)) {
    const abs = join(root, dest);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    written++;
  }
}

// publish characters (character.json + model/) to the renderer's public dir
for (const id of MODELS.map((m) => m.toLowerCase())) {
  const src = join(root, 'characters', id);
  const dst = join(root, 'apps/desktop/public/characters', id);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

const core = readFileSync(join(root, 'vendor/core/live2dcubismcore.min.js'), 'utf8');
if (!core.includes('offscreens')) throw new Error('Core is not version 6 — wrong SDK zip');
console.log(`wrote ${written} files; Core 6 OK; shaders + ${MODELS.join(', ')} ready`);
```

`characters/haru/character.json`:
```json
{
  "id": "haru",
  "name": "小春",
  "model": "model/Haru.model3.json",
  "emotionMap": { "happy": "F01", "sad": "F02", "angry": "F03", "think": "F04",
                  "surprised": "F05", "awkward": "F06", "question": "F07",
                  "curious": "F08", "neutral": null },
  "motionMap": { "nod": ["TapBody", 0], "shake": ["TapBody", 1], "wave": ["TapBody", 2], "think": ["TapBody", 3] },
  "idleGroup": "Idle",
  "tapMotions": { "Head": { "TapBody": [0, 1] }, "Body": { "TapBody": [2, 3] } },
  "scale": 1.0,
  "offsetY": 0.0
}
```
(The F0x↔emotion assignment is a first guess to be corrected in Task 6 after viewing each expression in the debug panel.)

`characters/hiyori/character.json`:
```json
{
  "id": "hiyori",
  "name": "日和",
  "model": "model/Hiyori.model3.json",
  "emotionMap": { "happy": ["TapBody", 0], "sad": null, "angry": null, "think": null,
                  "surprised": ["TapBody", 0], "awkward": null, "question": null,
                  "curious": null, "neutral": null },
  "motionMap": { "nod": ["TapBody", 0] },
  "idleGroup": "Idle",
  "tapMotions": { "Body": { "TapBody": [0] } },
  "scale": 1.0,
  "offsetY": 0.0
}
```

- [ ] **Step 5: Run tests, then run the script**

```powershell
pnpm add -Dw fflate
pnpm test
pnpm fetch-sdk
Get-ChildItem vendor/core, apps/desktop/public/live2d/shaders, characters/haru/model | Select-Object -First 30
git status --short
```
Expected: layout tests PASS; script prints `Core 6 OK`; 13 shader files; `Haru.model3.json` present; `git status` shows **no** files under `vendor/core`, `characters/*/model`, `apps/desktop/public` (ignored).

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: SDK fetch script (Core 6, shaders, Haru/Hiyori) + character configs"
```

---

### Task 3: `@ds/stage` pure parts — character config, view math, text mouth driver

**Files:**
- Create: `packages/stage/package.json`, `packages/stage/tsconfig.json`
- Create: `packages/stage/src/character.ts`, `packages/stage/src/character.test.ts`
- Create: `packages/stage/src/view.ts`, `packages/stage/src/view.test.ts`
- Create: `packages/stage/src/mouth.ts`, `packages/stage/src/mouth.test.ts`

**Interfaces:**
- Produces:
  - `CharacterConfig` (zod-inferred type) and `parseCharacterConfig(json: unknown): CharacterConfig`; `EMOTIONS` const tuple of the 9 emotions; `MotionRef = [group: string, index: number]`.
  - `ViewTransform` class: `constructor(canvasWidth: number, canvasHeight: number)`, `toView(deviceX: number, deviceY: number): {x: number; y: number}` — device pixels → Cubism view space (matches the sample's `LAppView.transformViewX/Y` with `ViewScale = 1`, logical rect −1..1 vertically, −ratio..ratio horizontally); `toGaze(deviceX, deviceY): {x: number; y: number}` — clamped to [−1, 1] each axis.
  - `MouthDriver` interface `{ update(dt: number): boolean; getParameter(): number; start(): void; stop(): void }`; `TextMouthDriver` implementing it with a `rng: () => number` constructor arg for determinism.

- [ ] **Step 1: Package files**

`packages/stage/package.json`:
```json
{
  "name": "@ds/stage",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "@ds/protocol": "workspace:*", "zod": "^4.0.0" }
}
```

`packages/stage/tsconfig.json` — the Framework sources assign `null` to typed fields everywhere, so `strictNullChecks` is off **for this package only**:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": false,
    "experimentalDecorators": true,
    "lib": ["ES2022", "DOM"],
    "baseUrl": ".",
    "paths": { "@framework/*": ["../../vendor/CubismWebFramework/src/*"] }
  },
  "include": ["src", "../../vendor/core/live2dcubismcore.d.ts"]
}
```

- [ ] **Step 2: Write failing tests**

`packages/stage/src/character.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseCharacterConfig, EMOTIONS } from './character';

const good = {
  id: 'haru', name: '小春', model: 'model/Haru.model3.json',
  emotionMap: Object.fromEntries(EMOTIONS.map((e) => [e, e === 'neutral' ? null : 'F01'])),
  motionMap: { nod: ['TapBody', 0] },
  idleGroup: 'Idle',
  tapMotions: { Head: { TapBody: [0, 1] } },
  scale: 1, offsetY: 0,
};

describe('character config', () => {
  it('parses a valid config', () => {
    const c = parseCharacterConfig(good);
    expect(c.id).toBe('haru');
    expect(c.motionMap.nod).toEqual(['TapBody', 0]);
  });
  it('accepts motion refs as emotion targets', () => {
    const c = parseCharacterConfig({ ...good, emotionMap: { ...good.emotionMap, happy: ['TapBody', 0] } });
    expect(c.emotionMap.happy).toEqual(['TapBody', 0]);
  });
  it('rejects a missing emotion key', () => {
    const { neutral: _n, ...partial } = good.emotionMap;
    expect(() => parseCharacterConfig({ ...good, emotionMap: partial })).toThrow();
  });
});
```

`packages/stage/src/view.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ViewTransform } from './view';

describe('ViewTransform', () => {
  it('maps canvas centre to view origin', () => {
    const v = new ViewTransform(400, 800);
    expect(v.toView(200, 400)).toEqual({ x: 0, y: 0 });
  });
  it('maps top-left to (-ratio, +1) for a portrait canvas', () => {
    const v = new ViewTransform(400, 800);
    const p = v.toView(0, 0);
    expect(p.x).toBeCloseTo(-0.5);
    expect(p.y).toBeCloseTo(1);
  });
  it('maps left edge to x=-1 for a landscape canvas', () => {
    const v = new ViewTransform(800, 400);
    expect(v.toView(0, 200).x).toBeCloseTo(-1);
  });
  it('clamps gaze to [-1,1] for points outside the canvas', () => {
    const v = new ViewTransform(400, 800);
    expect(v.toGaze(-5000, 9000)).toEqual({ x: -1, y: -1 });
  });
});
```

`packages/stage/src/mouth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TextMouthDriver } from './mouth';

describe('TextMouthDriver', () => {
  it('is closed when not speaking', () => {
    const m = new TextMouthDriver(() => 0.5);
    m.update(0.016);
    expect(m.getParameter()).toBe(0);
  });
  it('opens while speaking and stays within [0,1]', () => {
    const m = new TextMouthDriver(() => 0.5);
    m.start();
    let max = 0;
    for (let i = 0; i < 120; i++) { m.update(1 / 60); max = Math.max(max, m.getParameter()); expect(m.getParameter()).toBeGreaterThanOrEqual(0); expect(m.getParameter()).toBeLessThanOrEqual(1); }
    expect(max).toBeGreaterThan(0.4);
  });
  it('closes smoothly after stop (never jumps to 0 in one frame)', () => {
    const m = new TextMouthDriver(() => 0.5);
    m.start();
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    const before = m.getParameter();
    m.stop();
    m.update(1 / 60);
    expect(m.getParameter()).toBeLessThan(before);
    expect(m.getParameter()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

`pnpm install && pnpm test` → FAIL: modules not found.

- [ ] **Step 4: Implement**

`packages/stage/src/character.ts`:
```ts
import { z } from 'zod';

export const EMOTIONS = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral'] as const;
export type Emotion = (typeof EMOTIONS)[number];

const MotionRef = z.tuple([z.string(), z.number().int().nonnegative()]);
export type MotionRef = z.infer<typeof MotionRef>;

/** expression name | motion ref | null (= clear expression) */
const EmotionTarget = z.union([z.string(), MotionRef, z.null()]);

export const CharacterConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  model: z.string(),
  emotionMap: z.object(Object.fromEntries(EMOTIONS.map((e) => [e, EmotionTarget])) as Record<Emotion, typeof EmotionTarget>),
  motionMap: z.record(z.string(), MotionRef),
  idleGroup: z.string(),
  tapMotions: z.record(z.string(), z.record(z.string(), z.array(z.number().int().nonnegative()))),
  scale: z.number().positive().default(1),
  offsetY: z.number().default(0),
});
export type CharacterConfig = z.infer<typeof CharacterConfigSchema>;

export function parseCharacterConfig(json: unknown): CharacterConfig {
  return CharacterConfigSchema.parse(json);
}
```

`packages/stage/src/view.ts` — same math as `CubismWebSamples/Samples/TypeScript/Demo/src/lappview.ts` `initialize()` with `ViewScale = 1`:
```ts
export class ViewTransform {
  private readonly ratio: number;
  constructor(private readonly w: number, private readonly h: number) {
    this.ratio = w / h;
  }
  /** device (canvas) pixels → Cubism view space: x in [-ratio, ratio] (or [-1,1] for landscape), y up. */
  toView(deviceX: number, deviceY: number): { x: number; y: number } {
    // _deviceToScreen: scale by 2/max(w,h) in x, -2/max(w,h) in y, then translate by -w/2,-h/2
    const s = 2 / (this.w > this.h ? this.w : this.h);
    const sx = (deviceX - this.w * 0.5) * s;
    const sy = (deviceY - this.h * 0.5) * -s;
    // _viewMatrix with ViewScale=1 and screen rect (-ratio..ratio, -1..1) is identity in this setup
    return { x: sx, y: sy };
  }
  /** gaze target for CubismLook: both axes normalised to [-1, 1] relative to the canvas, clamped. */
  toGaze(deviceX: number, deviceY: number): { x: number; y: number } {
    const nx = (deviceX / this.w) * 2 - 1;
    const ny = -((deviceY / this.h) * 2 - 1);
    return { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
  }
}
```

`packages/stage/src/mouth.ts`:
```ts
/** Feeds ParamMouthOpenY. Mirrors Cubism's IParameterProvider (update + getParameter) so it can be
 *  handed straight to CubismLipSyncUpdater. Phase 2 adds AudioMouthDriver with the same interface. */
export interface MouthDriver {
  update(deltaSeconds: number): boolean;
  getParameter(): number;
  start(): void;
  stop(): void;
}

/** Procedural "talking" for text-only mode: a 4–7 Hz open/close rhythm with jittered amplitude. */
export class TextMouthDriver implements MouthDriver {
  private speaking = false;
  private value = 0;
  private phase = 0;
  private hz = 5;
  private amp = 0.8;

  constructor(private readonly rng: () => number = Math.random) {}

  start(): void { this.speaking = true; }
  stop(): void { this.speaking = false; }

  update(dt: number): boolean {
    let target = 0;
    if (this.speaking) {
      this.phase += dt * this.hz * Math.PI * 2;
      if (this.phase > Math.PI * 2) {
        this.phase -= Math.PI * 2;
        this.hz = 4 + this.rng() * 3;       // 4–7 Hz
        this.amp = 0.6 + this.rng() * 0.3;  // 0.6–0.9
      }
      target = this.amp * (0.5 - 0.5 * Math.cos(this.phase));
    }
    // fast attack, ~100 ms release
    const k = target > this.value ? 1 - Math.exp(-dt * 60) : 1 - Math.exp(-dt * 10);
    this.value += (target - this.value) * k;
    this.value = Math.max(0, Math.min(1, this.value));
    return true;
  }

  getParameter(): number { return this.value; }
}
```

- [ ] **Step 5: Run tests + typecheck**

`pnpm test && pnpm typecheck` → all PASS (typecheck of `@ds/stage` needs `vendor/core/live2dcubismcore.d.ts` from Task 2).

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(stage): character config schema, view transform, text mouth driver"
```

---

### Task 4: `CompanionModel` — async port of LAppModel on Framework 5-r.5

**Files:**
- Create: `packages/stage/src/companion-model.ts`, `packages/stage/src/textures.ts`, `packages/stage/src/index.ts`

**Interfaces:**
- Consumes: `MouthDriver`, `CharacterConfig`, `MotionRef` (Task 3); Framework classes listed below.
- Produces: `class CompanionModel extends CubismUserModel` with
  - `static async load(opts: { baseUrl: string; modelJson: string; gl: WebGL2RenderingContext; shaderPath: string; mouth: MouthDriver; checkMoc?: boolean }): Promise<CompanionModel>`
  - `expressionNames(): string[]`, `motionGroups(): Record<string, number>`, `hitAreaNames(): string[]`
  - `setExpression(name: string | null): void`
  - `startMotion(group: string, index: number, priority: number, onFinished?: () => void): boolean`
  - `hitTest(areaName: string, viewX: number, viewY: number): boolean` (inherited semantics), `hitAny(viewX, viewY): string | null`
  - `setGaze(x: number, y: number): void` (−1..1) — wraps `setDragging`
  - `tick(deltaSeconds: number): void` (the frame update), `draw(projection: CubismMatrix44, framebuffer: WebGLFramebuffer | null, viewport: number[]): void`
  - `idleGroup: string` (public field set by caller), `priorities = { none: 0, idle: 1, normal: 2, force: 3 }`.

Reference while implementing: `vendor/CubismWebFramework/src/model/cubismusermodel.ts` (base class), and the sample `https://raw.githubusercontent.com/Live2D/CubismWebSamples/5-r.5/Samples/TypeScript/Demo/src/lappmodel.ts` (the state-machine version we are replacing with `await`).

- [ ] **Step 1: Write `textures.ts`** (the sample's `LAppTextureManager.createTextureFromPngFile`, promisified)

```ts
export function loadTexture(gl: WebGL2RenderingContext, url: string, premultiply = true): Promise<WebGLTexture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error(`texture load failed: ${url}`));
    img.onload = () => {
      const tex = gl.createTexture();
      if (!tex) return reject(new Error('gl.createTexture failed'));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (premultiply) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
      resolve(tex);
    };
    img.src = url;
  });
}
```

- [ ] **Step 2: Write `companion-model.ts`**

```ts
import { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid';
import { CubismModelSettingJson } from '@framework/cubismmodelsettingjson';
import type { ICubismModelSetting } from '@framework/icubismmodelsetting';
import { CubismFramework } from '@framework/live2dcubismframework';
import type { CubismIdHandle } from '@framework/id/cubismid';
import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismMoc } from '@framework/model/cubismmoc';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import type { ACubismMotion } from '@framework/motion/acubismmotion';
import { InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager';
import { CubismUpdateScheduler } from '@framework/motion/cubismupdatescheduler';
import { CubismBreathUpdater } from '@framework/motion/cubismbreathupdater';
import { CubismEyeBlinkUpdater } from '@framework/motion/cubismeyeblinkupdater';
import { CubismExpressionUpdater } from '@framework/motion/cubismexpressionupdater';
import { CubismLipSyncUpdater } from '@framework/motion/cubismlipsyncupdater';
import { CubismLookUpdater } from '@framework/motion/cubismlookupdater';
import { CubismPhysicsUpdater } from '@framework/motion/cubismphysicsupdater';
import { CubismPoseUpdater } from '@framework/motion/cubismposeupdater';
import { IParameterProvider } from '@framework/motion/iparameterprovider';
import { BreathParameterData, CubismBreath } from '@framework/effect/cubismbreath';
import { CubismEyeBlink } from '@framework/effect/cubismeyeblink';
import { CubismLook, LookParameterData } from '@framework/effect/cubismlook';
import type { MouthDriver } from './mouth';
import { loadTexture } from './textures';

export const Priority = { none: 0, idle: 1, normal: 2, force: 3 } as const;

/** Adapts our MouthDriver to the Framework's abstract IParameterProvider. */
class MouthProvider extends IParameterProvider {
  constructor(private readonly driver: MouthDriver) { super(); }
  update(dt = 0): boolean { return this.driver.update(dt); }
  getParameter(): number { return this.driver.getParameter(); }
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
}

export class CompanionModel extends CubismUserModel {
  private setting!: ICubismModelSetting;
  private baseUrl = '';
  private shaderPath = '';
  private readonly scheduler = new CubismUpdateScheduler();
  private motionUpdated = false;
  private readonly motions = new Map<string, ACubismMotion>();
  private readonly expressions = new Map<string, ACubismMotion>();
  private eyeBlinkIds: CubismIdHandle[] = [];
  private lipSyncIds: CubismIdHandle[] = [];
  public idleGroup = 'Idle';

  static async load(opts: {
    baseUrl: string; modelJson: string; gl: WebGL2RenderingContext; shaderPath: string;
    mouth: MouthDriver; checkMoc?: boolean;
  }): Promise<CompanionModel> {
    const m = new CompanionModel();
    m.baseUrl = opts.baseUrl.endsWith('/') ? opts.baseUrl : opts.baseUrl + '/';
    m.shaderPath = opts.shaderPath;
    const settingBuf = await fetchBuffer(m.baseUrl + opts.modelJson);
    m.setting = new CubismModelSettingJson(settingBuf, settingBuf.byteLength);
    await m.setup(opts.gl, opts.mouth, opts.checkMoc ?? true);
    return m;
  }

  private async setup(gl: WebGL2RenderingContext, mouth: MouthDriver, checkMoc: boolean): Promise<void> {
    const s = this.setting;
    const idm = CubismFramework.getIdManager();
    const id = (name: string) => idm.getId(name);

    // moc — version guard first (spec §8)
    const mocBuf = await fetchBuffer(this.baseUrl + s.getModelFileName());
    const mocVersion = CubismMoc.getMocVersionFromBuffer(mocBuf);
    const latest = Live2DCubismCore.Version.csmGetLatestMocVersion();
    if (mocVersion > latest) throw new Error(`model moc3 version ${mocVersion} is newer than bundled Core (${latest})`);
    this.loadModel(mocBuf, checkMoc);

    // expressions
    for (let i = 0; i < s.getExpressionCount(); i++) {
      const name = s.getExpressionName(i);
      const buf = await fetchBuffer(this.baseUrl + s.getExpressionFileName(i));
      const motion = this.loadExpression(buf, buf.byteLength, name);
      if (motion) this.expressions.set(name, motion);
    }
    this.scheduler.addUpdatableList(new CubismExpressionUpdater(this._expressionManager));

    // physics / pose
    if (s.getPhysicsFileName() !== '') {
      const buf = await fetchBuffer(this.baseUrl + s.getPhysicsFileName());
      this.loadPhysics(buf, buf.byteLength);
      this.scheduler.addUpdatableList(new CubismPhysicsUpdater(this._physics));
    }
    if (s.getPoseFileName() !== '') {
      const buf = await fetchBuffer(this.baseUrl + s.getPoseFileName());
      this.loadPose(buf, buf.byteLength);
      this.scheduler.addUpdatableList(new CubismPoseUpdater(this._pose));
    }

    // eye blink
    if (s.getEyeBlinkParameterCount() > 0) {
      this._eyeBlink = CubismEyeBlink.create(s);
      this.scheduler.addUpdatableList(new CubismEyeBlinkUpdater(() => this.motionUpdated, this._eyeBlink));
    }
    for (let i = 0; i < s.getEyeBlinkParameterCount(); i++) this.eyeBlinkIds.push(s.getEyeBlinkParameterId(i));

    // breath (same constants as the sample)
    const angleX = id(CubismDefaultParameterId.ParamAngleX);
    const angleY = id(CubismDefaultParameterId.ParamAngleY);
    const angleZ = id(CubismDefaultParameterId.ParamAngleZ);
    const bodyX = id(CubismDefaultParameterId.ParamBodyAngleX);
    this._breath = CubismBreath.create();
    this._breath.setParameters([
      new BreathParameterData(angleX, 0.0, 15.0, 6.5345, 0.5),
      new BreathParameterData(angleY, 0.0, 8.0, 3.5345, 0.5),
      new BreathParameterData(angleZ, 0.0, 10.0, 5.5345, 0.5),
      new BreathParameterData(bodyX, 0.0, 4.0, 15.5345, 0.5),
      new BreathParameterData(id(CubismDefaultParameterId.ParamBreath), 0.5, 0.5, 3.2345, 1),
    ]);
    this.scheduler.addUpdatableList(new CubismBreathUpdater(this._breath));

    // user data (optional)
    if (s.getUserDataFile() !== '') {
      const buf = await fetchBuffer(this.baseUrl + s.getUserDataFile());
      this.loadUserData(buf, buf.byteLength);
    }

    // lip sync → our mouth driver
    for (let i = 0; i < s.getLipSyncParameterCount(); i++) this.lipSyncIds.push(s.getLipSyncParameterId(i));
    if (this.lipSyncIds.length > 0) {
      this.scheduler.addUpdatableList(new CubismLipSyncUpdater(this.lipSyncIds, new MouthProvider(mouth)));
    }

    // look (gaze) — driven by _dragManager via setGaze()
    const look = CubismLook.create();
    look.setParameters([
      new LookParameterData(angleX, 30.0, 0.0, 0.0),
      new LookParameterData(angleY, 0.0, 30.0, 0.0),
      new LookParameterData(angleZ, 0.0, 0.0, -30.0),
      new LookParameterData(bodyX, 10.0, 0.0, 0.0),
      new LookParameterData(id(CubismDefaultParameterId.ParamEyeBallX), 1.0, 0.0, 0.0),
      new LookParameterData(id(CubismDefaultParameterId.ParamEyeBallY), 0.0, 1.0, 0.0),
    ]);
    this.scheduler.addUpdatableList(new CubismLookUpdater(look, this._dragManager));
    this.scheduler.sortUpdatableList();

    // layout
    const layout = new Map<string, number>();
    s.getLayoutMap(layout);
    this._modelMatrix.setupFromLayout(layout);

    // motions (preload all groups)
    this._model.saveParameters();
    for (let g = 0; g < s.getMotionGroupCount(); g++) {
      const group = s.getMotionGroupName(g);
      for (let i = 0; i < s.getMotionCount(group); i++) {
        const file = s.getMotionFileName(group, i);
        const buf = await fetchBuffer(this.baseUrl + file);
        const motion = this.loadMotion(buf, buf.byteLength, `${group}_${i}`, undefined, undefined, s, group, i, this._motionConsistency);
        if (!motion) continue;
        motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);
        this.motions.set(`${group}_${i}`, motion);
      }
    }
    this._motionManager.stopAllMotions();

    // renderer + textures
    this.createRenderer(gl.canvas.width, gl.canvas.height);
    this.getRenderer().startUp(gl);
    this.getRenderer().loadShaders(this.shaderPath);
    this.getRenderer().setIsPremultipliedAlpha(true);
    const texDir = s.getTextureDirectory();
    for (let i = 0; i < s.getTextureCount(); i++) {
      const name = s.getTextureFileName(i);
      if (name === '') continue;
      const tex = await loadTexture(gl, this.baseUrl + name, true);
      this.getRenderer().bindTexture(i, tex);
    }
    void texDir;
    this._updating = false;
    this._initialized = true;
  }

  // ---- public API -------------------------------------------------------

  expressionNames(): string[] { return [...this.expressions.keys()]; }

  motionGroups(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let g = 0; g < this.setting.getMotionGroupCount(); g++) {
      const name = this.setting.getMotionGroupName(g);
      out[name] = this.setting.getMotionCount(name);
    }
    return out;
  }

  hitAreaNames(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.setting.getHitAreasCount(); i++) out.push(this.setting.getHitAreaName(i));
    return out;
  }

  setExpression(name: string | null): void {
    if (name === null) { this._expressionManager.stopAllMotions(); return; }
    const motion = this.expressions.get(name);
    if (!motion) throw new Error(`unknown expression ${name}`);
    this._expressionManager.startMotion(motion, false);
  }

  startMotion(group: string, index: number, priority: number, onFinished?: () => void): boolean {
    if (priority === Priority.force) this._motionManager.setReservePriority(priority);
    else if (!this._motionManager.reserveMotion(priority)) return false;
    const motion = this.motions.get(`${group}_${index}`);
    if (!motion) return false;
    motion.setFinishedMotionHandler(onFinished ? () => onFinished() : null);
    const h = this._motionManager.startMotionPriority(motion, false, priority);
    return h !== InvalidMotionQueueEntryHandleValue;
  }

  hitTest(areaName: string, viewX: number, viewY: number): boolean {
    if (this._opacity < 1) return false;
    for (let i = 0; i < this.setting.getHitAreasCount(); i++) {
      if (this.setting.getHitAreaName(i) === areaName) return this.isHit(this.setting.getHitAreaId(i), viewX, viewY);
    }
    return false;
  }

  hitAny(viewX: number, viewY: number): string | null {
    for (const name of this.hitAreaNames()) if (this.hitTest(name, viewX, viewY)) return name;
    return null;
  }

  setGaze(x: number, y: number): void { this.setDragging(x, y); }

  /** Frame update — identical order to LAppModel.update() at 5-r.5. */
  tick(dt: number): void {
    if (!this._initialized) return;
    this._model.loadParameters();
    this.motionUpdated = false;
    if (this._motionManager.isFinished()) {
      const n = this.setting.getMotionCount(this.idleGroup);
      if (n > 0) this.startMotion(this.idleGroup, Math.floor(Math.random() * n), Priority.idle);
    } else {
      this.motionUpdated = this._motionManager.updateMotion(this._model, dt);
    }
    this._model.saveParameters();
    this.scheduler.onLateUpdate(this._model, dt);
    this._model.update();
  }

  draw(projection: CubismMatrix44, framebuffer: WebGLFramebuffer | null, viewport: number[]): void {
    if (!this._initialized) return;
    const mvp = projection.clone();
    mvp.multiplyByMatrix(this._modelMatrix);
    const r = this.getRenderer();
    r.setMvpMatrix(mvp);
    r.setRenderState(framebuffer, viewport);
    r.drawModel(this.shaderPath);
  }
}
```

`packages/stage/src/index.ts`:
```ts
export * from './character';
export * from './mouth';
export * from './view';
export * from './companion-model';
export * from './stage';
```
(`./stage` is created in Task 5; add the export line then if the typecheck complains now.)

- [ ] **Step 3: Typecheck**

`pnpm --filter @ds/stage typecheck` → clean. If a Framework signature differs from the above (e.g. `loadMotion` parameter order, `setParameters` expecting `csmVector`), open the file under `vendor/CubismWebFramework/src/` and adapt — the sample `lappmodel.ts` at tag 5-r.5 is the authority.

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "feat(stage): CompanionModel — async LAppModel port on Framework 5-r.5"
```

---

### Task 5: `Live2DStage` — framework boot, GL, render loop, public API

**Files:**
- Create: `packages/stage/src/stage.ts`, `packages/stage/src/ticker.ts`, `packages/stage/src/ticker.test.ts`

**Interfaces:**
- Consumes: `CompanionModel`, `ViewTransform`, `MouthDriver`, `CharacterConfig`.
- Produces: `class Live2DStage` with
  - `static async create(opts: { canvas: HTMLCanvasElement; characterUrl: string /* dir containing character.json */; shaderPath: string; mouth?: MouthDriver; preserveDrawingBuffer?: boolean }): Promise<Live2DStage>`
  - `readonly config: CharacterConfig`, `readonly model: CompanionModel`, `readonly mouth: MouthDriver`
  - `setFps(fps: 30 | 60): void`, `start(): void`, `stop(): void`
  - `resize(): void` (reads `canvas.clientWidth/Height * devicePixelRatio`)
  - `hitTestClient(clientX: number, clientY: number): string | null` (CSS px → hit area name)
  - `gazeClient(clientX: number, clientY: number): void` (CSS px, may be outside the canvas)
  - `setEmotion(e: Emotion): void` (resolves through `config.emotionMap`), `playMotion(ref: MotionRef, priority?: number): boolean`
  - `dispose(): void`
  - `class Ticker { constructor(cb: (dt: number) => void); setFps(n: number); start(); stop(); }` using `requestAnimationFrame` with frame skipping to hit the target fps.

- [ ] **Step 1: Failing ticker test**

`packages/stage/src/ticker.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { shouldRender } from './ticker';

describe('shouldRender', () => {
  it('renders every frame at 60 fps', () => {
    expect(shouldRender(60, 0, 16.7)).toBe(true);
  });
  it('skips frames that arrive before the 30 fps interval elapsed', () => {
    expect(shouldRender(30, 1000, 1016.7)).toBe(false);
    expect(shouldRender(30, 1000, 1033.4)).toBe(true);
  });
});
```
Run `pnpm test` → FAIL (module missing).

- [ ] **Step 2: Implement `ticker.ts`**

```ts
export function shouldRender(fps: number, lastRenderMs: number, nowMs: number): boolean {
  const interval = 1000 / fps;
  return nowMs - lastRenderMs >= interval - 0.5; // 0.5 ms tolerance for rAF jitter
}

export class Ticker {
  private fps = 30;
  private last = 0;
  private lastRender = 0;
  private raf = 0;
  private running = false;
  constructor(private readonly cb: (dtSeconds: number) => void) {}
  setFps(fps: number): void { this.fps = fps; }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      if (shouldRender(this.fps, this.lastRender, now)) {
        const dt = Math.min((now - this.last) / 1000, 0.1); // clamp after tab/lock stalls
        this.last = now;
        this.lastRender = now;
        this.cb(dt);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }
}
```

- [ ] **Step 3: Implement `stage.ts`**

```ts
import { CubismFramework, LogLevel, Option } from '@framework/live2dcubismframework';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix';
import { CubismWebGLOffscreenManager } from '@framework/rendering/cubismoffscreenmanager';
import { CompanionModel, Priority } from './companion-model';
import { parseCharacterConfig, type CharacterConfig, type Emotion, type MotionRef } from './character';
import { TextMouthDriver, type MouthDriver } from './mouth';
import { Ticker } from './ticker';
import { ViewTransform } from './view';

let frameworkStarted = false;
function bootFramework(): void {
  if (frameworkStarted) return;
  const opt = new Option();
  opt.logFunction = (m: string) => console.log('[cubism]', m);
  opt.loggingLevel = LogLevel.LogLevel_Warning;
  CubismFramework.startUp(opt);
  CubismFramework.initialize();
  frameworkStarted = true;
}

export class Live2DStage {
  readonly config: CharacterConfig;
  readonly model: CompanionModel;
  readonly mouth: MouthDriver;
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private view = new ViewTransform(1, 1);
  private readonly viewMatrix = new CubismViewMatrix();
  private readonly ticker: Ticker;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, config: CharacterConfig, model: CompanionModel, mouth: MouthDriver) {
    this.canvas = canvas; this.gl = gl; this.config = config; this.model = model; this.mouth = mouth;
    this.ticker = new Ticker((dt) => this.frame(dt));
    this.resize();
  }

  static async create(opts: {
    canvas: HTMLCanvasElement; characterUrl: string; shaderPath: string;
    mouth?: MouthDriver; preserveDrawingBuffer?: boolean;
  }): Promise<Live2DStage> {
    if (typeof Live2DCubismCore === 'undefined') throw new Error('live2dcubismcore.min.js must be loaded via <script> before the stage');
    bootFramework();
    const gl = opts.canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error('WebGL2 is required');
    const base = opts.characterUrl.endsWith('/') ? opts.characterUrl : opts.characterUrl + '/';
    const cfgRes = await fetch(base + 'character.json');
    if (!cfgRes.ok) throw new Error(`character.json ${cfgRes.status}`);
    const config = parseCharacterConfig(await cfgRes.json());
    const mouth = opts.mouth ?? new TextMouthDriver();

    opts.canvas.width = Math.max(1, Math.round(opts.canvas.clientWidth * devicePixelRatio));
    opts.canvas.height = Math.max(1, Math.round(opts.canvas.clientHeight * devicePixelRatio));
    CubismWebGLOffscreenManager.getInstance().initialize(gl, opts.canvas.width, opts.canvas.height);

    const model = await CompanionModel.load({ baseUrl: base, modelJson: config.model, gl, shaderPath: opts.shaderPath, mouth });
    model.idleGroup = config.idleGroup;
    return new Live2DStage(opts.canvas, gl, config, model, mouth);
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.view = new ViewTransform(w, h);
    const ratio = w / h;
    this.viewMatrix.setScreenRect(-ratio, ratio, -1, 1);
    this.viewMatrix.scale(1, 1);
    this.viewMatrix.setMaxScale(2); this.viewMatrix.setMinScale(0.8);
    this.viewMatrix.setMaxScreenRect(-2, 2, -2, 2);
    this.model.setRenderTargetSize(w, h);
  }

  setFps(fps: 30 | 60): void { this.ticker.setFps(fps); }
  start(): void { this.ticker.start(); }
  stop(): void { this.ticker.stop(); }

  private frame(dt: number): void {
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);            // transparent background (the sample clears to black)
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearDepth(1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const offscreen = CubismWebGLOffscreenManager.getInstance();
    offscreen.beginFrameProcess(gl);
    const projection = new CubismMatrix44();
    if (this.model.getModel().getCanvasWidth() > 1 && w < h) {
      this.model.getModelMatrix().setWidth(2);
      projection.scale(1, w / h);
    } else {
      projection.scale(h / w, 1);
    }
    projection.scale(this.config.scale, this.config.scale);
    projection.translateRelative(0, this.config.offsetY);
    projection.multiplyByMatrix(this.viewMatrix);

    this.model.tick(dt);
    this.model.draw(projection, null, [0, 0, w, h]);
    offscreen.endFrameProcess(gl);
    offscreen.releaseStaleRenderTextures(gl);
  }

  private toDevice(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left) * devicePixelRatio, y: (clientY - r.top) * devicePixelRatio };
  }

  hitTestClient(clientX: number, clientY: number): string | null {
    const d = this.toDevice(clientX, clientY);
    const v = this.view.toView(d.x, d.y);
    // undo the projection scale/offset applied in frame()
    const x = this.viewMatrix.invertTransformX(v.x) / this.config.scale;
    const y = (this.viewMatrix.invertTransformY(v.y) - this.config.offsetY) / this.config.scale;
    return this.model.hitAny(x, y);
  }

  gazeClient(clientX: number, clientY: number): void {
    const d = this.toDevice(clientX, clientY);
    const g = this.view.toGaze(d.x, d.y);
    this.model.setGaze(g.x, g.y);
  }

  setEmotion(e: Emotion): void {
    const target = this.config.emotionMap[e];
    if (target === null) { this.model.setExpression(null); return; }
    if (typeof target === 'string') { this.model.setExpression(target); return; }
    this.playMotion(target, Priority.normal);
  }

  playMotion(ref: MotionRef, priority: number = Priority.normal): boolean {
    return this.model.startMotion(ref[0], ref[1], priority);
  }

  dispose(): void {
    this.stop();
    this.model.release();
    CubismWebGLOffscreenManager.getInstance().removeContext(this.gl);
  }
}
```
If `CubismWebGLOffscreenManager.initialize` has a different signature in 5-r.5, read `vendor/CubismWebFramework/src/rendering/cubismoffscreenmanager.ts` and the sample's `lappsubdelegate.ts` and match them. The hit-test un-projection above is the only non-sample math; Task 6's Playwright test proves it.

- [ ] **Step 4: Tests + typecheck**

`pnpm test && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(stage): Live2DStage render loop, ticker, hit-test, gaze, emotion mapping"
```

---

### Task 6: Pet renderer page in browser mode + Playwright smoke test

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.renderer.json`, `apps/desktop/vite.browser.config.ts`, `apps/desktop/playwright.config.ts`
- Create: `apps/desktop/src/renderer/pet.html`, `apps/desktop/src/renderer/pet/main.ts`, `apps/desktop/src/renderer/pet/debug-panel.ts`, `apps/desktop/src/renderer/pet/hover.ts`, `apps/desktop/src/renderer/pet/hover.test.ts`, `apps/desktop/src/renderer/pet/bridge.ts`
- Create: `apps/desktop/tests/stage.spec.ts`
- Modify: `characters/haru/character.json` (correct the F0x mapping after viewing)

**Interfaces:**
- Consumes: `Live2DStage`, `Channels`/`Schemas` from `@ds/protocol`.
- Produces:
  - `window.ds?: DsBridge` where `interface DsBridge { send<C extends Channel>(c: C, p: Payload<C>): void; on<C extends Channel>(c: C, cb: (p: Payload<C>) => void): () => void }` (provided by the preload in Task 7; in browser mode `window.ds` is undefined and the page runs standalone).
  - `window.__stage` (test hook, only when `?test=1`): `{ ready: boolean; setExpression(name: string | null): void; playMotion(group: string, i: number): boolean; hitTest(x: number, y: number): string | null; pixels(): { opaque: number; hash: number } }`.
  - `HoverTracker` (pure): `constructor(onChange: (inside: boolean) => void, debounceMs = 50)`, `sample(inside: boolean, nowMs: number): void` — emits only on debounced changes.

- [ ] **Step 1: Failing hover test**

`apps/desktop/src/renderer/pet/hover.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { HoverTracker } from './hover';

describe('HoverTracker', () => {
  it('emits enter once after the debounce window', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(true, 20); h.sample(true, 60);
    expect(events).toEqual([true]);
  });
  it('does not emit for a blip shorter than the debounce', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(false, 10); h.sample(false, 70);
    expect(events).toEqual([]);
  });
  it('emits leave after a stable outside period', () => {
    const events: boolean[] = [];
    const h = new HoverTracker((v) => events.push(v), 50);
    h.sample(true, 0); h.sample(true, 60); h.sample(false, 100); h.sample(false, 160);
    expect(events).toEqual([true, false]);
  });
});
```
`pnpm test` → FAIL.

- [ ] **Step 2: Implement `hover.ts`**

```ts
export class HoverTracker {
  private emitted = false;
  private candidate = false;
  private since = 0;
  constructor(private readonly onChange: (inside: boolean) => void, private readonly debounceMs = 50) {}
  sample(inside: boolean, nowMs: number): void {
    if (inside !== this.candidate) { this.candidate = inside; this.since = nowMs; }
    if (this.candidate !== this.emitted && nowMs - this.since >= this.debounceMs) {
      this.emitted = this.candidate;
      this.onChange(this.emitted);
    }
  }
}
```

- [ ] **Step 3: App package + configs**

`apps/desktop/package.json`:
```json
{
  "name": "@ds/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "dev:browser": "vite --config vite.browser.config.ts",
    "build": "electron-vite build",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.renderer.json",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@ds/protocol": "workspace:*",
    "@ds/stage": "workspace:*",
    "koffi": "^2.9.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "electron": "43.4.1",
    "electron-vite": "latest",
    "vite": "^7.0.0"
  }
}
```
Run `pnpm install` then replace `"latest"` with the resolved electron-vite version from `pnpm list electron-vite` (pin it). If `vite@^7` conflicts with electron-vite's peer range, use the range electron-vite declares (`pnpm why vite`).

`apps/desktop/tsconfig.json` (main + preload, Node):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "lib": ["ES2022"] },
  "include": ["src/main", "src/preload", "electron.vite.config.ts", "vite.browser.config.ts", "playwright.config.ts"]
}
```
`apps/desktop/tsconfig.renderer.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "strictNullChecks": false,
    "experimentalDecorators": true,
    "baseUrl": ".",
    "paths": { "@framework/*": ["../../vendor/CubismWebFramework/src/*"] }
  },
  "include": ["src/renderer", "../../vendor/core/live2dcubismcore.d.ts", "../../packages/stage/src"]
}
```
Add `"@types/node": "^24.0.0"` to root devDependencies.

`apps/desktop/vite.browser.config.ts`:
```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'public'),
  resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
  server: { port: 5174, fs: { allow: [resolve(__dirname, '../..')] } },
});
```

`apps/desktop/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5174', headless: true, launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'pnpm dev:browser', url: 'http://localhost:5174/pet.html?test=1', reuseExistingServer: true, timeout: 60_000 },
});
```

- [ ] **Step 4: Renderer page**

`apps/desktop/src/renderer/pet.html`:
```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>ds pet</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
    #stage { width: 100%; height: 100%; display: block; }
    #debug { position: fixed; top: 8px; left: 8px; font: 12px system-ui; background: rgba(0,0,0,.6); color: #fff; padding: 8px; border-radius: 6px; display: none; }
    #debug.show { display: block; }
    #debug select, #debug button { margin: 2px; }
  </style>
  <script src="/live2d/core/live2dcubismcore.min.js"></script>
</head>
<body>
  <canvas id="stage"></canvas>
  <div id="debug"></div>
  <script type="module" src="/pet/main.ts"></script>
</body>
</html>
```

`apps/desktop/src/renderer/pet/bridge.ts`:
```ts
import type { Channel, Payload } from '@ds/protocol';
export interface DsBridge {
  send<C extends Channel>(channel: C, payload: Payload<C>): void;
  on<C extends Channel>(channel: C, cb: (payload: Payload<C>) => void): () => void;
}
declare global { interface Window { ds?: DsBridge } }
export const bridge: DsBridge | undefined = window.ds;
```

`apps/desktop/src/renderer/pet/debug-panel.ts`:
```ts
import type { Live2DStage } from '@ds/stage';
import { EMOTIONS } from '@ds/stage';

export function mountDebugPanel(root: HTMLElement, stage: Live2DStage): void {
  root.classList.add('show');
  const exprs = stage.model.expressionNames();
  const groups = stage.model.motionGroups();
  root.innerHTML = `
    <div>expression: <select id="dbg-expr"><option value="">(none)</option>${exprs.map((e) => `<option>${e}</option>`).join('')}</select></div>
    <div>emotion: ${EMOTIONS.map((e) => `<button data-emo="${e}">${e}</button>`).join('')}</div>
    <div>motion: ${Object.entries(groups).map(([g, n]) => Array.from({ length: n }, (_, i) => `<button data-motion="${g}:${i}">${g}[${i}]</button>`).join('')).join('')}</div>
    <div>mouth: <button id="dbg-talk">talk</button> <button id="dbg-quiet">quiet</button></div>
    <div id="dbg-hit">hit: -</div>`;
  root.querySelector<HTMLSelectElement>('#dbg-expr')!.onchange = (ev) => {
    const v = (ev.target as HTMLSelectElement).value;
    stage.model.setExpression(v === '' ? null : v);
  };
  root.querySelectorAll<HTMLButtonElement>('[data-emo]').forEach((b) => (b.onclick = () => stage.setEmotion(b.dataset.emo as (typeof EMOTIONS)[number])));
  root.querySelectorAll<HTMLButtonElement>('[data-motion]').forEach((b) => (b.onclick = () => { const [g, i] = b.dataset.motion!.split(':'); stage.playMotion([g, Number(i)]); }));
  root.querySelector<HTMLButtonElement>('#dbg-talk')!.onclick = () => stage.mouth.start();
  root.querySelector<HTMLButtonElement>('#dbg-quiet')!.onclick = () => stage.mouth.stop();
}
```

`apps/desktop/src/renderer/pet/main.ts`:
```ts
import { Live2DStage } from '@ds/stage';
import { Channels } from '@ds/protocol';
import { bridge } from './bridge';
import { HoverTracker } from './hover';
import { mountDebugPanel } from './debug-panel';

const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const DEBUG = TEST || params.get('debug') === '1';
const character = params.get('character') ?? 'haru';

async function main(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const stage = await Live2DStage.create({
    canvas, characterUrl: `/characters/${character}`, shaderPath: '/live2d/shaders/', preserveDrawingBuffer: TEST,
  });
  stage.start();
  window.addEventListener('resize', () => stage.resize());

  // hover → click-through toggle (main decides), tap → motion, drag → move window
  const hover = new HoverTracker((inside) => {
    bridge?.send(Channels.avatarHover, { inside });
    stage.setFps(inside ? 60 : 30);
  });
  let dragging: { x: number; y: number } | null = null;
  window.addEventListener('mousemove', (e) => {
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    hover.sample(hit !== null, performance.now());
    if (!bridge) stage.gazeClient(e.clientX, e.clientY); // browser mode: gaze from local mouse
    if (dragging) {
      bridge?.send(Channels.avatarDrag, { dx: e.screenX - dragging.x, dy: e.screenY - dragging.y });
      dragging = { x: e.screenX, y: e.screenY };
    }
    const el = document.getElementById('dbg-hit'); if (el) el.textContent = `hit: ${hit ?? '-'}`;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (stage.hitTestClient(e.clientX, e.clientY) === null) return;
    dragging = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    const wasDragging = dragging !== null; dragging = null;
    if (wasDragging) bridge?.send(Channels.avatarDragEnd, {});
    const hit = stage.hitTestClient(e.clientX, e.clientY);
    if (hit) {
      bridge?.send(Channels.avatarTap, { hitArea: hit });
      const options = stage.config.tapMotions[hit];
      if (options) {
        const [group, idxs] = Object.entries(options)[0];
        stage.playMotion([group, idxs[Math.floor(Math.random() * idxs.length)]]);
      }
    }
  });

  bridge?.on(Channels.gazeCursor, ({ x, y }) => stage.gazeClient(x, y));
  bridge?.on(Channels.stageSetFps, ({ fps }) => stage.setFps(fps));
  bridge?.on(Channels.debugExpression, ({ name }) => stage.model.setExpression(name));
  bridge?.on(Channels.debugMotion, ({ group, index }) => stage.playMotion([group, index]));
  bridge?.on(Channels.shellVisibility, ({ hidden }) => (hidden ? stage.stop() : stage.start()));

  if (DEBUG) mountDebugPanel(document.getElementById('debug')!, stage);

  bridge?.send(Channels.stageReady, {
    character, expressions: stage.model.expressionNames(), motionGroups: stage.model.motionGroups(), hitAreas: stage.model.hitAreaNames(),
  });

  if (TEST) {
    const pixels = () => {
      const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
      const ctx = c2.getContext('2d')!; ctx.drawImage(canvas, 0, 0);
      const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
      let opaque = 0, hash = 0;
      for (let i = 3; i < d.length; i += 4 * 7) { if (d[i] > 10) opaque++; hash = (hash * 31 + d[i - 3] + d[i - 2] * 3 + d[i - 1] * 7) >>> 0; }
      return { opaque, hash };
    };
    (window as unknown as { __stage: unknown }).__stage = {
      ready: true,
      setExpression: (n: string | null) => stage.model.setExpression(n),
      playMotion: (g: string, i: number) => stage.playMotion([g, i]),
      hitTest: (x: number, y: number) => stage.hitTestClient(x, y),
      pixels,
    };
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  bridge?.send(Channels.stageError, { message });
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;background:#000;padding:8px">${message}</pre>`);
});
```

- [ ] **Step 5: Playwright smoke test**

`apps/desktop/tests/stage.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

type Hook = { ready: boolean; setExpression(n: string | null): void; playMotion(g: string, i: number): boolean; hitTest(x: number, y: number): string | null; pixels(): { opaque: number; hash: number } };
const hook = (fn: (s: Hook) => unknown) => `(${fn.toString()})(window.__stage)`;

test('Haru renders, expressions change pixels, hit-test finds the body', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/pet.html?test=1&character=haru');
  await page.waitForFunction(() => (window as unknown as { __stage?: Hook }).__stage?.ready === true, null, { timeout: 45_000 });
  await page.waitForTimeout(1500); // shaders fetch + first idle frames

  const before = (await page.evaluate(hook((s) => s.pixels()))) as { opaque: number; hash: number };
  expect(before.opaque).toBeGreaterThan(500);

  await page.evaluate(hook((s) => s.setExpression('F01')));
  await page.waitForTimeout(1500); // expression fade is 1 s
  const after = (await page.evaluate(hook((s) => s.pixels()))) as { opaque: number; hash: number };
  expect(after.hash).not.toBe(before.hash);

  const hit = await page.evaluate(hook((s) => s.hitTest(200, 350)));
  expect(['Head', 'Body']).toContain(hit);
  const miss = await page.evaluate(hook((s) => s.hitTest(5, 5)));
  expect(miss).toBeNull();

  await page.screenshot({ path: '../../docs/evidence/phase1/browser-haru.png' });
});
```

- [ ] **Step 6: Run everything**

```powershell
pnpm install
pnpm exec playwright install chromium
pnpm test
pnpm --filter @ds/desktop typecheck
pnpm --filter @ds/desktop test:e2e
```
Expected: unit tests PASS; e2e PASS; `docs/evidence/phase1/browser-haru.png` shows Haru. If the model renders but hit-test misses at (200,350), open `http://localhost:5174/pet.html?debug=1` and watch the `hit:` readout while moving the mouse; fix `Live2DStage.hitTestClient` un-projection until Head/Body track the drawn model, then re-run.

- [ ] **Step 7: Assign Haru's expressions to emotions (visual check)**

Run `pnpm --filter @ds/desktop dev:browser`, open `http://localhost:5174/pet.html?debug=1`, cycle F01–F08 in the dropdown, and rewrite `characters/haru/character.json` `emotionMap` so each of the 9 emotions points at the expression that looks right (a Chinese-pet reading: 开心/难过/生气/思考/惊讶/尴尬/疑问/好奇). Record the choice in the commit message. Re-run `pnpm fetch-sdk` (it re-copies `character.json` into `public/`).

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "feat(desktop): pet renderer page, debug panel, hover tracker, Playwright smoke test + Haru emotion map"
```

---

### Task 7: Electron shell — pet window, click-through, drag, cursor gaze, tray

**Files:**
- Create: `apps/desktop/electron.vite.config.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/pet-window.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/cursor.ts`, `apps/desktop/src/main/tray.ts`, `apps/desktop/src/main/window-state.ts`, `apps/desktop/src/main/window-state.test.ts`, `apps/desktop/src/preload/pet.ts`, `scripts/make-tray-icon.mjs`, `apps/desktop/resources/tray.png`
- Create: `docs/evidence/phase1/desktop-idle.png`, `desktop-hover.png`, `desktop-debug.png`

**Interfaces:**
- Consumes: `Channels`, `Schemas`, `parseEvent`, `RENDERER_TO_MAIN`, `MAIN_TO_RENDERER` from `@ds/protocol`; renderer contract from Task 6 (`window.ds`).
- Produces:
  - `ipc.ts`: `sendToPet<C>(win: BrowserWindow, c: C, p: Payload<C>)`, `onFromPet<C>(c: C, cb: (p: Payload<C>, win: BrowserWindow) => void)`, `registerIpc()`.
  - `pet-window.ts`: `createPetWindow(): BrowserWindow`, `setClickThrough(win, ignore: boolean)`, `moveBy(win, dx, dy)`.
  - `window-state.ts` (pure + fs): `clampToDisplays(pos: {x,y,w,h}, displays: {x,y,width,height}[]): {x,y}`, `loadWindowState(file): {x,y}|null`, `saveWindowState(file, {x,y})`.
  - `cursor.ts`: `startCursorPolling(win, hz = 30): () => void` — emits `gaze:cursor` in window-local CSS px.
  - `tray.ts`: `createTray(actions: { toggleVisible(): void; toggleDebug(): void; quit(): void }): Tray`.

- [ ] **Step 1: Failing window-state test**

`apps/desktop/src/main/window-state.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { clampToDisplays } from './window-state';

const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 1920, height: 1080 }];

describe('clampToDisplays', () => {
  it('keeps a position that is on a display', () => {
    expect(clampToDisplays({ x: 2000, y: 100, w: 400, h: 700 }, displays)).toEqual({ x: 2000, y: 100 });
  });
  it('pulls a fully off-screen window back onto the nearest display', () => {
    const p = clampToDisplays({ x: 5000, y: 100, w: 400, h: 700 }, displays);
    expect(p.x + 400).toBeLessThanOrEqual(3840);
    expect(p.x).toBeGreaterThanOrEqual(1920);
  });
  it('falls back to bottom-right of the first display when nothing is known', () => {
    expect(clampToDisplays(null, displays, { w: 400, h: 700 })).toEqual({ x: 1920 - 400 - 24, y: 1080 - 700 - 24 });
  });
});
```
`pnpm test` → FAIL.

- [ ] **Step 2: Implement `window-state.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Rect = { x: number; y: number; width: number; height: number };
export type Pos = { x: number; y: number };

export function clampToDisplays(pos: { x: number; y: number; w: number; h: number } | null, displays: Rect[], size?: { w: number; h: number }): Pos {
  const d0 = displays[0];
  if (!pos) {
    const w = size?.w ?? 400, h = size?.h ?? 700;
    return { x: d0.x + d0.width - w - 24, y: d0.y + d0.height - h - 24 };
  }
  const cx = pos.x + pos.w / 2, cy = pos.y + pos.h / 2;
  const on = displays.find((d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
  if (on) return { x: pos.x, y: pos.y };
  // nearest display by centre distance
  const nearest = displays.reduce((best, d) => {
    const dx = d.x + d.width / 2 - cx, dy = d.y + d.height / 2 - cy;
    const dist = dx * dx + dy * dy;
    return dist < best.dist ? { d, dist } : best;
  }, { d: d0, dist: Number.POSITIVE_INFINITY }).d;
  return {
    x: Math.min(Math.max(pos.x, nearest.x), nearest.x + nearest.width - pos.w),
    y: Math.min(Math.max(pos.y, nearest.y), nearest.y + nearest.height - pos.h),
  };
}

export function loadWindowState(file: string): Pos | null {
  try {
    if (!existsSync(file)) return null;
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Pos>;
    return typeof j.x === 'number' && typeof j.y === 'number' ? { x: j.x, y: j.y } : null;
  } catch { return null; }
}

export function saveWindowState(file: string, pos: Pos): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(pos));
}
```
`pnpm test` → PASS.

- [ ] **Step 3: Tray icon generator (no deps)**

`scripts/make-tray-icon.mjs`:
```js
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 16, H = 16;
const rows = [];
for (let y = 0; y < H; y++) {
  const row = [0];
  for (let x = 0; x < W; x++) {
    const dx = x - 7.5, dy = y - 7.5;
    const inside = dx * dx + dy * dy <= 6.5 * 6.5;
    row.push(inside ? 0xff : 0x00, inside ? 0x8c : 0x00, inside ? 0xb4 : 0x00, inside ? 0xff : 0x00);
  }
  rows.push(...row);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('apps/desktop/resources', { recursive: true });
writeFileSync('apps/desktop/resources/tray.png', png);
console.log('wrote apps/desktop/resources/tray.png', png.length, 'bytes');
```
Run `node scripts/make-tray-icon.mjs` → prints the byte count; open the PNG (`start apps\desktop\resources\tray.png`) to see a blue disc.

- [ ] **Step 4: electron-vite config**

`apps/desktop/electron.vite.config.ts`:
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { external: ['koffi'] } } },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { pet: resolve(__dirname, 'src/preload/pet.ts') } } },
  },
  renderer: {
    resolve: { alias: { '@framework': resolve(__dirname, '../../vendor/CubismWebFramework/src') } },
    server: { fs: { allow: [resolve(__dirname, '../..')] } },
    build: { rollupOptions: { input: { pet: resolve(__dirname, 'src/renderer/pet.html') } } },
  },
});
```

- [ ] **Step 5: Preload**

`apps/desktop/src/preload/pet.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { MAIN_TO_RENDERER, RENDERER_TO_MAIN, type Channel } from '@ds/protocol';

const toMain = new Set<string>(RENDERER_TO_MAIN);
const toRenderer = new Set<string>(MAIN_TO_RENDERER);

contextBridge.exposeInMainWorld('ds', {
  send(channel: Channel, payload: unknown) {
    if (!toMain.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    ipcRenderer.send(channel, payload);
  },
  on(channel: Channel, cb: (payload: unknown) => void) {
    if (!toRenderer.has(channel)) throw new Error(`channel not allowed: ${channel}`);
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
```

- [ ] **Step 6: Main-process modules**

`apps/desktop/src/main/ipc.ts`:
```ts
import { BrowserWindow, ipcMain } from 'electron';
import { parseEvent, type Channel, type Payload } from '@ds/protocol';

export function sendToPet<C extends Channel>(win: BrowserWindow, channel: C, payload: Payload<C>): void {
  if (win.isDestroyed()) return;
  const r = parseEvent(channel, payload);
  if (!r.ok) throw new Error(`refusing to send invalid ${channel}: ${r.error}`);
  win.webContents.send(channel, r.data);
}

export function onFromPet<C extends Channel>(channel: C, cb: (payload: Payload<C>, win: BrowserWindow) => void): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    const r = parseEvent(channel, raw);
    if (!r.ok) { console.warn(`[ipc] rejected ${channel}: ${r.error}`); return; }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) cb(r.data, win);
  });
}
```

`apps/desktop/src/main/pet-window.ts`:
```ts
import { BrowserWindow, screen, app } from 'electron';
import { join } from 'node:path';
import { clampToDisplays, loadWindowState, saveWindowState } from './window-state';

export const PET_SIZE = { w: 420, h: 720 };
const stateFile = () => join(app.getPath('userData'), 'window.json');

export function createPetWindow(): BrowserWindow {
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const saved = loadWindowState(stateFile());
  const pos = clampToDisplays(saved ? { ...saved, ...PET_SIZE } : null, displays, PET_SIZE);

  const win = new BrowserWindow({
    x: pos.x, y: pos.y, width: PET_SIZE.w, height: PET_SIZE.h,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    hasShadow: false, resizable: false, show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/pet.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  setClickThrough(win, true);

  const query = process.env.DS_DEBUG === '1' ? '?debug=1' : '';
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet.html${query}`);
  else win.loadFile(join(__dirname, '../renderer/pet.html'), { search: query.slice(1) });

  win.once('ready-to-show', () => win.show());
  win.on('moved', () => { const [x, y] = win.getPosition(); saveWindowState(stateFile(), { x, y }); });
  return win;
}

export function setClickThrough(win: BrowserWindow, ignore: boolean): void {
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

export function moveBy(win: BrowserWindow, dx: number, dy: number): void {
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy), false);
}
```

`apps/desktop/src/main/cursor.ts`:
```ts
import { BrowserWindow, screen } from 'electron';
import { Channels } from '@ds/protocol';
import { sendToPet } from './ipc';

/** Polls the global cursor and sends it in window-local CSS pixels (can be far outside the window). */
export function startCursorPolling(win: BrowserWindow, hz = 30): () => void {
  let last = { x: NaN, y: NaN };
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) return;
    last = p;
    const [wx, wy] = win.getPosition();
    sendToPet(win, Channels.gazeCursor, { x: p.x - wx, y: p.y - wy });
  }, Math.round(1000 / hz));
  return () => clearInterval(timer);
}
```

`apps/desktop/src/main/tray.ts`:
```ts
import { Menu, Tray, nativeImage, app } from 'electron';
import { join } from 'node:path';

export function createTray(actions: { toggleVisible(): void; toggleDebug(): void; quit(): void }): Tray {
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'tray.png') : join(__dirname, '../../resources/tray.png');
  const tray = new Tray(nativeImage.createFromPath(iconPath), 'ds-pet-tray-6f1c2a');
  tray.setToolTip('ds');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示/隐藏', click: actions.toggleVisible },
    { label: '调试面板', click: actions.toggleDebug },
    { type: 'separator' },
    { label: '退出', click: actions.quit },
  ]));
  return tray;
}
```

`apps/desktop/src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import { Channels } from '@ds/protocol';
import { createPetWindow, moveBy, setClickThrough } from './pet-window';
import { onFromPet, sendToPet } from './ipc';
import { startCursorPolling } from './cursor';
import { createTray } from './tray';

if (!app.requestSingleInstanceLock()) app.quit();

let pet: BrowserWindow | null = null;
let stopCursor: (() => void) | null = null;
let userHidden = false;

function showPet(visible: boolean): void {
  if (!pet) return;
  if (visible) pet.showInactive(); else pet.hide();
  sendToPet(pet, Channels.shellVisibility, { hidden: !visible, reason: visible ? 'none' : 'user' });
}

app.whenReady().then(() => {
  pet = createPetWindow();
  stopCursor = startCursorPolling(pet);

  onFromPet(Channels.avatarHover, ({ inside }, win) => setClickThrough(win, !inside));
  onFromPet(Channels.avatarDrag, ({ dx, dy }, win) => moveBy(win, dx, dy));
  onFromPet(Channels.avatarDragEnd, () => { /* position persisted by 'moved' handler */ });
  onFromPet(Channels.avatarTap, ({ hitArea }) => console.log('[pet] tap', hitArea));
  onFromPet(Channels.stageReady, (info) => console.log('[pet] stage ready', info));
  onFromPet(Channels.stageError, ({ message }) => console.error('[pet] stage error', message));

  createTray({
    toggleVisible: () => { userHidden = !userHidden; showPet(!userHidden); },
    toggleDebug: () => pet?.webContents.send(Channels.debugExpression, { name: null }), // placeholder action until Task 8 wires the panel toggle
    quit: () => app.quit(),
  });
});

app.on('second-instance', () => showPet(true));
app.on('window-all-closed', () => { /* keep running in tray */ });
app.on('before-quit', () => { stopCursor?.(); });
```
Replace the `toggleDebug` line with a real toggle now — do not leave the word "placeholder" in the code: add channel `debug:toggle` to `@ds/protocol` (`Schemas['debug:toggle'] = z.object({})`, in `MAIN_TO_RENDERER`), have the renderer toggle `#debug.show` on it, and call `sendToPet(pet, Channels.debugToggle, {})` here.

- [ ] **Step 7: Run it**

```powershell
pnpm --filter @ds/desktop typecheck
$env:DS_DEBUG='1'; pnpm dev
```
Expected: a transparent window with Haru bottom-right, always on top, no taskbar entry; moving the mouse anywhere on screen moves her gaze; clicks pass through to windows behind her except when the cursor is over her body; left-drag on her moves the window; tray menu shows/hides/quits; position persists across restarts (`%APPDATA%\ds\window.json` — the `userData` dir is named after `package.json` `name`, so if it is `@ds/desktop` set `app.setName('ds')` before `whenReady`).

Take screenshots with `Win+Shift+S` (or `powershell -c "Add-Type -A System.Windows.Forms; ..."`) and save as `docs/evidence/phase1/desktop-idle.png` (pet over desktop, cursor away), `desktop-hover.png` (cursor over her, click-through off — show a window behind her not receiving the click), `desktop-debug.png` (debug panel open with an expression selected).

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "feat(desktop): Electron pet window — transparent always-on-top, hover click-through, drag, cursor gaze, tray"
```

---

### Task 8: Fullscreen/lock hiding, FPS policy, first-run smoke script

**Files:**
- Create: `apps/desktop/src/main/foreground.ts`, `apps/desktop/src/main/foreground.test.ts`
- Modify: `apps/desktop/src/main/index.ts` (wire hiding + powerMonitor)
- Create: `docs/evidence/phase1/desktop-fullscreen-hidden.png`

**Interfaces:**
- Consumes: `sendToPet`, `Channels.shellVisibility`.
- Produces: `shouldHideForForeground(fg: Rect | null, display: Rect, selfHwnd: bigint, fgHwnd: bigint, shellHwnds: bigint[]): boolean` (pure) and `startForegroundWatch(win, onChange: (hide: boolean) => void, intervalMs = 2000): () => void`.

- [ ] **Step 1: Failing test**

`apps/desktop/src/main/foreground.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { shouldHideForForeground } from './foreground';

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('shouldHideForForeground', () => {
  it('hides when a foreign window exactly covers the display', () => {
    expect(shouldHideForForeground(display, display, 1n, 2n, [])).toBe(true);
  });
  it('does not hide for our own window', () => {
    expect(shouldHideForForeground(display, display, 2n, 2n, [])).toBe(false);
  });
  it('does not hide for the shell/desktop window', () => {
    expect(shouldHideForForeground(display, display, 1n, 3n, [3n])).toBe(false);
  });
  it('does not hide for a maximized window (has borders / taskbar)', () => {
    expect(shouldHideForForeground({ x: -8, y: -8, width: 1936, height: 1048 }, display, 1n, 2n, [])).toBe(false);
  });
  it('does not hide when nothing is foreground', () => {
    expect(shouldHideForForeground(null, display, 1n, 0n, [])).toBe(false);
  });
});
```
`pnpm test` → FAIL.

- [ ] **Step 2: Implement `foreground.ts`**

```ts
import { BrowserWindow, screen } from 'electron';

export type Rect = { x: number; y: number; width: number; height: number };

export function shouldHideForForeground(fg: Rect | null, display: Rect, selfHwnd: bigint, fgHwnd: bigint, shellHwnds: bigint[]): boolean {
  if (!fg || fgHwnd === 0n) return false;
  if (fgHwnd === selfHwnd || shellHwnds.includes(fgHwnd)) return false;
  const covers = Math.abs(fg.x - display.x) <= 1 && Math.abs(fg.y - display.y) <= 1
    && Math.abs(fg.width - display.width) <= 2 && Math.abs(fg.height - display.height) <= 2;
  return covers;
}

type Win32 = {
  GetForegroundWindow(): bigint; GetShellWindow(): bigint; GetDesktopWindow(): bigint;
  GetWindowRect(hwnd: bigint, out: { left: number; top: number; right: number; bottom: number }): boolean;
};

let win32: Win32 | null | undefined;
function loadWin32(): Win32 | null {
  if (win32 !== undefined) return win32;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const user32 = koffi.load('user32.dll');
    const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    win32 = {
      GetForegroundWindow: user32.func('uintptr_t __stdcall GetForegroundWindow()'),
      GetShellWindow: user32.func('uintptr_t __stdcall GetShellWindow()'),
      GetDesktopWindow: user32.func('uintptr_t __stdcall GetDesktopWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ RECT* rect)'),
    } as unknown as Win32;
    void RECT;
  } catch (err) {
    console.warn('[foreground] koffi unavailable, fullscreen hiding disabled:', err);
    win32 = null;
  }
  return win32;
}

export function startForegroundWatch(win: BrowserWindow, onChange: (hide: boolean) => void, intervalMs = 2000): () => void {
  const api = loadWin32();
  if (!api) return () => {};
  const selfHwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  let lastHide = false;
  const timer = setInterval(() => {
    if (win.isDestroyed()) return;
    const fgHwnd = BigInt(api.GetForegroundWindow());
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const ok = fgHwnd !== 0n && api.GetWindowRect(fgHwnd, rect);
    const fg: Rect | null = ok ? { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top } : null;
    const display = fg ? screen.getDisplayMatching(fg).bounds : screen.getPrimaryDisplay().bounds;
    const hide = shouldHideForForeground(fg, display, selfHwnd, fgHwnd, [BigInt(api.GetShellWindow()), BigInt(api.GetDesktopWindow())]);
    if (hide !== lastHide) { lastHide = hide; onChange(hide); }
  }, intervalMs);
  return () => clearInterval(timer);
}
```
If koffi's `uintptr_t` return arrives as a `number` rather than `bigint`, `BigInt(x)` above normalises it. If `_Out_ RECT*` needs a different marshalling in the installed koffi version, consult `node_modules/koffi/README.md` ("Output parameters") and adjust — the pure function and its tests stay unchanged.

- [ ] **Step 3: Wire into `index.ts`**

Add after `stopCursor = startCursorPolling(pet);`:
```ts
import { powerMonitor } from 'electron';
import { startForegroundWatch } from './foreground';
// …
let fullscreenHidden = false;
let systemHidden = false;
const applyVisibility = (reason: 'fullscreen' | 'locked' | 'suspended' | 'none') => {
  if (!pet) return;
  const hidden = userHidden || fullscreenHidden || systemHidden;
  if (hidden) pet.hide(); else pet.showInactive();
  sendToPet(pet, Channels.shellVisibility, { hidden, reason: hidden ? reason : 'none' });
};
const stopForeground = startForegroundWatch(pet, (hide) => { fullscreenHidden = hide; applyVisibility('fullscreen'); });
powerMonitor.on('lock-screen', () => { systemHidden = true; applyVisibility('locked'); });
powerMonitor.on('suspend', () => { systemHidden = true; applyVisibility('suspended'); });
powerMonitor.on('unlock-screen', () => { systemHidden = false; applyVisibility('none'); });
powerMonitor.on('resume', () => { systemHidden = false; applyVisibility('none'); });
```
and replace the tray `toggleVisible` body with `userHidden = !userHidden; applyVisibility('none');`; call `stopForeground()` in `before-quit`.

- [ ] **Step 4: Verify**

```powershell
pnpm test
pnpm --filter @ds/desktop typecheck
$env:DS_DEBUG='1'; pnpm dev
```
Manual checks, each with evidence:
1. Open a YouTube video in Edge and press F11 → within 2 s Haru disappears; leave fullscreen → she returns. Screenshot the fullscreen state as `docs/evidence/phase1/desktop-fullscreen-hidden.png` (she must be absent).
2. `Win+L`, unlock → she returns; the renderer resumed (gaze follows cursor again).
3. In Task Manager, GPU/CPU of the `ds` process drops when the cursor is away (30 FPS) vs hovering (60 FPS).

- [ ] **Step 5: Commit + tag the phase**

```powershell
git add -A
git commit -m "feat(desktop): hide behind fullscreen apps and on lock/suspend; fps policy"
git tag phase1-stage
```

---

## Self-review against the spec

- §1 decisions: Electron 43.4.1 pinned (T6), Cubism 5-r.5 hand-wrapped (T4/T5), Core from zip (T2), models gitignored (T1/T2), Haru+Hiyori (T2), no React in Phase 1 (spec §7 names React for the input/settings UIs, which are Phase 2/4).
- §2 architecture: pet window + preload + typed IPC (T7), protocol zod validation + unknown-channel rejection (T1, T7 `ipc.ts`), input/settings windows are Phase 2/4 — not in this plan.
- §4.1 frame order: `CompanionModel.tick` (T4) mirrors LAppModel 5-r.5; moc version guard (T4). §4.2 bundle: `character.json` schema (T3) — `lipSyncParams` dropped from the spec's example because the ids come from model3.json `Groups` (spec updated). §4.3 gaze: cursor poll 30 Hz (T7) + `CubismLook` (T4); easing is done by `CubismTargetPoint` inside the Framework. §4.4 interaction: hover hit-test/debounce (T6/T7), tap motions (T6), drag (T6/T7), context-menu/right-click and global hotkeys are listed in spec §4.4/§7 as Phase 4 polish and are **not** in this plan. §4.5 mouth: `TextMouthDriver` behind `MouthDriver`, `CubismLipSyncUpdater` (T3/T4). §4.6 performance: 30/60 FPS (T5/T6), fullscreen + lock hiding (T8), `backgroundThrottling:false` (T7).
- §7 shell: window flags (T7), tray with stable guid (T7), single-instance (T7), position persistence (T7). Autostart/hotkeys/settings — Phase 4.
- §8 errors: moc-newer-than-Core dialog is surfaced as `stage:error` → console + on-page message (T6/T7); a native dialog comes with the settings window in Phase 4.
- §9 testing: vitest for pure parts (T1–T8), Playwright browser-mode smoke (T6), desktop screenshots (T7, T8). §11 licensing: NOTICE + README credit (T1), gitignores (T1).
- Placeholder scan: the one "placeholder" word in T7's code is explicitly replaced in the same step. No TBD/TODO remain.
- Type consistency: `Payload<C>`, `Channels.*`, `parseEvent`, `RENDERER_TO_MAIN`/`MAIN_TO_RENDERER` (T1) used in T6/T7; `Live2DStage.create/hitTestClient/gazeClient/setEmotion/playMotion/setFps` (T5) used in T6; `CompanionModel.setExpression/startMotion/hitAny/setGaze/tick/draw/expressionNames/motionGroups/hitAreaNames` (T4) used in T5/T6; `HoverTracker.sample` (T6); `clampToDisplays(pos|null, displays, size?)` (T7) matches its test; `shouldHideForForeground(fg, display, selfHwnd, fgHwnd, shellHwnds)` (T8) matches its test.
