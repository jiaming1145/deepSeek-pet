# DS — DeepSeek-driven Live2D desktop companion: v1 design

Date: 2026-08-28 · Status: awaiting approval · Scope: v1, text-only, Windows desktop pet

Research basis: `docs/research/2026-08-28-landscape-research.md` (6 researchers + critic + fact-check, all claims URL-backed, dated 2026-08-28).

## 1. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Platform | Windows desktop pet (Electron **43.4.1**, pinned) | Only shell with click-through **plus hover** (`setIgnoreMouseEvents(true,{forward:true})`); AIRI reverted Tauri→Electron for this. 44.0.0 is 4 days old — pin 43. |
| Voice | None in v1 (text in, text + animation out) | User choice. Voice is a later spec; seams left (see §4.5, §10). |
| Use | Personal / hobby, possibly open-source | Bring-your-own DeepSeek key, no proxy, no compliance work. Curated models only. |
| Language | Chinese-first | Persona, prompts, UI strings in zh-CN; DeepSeek is strongest here. |
| Runtime | Pure TypeScript, single Electron app | Text-only v1 has no reason for a Python sidecar. |
| LLM | `deepseek-v4-flash`, thinking **disabled** per request | V4-only lineup; thinking is on by default and would add latency and cost. |
| Live2D renderer | Hand-wrapped official **CubismWebFramework 5-r.5** (LAppModel-style port, no PixiJS) | `pixi-live2d-display` is dead (2024); Pixi-8 forks are 5-r.4 or unpublished beta. |
| Storage | `node:sqlite` (Node 24.18.1 in Electron 43), FTS5 **trigram** | Verified running in Electron 43.4.1 main process; no native rebuild. |
| Models | Live2D free samples **Haru** (primary) + **Hiyori**; no user uploads | Original Characters, commercial-safe with credit line. Natori is collaboration/non-commercial → excluded. User uploads would make this an "Expandable Application" under Live2D's license → out of scope. |

## 2. Architecture

Three windows in one Electron app; the brain lives in the main process.

```
┌─ Electron main (Node 24) ─────────────────────────────────────────┐
│ brain/    prompt assembly → DeepSeek stream → ACT/sentence parser  │
│ sim/      mood/affection/energy ticks · idle timer · quiet hours   │
│ store/    SQLite: messages, summary, core memory, episodes, stats  │
│ shell/    pet window · input window · settings · tray · hotkeys ·  │
│           autostart · safeStorage key · cursor poll · fullscreen   │
└────────────── typed IPC (preload, contextIsolation on) ───────────┘
┌─ Renderer A: pet window (transparent, always-on-top, focusable:false)
│ stage/   Cubism 5 wrapper: model, expressions, motions, gaze, mouth
│ overlay/ speech bubble + subtitle (DOM, pointer-events:none)
┌─ Renderer B: input window (small, focusable, IME-safe; hotkey/click)
┌─ Renderer C: settings window (normal window; key, persona, options)
```

**Why a separate input window:** the pet window is `focusable:false` so it never steals focus from the user's work. An unfocusable window cannot host Chinese IME input, so text entry lives in its own tiny focusable window that appears next to the pet on click or `Ctrl+Shift+Space`.

### 2.1 Packages (pnpm workspace, single `main` branch)

```
D:\ds
  apps/desktop            electron-vite: src/main, src/preload, src/renderer/{pet,input,settings}
  packages/protocol       IPC + event types shared by everything (zod schemas)
  packages/brain          prompt assembler, DeepSeek client, streaming parser, state machine — pure TS
  packages/sim            stats model + scheduler — pure TS, injectable clock
  packages/memory         SQLite store, summarizer, core-memory consolidation, episode retrieval
  packages/stage          Cubism wrapper, MouthDriver, GazeDriver — browser only
  characters/haru, hiyori character.json (committed) + model/ (GITIGNORED — Free Material License forbids redistributing the raw files; fetched by scripts/fetch-sdk.mjs)
  vendor/CubismWebFramework   git submodule @ 5-r.5
  vendor/core/            live2dcubismcore.min.js + .d.ts — GITIGNORED, extracted from the SDK zip by scripts/fetch-sdk.mjs (the public CDN file is Core 5 and lacks the `offscreens` struct that Framework 5-r.5 requires; Core 6 ships only in the zip)
  docs/research, docs/superpowers/specs
```

`brain`, `sim`, `memory`, `protocol` have zero Electron imports so they unit-test under vitest in plain Node.

### 2.2 Event vocabulary (`packages/protocol`)

main → pet renderer: `brain:state {state: idle|thinking|speaking, turnId}` · `brain:sentence {turnId, seq, text, emotion, motion?, pause?}` · `sim:stats {mood, affection, energy}` · `gaze:cursor {x, y}` (window-local) · `avatar:reaction {motionGroup, index, line?}` (canned tap reactions) · `shell:visibility {hidden, reason}`

pet renderer → main: `avatar:hover {inside: boolean}` · `avatar:tap {hitArea}` · `avatar:drag {dx, dy}` · `playback:sentenceDone {turnId, seq}` · `playback:turnDone {turnId}`

input renderer → main: `user:text {text}` · `user:cancel`

settings renderer ↔ main: `settings:get/set`, `key:set`, `key:test`, `metrics:get`

All payloads validated with zod at the IPC boundary; unknown events are rejected and logged.

## 3. Character brain (`packages/brain`)

### 3.1 DeepSeek client
- OpenAI SDK, `baseURL: https://api.deepseek.com`, model `deepseek-v4-flash`.
- Every request: `stream: true`, `stream_options: {include_usage: true}`, `thinking: {type: 'disabled'}`, `temperature: 0.9`, `top_p: 0.95`, `max_tokens: 300`, `stop: ['\n用户：', '\n用户:', '\nUser:']`.
- Handles `: keep-alive` SSE comments, 429/5xx with jittered retry (3 attempts, 1s/2s/4s), and `AbortController` cancellation on interruption.
- Records per turn: TTFT, total ms, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, completion tokens → `metrics.jsonl`.

### 3.2 Prompt layout (built for DeepSeek's 64-token exact-prefix cache)
```
[system]  STATIC persona block — byte-identical across turns and sessions:
          hard rules → identity/personality → speaking style (zh-CN, short replies,
          no markdown) → control-token grammar + the 9 emotions → 2 few-shot examples
[user/assistant pair #1]  "长期记忆" — running summary + core memory snapshot
                          (rewritten ONLY at trim/consolidation events)
[history]  append-only, never reformatted
[user]     "【状态】本地时间 周三 21:14｜心情 平静偏好｜好感 62/100｜精力 40/100｜
            距离上次聊天 3小时｜相关记忆：…（≤5条）】\n\n<user text>"
```
Rule: dynamic state goes **only** in the latest user message. The assembler has a test asserting the system + pair #1 bytes are identical between consecutive turns when no trim occurred.

History trimming: when history exceeds 24K tokens, drop the oldest 8K and fold them into the running summary (one non-streaming `deepseek-v4-flash` call). Expect a cache miss only then.

### 3.3 Persona
Character Card V3 JSON in `characters/<id>/character.json` → `card: {name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions}`. Rendered in fixed order into the static block. Target ≤ 800 tokens. Written in Chinese.

### 3.4 Control-token grammar (ours, minimal)
```
<|ACT emotion=happy motion=nod|>你回来啦！<|ACT emotion=curious|>今天做了什么？<|PAUSE 1|>
```
- Reply MUST start with an `<|ACT …|>`; an ACT persists until the next one.
- `emotion` ∈ `happy sad angry think surprised awkward question curious neutral` (AIRI's 9).
- `motion` optional, from the character's `motionMap` keys (e.g. `nod shake wave shrug`).
- `<|PAUSE n|>` = n-second beat before the next sentence.
- Unknown emotion → `neutral`; unknown motion → dropped; missing leading ACT → `neutral` (logged as a compliance miss in metrics; a compliance rate < 90% triggers prompt tuning, not code).

### 3.5 Streaming parser
Token stream → tag-stack scanner (handles `<|` split across chunks) → sentence splitter on `。！？!?…` plus `\n`; first sentence of a turn may also split on `，,` after ≥ 6 chars (fast first reaction). Emits `brain:sentence` with the current ACT the moment a sentence closes. Tags never reach the display.

### 3.6 Conversation state machine
`idle → thinking → speaking → idle`, with `interrupted` as a transition, not a state.
- `thinking` is emitted the instant the request is sent (avatar plays the think motion; bubble shows "…").
- `speaking`: sentences are paced in the renderer at ~4 CJK chars/s (+ PAUSE), each `playback:sentenceDone` releases the next; `playback:turnDone` → `idle`.
- New `user:text` while `speaking`: cancel pacing, write only the displayed-so-far text to history as the assistant turn, then start the new turn (truthful history).
- New `user:text` while `thinking`: abort the request, discard, start a new turn with the concatenated user text.
- Proactive turn firing while the input window is open or the user typed within 60 s → skipped.

## 4. Avatar stage (`packages/stage`)

### 4.1 Cubism wrapper
Port of `CubismWebSamples` `LAppModel`/`LAppDelegate` trimmed to one model: loads `model3.json` (+ moc3, textures, physics, pose, expressions, motions), WebGL2 canvas, R5 `CubismUpdateScheduler` frame order:
`loadParameters → idle motion (PriorityIdle loop) → saveParameters → GazeDriver writes (ParamAngleX/Y/Z, ParamEyeBallX/Y, ParamBodyAngleX) → MouthDriver writes (LipSync group ids) → blink → breath → expression → physics → pose → model.update()`.

Validates `moc3` version at load (`getMocVersionFromBuffer`) and surfaces a clear error if newer than the bundled Core.

### 4.2 Character bundle (`character.json`)
```json
{
  "card": { "...Character Card V3 fields..." },
  "model": "Haru.model3.json",
  "emotionMap": { "happy": "F01", "sad": "F03", "angry": "F04", "think": "F02",
                  "surprised": "F05", "awkward": "F06", "question": "F07",
                  "curious": "F08", "neutral": null },
  "motionMap": { "nod": ["TapBody", 0], "shake": ["TapBody", 1], "wave": ["TapBody", 2] },
  "idleGroup": "Idle",
  "thinkMotion": ["TapBody", 3],
  "tapMotions": { "Head": { "TapBody": [0, 1] }, "Body": { "TapBody": [2] } },
  "cannedLines": { "tap": ["干嘛戳我～", "嗯？"], "offline": ["网络不太好呢…"] },
  "scale": 0.22, "anchor": [0.5, 1.0]
}
```
Verified from the 5-r.5 SDK: Haru has expressions `F01`–`F08`, motion groups `Idle` (2) and `TapBody` (4, each with a `.wav` we do not play), hit areas `Head` and `Body`, LipSync group `ParamMouthOpenY`. Hiyori has **no expressions**, `Idle` (9), `TapBody` (1), hit area `Body` only — its emotions map to motions (`emotionMap` values may be `["group", i]`). Which of Haru's F01–F08 means which emotion is decided by looking at them in Phase 1's debug panel. LipSync/EyeBlink parameter ids are read from the model3.json `Groups`, not from `character.json`.

### 4.3 Gaze
Main polls `screen.getCursorScreenPoint()` at 30 Hz, converts to pet-window coordinates, sends `gaze:cursor`. `GazeDriver` eases toward the target (critically damped, ~250 ms) and drifts back to center after 3 s idle. Random blink 2–6 s, breath from the Framework.

### 4.4 Interaction and click-through
- Window starts `setIgnoreMouseEvents(true, {forward: true})`. Forwarded `mousemove` → Live2D hit-test against the model's hit areas/bounds → `avatar:hover {inside}` → main toggles `setIgnoreMouseEvents(false)` inside / `(true,{forward:true})` outside, debounced 50 ms.
- Left-click on a hit area → `avatar:tap` → sim picks a weighted `tapMotions` entry + optional canned line (no API call). Left-drag → move window; position persisted. Right-click → context menu (chat, settings, hide 1h, quit).
- Global hotkeys: `Ctrl+Shift+Space` toggle input window; `Ctrl+Shift+P` force click-through on/off.
- Known Electron forward-mode hover bugs (#30808, #48035): hover is driven purely by our hit-test on forwarded `mousemove`, never CSS `:hover`.

### 4.5 Mouth (v1, no audio)
`MouthDriver` interface: `start(sentence)`, `stop()`, `value(dt): number`. v1 implementation `TextMouthDriver`: while a sentence is being paced, `ParamMouthOpenY` = clamp(0..1) of a smoothed noise envelope (4–7 Hz opening rhythm, amplitude 0.6–0.9); 0 when idle. Phase-2 voice replaces it with `AudioMouthDriver` (AnalyserNode RMS) — no stage changes.

### 4.6 Performance
Ticker 30 FPS when `idle` and not hovered, 60 FPS while `speaking`/hovered. `backgroundThrottling: false` on the pet window. Hidden entirely (window hidden, ticker stopped) when a fullscreen app owns the foreground (poll foreground window bounds vs. display bounds every 2 s) or the session is locked/asleep (`powerMonitor`).

## 5. Pet simulation and proactivity (`packages/sim`)
The sim owns all numbers; the LLM only narrates them.

- `mood ∈ [-1, 1]`: nudged by emotion tags (happy +0.05, sad −0.05, …), decays toward the persona baseline with a 2 h half-life.
- `affection ∈ [0, 100]`: +1 per exchange (cap +10/day), +0.5 per tap (cap +3/day), −1/day after 3 days without contact.
- `energy ∈ [0, 100]`: time-of-day curve (low 23:00–07:00), −0.5 per exchange, regenerates when idle.
- Ticks every 60 s from an injectable clock; persisted in SQLite; **paused while the app is closed** (no punishment for absence — Tamagotchi's rule, applied kindly).
- Stats are rendered into the state preamble as short Chinese phrases (`心情 平静偏好`), never raw numbers, so the character stays in voice.

Proactive speech: idle timer (default 20 min, range 5–120, off) fires a proactive turn with prompt "主动搭话，一句话以内，参考状态和记忆" and `skipMemoryWrite`; suppressed during quiet hours (default 23:00–08:00), when hidden, when locked, and within 60 s of user typing. Time, weekday, and time-since-last-chat are always in the preamble.

## 6. Memory (`packages/memory`, one SQLite file at `%APPDATA%/ds/ds.sqlite`)

| Tier | What | When written | How read |
|---|---|---|---|
| Window | `messages` table, last N turns within 24K tokens | every turn | verbatim history |
| Summary | `summary` (one row) | trim events only | pair #1 |
| Core memory | `core_memory {persona, human, relationship}` — three short Chinese paragraphs | consolidation pass: once per day at first idle after 03:00 or on quit if >20 new turns; single non-streaming `deepseek-v4-flash` call that rewrites all three | pair #1 |
| Episodes | `episodes(ts, text, importance 1–10)` + FTS5 `tokenize='trigram'` | after each turn, the consolidation pass extracts 0–3 episodes with importance | top-5 by `bm25 × importance × 0.995^hours`, injected into the preamble |

No embeddings in v1 (DeepSeek offers none; Chinese-capable vector search is phase 2 behind the `MemoryIndex` interface). Schema versioned with a `meta.schema_version` row and forward migrations. Settings → "导出/清空记忆" exports JSON and wipes.

## 7. Shell (`apps/desktop/src/main/shell`)
- Pet window: `frame:false, transparent:true, alwaysOnTop:true` at level `'screen-saver'`, `skipTaskbar:true, focusable:false, hasShadow:false, resizable:false`; sized to the model's bounds + margin (not full-screen — keeps the WebGL surface small); per-monitor DPI aware; position clamped to the nearest display on startup.
- Input window: `frame:false, alwaysOnTop:true, focusable:true`, 360×48 → grows with multiline; ESC closes; Enter sends; Shift+Enter newline.
- Settings window: normal window; tabs 通用 (autostart, quiet hours, idle timer, hotkeys, scale) / 角色 (choose Haru/Hiyori, view card) / API (DeepSeek key via `safeStorage`, "测试连接", base URL override for OpenAI-compatible fallbacks such as Ollama) / 记忆 (export, clear) / 关于 (Live2D credit line, licenses).
- Tray with stable `guid`; single-instance lock; `setLoginItemSettings` autostart; app menu absent.
- First run: settings window opens on the API tab; pet appears in the bottom-right with `first_mes`.

## 8. Error handling
| Condition | Behaviour |
|---|---|
| 429 / 5xx / network | 3 jittered retries; then `awkward` + canned offline line; turn not written to history; input restored to the box |
| 401 / no key | bubble "还没有设置 API Key" + opens settings API tab |
| Malformed/missing ACT | neutral, logged |
| Empty completion | one retry; then canned line |
| SQLite open failure | blocking dialog with path + error; app quits (never run without persistence) |
| moc3 newer than Core | dialog naming the model and Core version |
| Cache-hit ratio < 50% over 20 turns | warning in metrics tab (prompt-prefix drift detector) |

## 9. Testing and evidence
- **vitest**, plain Node: streaming parser (golden streams incl. tags split mid-chunk, CJK punctuation, PAUSE), prompt assembler (byte-identical prefix assertion, trim behaviour), state machine (interruption cases in §3.6), sim ticks (fake clock: decay, caps, quiet hours), memory retrieval ranking and migrations.
- **Playwright** against the pet renderer served by Vite in plain-browser mode with a fixed seed: model loads, `expression('f01')` changes pixels, tap emits hit-area, frame time under budget.
- **Integration** (gated on `DEEPSEEK_API_KEY`): one real streamed turn asserts ACT compliance and `prompt_cache_hit_tokens > 0` on the second call.
- **Evidence bar** (per Jiaming's standing orders): screenshots of the actual pet on the Windows desktop — idle, hovering (click-through off), mid-reply with bubble, and over a fullscreen app (hidden) — before any phase is called done. Committed to `main`.

## 10. Phases (each ends with a commit + screenshot evidence)
1. **Stage** — workspace scaffold, Core fetch script, Cubism wrapper renders Haru in a transparent always-on-top window; expressions/motions via a debug panel; hover click-through; gaze; drag; tray quit.
2. **Brain** — input window, DeepSeek streaming with ACT parser, bubble pacing, state machine, thinking motion, key storage, metrics.
3. **Sim + memory + proactive** — stats, idle chatter, quiet hours, fullscreen/lock hiding, SQLite tiers, consolidation pass, settings tabs.
4. **Polish + package** — hotkeys, autostart, first-run flow, Hiyori bundle, NSIS installer via electron-builder (unsigned for hobby use), README with Live2D credit and license NOTICE.

Out of scope for v1 (separate specs later): voice (STT/TTS/lip-sync, `AudioMouthDriver`), vector memory, screen awareness/vision, user-uploaded models, web build, code signing, any compliance features.

## 11. Licensing notes
- Cubism Core: proprietary. `scripts/fetch-sdk.mjs` downloads `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip` (verified live 2026-08-28, 20.7 MB, contains Core 06.00) and extracts `Core/live2dcubismcore.min.js` + `.d.ts` into `vendor/core/` (gitignored) and excluded from the repo license via `NOTICE`. Shipping it inside the packaged app is permitted (Proprietary Software License §5.1). The public CDN copy is Core 5 and is incompatible with Framework 5-r.5 — do not use it.
- CubismWebFramework: Live2D Open Software License (submodule, unmodified).
- Sample models: Live2D Free Material License; the raw model files may not be redistributed, so the same script extracts `Samples/Resources/Haru` and `Hiyori` into `characters/<id>/model/` (gitignored). Required credit line in Settings → 关于 and README: *"This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author's sole discretion."* Hiyori's design must not be altered.
- DeepSeek ToS requires disclosing to end users that output is AI-generated → shown on first run and in 关于.
- Our code: MIT.
