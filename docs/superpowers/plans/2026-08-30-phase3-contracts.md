# Phase 3 interface contract (`contracts.md`)

Single source of truth for every name, signature, value, channel, schema, table, file path and test
fixture the Phase 3 tasks share. **Authors copy from this file. Nothing here is a suggestion;
nothing missing from here may be invented — if a name or a value is genuinely absent, stop and ask
the controller.**

Status: **verified against `main` @ `f3185a3`** (2026-08-30), which carries the Phase 2 fix wave,
its RESIDUAL-1 merge `81ffd6b` and its RESIDUAL-2 merge `17d3fb9`. Every Phase 2 interface §0.6 was
drafted against is now **VERIFIED on `main`** — six directly, one (FW-3b) corrected to a verified
negative — and **every RESIDUAL-2 item is merged**, so no section carries a
"re-verify after merge" marker any more. §0.6 is the table; §3.11 carries the one real follow-on
(`DRAIN_TIMEOUT_MS`).

---

## Amendments (controller rulings after the plan was generated — these override the sections below)

Every entry cites the ruling that produced it (`rulings.md` v2.3, R3-35..R3-43, 2026-08-30) and is
binding on the section it names. Precedence is unchanged: rulings → this file → the specs; an
Amendment here **is** a ruling, so where an Amendment and a section disagree, the Amendment wins.

- **A3-1 (R3-35, 2026-08-30) — §2.4 `SimSnapshot` gains two UI booleans, so §5.9's work-mode fade and §5.12's mute are reachable end to end.** The plan self-review found the §5.9 fade unbuildable: `HoverAckMachine` (renderer), the 工作模式 / 静音 tray checkboxes (main) and the `ui_work_mode` / `ui_sfx_muted` kv writes (main) all ship, but §2.2/§2.3/§2.5 define **no channel** and `SimSnapshotSchema` carried **no field** that could relay either flag to the pet renderer — and §2 may be edited only once, before batch 2, by the protocol task. `SimSnapshotSchema` therefore gains, in that one edit:
  ```ts
    /** R3-35: the 工作模式 tray checkbox (kv `ui_work_mode`). Arms §5.9's rest>3 s fade. */
    uiWorkMode: z.boolean(),
    /** R3-35: the 静音 tray checkbox (kv `ui_sfx_muted`). Drives §5.12's SfxPlayer.setMuted. */
    uiSfxMuted: z.boolean(),
  ```
  Both default to `false` and are present in **every** `sim:state` broadcast. They are **not** reducer state: §3.1's `SimState` gains no field, `packages/sim`'s snapshot builder emits the two defaults, and `SimService` (§3.11) overlays the live pair through a new `setUiFlags({workMode, sfxMuted})` that `main/index.ts` calls once from kv at startup and once in each tray setter. kv stays the durable home and `index.ts` stays its writer; the snapshot is a broadcast mirror. **No channel is added** — the shared-protocol exception in §1.5 is untouched. Consumers: §5.9's machine reads `uiWorkMode` through its existing `workMode()` getter **at tick time** (a toggle mid-hover takes effect on the next tick, both directions); §5.12's `SfxPlayer.setMuted` is called from the same relay. §1.5 gains two rows: `apps/desktop/src/renderer/pet/stage/ui-flags.ts + .test.ts` — CREATE, T3-B — the tested relay module (`pet/main.ts` runs on import and has no test, so an inline relay would be the one unpinned link in the chain).
- **A3-2 (R3-36, 2026-08-30) — §10.4's cursor-wiggle predicate gets an owner, a field and ratified constants; its five draft constants are superseded.** §10.4 described the D11 predicate "computed from signal 3 alone" but named no module, and neither `ActivityDerived` nor the `TICK` event carried the direction history reversal-counting needs (`TICK` has a scalar `cursorDeltaDip`). The predicate is owned by **`apps/desktop/src/main/activity-sensor.ts` (T3-A)**, and §10.4's block
  ```
  WIGGLE_WINDOW_MS = 1_500 · WIGGLE_MIN_REVERSALS = 3 · WIGGLE_MIN_TRAVEL_DIP = 24
  WIGGLE_MAX_NET_DIP = 40 · WIGGLE_COOLDOWN_MS = 45_000
  ```
  is **replaced** by:
  ```
  WIGGLE_NEAR_DIP        = 240      // radius around the pet window CENTRE
  WIGGLE_FAST_TICK_MS    = 100      // 10 Hz cursor sampling inside that radius (2 Hz outside)
  WIGGLE_RING            = 15       // 15 x 100 ms == one WIGGLE_WINDOW_MS of history
  WIGGLE_MIN_DX_DIP      = 6        // below this an x-delta is not a stroke
  WIGGLE_MIN_REVERSALS   = 4        // sign changes of the x-delta inside the window
  WIGGLE_WINDOW_MS       = 1_500
  WIGGLE_COOLDOWN_MS     = 20_000
  ```
  A *reversal* is a sign change of the **x**-delta where `|dx| >= WIGGLE_MIN_DX_DIP` (one axis, not "either axis": a diagonal shake double-counted). `ActivityDerived` gains `wiggle: boolean`, true for the one sub-tick the predicate fires; `ActivitySensor` gains `onWiggle(cb): () => void` and `ActivitySensorDeps` gains `petCentre?(): {x, y} | null` (supplied by `main/index.ts`; absent ⇒ no radius, no wiggle, 2 Hz). §10.3's *one timer* survives as a **self-rescheduling `setTimeout`** whose period follows the cursor; the full 500 ms sample (signals 1, 4, 6 and the typing predicate) still runs at exactly `SENSOR_TICK_MS` at either rate. `SimService` fans the edge out as `sim:event {kind:'cursorWiggle'}` to the pet **without** a reducer round trip — it changes no sim state — and §5.10's arbiter answers it with the §10.4 curiosity lease (gaze `cursorLock` + `F06` 0.4, 1 200 ms, no motion), unchanged.
- **A3-3 (R3-37, 2026-08-30) — §1.5 gains the renderer consumers, owned by T3-B.** §9.5's chat 普通模式 plate, §9.4/§2.3's bubble `data-mode="plain"` and proactive band styling, §2.3's chat status line for `proactive:gate`, and X5's History badge all name files under `apps/desktop/src/renderer/chat/**` and `apps/desktop/src/renderer/bubble/**` that §1.5 omitted, so every producer shipped with no consumer. §1.5 gains:
  ```
  apps/desktop/src/renderer/chat/App.tsx          + .test.tsx  MODIFY  §2.7, §2.8, §9.5   T3-B
  apps/desktop/src/renderer/chat/Composer.tsx     + .test.tsx  MODIFY  §9.5, §2.3         T3-B
  apps/desktop/src/renderer/chat/History.tsx      + .test.tsx  MODIFY  X5, §2.7           T3-B
  apps/desktop/src/renderer/chat/chat.css         + chat-css.test.ts   MODIFY  §9.5       T3-B
  apps/desktop/src/renderer/bubble/bubble.ts      + .test.ts   MODIFY  §9.4, §2.3         T3-B
  apps/desktop/src/renderer/bubble/bubble.css     + bubble-css.test.ts MODIFY  §9.4, §2.3 T3-B
  apps/desktop/src/renderer/bubble/main.ts                     MODIFY  §2.7, §2.8         T3-B
  ```
  `apps/desktop/src/renderer/bubble/fps.ts` keeps its existing §1.5 row (§5.8, T3-B, the stage task) and is **not** part of this grant. Two things the sections do not state and the consumer task therefore invents, recorded here so they are reviewable: the **copy of the `proactive:gate` status line** (a Chinese line per §3.10.1 reason code, prefixed `主动说话：`, silent while the verdict is `eligible` or `displayed`), and the **proactive band's marker** (the band's left rail takes the advance-mark colour — no badge, no icon, no copy, because R3-19 forbids her name in a Phase 3 string and A14 forbids anything that reads as a demand).
- **A3-4 (R3-39, 2026-08-30) — §1.5 preamble: package barrels are append-only, and `turn.ts` has an owner.** `packages/brain/src/index.ts` and `packages/memory/src/index.ts` are **shared, append-only** files: any task may append **its own** `export * from './<file>.ts';` line at the end and may edit no other line; the integrator resolves a conflict there by **keeping both sides**; a barrel line is never a reason to report `BLOCKED`. (Three tasks append to the brain barrel and two to the memory barrel; without this rule §1.5's one-owner rule would have blocked all but one of them.) `packages/brain/src/turn.ts` is owned by **T3-C** for Phase 3, with one documented exception already in flight — the memory-v2 task's `history.setQuery` call and `metrics.envelope` writer (§8.6, §8.8), which lands in batch 1, before the T3-C work. Any other task needing a change there stops with `BLOCKED: turn.ts is owned by Task 14`.
- **A3-5 (R3-43, 2026-08-30) — §5.13 exception list: the extraction bounds stay two homes.** `FACT_MAX_CHARS = 120` (`packages/memory/src/facts.ts`, §8.2) and `EXTRACT_VALUE_MAX = 120` / `EXTRACT_ALIAS_MAX = 24` (`packages/brain/src/extract-prompt.ts`, §8.5) are the same numbers in two packages, because §1.2 forbids `@ds/brain` importing `@ds/memory`. They **stay two homes**; the identity is pinned from `apps/desktop`, which can see both, by `apps/desktop/src/main/fact-extractor.test.ts`'s `expect(FACT_MAX_CHARS).toBe(EXTRACT_VALUE_MAX)`. Moving them into `@ds/protocol` is **refused**: it would make the memory task depend on the protocol task inside the same batch for no user-visible gain. §5.13's permitted-duplication list is therefore exactly four pairs — `SIM_DEFAULTS`' mirror of the three touch constants, `NEAR_DUPLICATE_JACCARD`/`FACT_MERGE_JACCARD`, the two `proactive_log` constants against `SIM_DEFAULTS`, and this one — each with an identity assertion in the earliest file that can see both sides. `nextLocalMidnight` is **not** on that list: R3-38 moved the T3-C surface task to batch 3 so `main/tray.ts` imports `packages/sim/src/phases.ts`'s (§3.9) instead of declaring a second one.

---

## §0 Precedence, environment, and the baseline-interface list

### 0.1 Precedence (binding order)

1. `.superpowers/sdd/2026-08-30-phase3-behaviour/rulings.md` — **v2 (R3-1 … R3-19), v2.1
   (R3-20 … R3-27, the rulings on this contract's first §14) and v2.2 (R3-28 … R3-34, the rulings on
   `preflight.md` §G)**. All 34 are binding and all 34 are indexed in §0.5; each is reflected verbatim
   in the section that owns it.
2. `docs/superpowers/specs/2026-08-29-exquisite-bar.md` — §0 resolutions, D1–D16, A11, A14, X4, X10,
   X13. **Quoted with thresholds in §0.4** (rulings v2 requires the quotation, not a reference).
3. `docs/superpowers/specs/2026-08-28-live2d-companion-design.md` — §2.2 event vocabulary, §5 sim,
   §6 memory, §7 shell. Overruled where §0.4/§0.5 say so (spec §5's affection decay; spec §6's
   `tokenize='trigram'`).
4. `docs/research/2026-08-30-phase3-architecture-deliberation.md` and
   `docs/research/2026-08-30-phase3-behaviour-research.md` — concrete mechanics and numbers.
5. `docs/superpowers/plans/2026-08-29-phase2-contracts.md` — the Phase 2 contract. Phase 3 **extends**
   it. Where a Phase 2 interface is reused its name and signature are quoted here unchanged; where a
   Phase 2 channel is retired the retirement is explicit (§2.9).
6. `docs/evidence/phase2/deferred.md` + the Phase 2 `final-review.md` "Phase 3 carry list" → §13.

### 0.2 Environment facts verified in this session (do not re-derive)

| Fact | Value | How verified |
|---|---|---|
| Node — the **vitest** lane (`packages/memory`, `packages/sim`, `packages/behaviors`) | **v24.17.0** | `node -v` inside the probe below |
| SQLite in that lane | **3.53.0** | probe below |
| Node — the **Electron 43.4.1 main process**, which is what actually opens `ds.sqlite` in production | **v24.18.1** | `ELECTRON_RUN_AS_NODE=1 electron.exe -p process.versions` (preflight D-43) |
| SQLite in the Electron main process | **3.53.1** | same |
| FTS5 + `unicode61` | **available** | probe below |
| FTS5 `trigram` tokenizer | available **but useless for Chinese** — `MATCH '面试'` returns **0** rows | probe below |
| `fts5vocab` | available | probe below |
| `sqlite-vec` (`vec0`) | **absent** (`no such module: vec0`) | probe below |
| `bm25(f, 1.0, 2.0)` with column weights | works; returns negative scores, `ORDER BY … ASC` = best first | probe below |
| CJK unigram+bigram expansion over `unicode61` | `MATCH '面试'` returns **1** row on the expanded document | probe below |
| Electron 43.4.1 main process can `require('node:sqlite')` | verified in Phase 2 (`contracts.md` §0 row `node:sqlite`); **not re-verified here** — this probe ran under plain Node 24.17.0, the same runtime `packages/memory`'s vitest lane uses | Phase 2 contract |
| `koffi` | already a dependency of `@ds/desktop` (`^2.9.0`), already used by `main/foreground.ts` | `apps/desktop/package.json` |
| Haru registered motion groups | `Idle` = 2, `TapBody` = 4 — **six motions total**, although `characters/haru/model/motions/` holds 27 files | `characters/haru/model/Haru.model3.json` |
| Haru motion `Meta` | `Idle[0]` 10.00 s, `Idle[1]` 5.33 s, `TapBody[0]` 4.97 s, `TapBody[1]` 4.53 s, `TapBody[2]` 6.03 s, `TapBody[3]` 4.03 s — **every one is `Loop: true`**, and none declares `FadeInTime`/`FadeOutTime` in the motion file (the model3.json entries declare 0.5 s / 0.5 s) | read each `motion3.json` |
| Haru expressions | `F01`–`F08`; **none declares `FadeInTime`/`FadeOutTime`**, so `CubismExpressionMotion`'s `DefaultFadeTime = 1.0` applies unless set explicitly | read each `exp3.json`; `vendor/CubismWebFramework/src/motion/cubismexpressionmotion.ts:25` |
| Haru expression contents | F01 `ParamMouthForm +0.27`; F02 brows down + `ParamMouthOpenY 1` + `ParamEyeForm .54`; F03 brows angry + `ParamMouthForm −2`; F04 brows sad + `ParamEyeLOpen/ROpen ×0.8`; **F05 `ParamEyeLOpen/ROpen ×0`, `ParamEyeLSmile/RSmile 1` (eyes fully closed)**; F06 `ParamEyeLOpen/ROpen ×2` (wide); F07 sad brows + **`ParamTere 1` (blush)**; F08 `ParamMouthForm −1.76` + eyes ×0.8 | read each `exp3.json` |
| Haru part ids (committed, semantic) | `Part01Core Part01Hoho001 Part01Brow001 Part01Tear Part01EyeBall001 Part01Eye001 Part01Nose001 Part01Mouth001 Part01Face001 Part01Ear001 Part01Neck001 Part01HairFront001 Part01HairSide001 Part01HairBack001 Part01ArmRB001 Part01ArmLB001 Part01ArmRA001 Part01ArmLA001 Part01Body001 Part01Sketch` | `characters/haru/model/Haru.cdi3.json` |
| Haru parameter ids | `ParamAngleX/Y/Z ParamTere ParamFaceForm ParamEyeLOpen ParamEyeLSmile ParamEyeROpen ParamEyeRSmile ParamEyeForm ParamEyeBallForm ParamTear ParamEyeBallX/Y ParamBrowLY/RY/LX/RX/LAngle/RAngle/LForm/RForm ParamMouthForm ParamMouthOpenY ParamScarf ParamBodyAngleX/Y/Z ParamBodyUpper ParamBreath ParamBustY ParamArmLA/RA/LB/RB ParamHandChangeR ParamHandAngleR ParamHandDhangeL ParamHandAngleL ParamHairFront/Side/Back` | `Haru.cdi3.json` |
| Cubism motion priority is **unusable** as an arbitration mechanism for Haru | `CubismMotionManager.updateMotion` clears `_currentPriority` only when `isFinished()` (`cubismmotionmanager.ts:89-91`); every Haru motion is `Loop: true`, so `isFinished()` never returns true, so `_currentPriority` stays at whatever started last and `reserveMotion(p)` rejects every `p <= _currentPriority` (`:103-114`) — **forever** | read the Framework source; motion `Meta.Loop` read from the files |
| Cubism expression weight hook | `ACubismMotion.setWeight(w)` (`acubismmotion.ts:207`) multiplies into `updateFadeWeight` (`:142`, `fadeWeight = this._weight * fadeIn * fadeOut`). `CubismExpressionMotionManager.setFadeWeight()` is **overwritten every frame** (`cubismexpressionmotionmanager.ts:190-196`) and must not be used | read the Framework source |
| Framework typo, load-bearing | model opacity getter/setter are spelled **`getModelOapcity()` / `setModelOapcity()`** (`cubismmodel.ts:450,459`). `getModelOpacity()` does not exist | read the Framework source |
| Cubism picking API present on `CubismModel` | `getDrawableCount` `getDrawableId` `getDrawableVertexCount` `getDrawableVertexPositions` `getDrawableVertexUvs` `getDrawableVertexIndices` `getDrawableVertexIndexCount` `getDrawableOpacity` `getDrawableTextureIndex` `getDrawableCulling` `getDrawableMasks` `getDrawableMaskCounts` `getDrawableInvertedMaskBit` `getDrawableBlendMode` `getDrawableDynamicFlagIsVisible` `getDrawableParentPartIndex` `getPartId` `getPartCount` `getPartOpacityByIndex` `getRenderOrders` `getModelOapcity` | grep of `cubismmodel.ts` |
| `CubismBlendMode` | `Normal = 0`, `Additive = 1`, `Multiplicative = 2` (`rendering/cubismrenderer.ts:297-301`) | read the Framework source |
| `CubismUpdateOrder` | `EyeBlink 200`, `Expression 300`, `Drag 400`, `Breath 500`, `Physics 600`, `LipSync 700`, `Pose 800` | `motion/icubismupdater.ts:22-31` |
| ffmpeg | 8.1.2-full_build (gyan.dev) at `C:\Users\jiami\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`; `ddagrab` is a **filter**, not a device; `gfxcapture` present | research digest §9 (verified there, not re-run here) |

### 0.3 The `node:sqlite` probe — script and recorded output

Script (five statements; run read-only from the scratchpad, never from the repo):

```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:'), ok = (s) => { try { db.exec(s); return 'OK'; } catch (e) { return `ERR ${e.message}`; } };
console.log('node', process.version, '| sqlite', db.prepare('SELECT sqlite_version() v').get().v);
console.log('fts5/unicode61', ok("CREATE VIRTUAL TABLE f USING fts5(body,alias,tokenize='unicode61')"), '| trigram', ok("CREATE VIRTUAL TABLE t USING fts5(b,tokenize='trigram')"), '| fts5vocab', ok("CREATE VIRTUAL TABLE v USING fts5vocab(f,'row')"), '| vec0', ok('CREATE VIRTUAL TABLE z USING vec0(e float[4])'));
db.exec("INSERT INTO f VALUES ('我 我今 今 今天 天 天面 面 面试 试','面试 工作'); INSERT INTO t VALUES ('我今天面试')");
console.log('bigram MATCH 面试', db.prepare("SELECT count(*) n FROM f WHERE f MATCH '面试'").get().n, '| trigram MATCH 面试', db.prepare("SELECT count(*) n FROM t WHERE t MATCH '面试'").get().n, '| bm25', db.prepare("SELECT printf('%.4f',bm25(f,1.0,2.0)) s FROM f WHERE f MATCH '面试'").get().s);
```

Recorded output, verbatim:

```
node v24.17.0 | sqlite 3.53.0
fts5/unicode61 OK | trigram OK | fts5vocab OK | vec0 ERR no such module: vec0
bigram MATCH 面试 1 | trigram MATCH 面试 0 | bm25 -0.0000
```

`bm25` is `-0.0000` because a single-row table gives every term an IDF of zero. A three-row control
run (same scratchpad, three expanded facts, alias column weighted 2.0) produced real scores and the
paraphrase behaviour R3-10 depends on:

```
面试 -> -2.4732      (hit: 主人下周三要去杭州面试)
腰疼 -> -2.2821      (hit: 主人最近腰不太好，久坐会痛 — matched through the alias column only)
咖啡 -> -2.4194      (hit: 主人喜欢喝冰美式 — matched through the alias column only)
医院 -> NO MATCH     (correct: no row is about 医院)
```

**Conclusion, binding for §8:** FTS5 is available, `trigram` is unusable for Chinese as R3-10 states,
`sqlite-vec` is not available, and the bigram-expansion + weighted-alias design retrieves
paraphrases while still returning nothing for an unrelated query.

### 0.4 The exquisite-bar criteria Phase 3 implements — quoted, with thresholds

Rulings v2 requires each implemented criterion to be quoted with its threshold. Every row is
verbatim from `docs/superpowers/specs/2026-08-29-exquisite-bar.md`.

| Id | Verbatim criterion (threshold in **bold**) | Implemented in |
|---|---|---|
| §0 Resource budget | "Measured on the whole Electron process tree: **≤ 4 % CPU / ≤ 250 MB at 30 Hz idle**; ticker **stopped (0 frames)** when hidden, occluded, fullscreen-vacated, locked; **≤ 0.5 % CPU** in that state." | §11 |
| §0 Hover semantics | "hover **< 250 ms** → acknowledge (glance) and freeze wandering; click before any fade → opens chat; **rest > 3 s while a "work-mode" toggle is on** → fade to **35 %** + pass-through (opt-in, default off); hotkey toggles pass-through globally. A faded pet regains clickability the moment the cursor leaves and re-enters." | §5.9 |
| §0 Proactive caps | "Layered: global rate **≤ 1 / 20 min** → **≤ 3 unanswered per day** with exponential back-off → persona cap (**default 2/day**) → suppressed while typing, in fullscreen, locked, DND, or **within 60 s** of user input. Templates never repeat verbatim **within 30 days**." | §3.10 |
| §0 Absence economics | "**State changes only while the user is present. Absence is never penalized.** 'Neglect' = ignoring the pet while present; it degrades mood only, recoverable, no death, no resets." | §3.6, §3.7 |
| §0 Transition timing | "Tap motions fade-in **≤ 120 ms**, expressions **≤ 300 ms**, idle→idle **1 s**." | §5.4, §5.7 |
| §0 Idle behaviour density | "Idle behaviours last **5–20 s** (mean **≈ 12 s**); a **60-s** unattended recording must show **≥ 4 distinct behaviours**." | §4.6, §12.5 |
| §0 Memory budget | "Static prefix (persona **≤ 700 tokens**) → history → **≤ 600-token summary + ≤ 5 retrieved facts placed in the latest user message**; prompt-cache hit rate target **≥ 70 %** over a 20-turn session (`prompt_cache_hit_tokens / prompt_tokens`)." | §8.6, §8.8 |
| **D1** | "Idle = data-defined weighted behaviour pool (`behaviors.json`: name, weight, conditions: time-of-day, user-idle, on-floor, near-edge) with **≥ 12 idle behaviours**; **no behaviour twice in a row**." | §4 |
| **D2** | "Breath, blink (**mean 4 s, jitter ± 1.5 s**), physics run as independent always-on layers; low-amplitude wind keeps hair/clothes moving at rest." | §5.8 |
| **D3** | "Gaze: smoothed cursor-follow (**head 30° / eyes 1.0 / body 10°**), broken **every 8–20 s** by a look-away-and-back saccade or hand fidget; **stops following after 5 s of cursor rest**." | §5.6 |
| **D4** | "Real-clock rhythms: night state after a configurable hour (yawn, sleepy pose, **no requests while asleep**), morning greeting, meal-time cues." | §3.9 |
| **D5** | "Absence awareness: **≥ 5 min without input** → nap/slack state; on return, visibly notices the user **within 1 s**." | §3.1, §3.3, §5.10 |
| **D6** | "Body-part-aware touch: head / face / body / one ticklish zone with distinct reactions; **≥ 7 taps in 1 s** → annoyed reaction + cooldown. Hit-testing is **opaque-pixel** (alpha readback), shared by hover, click-through and HitArea resolution; HitArea names normalized (Head/HitAreaHead/头)." | §5.11, §6 |
| **D7** | "Hover acknowledgement per §0; wandering freezes under the cursor." | §5.9 |
| **D8** | "Drag has weight: dangling pose leans with cursor velocity; **release velocity from the last 4 samples**; gravity, edge bounce with decay, tumble + landing squash + stand-up. A fast fling shows visible travel." | §7 |
| **D9** | "Grounded: **floor = work area (taskbar excluded)**; optional walk-on-active-window-edge (later); **never off-screen**, restored to a visible corner at launch." | §7.7 |
| **D11** | "Reacts to real activity: typing → glances at the screen; long streak → cheer; wiggle near her → curiosity; battery low / on charger → micro-reaction. Keystroke reactions are **opt-in** with password-field masking; **no key logging by default**." | §10 |
| **D12** | "Personality knob: one '活泼度' slider (quiet cat in the corner → playful), **default quiet**." | §3.5 |
| **D13** | "Escape hatches: tray, right-click menu, hidden from Alt-Tab/taskbar, `Ctrl+Alt+H`, corner snap that never triggers Windows Snap Layouts." | §7.7 (corner snap), §3.5 / §3.10.4 / §5.9 / §8.9 / §9.5 (the tray submenus). **`Ctrl+Alt+H` is NOT shipped in Phase 3** — the only global shortcut on `main` is `Control+Shift+Space` (`index.ts:405`); the panic-hide hotkey is §13.2's Phase 4 row |
| **D14** | "LLM drives behaviour only through the bounded vocabulary (`emotion, motion, say, look, walkTo`); the local behaviour engine keeps her alive between calls and during API failure. Arbitration: tap reaction > LLM motion > idle; **LLM expressions persist until the next ACT or 90 s**, then decay to neutral." | §2.6, §5.2, §5.4 |
| **D16** | "Evidence gate: **60-s unattended recording** (**≥ 4 idle behaviours**, continuous breath/blink, **≥ 1 gaze break**) and **20-s interaction recording** (hover ack, **3 touch reactions**, drag-fling arc + landing)." | §12 |
| **A11** | "Memory recall (P3): **20 facts over 5 sessions → ≥ 90 % recalled** when relevant, paraphrase-robust; callbacks woven ('你上次说的那个面试呢'), **0** '根据你之前提到的'." | §8 |
| **A14** | "Proactive per §0; every template audited against manipulation tactics (guilt, FOMO, neediness)." | §3.10, §4.8 |
| **X4** | "Memory transparency (P3): a 记忆 tab to view/edit/delete memories, '记住这个 / 忘掉这个' commands, export/import, `%APPDATA%\\ds` documented, one-click wipe." | §8.9 (commands + export/wipe; the 记忆 **tab** is Phase 4 with the settings window — R3-24, §14.1 Q5; **import** is Phase 4 too — R3-33, §14.2 P6) |
| **X10** | "Persona ecosystem (P3/4): multiple personas, editor with test-chat and live slop-linter, SillyTavern card import." | §9.6 (the 3-persona eval fixture + the plain profile only; editor and import are Phase 4 per R3-18) |
| **X13** | "Sound (P3): tap/notification SFX with mute/volume; accessibility: labelled settings controls, high-contrast survives." | §5.12 |

### 0.5 Ruling → section index

| Ruling | Sections that implement it |
|---|---|
| Ownership table | §1.2, §2, §5.1, §7.1 |
| R3-1 | §1.3, §3.1–§3.3, §3.11, §3.12 |
| R3-2 | §4 |
| R3-3 | §5.1–§5.3, §7.1 |
| R3-4 | §5.4 |
| R3-5 | §7 |
| R3-6 | §6 |
| R3-7 | §3.10, §2.7 |
| R3-8 | §3.6–§3.8 |
| R3-9 | §10 |
| R3-10 | §8.1–§8.5 |
| R3-11 | §8.6–§8.8 |
| R3-12 | §9 |
| R3-13 | §3.4, §3.5 |
| R3-14 | §11 |
| R3-15 | §12.1–§12.5 |
| R3-16 | §12.7 |
| R3-17 | §13 |
| R3-18 | §1.6 |
| R3-19 | §1.7 |
| R3-20 (C7 → Phase 4) | §13.2, §14 |
| R3-21 (plain-profile tokens) | §9.2, §14 |
| R3-22 (press = alpha-only) | §6.3, §6.5, §14 |
| R3-23 (`wander` ≥ 0.4) | §4.9, §14 |
| R3-24 (记忆 tab → Phase 4) | §8.9, §14 |
| R3-25 / R3-29 (1 LLM proactive line/day; `callback` only) | §3.10.5, §3.10.7, §14 |
| R3-26 (`ddagrab` is a filter) | §0.2, §12.3, §14 |
| R3-27 / R3-28 (motion-labelling pass) | §4.10, §4.11, §4.9 |
| R3-30 (≥ 15 audited templates per bucket) | §4.8 |
| R3-31 (Hiyori unselectable in Phase 3) | §4.7, §13.2 |
| R3-32 (A11 → `not-measured.md` + fixture) | §8.11, §12.1 |
| R3-33 (X4 import → Phase 4) | §8.9, §13.2 |
| R3-34 (remaining §G questions → preflight defaults) | §14 |

### 0.6 The Phase 2 interfaces this contract is written against

`main` @ `f3185a3` (after RESIDUAL-1 `81ffd6b` and RESIDUAL-2 `17d3fb9`) was read directly for
every row below, and every line number was re-verified against that commit. **Six are VERIFIED and
carry no marker; FW-3 is half-true and its false half is corrected here.** RESIDUAL-2 is merged, and
its four items are verified in the second table.

| # | Interface | State on `main` @ `f3185a3` | Sections that depend on it |
|---|---|---|---|
| FW-1 | `TurnRunner.cancel(): Promise<void>` — resolves after `retire`'s writes | **VERIFIED** (`packages/brain/src/turn.ts`; the write chain now also carries `userCommit: CommitState` and a `persistFailed` event, `turn.ts:34`, `:110`) | §3.11 (quit drain), §7.6, §8.5, §12.7 B-04 |
| FW-2 | `BrainService.dispose(): Promise<void>`, awaited in `before-quit` before `db.close()` | **VERIFIED** (`brain-service.ts:421` `async dispose(): Promise<void>`; `createBeforeQuit` in `quit.ts:30` races `drain()` against `DRAIN_TIMEOUT_MS = 3000` (`quit.ts:28`), then `closeDb`) | §1.5, §3.11, §8.5, §11.2 |
| FW-3a | `HistoryStore` has a **closing fence** | **VERIFIED** (`history.ts:73` `private closed = false`, set by `close()` at `:92-93`, checked at `:172` and `:201`) | §8.5 |
| FW-3b | `TrimPlan` carries **row ids** | **FALSE — corrected.** `TrimPlan` is `{keep, drop, droppedTokens}` (`packages/brain/src/types.ts:23`) and carries **no ids**. RESIDUAL-1's GC-1 rewrite instead chunks the retired prefix (`history.ts:32` `TRIM_CHUNK_TOKENS = 24_000`, `:188` `chunkByTokens`, `:208` + `:333` `prefixStillMatches`) and re-validates before advancing `last_trim_id`. §8.2 and §8.5 are written against **that** shape | §8.2, §8.5 |
| FW-4 | the single visibility-aware chat opener in `main/index.ts` | **VERIFIED, signature corrected**: it is `requestChat(source: ChatRequestSource, focusComposer: boolean): void` (`index.ts:367`), **two** parameters, the first `source` not `reason`; bound to the pre-ready holder at `:383`, call sites `:388` (`chat:open`), `:400` (tray) and `:405` (hotkey). `decideChatRequest` lives in `main/chat-request.ts` | §2.4, §5.9, §11.2, §13 |
| FW-5 | `SpeechController` has an explicit `visible` state | **VERIFIED** (`apps/desktop/src/renderer/bubble/speech.ts:186` `get visible(): boolean`) | §11.3, §13 item 4 |
| FW-6 | `PAUSE_MAX_S` / `USER_TEXT_MAX` exported from `@ds/protocol` | **VERIFIED, and already used**: `PAUSE_MAX_S = 3` (`index.ts:29`) is enforced inside `SentenceEventSchema.pause` (`:37`) **and** clamped in `parseTag` (`packages/brain/src/tags.ts:12`); `USER_TEXT_MAX = 2000` (`index.ts:255`) bounds `user:text` | §2.6, §3.10, §9.4 |
| FW-7 | `DeepSeekError.message` user-safe, redacted `detail` | **VERIFIED** (`packages/brain/src/deepseek.ts:65-77`, "`message` never carries the upstream body"). RESIDUAL-1 also made a malformed SSE frame an error rather than a silent skip | §12.2 |

**RESIDUAL-2, merged in `17d3fb9` — all four VERIFIED.** Every item Phase 3 depends on is on `main`;
the inline "re-verify after merge" markers this table used to carry are deleted.

| Residual-2 item | State | Evidence on `f3185a3` | Where Phase 3 depends on it |
|---|---|---|---|
| `quit.ts` step guard / drain ordering | **VERIFIED** | `quit.ts:62` `const step = (name: string, fn: () => void): void`, used at `:79` `step('teardownSync', …)` — a throwing teardown no longer strands `phase` at `'draining'` | §3.11's four-await quit sequence |
| second-instance routed through `requestChat` | **VERIFIED** | `index.ts:126` `app.on('second-instance', () => chatRequest.request('second-instance', true))`, replayed once bound at `:383` `chatRequest.bind(requestChat)` | §3.11's `USER_HIDDEN` dispatch on the tray / second-instance show path |
| `SpeechController` hidden-cancel, and `complete()` a no-op while paused | **VERIFIED** | `speech.ts:106` (GC2-3: hidden-and-unfinished no longer wedges the controller), `:152-155` (GC2-4: `complete()` drops the request while paused rather than committing unseen text) | §11.3's "no speech lease active" predicate |
| `ErrorCodeSchema` gains `'storage'` | **VERIFIED** | `packages/protocol/src/index.ts:49` `z.enum([… 'no-key', 'storage'])` and its `ERROR_HINTS.storage` row at `:376` | §12.2's trace `code` field, and `ERROR_HINTS`'s exhaustiveness test |

If any row above changes again, the dependent section is re-verified before its owning task starts,
and the difference is recorded as an Amendment at the top of this file (Phase 2's Amendments
convention).

---

## §1 Package map, dependency direction, and every new file path

### 1.1 New and modified packages

```
packages/sim          NEW  — Electron-free reducer + policies (mood, energy, affection, presence,
                             phases, liveliness map, proactive gate). No I/O, no timers, no Date.
packages/behaviors    NEW  — Electron-free schema + condition evaluator + shuffle-bag selector.
                             No fs, no WebGL, no app://, no Electron. Bundle I/O is the caller's.
packages/memory       v2   — facts table, CJK bigram FTS index, extractor plumbing, kv additions.
packages/protocol     +    — the Phase 3 channels, schemas and allow-list rows (§2).
packages/brain        +    — ACT vocabulary extension (`look`, `walkTo`), plain-profile switch,
                             fact-extraction prompt, proactive prompt builder.
packages/stage        +    — picker (CPU mesh + alpha), 1-px GPU press read, overlay updater,
                             expression-weight hook, extra-motion registration.
apps/desktop          +    — SimService, WindowMotionController, ProactiveController, ActivitySensor,
                             mode store, trace writer, lazy window lifecycle; renderer `stage/arbiter`.
```

### 1.2 Dependency direction (no cycles; arrows point at the dependency)

```
                 @ds/protocol  (zod shapes, channels, allow-lists — depends on nothing but zod)
                    ▲   ▲   ▲   ▲
        ┌───────────┘   │   │   └────────────┐
   @ds/sim         @ds/behaviors        @ds/stage            @ds/brain
   (pure policy)   (pure selection)     (browser only)       (pure prompt/parse)
        ▲                ▲                  ▲                    ▲
        │                │                  │                    │
        │                └──────┬───────────┘                    │
        │                       │                                │
        │              apps/desktop RENDERER (pet)        @ds/memory ──┐
        │              src/renderer/pet/stage/arbiter     (node:sqlite)│
        │                                                             │
        └──────────────── apps/desktop MAIN ──────────────────────────┘
                          SimService · WindowMotionController
                          ProactiveController · ActivitySensor
                          ModeStore · TraceWriter · BrainService (Phase 2)
```

Hard rules:

- `@ds/sim` and `@ds/behaviors` import **only** `@ds/protocol` and `zod`. Importing `electron`,
  `node:fs`, `node:sqlite` or anything from `@ds/stage` is a defect. Each ships a test asserting it
  (`expect(readFileSync(f,'utf8')).not.toMatch(/from '(electron|node:)/)` over its own `src/**`).
- `@ds/behaviors` never reads a file. The renderer's asset loader fetches `behaviors.json` and hands
  the parsed JSON to `parseBehaviorPack`.
- `@ds/stage` never imports `@ds/sim` **types at runtime** — it takes `SimSnapshot` as a
  `import type` from `@ds/protocol` (the broadcast subset lives in the protocol, §2.3).
- Main never imports from `apps/desktop/src/renderer/**` except the two existing shared metric
  modules (`renderer/shared/chat-metrics.ts`, Phase 2 §6.1) and the new
  `renderer/shared/lane-metrics.ts` (§5.13).
- **C1 (Phase 2 §0) applies unchanged:** every relative import inside `@ds/protocol`, `@ds/brain`,
  `@ds/memory`, **`@ds/sim` and `@ds/behaviors`** carries an explicit `.ts` extension, and those
  packages' tsconfigs set `allowImportingTsExtensions: true`. `@ds/stage` and `apps/desktop` keep the
  extensionless convention.

### 1.3 `packages/sim` — files

```
packages/sim/package.json                 name @ds/sim; deps: @ds/protocol workspace:*, zod ^4.0.0
packages/sim/tsconfig.json                copy of packages/brain/tsconfig.json verbatim
packages/sim/vitest.config.ts             { test: { environment: 'node', include: ['src/**/*.test.ts'] } }
packages/sim/src/index.ts                 barrel (export * from each module, .ts extensions)
packages/sim/src/state.ts      + .test.ts SimState, SimStateSchema, initialSimState(), SIM_DEFAULTS
packages/sim/src/events.ts     + .test.ts SimEvent union + SimEventSchema
packages/sim/src/reduce.ts     + .test.ts reduce(state, event, nowMono, nowWall) -> SimState
packages/sim/src/mood.ts       + .test.ts valence/arousal integration, neglect, return settling
packages/sim/src/energy.ts     + .test.ts circadian curve + expenditure
packages/sim/src/affection.ts  + .test.ts monotonic grants, daily cap, dual-path milestone
packages/sim/src/phases.ts     + .test.ts clock phases, meal cues, local-date markers
packages/sim/src/liveliness.ts + .test.ts the one monotonic mapping (R3-13)
packages/sim/src/presence.ts   + .test.ts PRESENT predicate, presentation mode, probableTyping input
packages/sim/src/proactive.ts  + .test.ts the pure gate: shouldSpeak(gateState, now) -> GateVerdict
packages/sim/src/snapshot.ts   + .test.ts SimSnapshot (broadcast subset) + persistence envelope
packages/sim/src/rng.ts        + .test.ts seeded mulberry32 with serialisable state (rngState)
```

### 1.4 `packages/behaviors` — files

```
packages/behaviors/package.json            name @ds/behaviors; deps: @ds/protocol workspace:*, zod ^4.0.0
packages/behaviors/tsconfig.json           copy of packages/brain/tsconfig.json verbatim
packages/behaviors/vitest.config.ts        node environment
packages/behaviors/src/index.ts            barrel
packages/behaviors/src/schema.ts    + .test.ts BehaviorSchema, BehaviorPackSchema, parseBehaviorPack
packages/behaviors/src/conditions.ts+ .test.ts ConditionSchema + evaluate(condition, facts)
packages/behaviors/src/bag.ts       + .test.ts WeightedShuffleBag
packages/behaviors/src/selector.ts  + .test.ts BehaviorSelector (recency, cooldown, LRU, density guard)
packages/behaviors/src/bind.ts      + .test.ts bindResources(pack, catalogue) -> BoundPack | BindError
```

### 1.5 Every file Phase 3 touches — with its one owner

**This table is exhaustive**, *as amended* — the Amendments block at the top of this file adds rows
(A3-1, A3-3) and two rules the table cannot express (A3-4); read both together. If a section names a
file that is in neither, that is a defect in this
contract, not a licence to edit. The rule is Phase 2's: *a task that is not the owner may read a file
but must not create, delete or edit it; if it needs a change there it stops and reports
`BLOCKED: <path> is owned by <task>`.*

**The shared-protocol exception, pinned.** `packages/protocol/src/index.ts` is imported by every task
and edited by exactly one (T3-A), which lands its whole §2 change set — constants, channels,
schemas, allow-lists — in **one** edit, before any other Phase 3 task starts. `channels.test.ts`
hard-pins every allow-list to an exact literal array (`packages/protocol/src/channels.test.ts:76-102`
on `main`), so the list edit and the test edit are one change, by one owner, or the suite goes red.
The same test's cross-window isolation case asserts with `/^(user|key|history):/`; T3-A widens it to
`/^(user|key|history|proactive):/` in the same edit, or Phase 3's `proactive:*` telemetry to the chat
window weakens the invariant with nothing failing (preflight F-11).

```
                                                                                  OWNER (task)
packages/protocol/src/index.ts                            MODIFY  §2 (all of it)   T3-A
packages/protocol/src/channels.test.ts                    MODIFY  §2.5, §2.9      T3-A
apps/desktop/src/main/sim-service.ts          + .test.ts   CREATE  §3.11           T3-A
apps/desktop/src/main/activity-sensor.ts      + .test.ts   CREATE  §10             T3-A
apps/desktop/src/main/notification-state.ts   + .test.ts   CREATE  §10.3 (koffi)   T3-A
apps/desktop/src/main/window-motion.ts        + .test.ts   CREATE  §7              T3-B
apps/desktop/src/main/proactive-controller.ts + .test.ts   CREATE  §3.10           T3-C
apps/desktop/src/main/proactive-templates.ts  + .test.ts   CREATE  §4.8            T3-C
apps/desktop/src/main/mode-store.ts           + .test.ts   CREATE  §9              T3-C
apps/desktop/src/main/trace.ts                + .test.ts   CREATE  §12.2           T3-E
apps/desktop/src/main/window-lifecycle.ts     + .test.ts   CREATE  §11.3           T3-E
apps/desktop/src/main/fact-extractor.ts       + .test.ts   CREATE  §8.5            T3-D
apps/desktop/src/main/index.ts                            MODIFY  §1.5 wiring     T3-A
apps/desktop/src/main/quit.ts                             MODIFY  §3.11 (DRAIN_TIMEOUT_MS) T3-A
apps/desktop/src/main/brain-service.ts                    MODIFY  §3.11, §9.1     T3-C
apps/desktop/src/main/tray.ts                 + .test.ts   MODIFY  §3.5, §3.10, §9.5 T3-C
apps/desktop/src/main/pet-window.ts                       MODIFY  §7.7 (motor owns setPosition) T3-B
apps/desktop/src/renderer/shared/lane-metrics.ts + .test.ts CREATE §5.13          T3-B
apps/desktop/src/renderer/pet/stage/arbiter.ts   + .test.ts CREATE §5.2           T3-B
apps/desktop/src/renderer/pet/stage/lanes.ts     + .test.ts CREATE §5.1           T3-B
apps/desktop/src/renderer/pet/stage/expression-lease.ts + .test.ts CREATE §5.4    T3-B
apps/desktop/src/renderer/pet/stage/gaze-lane.ts + .test.ts CREATE §5.6           T3-B
apps/desktop/src/renderer/pet/stage/touch.ts     + .test.ts CREATE §5.11          T3-B
apps/desktop/src/renderer/pet/stage/hover-ack.ts + .test.ts CREATE §5.9           T3-B
apps/desktop/src/renderer/pet/stage/drag-visual.ts + .test.ts CREATE §5.5         T3-B
apps/desktop/src/renderer/pet/stage/behaviour-runner.ts + .test.ts CREATE §5.3    T3-B
apps/desktop/src/renderer/pet/main.ts                     MODIFY  §5.14           T3-B
apps/desktop/src/renderer/pet/press.ts                    MODIFY  §7.2 (grab/release) T3-B
packages/stage/src/picker.ts                  + .test.ts   CREATE  §6             T3-B
packages/stage/src/picker-gpu.ts              + .test.ts   CREATE  §6.6           T3-B
packages/stage/src/overlay.ts                 + .test.ts   CREATE  §5.7           T3-B
packages/stage/src/companion-model.ts                     MODIFY  §5.7, §6.2      T3-B
packages/stage/src/stage.ts                               MODIFY  §6.3            T3-B
packages/memory/src/db.ts                                 MODIFY  §8.1            T3-D
packages/memory/src/facts.ts                  + .test.ts   CREATE  §8.2–§8.4      T3-D
packages/memory/src/tok.ts                    + .test.ts   CREATE  §8.3           T3-D
packages/memory/src/summary.ts                            MODIFY  §8.10          T3-D
packages/memory/src/proactive-log.ts          + .test.ts   CREATE  §3.10.6        T3-C
packages/brain/src/act.ts                     + .test.ts   CREATE  §2.6           T3-B
packages/brain/src/extract-prompt.ts          + .test.ts   CREATE  §8.5           T3-D
packages/brain/src/proactive-prompt.ts        + .test.ts   CREATE  §3.10.7        T3-C
packages/brain/src/mode.ts                    + .test.ts   CREATE  §9.1           T3-C
characters/haru/behaviors.json                            CREATE  §4.9            T3-B
characters/haru/character.json                            MODIFY  §4.9, §4.10, §6.4, §3.10.7 T3-B
scripts/measure-memory.ps1                                CREATE  §11.4           T3-E
scripts/record-phase3.ps1                                 CREATE  §12.3           T3-E
scripts/sendinput-drive.ps1                               CREATE  §12.4           T3-E
scripts/assert-trace.mjs                      + .test.mjs  CREATE  §12.6          T3-E
scripts/make-sfx.mjs                                      CREATE  §5.12           T3-B

--- files Phase 3 also touches, added by the preflight (fix 1) -------------------
packages/brain/src/tags.ts                                MODIFY  §2.6            T3-B
packages/brain/src/types.ts                               MODIFY  §2.6            T3-B
packages/brain/src/stream-parser.ts                       MODIFY  §9.4            T3-C
packages/brain/src/persona.ts                             MODIFY  §9.2            T3-C
packages/brain/src/ports.ts                               MODIFY  §8.6            T3-D
packages/memory/src/history.ts                            MODIFY  §8.1, §8.6      T3-D
packages/stage/src/character.ts                           MODIFY  §4.10, §6.4     T3-B
apps/desktop/src/main/foreground.ts                       MODIFY  §10.3           T3-A
apps/desktop/src/main/invoke.ts                           MODIFY  §11.2           T3-E
apps/desktop/src/main/ipc.ts                              MODIFY  §11.2           T3-E
apps/desktop/src/renderer/bubble/fps.ts                   MODIFY  §5.8            T3-B
apps/desktop/src/main/persona-name.ts         + .test.ts   CREATE  §1.7            T3-C
apps/desktop/src/main/memory-metric.ts        + .test.ts   CREATE  §11.1           T3-E
apps/desktop/src/renderer/pet/stage/sfx.ts    + .test.ts   CREATE  §5.12           T3-B
apps/desktop/public/sfx/{tap,annoyed,land,notify}.ogg     CREATE  §5.12           T3-B
apps/desktop/tests/picker-oracle.spec.ts                  CREATE  §6.5            T3-B
docs/PRIVACY-SENSING.md                                   CREATE  §10.7           T3-A
scripts/phase3-cache.mjs                      + .test.mjs  CREATE  §8.8            T3-E
eval/personas/{haru,quiet,blunt}.json                     CREATE  §9.6            T3-C
eval/fixtures/persona-bleed.zh.json                       CREATE  §9.6            T3-C
eval/fixtures/memory-recall.zh.json                       CREATE  §8.11           T3-D
eval/run.mjs                                              MODIFY  §9.6            T3-C
eval/judge.md                                             MODIFY  §9.6, §13.2     T3-C
docs/evidence/phase3/not-measured.md                      CREATE  §12.1           T3-E
docs/evidence/phase3/motion-labels.{md,json}              CREATE  §4.11           T3-B
docs/evidence/phase3/motions/*.png                        CREATE  §4.11           T3-B
docs/evidence/phase2/deferred.md                          MODIFY  §4.7 (Hiyori)   T3-B

--- added by the controller's post-plan rulings (Amendments A3-1, A3-3) -----------
apps/desktop/src/renderer/pet/stage/ui-flags.ts + .test.ts CREATE  §5.9, §5.12 (A3-1) T3-B
apps/desktop/src/renderer/chat/App.tsx        + .test.tsx  MODIFY  §2.7, §2.8, §9.5   T3-B
apps/desktop/src/renderer/chat/Composer.tsx   + .test.tsx  MODIFY  §9.5, §2.3         T3-B
apps/desktop/src/renderer/chat/History.tsx    + .test.tsx  MODIFY  X5, §2.7           T3-B
apps/desktop/src/renderer/chat/chat.css       + chat-css.test.ts   MODIFY §9.5        T3-B
apps/desktop/src/renderer/bubble/bubble.ts    + .test.ts   MODIFY  §9.4, §2.3         T3-B
apps/desktop/src/renderer/bubble/bubble.css   + bubble-css.test.ts MODIFY §9.4, §2.3  T3-B
apps/desktop/src/renderer/bubble/main.ts                   MODIFY  §2.7, §2.8         T3-B
```

**Two rules the table above cannot express, added by Amendments A3-4 and A3-3.** (1) `packages/brain/src/index.ts` and `packages/memory/src/index.ts` are **append-only shared files** — every task appends its own `export *` line at the end, nobody edits another's line, the integrator keeps both sides on a conflict, and a barrel line is never a `BLOCKED`; `packages/brain/src/turn.ts` is **T3-C's**, with the single documented batch-1 exception for `setQuery` + `metrics.envelope` (A3-4). (2) The renderer rows above grant T3-B `apps/desktop/src/renderer/chat/**` and the non-`fps.ts` half of `apps/desktop/src/renderer/bubble/**` for Phase 3; `bubble/fps.ts` keeps its own §5.8 row (A3-3).

Task letters are placeholders for the plan (which this document does **not** write); the point of
the column is that **every path has exactly one owner**, and a task that is not the owner may read
but not edit, reporting `BLOCKED: <path> is owned by <task>`.

### 1.6 Out of scope (R3-18), stated so no task adds it

Settings window (Phase 4 — presets and quiet mode ship as **tray submenus** only); walk-on-active-
window-edge (D9 "later"); voice; SillyTavern card import UI. X10 in Phase 3 means exactly two
things: the **3-persona eval fixture** (§9.6) and the **plain profile** (§9.2).

### 1.7 R3-19 — the persona name is a placeholder

No Phase 3 source file, template, prompt, tray label, plate or test fixture may contain the literal
`小春`. Every user-visible string that needs the name reads it from the character bundle:

```ts
// apps/desktop/src/main/persona-name.ts  — CREATE, owner T3-C
/** The one accessor. Phase 3 strings interpolate this, never a literal (R3-19). */
export function personaName(bundle: CharacterBundle): string { return bundle.card.name; }
```

Acceptance check, run by every Phase 3 task: `grep -rn '小春' packages/sim packages/behaviors
apps/desktop/src/main apps/desktop/src/renderer/pet characters/haru/behaviors.json` returns nothing.
(Phase 2 files that already contain it — `summarizer.ts`'s default parameter — are not touched.)

---

## §2 `@ds/protocol` additions

Everything in this section lands in `packages/protocol/src/index.ts`. **Every Phase 1 and Phase 2
row keeps its name, direction and schema byte-for-byte** (Phase 2 §2.3's rule); Phase 3 only appends
to `Channels`, `Schemas` and the eight allow-lists, and appends two optional fields to
`SentenceEventSchema` (§2.6).

Legend, unchanged from Phase 2: `P` = pet renderer, `B` = bubble renderer, `C` = chat renderer,
`K` = key renderer, `M` = main.

### 2.1 New constants

```ts
// ---- Phase 3 (contracts 2026-08-30) ------------------------------------------------------

/** Liveliness (活泼度) is one normalised value with one mapping (R3-13). */
export const LIVELINESS_MIN = 0;
export const LIVELINESS_MAX = 1;
export const LIVELINESS_PRESETS = { quiet: 0.15, default: 0.30, lively: 0.70 } as const;
export type LivelinessPreset = keyof typeof LIVELINESS_PRESETS;

/** The four clock phases (D4). Wall-clock derived, recomputed every tick, never cached. */
export const CLOCK_PHASES = ['morning', 'day', 'evening', 'night'] as const;
export type ClockPhase = (typeof CLOCK_PHASES)[number];
export const ClockPhaseSchema = z.enum(CLOCK_PHASES);

/** Presence (R3-1: PRESENT := unlocked AND not suspended AND last input < 300 s). */
export const PRESENCE_STATES = ['active', 'idle-present', 'absent'] as const;
export type Presence = (typeof PRESENCE_STATES)[number];
export const PresenceSchema = z.enum(PRESENCE_STATES);

/** What the body is doing at the coarse level; drives the idle pool's `presentation` condition. */
export const PRESENTATION_MODES = ['awake', 'nap', 'sleep'] as const;
export type PresentationMode = (typeof PRESENTATION_MODES)[number];
export const PresentationModeSchema = z.enum(PRESENTATION_MODES);

/** The five arbitration lanes (R3-3). `locomotion` and `speech` are MAIN-owned. */
export const LANES = ['body', 'expression', 'gaze', 'locomotion', 'speech'] as const;
export type Lane = (typeof LANES)[number];
export const LaneSchema = z.enum(LANES);

/** Who issued a lane command (R3-3 envelope). */
export const LANE_SOURCES = ['touch', 'llm', 'behaviour', 'drag', 'sim', 'idle'] as const;
export type LaneSource = (typeof LANE_SOURCES)[number];
export const LaneSourceSchema = z.enum(LANE_SOURCES);

/** Terminal results for every lane command (rulings v2 ownership table). */
export const LANE_RESULTS = ['completed', 'expired', 'preempted', 'cancelled', 'renderer_lost'] as const;
export type LaneResult = (typeof LANE_RESULTS)[number];
export const LaneResultSchema = z.enum(LANE_RESULTS);

/** The semantic touch parts (D6: head / face / body / one ticklish zone). */
export const HIT_PARTS = ['head', 'face', 'hair', 'body', 'arm', 'ticklish'] as const;
export type HitPart = (typeof HIT_PARTS)[number];
export const HitPartSchema = z.enum(HIT_PARTS);

/** Symbolic gaze targets the LLM may name (D14 `look`). Never free coordinates from the model. */
export const LOOK_ANCHORS = ['cursor', 'user', 'away', 'up', 'down', 'left', 'right', 'screen'] as const;
export type LookAnchor = (typeof LOOK_ANCHORS)[number];
export const LookAnchorSchema = z.enum(LOOK_ANCHORS);

/** Symbolic locomotion anchors (D14 `walkTo`). Convai's `objects[].name` model: never coordinates. */
export const WALK_ANCHORS = ['left', 'right', 'center', 'corner-bl', 'corner-br', 'home'] as const;
export type WalkAnchor = (typeof WALK_ANCHORS)[number];
export const WalkAnchorSchema = z.enum(WALK_ANCHORS);

/** Conversation mode (R3-12). Product state in kv, never model behaviour. */
export const PERSONA_MODES_IPC = ['character', 'plain'] as const;
export type PersonaModeIpc = (typeof PERSONA_MODES_IPC)[number];
export const PersonaModeIpcSchema = z.enum(PERSONA_MODES_IPC);

/** Longest `say` the LLM may put in one sentence, in grapheme clusters (D14 `say` bound). */
export const SAY_MAX_GRAPHEMES = 120;

/** Longest a lane lease may be requested for, ms. The owner clamps every ttlMs into this. */
export const LANE_TTL_MAX_MS = 90_000;
```

`PERSONA_MODES` already exists in `@ds/brain` (`persona.ts`) with the identical member list.
`PERSONA_MODES_IPC` is a **separate binding in `@ds/protocol`** rather than an import, because
`@ds/protocol` must not depend on `@ds/brain` (§1.2). `packages/brain/src/mode.ts` (§9.1) carries
one identity test — `expect([...PERSONA_MODES]).toEqual([...PERSONA_MODES_IPC])` — so the two lists
cannot drift.

### 2.2 New channel names

```ts
export const Channels = {
  // ... every Phase 1 and Phase 2 row unchanged ...

  // ---- Phase 3: main -> pet / bubble / chat ----
  simState: 'sim:state',
  simEvent: 'sim:event',
  simWindowMotion: 'sim:windowMotion',
  simLanding: 'sim:landing',
  proactiveTurn: 'proactive:turn',
  proactiveGate: 'proactive:gate',
  modeChanged: 'mode:changed',
  // ---- Phase 3: pet renderer -> main ----
  arbGrab: 'arb:grab',
  arbRelease: 'arb:release',
  arbTouch: 'arb:touch',
  arbPassthrough: 'arb:passthrough',
  arbTrace: 'arb:trace',
} as const;
```

### 2.3 Channel table — Phase 3 send channels

| Channel | Key | Dir | Producer | Consumers | Allow-lists it joins |
|---|---|---|---|---|---|
| `sim:state` | `simState` | M→P, M→B | M (`SimService`, on every change of the broadcast subset, coalesced to ≤ 2 Hz) | P (conditions, liveliness, phase), B (night styling, mode plate) | `MAIN_TO_PET`, `MAIN_TO_BUBBLE` |
| `sim:event` | `simEvent` | M→P | M (`SimService`) | P (one-shot reactions) | `MAIN_TO_PET` |
| `sim:windowMotion` | `simWindowMotion` | M→P | M (`WindowMotionController`, **30 Hz while a motion episode is live, 0 Hz otherwise**) | P (lean / squash / gait interpolation at RAF) | `MAIN_TO_PET` |
| `sim:landing` | `simLanding` | M→P | M (`WindowMotionController`, one-shot per landing) | P (squash impulse) | `MAIN_TO_PET` |
| `proactive:turn` | `proactiveTurn` | M→B, M→C | M (`ProactiveController`, sent **immediately before** the proactive turn's `brain:state thinking`) | B (proactive band styling, no composer restore), C (history badge, X5) | `MAIN_TO_BUBBLE`, `MAIN_TO_CHAT` |
| `proactive:gate` | `proactiveGate` | M→C | M (`ProactiveController`, on every gate evaluation and on every 别打扰 change) | C (status line + the D16 trace's cross-check) | `MAIN_TO_CHAT` |
| `mode:changed` | `modeChanged` | M→P, M→B, M→C | M (`ModeStore`) | P (plain mode = neutral visual state), B (plain band), C (mode plate) | `MAIN_TO_PET`, `MAIN_TO_BUBBLE`, `MAIN_TO_CHAT` |
| `arb:grab` | `arbGrab` | P→M | P (`PressTracker` on an opaque pointer-down) | M → `WindowMotionController.grab()` | `PET_TO_MAIN` |
| `arb:release` | `arbRelease` | P→M | P (`PressTracker` on pointer-up / lost button) | M → `WindowMotionController.release()` | `PET_TO_MAIN` |
| `arb:touch` | `arbTouch` | P→M | P (`stage/touch.ts`, one per accepted tap **and** one per annoyance trigger) | M → `SimService.dispatch({type:'TOUCH'})`, trace | `PET_TO_MAIN` |
| `arb:passthrough` | `arbPassthrough` | P→M | P (`stage/hover-ack.ts`, work-mode fade edges only) | M → `setClickThrough(pet, faded)` | `PET_TO_MAIN` |
| `arb:trace` | `arbTrace` | P→M | P (arbiter, every lane decision + every behaviour start) | M → `TraceWriter` (§12.2) | `PET_TO_MAIN` |

**No new invoke channels.** X4's 记住这个 / 忘掉这个 are text commands parsed in main from the
ordinary `user:text` invoke (§8.9); memory export and wipe are **tray items** (§8.9), because the
settings window that would host them is Phase 4 (R3-18). An implementer who adds `memory:*` invoke
channels has widened the surface beyond this contract.

### 2.4 Schemas — exact

> **Amended by A3-1 (R3-35):** `SimSnapshotSchema` below also carries `uiWorkMode: z.boolean()` and
> `uiSfxMuted: z.boolean()` (default `false`, in every broadcast, overlaid by `SimService.setUiFlags`
> from the two kv keys the tray writes — **not** reducer state). Read the Amendments block at the top.

```ts
/** The broadcast subset of SimState. Deliberately NOT the whole reducer state: ledger counters,
 *  rng state and the proactive reservation never cross to a renderer. */
export const SimSnapshotSchema = z.object({
  /** Monotonic ms in MAIN's domain. The renderer never compares it to performance.now(). */
  tsMain: z.number().nonnegative(),
  presence: PresenceSchema,
  presentationMode: PresentationModeSchema,
  phase: ClockPhaseSchema,
  /** R3-8: mood is 2-D. `valence` is what the prompt's moodPhrase() reads. */
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  energy: z.number().min(0).max(100),
  /** The DISPLAY value (dual-path milestone floor applied, §3.6.3), not the raw ledger. */
  affection: z.number().min(0).max(100),
  liveliness: z.number().min(LIVELINESS_MIN).max(LIVELINESS_MAX),
  /** Seconds since the last OS input, clamped to 3600 so it is never a precise absence clock. */
  userIdleS: z.number().min(0).max(3600),
  probableTyping: z.boolean(),
  /** Cursor is within CURSOR_NEAR_DIP of the pet window rect (§3.3). */
  cursorNear: z.boolean(),
  onFloor: z.boolean(),
  nearEdge: z.boolean(),
  dnd: z.boolean(),
  battery: z.object({ charging: z.boolean(), level: z.number().min(0).max(1).nullable() }),
  mode: PersonaModeIpcSchema,
  /** Local calendar day, 'YYYY-MM-DD'. The renderer uses it only to reset per-day one-shots. */
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SimSnapshot = z.infer<typeof SimSnapshotSchema>;

/** One-shot sim events the renderer must react to but that a snapshot cannot express. */
export const SIM_EVENT_KINDS = [
  'returned',        // D5: input resumed after >= NAP_IDLE_MS. Payload: awayMs.
  'phaseChanged',    // D4: morning/day/evening/night boundary crossed.
  'mealCue',         // D4: one of the three meal windows opened (jittered, once per day).
  'annoyed',         // D6: >= TAP_BURST_COUNT taps in TAP_BURST_WINDOW_MS.
  'typingGlance',    // D11/A22 SOFT reaction (R3-9/R3-17): glance at the screen, no expression.
  'cheer',           // D11: long typing streak ended.
  'batteryLow',      // D11: crossed below BATTERY_LOW_LEVEL while discharging.
  'onCharger',       // D11: charging edge.
  'cursorWiggle',    // D11: "wiggle near her -> curiosity" (see the predicate in §10.4).
  'wake',            // presentationMode left 'nap'/'sleep'.
] as const;
export type SimEventKind = (typeof SIM_EVENT_KINDS)[number];
export const SimEventKindSchema = z.enum(SIM_EVENT_KINDS);

export const SimEventSchema = z.object({
  kind: SimEventKindSchema,
  tsMain: z.number().nonnegative(),
  /** Present only for `returned`: how long the user was away, ms, clamped to 7 days. */
  awayMs: z.number().min(0).max(604_800_000).optional(),
  /** Present only for `phaseChanged`. */
  phase: ClockPhaseSchema.optional(),
  /** Present only for `mealCue`. */
  meal: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
});
export type SimEventPayload = z.infer<typeof SimEventSchema>;

/** R3-5. Published at 30 Hz for the duration of a motion episode, never when idle. */
export const WindowMotionSchema = z.object({
  /** Motion-episode generation, monotonically increasing in MAIN. Stale frames are ignored. */
  generation: z.number().int().nonnegative(),
  tsMain: z.number().nonnegative(),
  phase: z.enum(['drag', 'fling', 'walk', 'settling', 'rest']),
  /** Window velocity in DIP/s, already clamped to +/- FLING_VELOCITY_CAP. */
  vx: z.number().finite(),
  vy: z.number().finite(),
  /** Pointer-minus-window lag in DIP, already clamped to +/- DRAG_MAX_LAG_DIP. Drives the lean. */
  lagX: z.number().finite(),
  lagY: z.number().finite(),
  /** Model-local contact point from the press pick, normalised to [-1,1] on both axes. */
  contact: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).nullable(),
});
export type WindowMotion = z.infer<typeof WindowMotionSchema>;

/** R3-5. Generation-stamped so a stale landing cannot squash a newer drag. */
export const LandingSchema = z.object({
  generation: z.number().int().nonnegative(),
  tsMain: z.number().nonnegative(),
  /** Impact speed in DIP/s at contact. The bound IS `FLING_VELOCITY_CAP` (§7.5); the literal is
   *  written out because `@ds/protocol` must not import from `apps/desktop` — `lane-metrics.test.ts`
   *  asserts `FLING_VELOCITY_CAP === 2400` so the two can never drift apart silently. */
  impulse: z.number().min(0).max(2400),
  edge: z.enum(['floor', 'left', 'right', 'ceiling']),
});
export type Landing = z.infer<typeof LandingSchema>;

/** R3-7. Sent immediately BEFORE the proactive turn's `brain:state thinking`. */
export const PROACTIVE_BUCKETS = ['greeting', 'night', 'meal', 'longGap', 'callback', 'world'] as const;
export type ProactiveBucket = (typeof PROACTIVE_BUCKETS)[number];
export const ProactiveBucketSchema = z.enum(PROACTIVE_BUCKETS);

export const ProactiveTurnSchema = z.object({
  turnId: z.string().min(1),
  reservationId: z.string().min(1),
  templateId: z.string().min(1),
  bucket: ProactiveBucketSchema,
});

/** R3-7. Every gate evaluation, plus every 别打扰 change. Consumed by the chat status line. */
export const PROACTIVE_VERDICTS = [
  'eligible', 'rateLimited', 'unansweredCap', 'personaCap', 'suppressed', 'deferred',
  'discarded', 'displayed', 'muted',
] as const;
export type ProactiveVerdict = (typeof PROACTIVE_VERDICTS)[number];
export const ProactiveVerdictSchema = z.enum(PROACTIVE_VERDICTS);

export const ProactiveGateSchema = z.object({
  verdict: ProactiveVerdictSchema,
  /** The FIRST failing layer's reason, or '' when eligible. One of §3.10.1's reason codes. */
  reason: z.string().max(64),
  displayedToday: z.number().int().min(0),
  unansweredToday: z.number().int().min(0),
  /** Epoch ms when layers 1+2 will next allow a line, or null when muted/never. */
  nextEligibleAt: z.number().int().nonnegative().nullable(),
  /** 别打扰 state: null = off, otherwise the epoch ms it expires (8.64e15 = 'off forever'). */
  mutedUntil: z.number().int().nonnegative().nullable(),
});

/** R3-12. */
export const ModeChangedSchema = z.object({
  mode: PersonaModeIpcSchema,
  reason: z.enum(['command', 'restored', 'tray']),
});

/** R3-5 + R3-6. The renderer's press pick, in MODEL-local normalised coordinates. */
export const ArbGrabSchema = z.object({
  pressId: z.number().int().nonnegative(),
  part: HitPartSchema,
  /** Model-local contact anchor, [-1,1] on both axes; main keeps the native pointer offset. */
  modelX: z.number().min(-1).max(1),
  modelY: z.number().min(-1).max(1),
  /** Global cursor at press, DIP. Main re-reads the global cursor from here on. */
  screenX: z.number().finite(),
  screenY: z.number().finite(),
});

export const ArbReleaseSchema = z.object({
  pressId: z.number().int().nonnegative(),
  /** True when the press never exceeded TAP_SLOP_DIP - main then does NOT start a fling. */
  wasTap: z.boolean(),
});

/** R3-6/D6. Carries the OPAQUE-PIXEL semantic part; `avatar:tap` keeps its Phase 1 meaning (§2.9). */
export const ArbTouchSchema = z.object({
  pressId: z.number().int().nonnegative(),
  part: HitPartSchema,
  /** Final composited alpha at the press point, 0..255, from the 1-px GPU read (R3-6b). */
  alpha: z.number().int().min(0).max(255),
  /** Taps inside the trailing TAP_BURST_WINDOW_MS, including this one. */
  burst: z.number().int().min(1),
  /** True when this event crossed TAP_BURST_COUNT and armed the annoyance cooldown. */
  annoyed: z.boolean(),
});

/** Bar §0 hover semantics: work-mode fade is opt-in and needs main to flip native pass-through. */
export const ArbPassthroughSchema = z.object({ faded: z.boolean() });

/** R3-15. One trace record per arbitration decision. NEVER carries user text, titles or keys. */
export const ArbTraceSchema = z.object({
  /** Renderer monotonic ms (performance.now()). Main stamps wall time when it writes the line. */
  tsRenderer: z.number().nonnegative(),
  /**
   * Exactly the record types the RENDERER produces. `touch` arrives on `arb:touch` and
   * `motion` / `landing` / `presence` / `visibility` / `proactive` / `mode` / `resource` are
   * written by MAIN, so none of them appears here — §12.2's `TraceLine.t` is the union of these
   * eight renderer kinds and those eight main-written ones (16 in total). `dragVisual` is deleted:
   * nothing emitted it and nothing read it.
   */
  kind: z.enum([
    'behaviourStart', 'behaviourEnd', 'laneGrant', 'laneResult', 'gazeBreak', 'blink',
    'hoverAck', 'fps',
  ]),
  lane: LaneSchema.nullable(),
  source: LaneSourceSchema.nullable(),
  generation: z.number().int().nonnegative().nullable(),
  /** Behaviour id for behaviourStart/End; motion or expression key for laneGrant; else ''. */
  id: z.string().max(64),
  result: LaneResultSchema.nullable(),
  /** Selector diagnostics, present only on behaviourStart. */
  eligible: z.array(z.string().max(64)).max(64).optional(),
  weights: z.array(z.number()).max(64).optional(),
  seed: z.number().int().optional(),
  /** Primary numeric slot: `fps` for fps, degrees for gazeBreak, `alpha` for a hover pick. */
  value: z.number().finite().nullable(),
  /** Secondary numeric slot: `frameMs` for fps. Absent elsewhere. */
  value2: z.number().finite().optional(),
  /** Boolean slot: `doublet` for blink. Absent elsewhere. */
  flag: z.boolean().optional(),
  /** behaviourStart only: the drawn duration and the bag size at the moment of the draw. */
  durationMs: z.number().int().nonnegative().optional(),
  bagSize: z.number().int().nonnegative().optional(),
  /** laneGrant only: the requested lease lifetime. */
  ttlMs: z.number().int().nonnegative().optional(),
  /** gazeBreak: the break type; hoverAck: the new state. Both are short enums, carried as text. */
  label: z.string().max(24).optional(),
});
```

Every §12.2 payload therefore has a home: `behaviourStart` → `id, durationMs, eligible, weights,
seed, bagSize`; `behaviourEnd` → `id, result`; `laneGrant` → `lane, source, generation, id, ttlMs`;
`laneResult` → `lane, source, generation, result`; `gazeBreak` → `label, value` (degrees);
`blink` → `flag` (doublet); `hoverAck` → `label` (state); `fps` → `value` (fps) + `value2` (frameMs).
A field that has no meaning for a given `kind` is **omitted**, never sent as `null`, and
`trace.test.ts` asserts that per-kind shape.

```ts
```

`Schemas` gains one row per channel, keeping its `satisfies Record<Channel, z.ZodTypeAny>` shape:

```ts
  [Channels.simState]: SimSnapshotSchema,
  [Channels.simEvent]: SimEventSchema,
  [Channels.simWindowMotion]: WindowMotionSchema,
  [Channels.simLanding]: LandingSchema,
  [Channels.proactiveTurn]: ProactiveTurnSchema,
  [Channels.proactiveGate]: ProactiveGateSchema,
  [Channels.modeChanged]: ModeChangedSchema,
  [Channels.arbGrab]: ArbGrabSchema,
  [Channels.arbRelease]: ArbReleaseSchema,
  [Channels.arbTouch]: ArbTouchSchema,
  [Channels.arbPassthrough]: ArbPassthroughSchema,
  [Channels.arbTrace]: ArbTraceSchema,
```

### 2.5 Allow-list rows added (Phase 2 §2.5 lists, appended in place)

```ts
export const PET_TO_MAIN: readonly Channel[] = [
  // ... Phase 1/2 rows unchanged ...
  Channels.arbGrab, Channels.arbRelease, Channels.arbTouch,
  Channels.arbPassthrough, Channels.arbTrace,
];
export const MAIN_TO_PET: readonly Channel[] = [
  // ... Phase 1/2 rows unchanged ...
  Channels.simState, Channels.simEvent, Channels.simWindowMotion, Channels.simLanding,
  Channels.modeChanged,
];
export const MAIN_TO_BUBBLE: readonly Channel[] = [
  // ... Phase 2 rows unchanged ...
  Channels.simState, Channels.proactiveTurn, Channels.modeChanged,
];
export const MAIN_TO_CHAT: readonly Channel[] = [
  // ... Phase 2 rows unchanged ...
  Channels.proactiveTurn, Channels.proactiveGate, Channels.modeChanged,
];
```

`BUBBLE_TO_MAIN`, `CHAT_TO_MAIN`, `KEY_TO_MAIN`, `MAIN_TO_KEY`, `CHAT_INVOKE`, `KEY_INVOKE`,
`PET_INVOKE` and `BUBBLE_INVOKE` are **unchanged**. `PET_INVOKE` and `BUBBLE_INVOKE` stay empty
(D14), and `packages/protocol/src/channels.test.ts` keeps asserting it.

Main-side registration (Phase 2 §2.7 helpers, no new helper needed):

| Handler | Registration |
|---|---|
| `arb:grab`, `arb:release`, `arb:touch`, `arb:passthrough`, `arb:trace` | `onFromPet(pet, ...)` |
| every `sim:*`, `mode:changed`, `proactive:*` send | `sendTo(win, ...)` |

### 2.6 The ACT vocabulary extension (D14: `emotion, motion, say, look, walkTo`)

Phase 2 ships `<|ACT emotion=... motion=...|>` and `<|PAUSE n|>`. Phase 3 adds **two attributes** to
the same tag. **This is a real change to `packages/brain/src/tags.ts` and `types.ts`, not an
additive one** — the preflight caught the contract claiming otherwise, and the claim was false:

| What | On `main` @ `f3185a3` | Phase 3 |
|---|---|---|
| `ACT_ATTR` | `/^(emotion\|motion)=([\w-]+)$/` (`tags.ts:7`) | `/^(emotion\|motion\|look\|walkTo)=([\w.,-]+)$/` — `look=-0.75,-0.50` needs `.` and `,`, which `[\w-]` does not match |
| unknown attribute | **the whole tag is rejected**: `parseTag` returns `null` (`tags.ts:24`), the candidate becomes a `badtag` and is dropped silently (`tags.ts:70`, `stream-parser.ts:22-34`) | **per-attribute drop**: an unrecognised or unparseable attribute is skipped and counted as a compliance miss; the ACT still yields its `emotion` and the sentence is still emitted. Only a missing/invalid `emotion` still rejects the tag |
| `MAX_TAG` | `64` (`tags.ts:4`) | **`96`**. Worst case, computed: `<\|`(2) + `ACT`(3) + ` emotion=surprised`(18) + ` motion=` + a 24-char motion key(32) + ` look=-0.75,-0.50`(17) + ` walkTo=corner-br`(17) + `\|>`(2) = **91**; 96 leaves five characters of headroom and still keeps a runaway `<\|` from buffering |
| `Tag` (`types.ts:5-7`) | `{kind:'act'; emotion; motion?}` \| `{kind:'pause'; seconds}` | the `act` arm gains `look?: LookTarget` and `walkTo?: WalkAnchor` |
| duplicate-attribute rejection | whole tag rejected | **unchanged** — a duplicate is still a hard reject, because it signals a malformed generation rather than an unknown vocabulary |
| `<\|PAUSE n\|>` clamp | `Math.min(Number(n), PAUSE_MAX_S)` (`tags.ts:12`) | **unchanged** |

The "unknown → drop, logged" *discipline* is what survives; its *implementation* moves from
whole-tag rejection to per-attribute rejection, and `tags.test.ts` gains the four cases that pin it
(`look` unknown, `walkTo` unknown, both unknown, and a 95-character tag).

```
<|ACT emotion=happy motion=nod look=cursor|>你回来啦！<|ACT emotion=curious walkTo=left|>过来一下。
```

- `look` is a member of `LOOK_ANCHORS`, **or** the literal form `look=x,y` with up to two decimals in
  `[-1,1]` matching
  `/^-?(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?),-?(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/`.
  Unknown → the attribute is dropped and a `look` compliance miss is logged; the sentence is still
  emitted.
- `walkTo` is a member of `WALK_ANCHORS` **only**. Free coordinates are never accepted (Convai's
  `objects[].name` model, research §8). Unknown → dropped + logged.
- `say` is the prose itself. Bound: after `sanitizeForDisplay`, a sentence longer than
  `SAY_MAX_GRAPHEMES` (120, counted with `Intl.Segmenter`) is **truncated at the last sentence
  terminator inside the bound**, or hard-cut at 120 graphemes if there is none, and a `say-length`
  compliance miss is logged. It is never dropped — a truncated line beats a silent turn.
- `<|PAUSE n|>` keeps its Phase 2 bound `PAUSE_MAX_S`.

`packages/brain/src/act.ts` (CREATE, owner T3-B) owns the two new attributes:

```ts
import { LookAnchorSchema, WalkAnchorSchema, SAY_MAX_GRAPHEMES,
         type LookAnchor, type WalkAnchor } from '@ds/protocol';

export type LookTarget = { kind: 'anchor'; anchor: LookAnchor } | { kind: 'point'; x: number; y: number };

/** Parses the `look=` attribute value. Returns null for anything unrecognised (caller logs). */
export function parseLook(raw: string): LookTarget | null;
/** Parses the `walkTo=` attribute value. Symbolic anchors only. */
export function parseWalkTo(raw: string): WalkAnchor | null;
/** The §2.6 `say` bound, applied AFTER sanitizeForDisplay. */
export function boundSay(text: string): { text: string; truncated: boolean };

export const ACT_ATTRS = ['emotion', 'motion', 'look', 'walkTo'] as const;
```

`SentenceEventSchema` in `@ds/protocol` gains **two optional fields and nothing else** (additive, so
every Phase 2 producer and consumer keeps compiling):

```ts
export const LookTargetSchema = z.union([
  z.object({ kind: z.literal('anchor'), anchor: LookAnchorSchema }),
  z.object({ kind: z.literal('point'), x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
]);

export const SentenceEventSchema = z.object({
  turnId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  text: z.string(),
  emotion: EmotionSchema,
  motion: z.string().optional(),
  pause: z.number().nonnegative().max(PAUSE_MAX_S).optional(),   // UNCHANGED from Phase 2
  look: LookTargetSchema.optional(),         // Phase 3 (D14)
  walkTo: WalkAnchorSchema.optional(),       // Phase 3 (D14)
});
```

**Who consumes which attribute, pinned** (rulings v2 ownership table: locomotion is MAIN's lane):

| Attribute | Consumer | Notes |
|---|---|---|
| `emotion` | pet renderer, expression lane | R3-4 lease, §5.4 |
| `motion` | pet renderer, body lane | §5.4 |
| `look` | pet renderer, gaze lane | §5.6 LLM look lease |
| `walkTo` | **main**, `WindowMotionController` | §7.6. The pet renderer receives the field on `brain:sentence` and **ignores it**; main reads it off the `sentence` event inside `BrainService` before the relay. |
| `say` | bubble renderer | Phase 2 reveal, unchanged |

### 2.7 `proactive:*` producer rules

- `proactive:turn` is sent **exactly once per displayed proactive line**, to `bubble` and `chat`,
  synchronously **before** `TurnRunner.send(text, 'proactive')` is called. A bubble that receives
  `brain:state thinking` for a `turnId` it has no `proactive:turn` for renders the ordinary band;
  the ordering above makes that impossible for real proactive turns.
- `proactive:gate` is sent on every `shouldSpeak()` evaluation (at most once per
  `PROACTIVE_EVAL_INTERVAL_MS`, §3.10.2) and on every 别打扰 change. It is **the only** proactive
  telemetry that reaches a renderer; the ledger itself never leaves main.

### 2.8 `mode:*` producer rules

`mode:changed` is sent on: app start (`reason: 'restored'`, after kv is read), a recognised command
(`reason: 'command'`, §9.1), and the tray toggle (`reason: 'tray'`). It is sent to **pet, bubble and
chat** in that order, before the intercepted command's acknowledgement line is spoken.

### 2.9 Retired Phase 2 producers (channels kept, senders removed)

R3-5 gives main the whole locomotion lane, so the Phase 1 delta-drag path is replaced. Following the
precedent Phase 2 §5.6 set for `stage:setFps` — *the channel, its schema and its allow-list
membership stay; only the dead end of the wire goes*:

| Channel | Phase 3 state |
|---|---|
| `avatar:drag` | **No sender.** `PressTracker.onDragMove` is rewired to `arb:grab` + main's motor (§7.2). The channel, `Schemas` row and `PET_TO_MAIN` membership are untouched. `main/index.ts`'s `onFromPet(petWin, Channels.avatarDrag, ...)` handler is **deleted** (its `moveBy` + `service.reposition()` work moves into `WindowMotionController`, §7.7). |
| `avatar:dragEnd` | **No sender.** Its two effects — `savePetPosition` and `service.reposition()` — move into the motor's settle path (§7.7). Handler deleted. |
| `avatar:tap` | **Kept, unchanged, still sent.** It is the Phase 1 hit-**area** name and the anchor of `apps/desktop/tests/stage.spec.ts`'s existing assertions. Phase 3's sim consumes `arb:touch` (the opaque-pixel semantic part) and **not** `avatar:tap`; main's current `console.log` handler stays as-is. Both fire for one gesture, in the order `avatar:tap` then `arb:touch`. |
| `gaze:cursor` | **Kept, unchanged.** `main/cursor.ts` keeps polling at 30 Hz; §5.6 adds cursor-rest and saccades **on top of** the same stream. |

A test in `packages/protocol/src/channels.test.ts` asserts `PET_TO_MAIN` still contains
`avatarDrag`/`avatarDragEnd` (so the retirement is a wiring change, not a protocol break), and a
test in `apps/desktop/src/main/index.test.ts` asserts no `onFromPet` registration exists for either.

---

## §3 `packages/sim` — the reducer

R3-1: *"Sim in main as a pure reducer; events dispatch immediately, the 2-Hz tick only integrates."*
`packages/sim` contains **no** timers, no `Date`, no `performance`, no I/O. Every function takes its
clocks as arguments. Two clock domains, never mixed:

- `nowMono: number` — monotonic ms, main's domain. Durations, cooldowns, leases, back-off, deadlines.
- `nowWall: number` — epoch ms. **Only** phases, meal cues, local dates and the `updated_at` values.

### 3.1 `SimState` — exact fields, units, ranges, defaults

```ts
// packages/sim/src/state.ts
import { z } from 'zod';
import {
  ClockPhaseSchema, PresenceSchema, PresentationModeSchema, PersonaModeIpcSchema,
  LIVELINESS_PRESETS, type ClockPhase, type Presence, type PresentationMode,
} from '@ds/protocol';

export const SimStateSchema = z.object({
  // ---- clocks (monotonic ms unless stated) -------------------------------------------------
  /** Last `nowMono` the reducer saw. Used only to compute deltas; never persisted raw (§3.12). */
  lastMono: z.number().nonnegative(),
  /** Last `nowWall` the reducer saw, epoch ms. Persisted, so a rollback is detectable (§3.10 and B-03). */
  lastWall: z.number().nonnegative(),
  /** Local calendar day of `lastWall`, 'YYYY-MM-DD'. The only day key anything uses. */
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  // ---- presence (R3-1) -----------------------------------------------------------------------
  /** ms since the last OS input, from GetLastInputInfo. Clamped to 7 days. */
  inputAgeMs: z.number().min(0).max(604_800_000),
  locked: z.boolean(),
  suspended: z.boolean(),
  fullscreen: z.boolean(),
  dnd: z.boolean(),
  /** Tray/hotkey user-hide (Phase 1 `VisibilityFlag 'user'`). Does NOT affect presence. */
  userHidden: z.boolean(),
  presence: PresenceSchema,
  presentationMode: PresentationModeSchema,
  probableTyping: z.boolean(),
  /** Consecutive 2 Hz samples matching the typing predicate (R3-9). */
  typingSamples: z.number().int().min(0),
  /** Consecutive 2 Hz samples NOT matching it, while probableTyping is true. */
  typingIdleSamples: z.number().int().min(0),
  /** Monotonic ms the current typing streak started, or null. */
  typingStreakStartedMono: z.number().nonnegative().nullable(),
  cursorNear: z.boolean(),
  onFloor: z.boolean(),
  nearEdge: z.boolean(),
  /** Accumulated PRESENT time since the last tick that changed anything, ms. Diagnostics only. */
  presentMsToday: z.number().min(0),
  /** Monotonic ms of the last PRESENT->absent transition, or null while present. */
  absentSinceMono: z.number().nonnegative().nullable(),

  // ---- mood (R3-8: 2-D, present-time only) ---------------------------------------------------
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  /** Persona baseline. Read from character.json `sim.moodBase`, defaulted in SIM_DEFAULTS. */
  valenceBase: z.number().min(-1).max(1),
  arousalBase: z.number().min(0).max(1),
  /** The neglect accumulator (R3-8). Separate field so the -0.2 floor is STRUCTURAL. */
  neglect: z.number().min(-0.2).max(0),
  /** PRESENT ms since the last pet interaction (touch, chat turn, answered proactive). */
  sinceInteractionMs: z.number().min(0),

  // ---- energy --------------------------------------------------------------------------------
  /** Present-time expenditure subtracted from the circadian curve, points. */
  expenditure: z.number().min(0).max(40),

  // ---- affection (R3-8: monotonic) -----------------------------------------------------------
  affection: z.number().min(0).max(100),
  /** Points granted during `localDate`. Reset on a local-date change, never carried over. */
  earnedToday: z.number().min(0),
  /** Distinct local dates on which at least one PRESENT tick happened. */
  distinctDaysSeen: z.number().int().min(0),

  // ---- rhythm --------------------------------------------------------------------------------
  phase: ClockPhaseSchema,
  /** localDate strings of the phase/meal one-shots already fired today. */
  firedToday: z.object({
    morningGreeting: z.boolean(),
    nightEntry: z.boolean(),
    breakfast: z.boolean(),
    lunch: z.boolean(),
    dinner: z.boolean(),
  }),
  /** Per-day deterministic meal jitter in ms, derived from hash(localDate) (§3.9). */
  mealJitterMs: z.object({ breakfast: z.number(), lunch: z.number(), dinner: z.number() }),

  // ---- knobs ---------------------------------------------------------------------------------
  liveliness: z.number().min(0).max(1),
  mode: PersonaModeIpcSchema,

  // ---- power ---------------------------------------------------------------------------------
  battery: z.object({ charging: z.boolean(), level: z.number().min(0).max(1).nullable() }),
  batteryLowFired: z.boolean(),

  // ---- proactive gate state (never broadcast) ------------------------------------------------
  gate: z.object({
    /** Monotonic ms of the last DISPLAYED proactive line, or null. */
    lastDisplayedMono: z.number().nonnegative().nullable(),
    displayedToday: z.number().int().min(0),
    unansweredToday: z.number().int().min(0),
    /** Back-off exponent n (R3-7 layer 2). Reset to 0 by any user turn. */
    backoffN: z.number().int().min(0).max(8),
    /** Monotonic ms before which layer 2 refuses, or null. Full-jitter draw (§3.10.3). */
    backoffUntilMono: z.number().nonnegative().nullable(),
    /** The single in-flight INTENT, or null. */
    intent: z.object({
      reservationId: z.string().min(1),
      templateId: z.string().min(1),
      bucket: z.string().min(1),
      reservedMono: z.number().nonnegative(),
      /** Monotonic deadline: reservedMono + PROACTIVE_DEFER_MAX_MS. */
      deferUntilMono: z.number().nonnegative(),
    }).nullable(),
    /** Epoch ms until which 别打扰 is on; null = off; 8.64e15 = off forever. */
    mutedUntilWall: z.number().nonnegative().nullable(),
    /**
     * The last `localDate` whose quota was handed out, 'YYYY-MM-DD'. The local-day rule of §3.10
     * depends on it: a rollback to an EARLIER date resets the counters only if that date string is
     * not this one, so a backwards clock can never hand out a second quota for the same day.
     * Initialised to `localDateString(nowWall)` by `initialSimState`.
     */
    lastCountedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),

  // ---- rng -----------------------------------------------------------------------------------
  /** mulberry32 state. Serialised so a snapshot replays bit-identically (R3-1). */
  rngState: z.number().int().nonnegative(),
});
export type SimState = z.infer<typeof SimStateSchema>;
```

`SIM_DEFAULTS`, the one place every number lives (each is a named constant with a test override):

```ts
export const SIM_DEFAULTS = {
  // presence (R3-1 / D5: ">= 5 min without input -> nap/slack state")
  PRESENT_INPUT_MAX_MS: 300_000,      // 300 s — the PRESENT boundary AND D5's nap threshold
  IDLE_PRESENT_MAX_MS: 1_800_000,     // 30 min — beyond this a present-but-idle user is 'absent'
  NAP_IDLE_MS: 300_000,               // presentationMode -> 'nap'
  SLEEP_PHASE_IDLE_MS: 900_000,       // 15 min of idle DURING the 'night' phase -> 'sleep'
  TICK_MS: 500,                       // R3-1: 2 Hz
  TICK_DELTA_CAP_MS: 2_000,           // R3-1: never one decision per missed tick after sleep
  CURSOR_NEAR_DIP: 160,               // cursorNear predicate, distance from the pet window rect
  NEAR_EDGE_DIP: 64,                  // nearEdge predicate, distance from the work-area edge

  // mood (R3-8)
  MOOD_HALF_LIFE_PRESENT_MS: 3_000_000,   // 50 min of PRESENT time
  RETURN_SETTLE_AFTER_MS: 7_200_000,      // > 2 h absent triggers the one settling step
  RETURN_SETTLE_FRACTION: 0.70,           // only the ADVERSE component moves (R3-8)
  NEGLECT_WINDOW_MS: 2_700_000,           // 45 min PRESENT with zero interaction
  NEGLECT_STEP: -0.05,                    // per window
  NEGLECT_FLOOR: -0.2,                    // hard floor, structural (own field)
  VALENCE_BASE: 0.10,
  AROUSAL_BASE: 0.35,

  // energy
  ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS: 1_500_000,  // 25 min of PRESENT time
  ENERGY_PER_EXCHANGE: 0.5,
  ENERGY_PER_TOUCH: 0.15,
  ENERGY_EXPENDITURE_MAX: 40,

  // affection (R3-8)
  AFFECTION_DAILY_CAP: 12,
  AFFECTION_PER_EXCHANGE: 1.0,
  AFFECTION_PER_TOUCH: 0.5,
  AFFECTION_PER_NEW_DAY: 0.5,

  // rhythm (D4) — configurable; these are the defaults
  PHASE_HOURS: { morning: 6, day: 11, evening: 18, night: 22 },
  MEAL_HOURS: { breakfast: 8.0, lunch: 12.5, dinner: 19.0 },
  MEAL_JITTER_MAX_MS: 1_800_000,          // +/- 30 min, deterministic per local date

  // touch (D6). NOT re-declared: `packages/sim` cannot import from `apps/desktop` (§1.2), so these
  // three are DECLARED in `renderer/shared/lane-metrics.ts` (§5.11/§5.13) and MIRRORED here, with
  // `state.test.ts` importing both and asserting equality. One home, one assertion, no drift.
  TAP_BURST_COUNT: 7,                     // ">= 7 taps in 1 s -> annoyed"
  TAP_BURST_WINDOW_MS: 1_000,
  ANNOY_COOLDOWN_MS: 4_000,               // research 4.x: 3-5 s; 4 s is the shipped value

  // typing (R3-9)
  TYPING_ENTER_SAMPLES: 4,                // 4 consecutive 2 Hz samples = 2 s
  TYPING_EXIT_SAMPLES: 2,
  TYPING_INPUT_AGE_MAX_MS: 1_000,
  TYPING_CURSOR_DELTA_MAX_DIP: 2,
  TYPING_GLANCE_COOLDOWN_MS: 60_000,      // D11 glance, at most one per minute
  TYPING_CHEER_MIN_STREAK_MS: 300_000,    // D11 cheer: >= 5 min streak
  TYPING_CHEER_COOLDOWN_MS: 900_000,      // >= 15 min apart
  TYPING_CHEER_DELAY_MS: 5_000,           // fires on the FALLING edge, 5 s after typing stops

  // power (D11)
  BATTERY_LOW_LEVEL: 0.20,

  // proactive (R3-7 / bar §0)
  PROACTIVE_RATE_WINDOW_MS: 1_200_000,    // "<= 1 / 20 min"
  PROACTIVE_UNANSWERED_CAP: 3,            // "<= 3 unanswered per day"
  PROACTIVE_UNANSWERED_AFTER_MS: 600_000, // R3-7: unanswered = displayed and no input within 10 min
  PROACTIVE_PERSONA_CAP_DEFAULT: 2,       // "persona cap (default 2/day)"
  PROACTIVE_PERSONA_CAP_MAX: 5,           // R3-7: persona may set <= 5
  PROACTIVE_BACKOFF_BASE_MS: 2_400_000,   // R3-7: base 40 min
  PROACTIVE_BACKOFF_CAP_MS: 14_400_000,   // R3-7: cap 4 h
  PROACTIVE_SINCE_INPUT_MIN_MS: 60_000,   // "within 60 s of user input"
  PROACTIVE_DEFER_MAX_MS: 120_000,        // R3-7 layer 5
  PROACTIVE_TYPING_FALLING_EDGE_MS: 5_000,
  PROACTIVE_RESERVATION_STALE_MS: 300_000,// R3-7: a reservation older than 5 min at startup is void
  PROACTIVE_TEMPLATE_NO_REPEAT_MS: 2_592_000_000, // 30 days
  PROACTIVE_EVAL_INTERVAL_MS: 10_000,     // how often SimService asks the pure gate

  // liveliness (R3-13)
  LIVELINESS_DEFAULT: LIVELINESS_PRESETS.default,  // 0.30
} as const;
```

`initialSimState(nowMono, nowWall, opts?)` returns a `SimState` with every field at the default
above, `phase` computed from `nowWall`, `localDate` from `nowWall`, `rngState = opts?.seed ?? 0x9e3779b9`.

### 3.2 The event union — exact

```ts
// packages/sim/src/events.ts
export type SimEvent =
  /** The 2 Hz integrator. `inputAgeMs`, `cursorDeltaDip` and the flags come from the sensors. */
  | { type: 'TICK'; inputAgeMs: number; cursorDeltaDip: number; cursorNear: boolean;
      onFloor: boolean; nearEdge: boolean }
  /** Dispatched the MOMENT input is observed at age 0 — never waits for the next tick (R3-1). */
  | { type: 'USER_INPUT' }
  | { type: 'LOCKED' } | { type: 'UNLOCKED' }
  | { type: 'SUSPEND' } | { type: 'RESUME' }
  | { type: 'FULLSCREEN'; on: boolean }
  | { type: 'DND'; on: boolean }
  | { type: 'USER_HIDDEN'; on: boolean }
  | { type: 'BATTERY'; charging: boolean; level: number | null }
  /** From `arb:touch`. `annoyed` is the renderer's burst verdict; the sim only records it. */
  | { type: 'TOUCH'; part: HitPart; annoyed: boolean }
  | { type: 'CHAT_OPEN'; on: boolean }
  /** One completed user<->assistant exchange. `proactive` marks a turn the pet started. */
  | { type: 'TURN_DONE'; proactive: boolean; interrupted: boolean }
  /** The user sent text. Resets the proactive back-off and the neglect accumulator. */
  | { type: 'TURN_USER' }
  | { type: 'EMOTION'; emotion: Emotion }
  | { type: 'LIVELINESS'; value: number }
  | { type: 'MODE'; mode: PersonaModeIpc }
  /** 别打扰. `untilWall === null` clears it. */
  | { type: 'PROACTIVE_MUTE'; untilWall: number | null }
  /** The gate reserved an intent; the reducer records it so a restart cannot double-fire. */
  | { type: 'PROACTIVE_RESERVE'; reservationId: string; templateId: string; bucket: string }
  /** Terminal outcome of the in-flight intent. */
  | { type: 'PROACTIVE_OUTCOME'; reservationId: string;
      outcome: 'displayed' | 'discarded' | 'suppressed' | 'failed' }
  /** The user replied within PROACTIVE_UNANSWERED_AFTER_MS of a displayed line. */
  | { type: 'PROACTIVE_ANSWERED'; reservationId: string };

export const reduce = (
  state: SimState, event: SimEvent, nowMono: number, nowWall: number,
): SimState => { /* pure */ };
```

`reduce` is **total and pure**: same `(state, event, nowMono, nowWall)` always returns the same next
state, structurally shared where nothing changed (so `SimService` can compare by reference before
broadcasting). It never throws; an out-of-range input is clamped, and clamping is asserted by tests.

`SimEffect` — the reducer also returns the one-shots the adapter must emit, so the adapter never
re-derives them:

```ts
export interface ReduceResult { state: SimState; effects: SimEffect[] }
export type SimEffect =
  | { kind: 'simEvent'; payload: SimEventPayload }        // -> `sim:event` (§2.4)
  | { kind: 'snapshotDirty' }                             // -> broadcast `sim:state`
  | { kind: 'persist' }                                   // -> write the kv snapshot now
  | { kind: 'proactiveEvaluate' };                        // -> ProactiveController.evaluate()
export const reduceWithEffects = (
  state: SimState, event: SimEvent, nowMono: number, nowWall: number,
): ReduceResult => { /* pure */ };
```

`reduce` is `reduceWithEffects(...).state`; both are exported and both are tested.

### 3.3 The tick contract (R3-1)

1. `SimService` calls `dispatch({type:'TICK', ...})` every `TICK_MS = 500` ms from a
   `setInterval`. The reducer computes `rawDelta = nowMono - state.lastMono` and
   `delta = min(rawDelta, TICK_DELTA_CAP_MS)` — **one decision per tick, never one per missed tick**.
   A negative `rawDelta` (impossible for a monotonic clock, but a defensive case the tests cover) is
   treated as `0`.
2. `presentDelta = PRESENT ? delta : 0`, where
   `PRESENT := !locked && !suspended && inputAgeMs < PRESENT_INPUT_MAX_MS`. **Visibility of the pet
   does not affect presence** (R3-1) — a user-hidden or fullscreen-covered pet still counts the user
   as present.
3. Integration order inside a `TICK`, fixed so the tests are deterministic:
   `presence → phase/localDate → mood (presentDelta) → energy (nowWall + presentDelta) →
   neglect → typing → one-shots (meal/greeting/battery/return) → gate bookkeeping`.
4. **Affection is never touched by a `TICK`**, except the `+AFFECTION_PER_NEW_DAY` grant on the
   first PRESENT tick of a new `localDate` — which is a *grant*, and goes through `grantAffection`
   (§3.6) like every other one. There is no other write path from a tick.
5. Presence transitions:

   | From | To | Trigger | Effects |
   |---|---|---|---|
   | any | `absent` | `locked`, `suspended`, or `inputAgeMs >= IDLE_PRESENT_MAX_MS` | snapshot mood (freeze), set `absentSinceMono` |
   | `active` | `idle-present` | `inputAgeMs >= PRESENT_INPUT_MAX_MS` and still present | `presentationMode = 'nap'`; effect `simEvent{kind:'wake'}` is **not** emitted |
   | `idle-present`/`absent` | `active` | `USER_INPUT`, `UNLOCKED`, `RESUME`, or a tick with `inputAgeMs < PRESENT_INPUT_MAX_MS` | `presentationMode='awake'`; if the previous state was not `active`, effect `simEvent{kind:'returned', awayMs}`; if `awayMs > RETURN_SETTLE_AFTER_MS`, apply the one settling step (§3.7.3) |

   **D5's "on return, visibly notices the user within 1 s"** is met structurally: `USER_INPUT` is
   dispatched by the sensor the moment `GetLastInputInfo` reports age 0 (≤ 500 ms at the 2 Hz poll),
   the reducer emits `returned` synchronously, and `SimService` sends `sim:event` in the same tick —
   no 60-s consolidation, no waiting for the next tick. Boundary test B-01 (§12.7) pins 299.9 s vs
   300.0 s and the < 1 s return.

### 3.4 The liveliness mapping — the ONE monotonic table (R3-13)

D12: *"Personality knob: one '活泼度' slider (quiet cat in the corner → playful), **default quiet**."*

```ts
// packages/sim/src/liveliness.ts — the single mapping. No other module may scale by L.
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface LivelinessMap {
  /** Target interval between consecutive behaviour STARTS, ms. Jittered +/-25 % by the selector. */
  idleGapMs: number;
  /** Multiplier on the weight of behaviours tagged `big` in behaviors.json. */
  highEnergyWeight: number;
  /** Mean interval between gaze breaks, ms (D3 clamps the DRAW to [8000, 20000]). */
  saccadeIntervalMs: number;
  /** Multiplier on saccade amplitude (D3's 15-35 deg base range). */
  saccadeAmplitude: number;
  /** Multiplier on the touch reaction VARIANT intensity. A touch is ALWAYS answered (R3-13). */
  touchVariantIntensity: number;
  /** Probability that an idle decision may pick a behaviour with `locomotion !== null`. */
  locomotionProbability: number;
  /** Multiplier on the proactive eligibility roll. Hard caps stay hard (R3-13). */
  proactiveEligibility: number;
}

export function livelinessMap(L: number): LivelinessMap {
  const t = Math.min(1, Math.max(0, L));
  return {
    idleGapMs:             lerp(20_000, 6_000, t),
    highEnergyWeight:      lerp(0.5, 2.0, t),
    saccadeIntervalMs:     lerp(20_000, 8_000, t),
    saccadeAmplitude:      lerp(0.5, 1.0, t),
    touchVariantIntensity: lerp(0.5, 1.0, t),
    locomotionProbability: lerp(0, 0.25, t),
    proactiveEligibility:  lerp(0.5, 1.0, t),
  };
}
```

Values at the three presets, pinned as a test table:

| L | preset | `idleGapMs` | `highEnergyWeight` | `saccadeIntervalMs` | `saccadeAmplitude` | `touchVariantIntensity` | `locomotionProbability` | `proactiveEligibility` |
|---|---|---|---|---|---|---|---|---|
| 0.00 | — | 20 000 | 0.50 | 20 000 | 0.50 | 0.50 | 0.000 | 0.500 |
| 0.15 | 安静 | 17 900 | 0.725 | 18 200 | 0.575 | 0.575 | 0.0375 | 0.575 |
| **0.30** | **默认** | **15 800** | **0.95** | **16 400** | **0.65** | **0.65** | **0.075** | **0.65** |
| 0.70 | 活泼 | 10 200 | 1.55 | 11 600 | 0.85 | 0.85 | 0.175 | 0.85 |
| 1.00 | — | 6 000 | 2.00 | 8 000 | 1.00 | 1.00 | 0.250 | 1.000 |

Two monotonicity tests are required (`liveliness.test.ts`): over `L ∈ {0, 0.01, …, 1.00}`,
`idleGapMs` and `saccadeIntervalMs` are **non-increasing** and every other field is
**non-decreasing**. R3-13's closing sentence is also a test: `livelinessMap` is imported by
`packages/behaviors` and the renderer arbiter and by **nothing** in `affection.ts`, `mood.ts`,
`energy.ts`, `proactive.ts`'s hard caps, or `packages/memory` — asserted by a grep test.

`idleGapMs` at L = 0.30 is 15 800 ms, which alone yields 3.8 behaviour starts per 60 s. The D16
density guard (§4.6) clamps the decision interval to `DENSITY_MAX_PERIOD_MS = 14_000` whenever
`L >= 0.30`, giving ≥ 4.28 starts per 60 s. R3-2's *"the guard is a MINIMUM density and applies only
at liveliness >= 0.3"* is exactly that clamp.

### 3.5 The knob: storage, tray, and the one write path

- Persisted in kv under `sim_liveliness` as a decimal string (§8.1 lists every Phase 3 kv key).
- Read at startup into `SimState.liveliness`; changed **only** by `{type:'LIVELINESS', value}`.
- Tray submenu (Phase 3's only UI for it — R3-18 keeps the settings window in Phase 4):
  `活泼度 ▸ 安静 / 默认 / 活泼`, radio-checked, values `LIVELINESS_PRESETS`. `main/tray.ts`'s
  **The whole tray change, in one place** — the preflight was right that naming two of the actions
  understated it. On `main` the menu is `显示/隐藏 · 打开对话 · 设置 API Key · 调试面板 · ─ · 退出`
  (`apps/desktop/src/main/tray.ts:49-58`) and `createTray(actions: {toggleVisible, toggleDebug,
  openChat, openKey, quit})` (`tray.ts:29-35`). Phase 3 extends it to:

  ```ts
  export function createTray(actions: {
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
  }): Tray;
  ```

  That is **twelve** new members across six submenus, and every one of them must appear in
  `tray.test.ts`'s shared `actions` literal or `tsc -p tsconfig.json` fails — a breaking signature
  change, exactly as Phase 2 §6.6 handled `openChat`/`openKey`. The menu order is fixed:
  `显示/隐藏 · 打开对话 · ─ · 活泼度 ▸ · 别打扰 ▸ · 普通模式 · 工作模式 · 静音 · ─ · 记忆 ▸ · 设置 API Key · 调试面板 · ─ · 退出`.
- A value outside `[0, 1]` is clamped by the reducer, and the clamp is tested.

### 3.6 Affection — monotonic by construction (R3-8)

Bar §0: *"**State changes only while the user is present. Absence is never penalized.**"*
R3-8: *"the reducer has **no branch that can decrement affection**."*

#### 3.6.1 The only write path

```ts
// packages/sim/src/affection.ts
/** The ONLY function that writes `affection`. `amount` MUST be > 0; a non-positive amount throws
 *  in dev and is ignored in production, so "absence is never penalised" is a type-level property. */
export function grantAffection(
  state: SimState, amount: number,
): Pick<SimState, 'affection' | 'earnedToday'> {
  if (!(amount > 0)) return { affection: state.affection, earnedToday: state.earnedToday };
  const room = Math.max(0, SIM_DEFAULTS.AFFECTION_DAILY_CAP - state.earnedToday);
  const granted = Math.min(amount, room);
  return {
    affection: Math.min(100, state.affection + granted),
    earnedToday: state.earnedToday + granted,
  };
}
```

`affection.test.ts` asserts the structural claim directly:

```ts
it('has no branch that can decrement affection', () => {
  const src = readFileSync(new URL('./affection.ts', import.meta.url), 'utf8');
  expect(src).not.toMatch(/affection\s*[-]=|affection\s*-\s*[A-Za-z0-9_.]/);
});
it('never decreases affection across a 10 000-event fuzz of every SimEvent', () => { /* … */ });
```

#### 3.6.2 Grants

| Event | Amount | Notes |
|---|---|---|
| `TURN_DONE {proactive:false, interrupted:false}` | `AFFECTION_PER_EXCHANGE` = 1.0 | one per completed exchange |
| `TOUCH` | `AFFECTION_PER_TOUCH` = 0.5 | **not** granted when `annoyed === true` (an annoying burst earns nothing; it still never subtracts) |
| first PRESENT tick of a new `localDate` | `AFFECTION_PER_NEW_DAY` = 0.5 | also `distinctDaysSeen++` |
| `PROACTIVE_ANSWERED` | `AFFECTION_PER_EXCHANGE` = 1.0 | the exchange it belongs to also grants, so answering a proactive line is worth 2.0 |

`earnedToday` resets to 0 when `localDate` changes; `AFFECTION_DAILY_CAP = 12`.

#### 3.6.3 Dual-path milestones, and what the prompt sees

R3-8: *"milestones by cumulative affection OR distinct days seen."* Phase 2's
`AFFECTION_BUCKETS` (`packages/brain/src/persona.ts`) has six buckets with upper bounds
`10 / 30 / 55 / 75 / 90 / ∞`. The day path uses the same six buckets:

```ts
export const AFFECTION_DAY_THRESHOLDS = [0, 2, 7, 20, 45, 90] as const;   // distinct days
export const AFFECTION_BUCKET_FLOORS  = [0, 10, 30, 55, 75, 90] as const; // matching value floors

/** The value the PROMPT sees. Never lower than the raw ledger, so nothing can read as a loss. */
export function affectionShown(state: SimState): number {
  let i = 0;
  while (i + 1 < AFFECTION_DAY_THRESHOLDS.length
         && state.distinctDaysSeen >= AFFECTION_DAY_THRESHOLDS[i + 1]) i++;
  return Math.max(state.affection, AFFECTION_BUCKET_FLOORS[i]);
}
```

`SimSnapshot.affection` and `StatePreamble.affection` both carry `affectionShown(state)`, so
`affectionPhrase()` in `persona.ts` is untouched and **no Phase 2 interface changes**. A light user
who has been around for 20 days reads as 熟络 even if they never talked much — the dual path R3-8
requires, delivered without a new prompt field.

Bar §0's *"never let the prompt contain a delta"* (research §2) is enforced by the same route: the
preamble carries a phrase from a bucket index, never a number and never a difference.

### 3.7 Mood — 2-D, present-time only (R3-8)

#### 3.7.1 Integration

R3-8's equation, verbatim: `x' = base + (x − base)·exp(−ln2·presentDelta/3000 s)`.

```ts
// packages/sim/src/mood.ts
export function decayToward(x: number, base: number, presentDeltaMs: number, halfLifeMs: number): number {
  if (presentDeltaMs <= 0) return x;
  return base + (x - base) * Math.exp(-Math.LN2 * presentDeltaMs / halfLifeMs);
}
```

Applied per tick with `halfLifeMs = MOOD_HALF_LIFE_PRESENT_MS` (3 000 000 ms = 50 min of PRESENT
time) to both `valence` (toward `valenceBase + neglect`) and `arousal` (toward `arousalBase`).
`presentDelta` is 0 while absent, so **mood is frozen while absent** — no snapshot field is needed,
freezing is the absence of integration.

#### 3.7.2 Event nudges (applied before the tick decay, clamped to the ranges)

| Event | Δvalence | Δarousal |
|---|---|---|
| `EMOTION happy` | +0.05 | +0.04 |
| `EMOTION surprised` | +0.02 | +0.10 |
| `EMOTION curious` | +0.02 | +0.04 |
| `EMOTION think` | 0 | −0.02 |
| `EMOTION question` | 0 | +0.01 |
| `EMOTION neutral` | 0 | 0 |
| `EMOTION awkward` | −0.01 | +0.03 |
| `EMOTION sad` | −0.05 | −0.04 |
| `EMOTION angry` | −0.04 | +0.08 |
| `TOUCH {annoyed:false}` | +0.02 | +0.03 |
| `TOUCH {annoyed:true}` | −0.05 | +0.10 |
| `TURN_DONE {interrupted:true}` | −0.02 | 0 |
| `PROACTIVE_OUTCOME {outcome:'displayed'}` then no answer for 10 min | 0 | −0.03 |

`EMOTION` events come from `BrainService` on every `brain:sentence` (one per sentence, so a
three-sentence reply nudges three times). Both axes clamp: valence to `[-1, 1]`, arousal to `[0, 1]`.

#### 3.7.3 Absence and return

- On the transition to `absent`, nothing is written to mood. It simply stops integrating.
- On the transition back to `active` with `awayMs > RETURN_SETTLE_AFTER_MS` (2 h), **one** settling
  step runs, and R3-8 restricts it to the adverse component:

  ```ts
  // ONLY the adverse component moves. Positive valence is never reduced by absence (R3-8).
  const base = state.valenceBase + state.neglect;
  const valence = state.valence < base
    ? state.valence + (base - state.valence) * SIM_DEFAULTS.RETURN_SETTLE_FRACTION
    : state.valence;                                   // positive valence survives absence intact
  const arousal = state.arousal + (state.arousalBase - state.arousal) * SIM_DEFAULTS.RETURN_SETTLE_FRACTION;
  ```

- `neglect` is **not** touched by the return step. It is reset to 0 by any interaction (§3.7.4).

#### 3.7.4 Neglect (R3-8, and the ONLY downward pressure that exists)

R3-8: *"Neglect := PRESENT for ≥ 45 min with zero pet interaction (no touch, no chat, no proactive
answer) → mood valence drifts −0.05/45 min toward −0.2 max, fully recoverable."*

```
on TICK while PRESENT:
  sinceInteractionMs += presentDelta
  // Bounded by construction: presentDelta <= TICK_DELTA_CAP_MS (2 s) against a 45-min window, so
  // this runs at most once per tick. `fromPersisted` clamps sinceInteractionMs to NEGLECT_WINDOW_MS
  // on restore, so a corrupted snapshot cannot make it spin either (preflight F-5).
  while sinceInteractionMs >= NEGLECT_WINDOW_MS:          // 45 min
    sinceInteractionMs -= NEGLECT_WINDOW_MS
    neglect = max(NEGLECT_FLOOR, neglect + NEGLECT_STEP)  // -0.05 per window, floor -0.2
on TOUCH | TURN_USER | TURN_DONE | PROACTIVE_ANSWERED:
    sinceInteractionMs = 0
    neglect = 0                                            // fully recoverable, immediately
```

`neglect` is a field with a schema range of `[-0.2, 0]`, so the floor cannot be exceeded even by a
bug: the zod parse of a corrupted snapshot fails and §3.12's recovery resets to defaults. Four
consecutive unattended 45-min windows reach the floor; an ordinary work session therefore costs at
most a slightly wistful pet — R3-8's stated intent, expressed as a bounded type.

### 3.8 Energy — circadian world-fact plus present-time expenditure (R3-8)

R3-8: *"Energy = circadian(wallClock) (a world-fact, documented as such) + present-time
expenditure/recovery."* Research decision 3: *"a penalty is state that got worse because of the
user's choice; circadian energy is state that would be identical no matter what they did."*

```ts
// packages/sim/src/energy.ts
/** Piecewise-linear over LOCAL hours, wrapping at 24. These anchors ARE the curve. */
export const CIRCADIAN_ANCHORS: readonly (readonly [hour: number, value: number])[] = [
  [0, 18], [3, 8], [6, 22], [8, 62], [10, 85], [13, 78], [15, 68], [18, 80], [21, 58], [23, 34], [24, 18],
];
/** `hour` is a float local hour in [0, 24). Linear between anchors; exact at every anchor. */
export function circadian(hour: number): number;

/** energy = clamp(circadian(localHour(nowWall)) - expenditure, 0, 100). Recomputable from the
 *  clock alone after any gap — which is what kills the whole class of catch-up bugs. */
export function energyOf(state: SimState, nowWall: number): number;
```

`expenditure` accrues **only while PRESENT** (`+ENERGY_PER_EXCHANGE` per `TURN_DONE`,
`+ENERGY_PER_TOUCH` per `TOUCH`) and decays with `decayToward(expenditure, 0, presentDelta,
ENERGY_EXPENDITURE_HALF_LIFE_PRESENT_MS)`, clamped to `[0, ENERGY_EXPENDITURE_MAX]`.

`energy.test.ts` pins the anchor values, the wrap (`circadian(24) === circadian(0) === 18`), the
midpoint interpolation (`circadian(1.5) === 13`), and — the load-bearing property — that
`energyOf` is a **pure function of `(nowWall, expenditure)`**: two states that differ only in how
long the app was closed produce the same energy.

### 3.9 Clock phases and meal cues (D4)

D4: *"Real-clock rhythms: night state after a configurable hour (yawn, sleepy pose, **no requests
while asleep**), morning greeting, meal-time cues."*

```ts
// packages/sim/src/phases.ts
/** Defaults from SIM_DEFAULTS.PHASE_HOURS; every boundary is configurable through kv `sim_phases`. */
export interface PhaseHours { morning: number; day: number; evening: number; night: number }
export const DEFAULT_PHASE_HOURS: PhaseHours = { morning: 6, day: 11, evening: 18, night: 22 };
/** phaseOf(h, hours): morning [6,11) | day [11,18) | evening [18,22) | night [22,24)+[0,6) */
export function phaseOf(localHour: number, hours?: PhaseHours): ClockPhase;
/** 'YYYY-MM-DD' in LOCAL time. The only day key in the system (R3-7's "local day"). */
export function localDateString(nowWall: number): string;
/** Deterministic per-day jitter in [-MEAL_JITTER_MAX_MS, +MEAL_JITTER_MAX_MS] from FNV-1a(date+meal). */
export function mealJitter(localDate: string, meal: 'breakfast'|'lunch'|'dinner'): number;
/** Epoch ms of the next LOCAL midnight after `nowWall`. Used twice by §3.10.2's gate. */
export function nextLocalMidnight(nowWall: number): number;
/** Local hour as a float in [0, 24), from `nowWall`. The one converter energy and phases share. */
export function localHour(nowWall: number): number;
```

Defaults, all configurable: **morning 06:00–10:59, day 11:00–17:59, evening 18:00–21:59, night
22:00–05:59**; meals **08:00 / 12:30 / 19:00 ± 30 min** (deterministic per local date), each at most
once per day.

Rules, from research §5's DST/rollback warning:

- The bucket is recomputed from `nowWall` **on every tick** and never from elapsed time.
- Every one-shot is keyed by `localDate`, not by an elapsed counter: `firedToday` resets whenever
  `localDate` changes, in either direction. A clock rollback across midnight therefore re-arms the
  day's one-shots exactly once; a forward jump skips the ones whose window has passed. Boundary test
  B-03 (§12.7) pins DST-forward, DST-back and a manual rollback.
- `phaseChanged` and `mealCue` effects fire at most once per `localDate` per marker.
- **D4's "no requests while asleep"** is layer 4 of the proactive gate: `phase === 'night'` **and**
  `presentationMode !== 'awake'` is a suppression reason (§3.10.2).
- A12's three greetings (`first-open-of-day`, `late-night`, `long-gap`) are proactive template
  buckets, not sim effects — §4.8 owns their ids and §13 item 2 tracks the carry.

### 3.10 The proactive gate (R3-7)

Bar §0: *"Layered: global rate **≤ 1 / 20 min** → **≤ 3 unanswered per day** with exponential
back-off → persona cap (**default 2/day**) → suppressed while typing, in fullscreen, locked, DND, or
**within 60 s** of user input. Templates never repeat verbatim **within 30 days**."*
A14: *"every template audited against manipulation tactics (guilt, FOMO, neediness)"* — §4.8.

R3-7's definitions, binding for every counter below:

- **displayed** = the band painted the line (i.e. the bubble sent `playback:sentenceDone` for
  `seq 0` of that turn). Not "generated", not "sent".
- **unanswered** = displayed **and** no user input within `PROACTIVE_UNANSWERED_AFTER_MS` (10 min).
- **local day** = the machine's local calendar day. *A timezone change closes the day early, never
  re-opens it*: `localDate` changing resets the counters, and a rollback to a previous `localDate`
  is treated as a **new** day only if that date string has not already been counted this session —
  tracked by `gate.lastCountedDate`, so a backwards clock can never hand out a fresh quota twice.

#### 3.10.1 The pure gate

```ts
// packages/sim/src/proactive.ts — pure; ProactiveController (main) owns the side effects.
export interface GateInput {
  state: SimState;
  nowMono: number;
  nowWall: number;
  /** From the character card: sim.proactive.maxPerDay, clamped to [0, PROACTIVE_PERSONA_CAP_MAX]. */
  personaCap: number;
  /** True while any TurnRunner turn is not idle, or the chat window is open. */
  turnActive: boolean;
  chatOpen: boolean;
  /** A random draw in [0,1) supplied by the caller so the gate stays pure. */
  roll: number;
}

export type GateVerdict =
  | { verdict: 'eligible' }
  | { verdict: 'rateLimited' | 'unansweredCap' | 'personaCap' | 'suppressed' | 'muted';
      reason: GateReason; nextEligibleAt: number | null };

export const GATE_REASONS = [
  'rate-20min', 'backoff', 'unanswered-3', 'persona-cap', 'muted',
  'typing', 'fullscreen', 'locked', 'suspended', 'dnd', 'user-hidden',
  'recent-input', 'turn-active', 'chat-open', 'asleep', 'plain-mode',
  'sensor-unknown', 'liveliness-roll',
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

export function shouldSpeak(input: GateInput): GateVerdict;
```

#### 3.10.2 The algorithm — all five layers, in order

```
function shouldSpeak({state, nowMono, nowWall, personaCap, turnActive, chatOpen, roll}):

  g = state.gate

  # ---- layer 0: user control (R3-7 "User control ships with the feature") ----
  if g.mutedUntilWall !== null and nowWall < g.mutedUntilWall:
      return { muted, reason:'muted', nextEligibleAt: g.mutedUntilWall }

  # ---- layer 1: global rate, <= 1 displayed per rolling 20 min ----
  if g.lastDisplayedMono !== null:
      earliest = g.lastDisplayedMono + PROACTIVE_RATE_WINDOW_MS          # 1_200_000
      if nowMono < earliest:
          return { rateLimited, reason:'rate-20min',
                   nextEligibleAt: nowWall + (earliest - nowMono) }

  # ---- layer 2: unanswered cap + full-jitter exponential back-off ----
  if g.unansweredToday >= PROACTIVE_UNANSWERED_CAP:                      # 3
      return { unansweredCap, reason:'unanswered-3', nextEligibleAt: nextLocalMidnight(nowWall) }
  if g.backoffUntilMono !== null and nowMono < g.backoffUntilMono:
      return { rateLimited, reason:'backoff',
               nextEligibleAt: nowWall + (g.backoffUntilMono - nowMono) }

  # ---- layer 3: persona cap on DISPLAYED lines ----
  if g.displayedToday >= personaCap:                                     # default 2, persona <= 5
      return { personaCap, reason:'persona-cap', nextEligibleAt: nextLocalMidnight(nowWall) }

  # ---- layer 4: suppression. Every one is re-checked again before display (R3-7). ----
  if state.mode === 'plain':                    return suppressed('plain-mode')     # R3-12
  if state.probableTyping:                      return suppressed('typing')         # R3-9
  if state.fullscreen:                          return suppressed('fullscreen')
  if state.locked:                              return suppressed('locked')
  if state.suspended:                           return suppressed('suspended')
  if state.dnd:                                 return suppressed('dnd')
  if state.userHidden:                          return suppressed('user-hidden')
  if state.inputAgeMs < PROACTIVE_SINCE_INPUT_MIN_MS:  return suppressed('recent-input')  # 60 s
  if turnActive:                                return suppressed('turn-active')
  if chatOpen:                                  return suppressed('chat-open')
  if state.phase === 'night' and state.presentationMode !== 'awake':
                                                return suppressed('asleep')          # D4
  if sensorsUnknown(state):                     return suppressed('sensor-unknown')   # R3-9

  # ---- the liveliness roll. NEVER widens a hard cap; only makes a quiet pet quieter. ----
  if roll >= livelinessMap(state.liveliness).proactiveEligibility:
      return suppressed('liveliness-roll')

  return { eligible }
```

`suppressed(reason)` returns `{verdict:'suppressed', reason, nextEligibleAt: null}` — a suppression
is transient and has no computable expiry, so the chat's status line shows only the reason.

`sensorsUnknown(state)` is true when the activity sensor last reported a hard failure (R3-9: *"Sensor
errors degrade to 'unknown' and suppress proactive"*). `SimService` sets it from
`ActivitySensor.healthy` (§10.5).

#### 3.10.3 Layer 5 — bounded deferral (R3-7), owned by `ProactiveController`

The pure gate returns `eligible`; **firing is still not allowed**. `ProactiveController` then:

```
on eligible:
  if g.intent !== null: return                         # one in-flight intent, ever
  templateId = pickTemplate(bucketFor(state), ledger)  # §4.8; 30-day no-repeat on template id
  if templateId === null: return                        # pool exhausted -> stay silent
  reservationId = randomUUID()
  dispatch PROACTIVE_RESERVE {reservationId, templateId, bucket}
  INSERT proactive_log(reservationId, templateId, bucket, reserved_at = nowWall)   # §3.10.6
  deferUntilMono = nowMono + PROACTIVE_DEFER_MAX_MS    # 120_000

wait for a COARSE BREAKPOINT (research 3.6; whichever comes first):
  (a) foreground-window change      -> ActivitySensor `foregroundChanged`
  (b) typing falling edge + 5 s     -> probableTyping true->false, then 5 000 ms quiet
  (c) return from idle              -> SimEvent `returned`
  (d) deferUntilMono reached        -> DISCARD

on breakpoint:
  re-run shouldSpeak(); if not eligible -> outcome 'suppressed', DISCARD, no generation
  GENERATE now (never before the breakpoint, R3-7):
    text = proactivePrompt(templateId, bucket, state)     # §3.10.7
    turnId = await BrainService.sendProactive(text, reservationId)
  UPDATE proactive_log SET generated_at = nowWall
  immediately BEFORE display, re-check EVERY layer-4 suppression once more (R3-7)
    -> if any fires: TurnRunner.cancel(); outcome 'suppressed'   # FW-1, verified on main

on the bubble's playback:sentenceDone for seq 0 of that turnId:
  dispatch PROACTIVE_OUTCOME {reservationId, outcome:'displayed'}
  UPDATE proactive_log SET displayed_at = nowWall
  g.lastDisplayedMono = nowMono ; g.displayedToday += 1

on discard (timeout or suppression):
  dispatch PROACTIVE_OUTCOME {reservationId, outcome:'discarded'|'suppressed'}
  UPDATE proactive_log SET outcome = ...
  # NEVER fire on timeout (R3-7). Nothing is charged; layers 1-3 are untouched.
```

`BrainService` gains exactly one method for this, declared here because §3.10.3 is its only caller
(preflight E-4 — it was invoked but never given a signature):

```ts
// apps/desktop/src/main/brain-service.ts — added to the Phase 2 public surface
/**
 * The ONE entry point for a generated proactive line. Refuses — returning null, never throwing —
 * when `this.runner === null` (no key), when `runner.state !== 'idle'` (R3-3: proactive speech never
 * interrupts a user reply), when the mode is 'plain' (R3-12), or when `reservationId` is not the
 * controller's live intent. On success it sends `proactive:turn` to the bubble and the chat FIRST
 * (§2.7's ordering), then returns `TurnRunner.send(text, 'proactive')`'s turnId.
 */
sendProactive(text: string, reservationId: string, templateId: string, bucket: ProactiveBucket): Promise<string | null>;
```

**Charging rule, pinned:** the reservation is written at generation start; the caps are charged
**on display**. A restart therefore cannot double-fire — the recovery rule below closes the window.

**Startup recovery (R3-7):** on `SimService.start()`, any `proactive_log` row with
`displayed_at IS NULL AND outcome IS NULL` whose `reserved_at` is older than
`PROACTIVE_RESERVATION_STALE_MS` (5 min) is **voided** (`outcome = 'void'`); a fresher one is
resumed as a live intent with its remaining deferral window. `gate.intent` is rebuilt from that row.

**Unanswered accounting:** `ProactiveController` arms a `PROACTIVE_UNANSWERED_AFTER_MS` timer on
display. If `TURN_USER` arrives first → `PROACTIVE_ANSWERED` (`answered_at` set, `backoffN = 0`,
`backoffUntilMono = null`). If the timer fires first → `unansweredToday += 1`, `backoffN += 1`, and

```
# AWS full jitter (research 3.x): the jitter is not cosmetic — a fixed cadence reads as a cron job.
delay      = random(0, min(PROACTIVE_BACKOFF_CAP_MS, PROACTIVE_BACKOFF_BASE_MS * 2 ** (backoffN - 1)))
backoffUntilMono = nowMono + delay
```

with `PROACTIVE_BACKOFF_BASE_MS = 2_400_000` (40 min) and cap `14_400_000` (4 h) exactly as R3-7
states. The `random` draw comes from the reducer's seeded rng so tests are deterministic.

#### 3.10.4 别打扰 — the user control that ships with the feature (R3-7)

`main/tray.ts` gains a submenu **别打扰 ▸ 1 小时 / 今天 / 关闭主动说话**, radio-checked against
`gate.mutedUntilWall`:

| Item | `PROACTIVE_MUTE.untilWall` |
|---|---|
| `1 小时` | `nowWall + 3_600_000` |
| `今天` | next local midnight (epoch ms) |
| `关闭主动说话` | `8.64e15` (the ES max date; "off forever" until re-enabled) |
| (the same item again, when checked) | `null` — clears the mute |

Persisted in kv under `sim_proactive_muted`; restored at startup; every change emits
`proactive:gate` with `verdict: 'muted'`.

#### 3.10.5 The bucket chooser

```ts
export function bucketFor(state: SimState): ProactiveBucket | null;
```

| Bucket | Fires when | Cap |
|---|---|---|
| `greeting` | first eligible evaluation of a `localDate` while `phase === 'morning'` and `firedToday.morningGreeting === false` | 1/day (A12 first-open-of-day) |
| `night` | `phase === 'night'` and `presentationMode === 'awake'` (she is awake, the user is up late) | 1/day (A12 late-night) |
| `meal` | within 20 min after a `mealCue` effect for that meal | 1/meal/day |
| `longGap` | the last `returned` effect had `awayMs >= 21_600_000` (6 h) and no line has been spoken since | 1 per return (A12 long-gap) |
| `callback` | `HistoryStore.countSince(startOfLocalDay) > 0` **and** at least one non-tombstoned fact with `confidence >= 0.6` exists | **1/day** — and it is the **only** bucket that may use an `instruction` template (R3-29) |
| `world` | otherwise | remainder, **template-only — no `instruction`** (R3-29) |

**The LLM-budget invariant, stated once (R3-25 + R3-29):** *at most **one** `instruction` template
may be generated per local day, across all buckets, and only from the `callback` bucket; every other
bucket is served by a zero-token `text` template.* With `max_tokens 300` (the shipped default,
`packages/brain/src/deepseek.ts:45`), the whole proactive feature costs **≤ ~300 completion tokens
per day** — which is X6's "per-day token cap for proactive calls", expressed as the count that bounds
it. `proactive-templates.test.ts` asserts it structurally: `PROACTIVE_TEMPLATES.filter(t =>
t.instruction !== undefined).every(t => t.bucket === 'callback')`, and `ProactiveController` refuses
to generate when `bucket !== 'callback'`.

`bucketFor` returns `null` when every bucket is capped — the pet simply stays quiet. **A `null`
bucket is not an error and is not logged as a suppression.**

**Which producer emits which `ProactiveVerdict` (§2.4's nine), pinned** — the pure gate can only
return six of them, and the other three come from the deferral machinery:

| Verdict | Producer |
|---|---|
| `eligible`, `rateLimited`, `unansweredCap`, `personaCap`, `suppressed`, `muted` | `shouldSpeak()` (§3.10.1's `GateVerdict`), relayed verbatim |
| `deferred` | `ProactiveController`, at the moment an intent is reserved and the 120-s window opens |
| `discarded` | `ProactiveController`, on deferral timeout or a pre-display suppression |
| `displayed` | `ProactiveController`, on `playback:sentenceDone seq 0` |

`GateVerdict` is therefore a strict subset of `ProactiveVerdict`, and `proactive.test.ts` asserts
that containment so the two lists cannot drift.

#### 3.10.6 Ledger rows — `proactive_log` (schema in §8.1)

R3-7: *"ledger rows `{id, templateId, reservedAt, generatedAt, displayedAt, answeredAt, outcome}`"*.

| Column | Type | Meaning |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | the `reservationId` (uuid) |
| `template_id` | `TEXT NOT NULL` | the 30-day no-repeat key |
| `bucket` | `TEXT NOT NULL` | one of `PROACTIVE_BUCKETS` |
| `reserved_at` | `INTEGER NOT NULL` | epoch ms, written at reservation |
| `generated_at` | `INTEGER` | epoch ms, written when the LLM call starts; `NULL` if discarded before generation |
| `displayed_at` | `INTEGER` | epoch ms, written on `playback:sentenceDone seq 0`; `NULL` otherwise |
| `answered_at` | `INTEGER` | epoch ms of the user turn that answered it |
| `outcome` | `TEXT` | `displayed` / `discarded` / `suppressed` / `failed` / `void`; `NULL` while in flight |
| `turn_id` | `TEXT` | the `TurnRunner` turn id, for joining against `messages` and `metrics` |
| `local_date` | `TEXT NOT NULL` | `YYYY-MM-DD`, the day the counters charged |

Counting queries, exact (the caps count **displayed rows only**, R3-7):

```sql
-- displayedToday
SELECT count(*) FROM proactive_log WHERE local_date = ?1 AND displayed_at IS NOT NULL;
-- unansweredToday
SELECT count(*) FROM proactive_log
 WHERE local_date = ?1 AND displayed_at IS NOT NULL AND answered_at IS NULL AND outcome = 'displayed';
-- 30-day template no-repeat (bar §0: "Templates never repeat verbatim within 30 days")
SELECT 1 FROM proactive_log
 WHERE template_id = ?1 AND displayed_at IS NOT NULL AND displayed_at > ?2 LIMIT 1;   -- ?2 = now - 30 d
```

#### 3.10.7 The proactive prompt — the existing pipeline, never a second one (R3-7)

`packages/brain/src/proactive-prompt.ts`:

```ts
export interface ProactiveTemplate {
  id: string;                 // stable, the 30-day ledger key
  bucket: ProactiveBucket;
  /** Zero-token path: the line is spoken verbatim. Used for greeting/night/meal/longGap. */
  text?: string;
  /** LLM path: a TOPIC + STYLE instruction, never a script. Used for **`callback` only** (R3-29). */
  instruction?: string;
  /** A14 audit marker: set by the template author, asserted by the §4.8 linter. */
  audited: true;
}

/** Builds the user-message text handed to TurnRunner.send(text, 'proactive'). */
export function proactivePrompt(t: ProactiveTemplate, facts: string[]): string;
```

- A template with `text` is **not** sent to DeepSeek at all: `ProactiveController` synthesises the
  turn locally, exactly the way `BrainService.maybeFirstMessage()` synthesises `'first-mes'`
  (Phase 2 §6.6) — `brain:sentence` + `brain:turnDone`, no `brain:state`, `kind: 'proactive'`
  appended to history. Zero tokens, zero latency, hand-audited once against A14.
- A template with `instruction` — **`callback` only** (R3-29) — goes through **`TurnRunner.send(text, 'proactive')`** — the same
  runner, the same cancellation, the same shutdown drain. There is no second DeepSeek pipeline
  (R3-7). The text is:

  ```
  【主动】{instruction}
  只说一句话，不超过三十个字。不要提对方多久没理你，不要催，不要问“你还在吗”。
  ```

  `≈30 characters` is bar §0's 2-second reveal cap at the shipped cadence (60–80 ms per hanzi).
  The literal is byte-stable and lives in `proactive-prompt.ts` as `PROACTIVE_INSTRUCTION_TAIL`.
- `TurnRunner`'s existing `MessageKind 'proactive'` is what marks the history row; nothing new.
- **Proactive speech never interrupts a user reply** (R3-3): layer 4's `turn-active` covers the
  in-flight case, and the speech lane is main-owned, so a proactive turn that somehow raced a user
  turn is refused by `BrainService.sendProactive` before `TurnRunner.send` is reached.

### 3.11 `SimService` — the main adapter (R3-1)

```ts
// apps/desktop/src/main/sim-service.ts
export interface SimServiceDeps {
  pet: BrowserWindow;
  bubble: BrowserWindow;
  db: DatabaseSync;
  sensor: ActivitySensor;                       // §10
  petBounds(): Rect;                            // for cursorNear / onFloor / nearEdge
  workArea(): Rect;
  /** Injected clocks. Tests pass fakes; production passes the two below. */
  nowMono?: () => number;                       // default () => Number(process.hrtime.bigint() / 1_000_000n)
  nowWall?: () => number;                       // default Date.now
  seed?: number;
}

export class SimService {
  constructor(deps: SimServiceDeps);
  /** Reads kv, rebuilds state, recovers a stale proactive reservation, starts the 2 Hz timer. */
  start(): void;
  /** Dispatches immediately. Never queues to the next tick (R3-1). */
  dispatch(event: SimEvent): void;
  /** The current broadcast subset — what `sim:state` carries. */
  snapshot(): SimSnapshot;
  /**
   * The live StatePreamble. Phase 2's `BrainService.state()` is `private state(): StatePreamble`
   * with ZERO arguments (`brain-service.ts:502`) and derives `sinceLastChat` itself from
   * `store.lastMessageTs()` — so this is NOT the same signature, and the preflight was right to
   * flag the claim. Phase 3's wiring: `BrainService.state()` keeps its zero-argument shape and its
   * `humanizeGap` call, and its body's three constants (`mood: 0.1, energy: 70, affection: 50`)
   * are replaced by `sim.preamble(sinceLastChat)`. Nothing outside `brain-service.ts` changes.
   */
  preamble(sinceLastChat: string): StatePreamble;
  readonly liveliness: number;
  /** Flushes the kv snapshot and stops the timer. Awaited by BrainService.dispose(). */
  dispose(): Promise<void>;
}
```

Wiring, exact (all in `main/index.ts`, after the `HistoryStore` is built):

| Source | Dispatch |
|---|---|
| `setInterval(500)` | `{type:'TICK', ...}` with the sensor's latest sample |
| `ActivitySensor.onInput` | `{type:'USER_INPUT'}` **immediately** |
| `powerMonitor 'lock-screen' / 'unlock-screen'` | `LOCKED` / `UNLOCKED` (alongside the existing `visibility.set('locked', …)`) |
| `powerMonitor 'suspend' / 'resume'` | `SUSPEND` / `RESUME` |
| `startForegroundWatch` callback | `{type:'FULLSCREEN', on}` |
| `NotificationState.onChange` | `{type:'DND', on}` |
| `powerMonitor 'on-ac' / 'on-battery'` + `getBattery()` | `{type:'BATTERY', ...}` |
| tray 显示/隐藏 | `{type:'USER_HIDDEN', on}` |
| `arb:touch` | `{type:'TOUCH', part, annoyed}` |
| chat window `show`/`hide` | `{type:'CHAT_OPEN', on}` |
| `TurnRunner` `sentence` | `{type:'EMOTION', emotion}` (one per sentence) |
| `TurnRunner` `turnDone` | `{type:'TURN_DONE', proactive, interrupted}` |
| `user:text` invoke | `{type:'TURN_USER'}` |
| tray 活泼度 | `{type:'LIVELINESS', value}` |
| `ModeStore.onChange` | `{type:'MODE', mode}` |
| tray 别打扰 | `{type:'PROACTIVE_MUTE', untilWall}` |
| `setInterval(PROACTIVE_EVAL_INTERVAL_MS)` = 10 s, **owned by `ProactiveController`**, started by `SimService.start()` and cleared by `ProactiveController.dispose()` | `ProactiveController.evaluate()` → `shouldSpeak(...)` → `proactive:gate` |

The proactive evaluation timer is the **only** timer Phase 3 adds beside `SimService`'s 2 Hz tick,
`ActivitySensor`'s 2 Hz tick and `WindowMotionController`'s on-demand 60 Hz motor. It is listed here
because a constant with a rate and no owner is exactly the seam this contract exists to close.

Broadcast policy: after every dispatch, if the effects contain `snapshotDirty`, `SimService`
compares the new `SimSnapshot` to the last sent one **field by field**, and sends `sim:state` only
if it differs — coalesced so at most one send per `TICK_MS`. `sim:event` effects are sent
immediately, un-coalesced. On `stage:ready` (renderer reload) `SimService` re-sends the current
snapshot unconditionally, joining the existing `visibility.resend()` + `cursorPolling.recheck()`
block in `main/index.ts`.

Quit drain, exact order in `before-quit` (FW-1 and FW-2, both verified on `main` @ `f3185a3`; the
surrounding `quit.ts` ordering and its `step()` guard are verified too, `quit.ts:62`/`:79`):

```
markQuitting()
await brain.dispose()          // FW-2: awaits TurnRunner.cancel()'s writes (FW-1)
await proactive.dispose()      // flushes the in-flight ledger row as outcome 'void'
await sim.dispose()            // writes the kv snapshot (§3.12)
await extractor.dispose()      // §8.5, the serialised fact-extraction chain
db.close()
```

`db.close()` moves **after** the three new awaits. Phase 2's `before-quit` already awaits
`brain.dispose()` before `db.close()` under FW-2; Phase 3 inserts the other three between them.

> **`DRAIN_TIMEOUT_MS` has to be re-derived, and this is the note that says so.**
> `DRAIN_TIMEOUT_MS = 3000` (`apps/desktop/src/main/quit.ts:28`) was sized for **one** await
> (`brain.dispose()`); §3.11 puts **four** inside `drain()`. Three seconds is then a budget for four
> serialised shutdowns, not one, and a timeout does not fail loudly — it proceeds to `closeDb`,
> which is exactly when a snapshot or a ledger row is lost. Two acceptable resolutions, and the
> owning task picks one from a **measurement**, not from taste: re-derive the constant from the
> observed p95 drain across the four (`trace.ts` records it as a `resource` line at quit), or make
> it a parameter — `createBeforeQuit({…, timeoutMs})` — and pass the value from `index.ts`, which
> already owns the composed `drain`. Owner: T3-A, `quit.ts` (§1.5).

### 3.12 The persisted snapshot — schema and version (R3-1)

R3-1: *"Persisted snapshot = `{version, state, rngState, remainingMs per active timer}` — **never
raw monotonic timestamps**."*

```ts
// packages/sim/src/snapshot.ts
export const SIM_SNAPSHOT_VERSION = 1;

export const SimPersistedSchema = z.object({
  version: z.literal(SIM_SNAPSHOT_VERSION),
  /** Epoch ms the snapshot was written. Used only to detect a wall-clock jump on restore. */
  writtenWall: z.number().nonnegative(),
  /** Everything from SimState EXCEPT every monotonic field, which is rebased on restore. */
  state: SimStateSchema.omit({
    lastMono: true, absentSinceMono: true, typingStreakStartedMono: true, gate: true,
  }).extend({
    gate: SimStateSchema.shape.gate.omit({
      lastDisplayedMono: true, backoffUntilMono: true, intent: true,
    }),
  }),
  /** Every live monotonic deadline, stored as a REMAINING duration in ms (R3-1). */
  remainingMs: z.object({
    /** PROACTIVE_RATE_WINDOW_MS minus the elapsed part, or null when no line was displayed. */
    proactiveRate: z.number().min(0).nullable(),
    /** Remaining back-off, or null. */
    proactiveBackoff: z.number().min(0).nullable(),
    /** Remaining deferral for the in-flight intent, or null. */
    proactiveDefer: z.number().min(0).nullable(),
  }),
  /** The in-flight intent WITHOUT its monotonic fields; reserved_at lives in proactive_log. */
  intent: z.object({
    reservationId: z.string(), templateId: z.string(), bucket: z.string(),
  }).nullable(),
});
export type SimPersisted = z.infer<typeof SimPersistedSchema>;

export function toPersisted(state: SimState, nowMono: number, nowWall: number): SimPersisted;
export function fromPersisted(p: SimPersisted, nowMono: number, nowWall: number): SimState;
```

- Stored in kv under `sim_snapshot` as `JSON.stringify(SimPersisted)` (§8.1).
- Written **every 60 s** (a `persist` effect emitted by the 120th tick) and on
  `SimService.dispose()` — awaited before `db.close()` (§3.11).
- `fromPersisted` rebases every monotonic field against the **current** `nowMono`: a remaining
  duration becomes `nowMono + remainingMs`, and a `null` remaining stays `null`. `lastMono` is set
  to `nowMono` (so the first tick after restore integrates 0 present time, never the downtime).
- `lastWall` and `localDate` come from the snapshot, so the first tick after restore sees the real
  wall-clock jump and runs the local-date reset exactly once.
- **Version mismatch or a failed zod parse → the snapshot is discarded**, `initialSimState()` is
  used, and one line is logged: `console.warn('[sim] snapshot discarded:', reason)`. Losing the mood
  of one session is a bounded, invisible cost; running on a half-parsed state is not. Affection is
  the exception that would hurt, so it is **also** mirrored into two scalar kv keys
  (`sim_affection`, `sim_days_seen`) written in the same transaction and read back when the snapshot
  is discarded — the one piece of state a corrupt snapshot must not silently reset.

---

## §4 `packages/behaviors` — the idle pool

D1: *"Idle = data-defined weighted behaviour pool (`behaviors.json`: name, weight, conditions:
time-of-day, user-idle, on-floor, near-edge) with **≥ 12 idle behaviours**; **no behaviour twice in
a row**."*
Bar §0: *"Idle behaviours last **5–20 s** (mean **≈ 12 s**); a **60-s** unattended recording must
show **≥ 4 distinct behaviours**."*

R3-2 makes both structural, not statistical: a weighted shuffle bag makes an immediate repeat
impossible **by construction**, and the density guard makes ≥ 4-in-60-s a clamp rather than a hope.

### 4.1 `behaviors.json` — the zod schema, exact

```ts
// packages/behaviors/src/schema.ts
import { z } from 'zod';
import { ClockPhaseSchema, PresentationModeSchema } from '@ds/protocol';
import { ConditionSchema } from './conditions.ts';

/** A motion reference into the model3.json groups. Validated against the live catalogue in bind(). */
export const MotionRefSchema = z.tuple([z.string().min(1), z.number().int().nonnegative()]);
export type MotionRef = z.infer<typeof MotionRefSchema>;

/** The fixed overlay presets. A behaviour may not invent parameter writes — the set is closed so
 *  every write is reviewable, and every value is clamped by Cubism to the parameter's own range. */
export const OVERLAY_PRESETS = [
  'none', 'headTilt', 'headTiltHold', 'headDroop', 'leanLeft', 'leanRight', 'lookUp', 'blush',
] as const;
export type OverlayPreset = (typeof OVERLAY_PRESETS)[number];
export const OverlayPresetSchema = z.enum(OVERLAY_PRESETS);

/** The gaze pattern the behaviour asks the gaze lane for while it owns the body lane. */
export const GAZE_PATTERNS = ['follow', 'wander', 'cursorLock', 'away', 'down', 'up', 'edge', 'none'] as const;
export type GazePattern = (typeof GAZE_PATTERNS)[number];
export const GazePatternSchema = z.enum(GAZE_PATTERNS);

/** Locomotion the behaviour may request. Executed by MAIN (R3-5); the renderer only asks. */
export const LOCOMOTIONS = ['stroll', 'hop'] as const;
export const LocomotionSchema = z.enum(LOCOMOTIONS);

export const BehaviorSchema = z.object({
  /** Stable id. The trace key, the recency key, the cooldown key. [a-z0-9_]{2,48}. */
  id: z.string().regex(/^[a-z0-9_]{2,48}$/),
  /** Selection weight BEFORE the liveliness multiplier. Bag copies = round(weight * 4), min 1. */
  weight: z.number().min(0.1).max(5),
  /** Bar §0: 5-20 s. min <= max is enforced by a refine. */
  minMs: z.number().int().min(5_000).max(20_000),
  maxMs: z.number().int().min(5_000).max(20_000),
  /** Per-behaviour cooldown, monotonic ms. 0 = none. */
  cooldownMs: z.number().int().min(0).max(600_000).default(0),
  /** The R3-13 gate: ineligible while liveliness < this. */
  minLiveliness: z.number().min(0).max(1).default(0),
  /** Body-lane motion, or null for a behaviour that only changes expression / gaze / overlay. */
  motion: MotionRefSchema.nullable().default(null),
  /** Expression-lane name from the model's expression list, or null to leave the lane alone. */
  expression: z.string().min(1).nullable().default(null),
  /** Weight the expression is applied at. R3-4's LLM clamp does not apply to sim/idle sources. */
  expressionWeight: z.number().min(0).max(1).default(0.55),
  gaze: GazePatternSchema.default('follow'),
  overlay: OverlayPresetSchema.default('none'),
  /** null = never asks to move. Only drawn when the liveliness locomotion roll passes (§3.4). */
  locomotion: LocomotionSchema.nullable().default(null),
  /** Free tags. `big` is the only one the engine reads (the liveliness weight multiplier). */
  tags: z.array(z.enum(['big', 'quiet', 'sleepy', 'social'])).default([]),
  /** Declarative gate. Absent = always eligible. */
  when: ConditionSchema.optional(),
}).refine((b) => b.minMs <= b.maxMs, { message: 'minMs must be <= maxMs' });
export type Behavior = z.infer<typeof BehaviorSchema>;

export const BehaviorPackSchema = z.object({
  version: z.literal(1),
  /** Must match characters/<id>/character.json `id`; bind() re-checks it. */
  character: z.string().regex(/^[a-z0-9-]+$/),
  behaviors: z.array(BehaviorSchema).min(12),          // D1's floor, at the SCHEMA level
}).refine(
  (p) => new Set(p.behaviors.map((b) => b.id)).size === p.behaviors.length,
  { message: 'behaviour ids must be unique' },
);
export type BehaviorPack = z.infer<typeof BehaviorPackSchema>;

/** Stage 1 validation (structural). Throws a zod error with the offending path. */
export function parseBehaviorPack(json: unknown): BehaviorPack;
```

The overlay presets, defined once, as **additive parameter deltas** applied through
`CubismModel.addParameterValueById(id, delta, weight)` (the Framework clamps every write to the
parameter's declared min/max, so no value here can drive a model out of range):

| Preset | Parameter deltas | Ease in / out |
|---|---|---|
| `none` | — | — |
| `headTilt` | `ParamAngleZ +12` | 400 ms / 400 ms |
| `headTiltHold` | `ParamAngleZ +18`, `ParamBodyAngleZ +4` | 600 ms / 400 ms |
| `headDroop` | `ParamAngleY −10`, `ParamBodyAngleZ +4` | 900 ms / 600 ms |
| `leanLeft` | `ParamAngleX −8`, `ParamBodyAngleX −6` | 500 ms / 400 ms |
| `leanRight` | `ParamAngleX +8`, `ParamBodyAngleX +6` | 500 ms / 400 ms |
| `lookUp` | `ParamAngleY +10` | 500 ms / 400 ms |
| `blush` | `ParamTere +0.8` | 700 ms / 900 ms |

Every parameter above is on Haru's declared list (§0.2) and every range is the Cubism standard
(`ParamAngle* ±30`, `ParamBodyAngle* ±10`, `ParamTere 0…1`, evidenced by `F07` writing `1`).
The overlay layer is registered as an `ICubismUpdater` at execution order **450** — after
`CubismUpdateOrder_Drag (400)`, so it composes on top of the gaze, and before
`CubismUpdateOrder_Breath (500)`, so breath still rides on it (§5.7).

### 4.2 The condition language (R3-2), declarative, no evaluator

R3-2: *"declarative conditions (`allOf/anyOf/not` over `{phase, present, liveliness, mood, energy,
onFloor, nearEdge, cursorNear, userIdleS}` with `eq/lt/gt/in`)"*. **No JS expression evaluator ever
ships** (research §1: R1's erasable-syntax rule makes one a liability, and Shimeji only needs Nashorn
because designers author XML).

```ts
// packages/behaviors/src/conditions.ts
/** The nine facts a condition may read. Nothing else is addressable. */
export const CONDITION_FACTS = [
  'phase', 'present', 'presentation', 'liveliness', 'mood', 'energy',
  'onFloor', 'nearEdge', 'cursorNear', 'userIdleS', 'affection', 'probableTyping',
] as const;
export type ConditionFact = (typeof CONDITION_FACTS)[number];

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ allOf: z.array(ConditionSchema).min(1).max(8) }),
  z.object({ anyOf: z.array(ConditionSchema).min(1).max(8) }),
  z.object({ not: ConditionSchema }),
  z.object({ fact: z.enum(CONDITION_FACTS), eq: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ fact: z.enum(CONDITION_FACTS), lt: z.number() }),
  z.object({ fact: z.enum(CONDITION_FACTS), gt: z.number() }),
  z.object({ fact: z.enum(CONDITION_FACTS), in: z.array(z.union([z.string(), z.number()])).min(1).max(8) }),
]));
export type Condition =
  | { allOf: Condition[] } | { anyOf: Condition[] } | { not: Condition }
  | { fact: ConditionFact; eq: string | number | boolean }
  | { fact: ConditionFact; lt: number }
  | { fact: ConditionFact; gt: number }
  | { fact: ConditionFact; in: (string | number)[] };

/** The value each fact resolves to, built by the renderer from the latest SimSnapshot. */
export interface ConditionFacts {
  phase: ClockPhase;
  present: boolean;
  presentation: PresentationMode;
  liveliness: number;          // 0..1
  mood: number;                // SimSnapshot.valence, -1..1
  energy: number;              // 0..100
  onFloor: boolean;
  nearEdge: boolean;
  cursorNear: boolean;
  userIdleS: number;           // 0..3600
  affection: number;           // 0..100 (the SHOWN value, §3.6.3)
  probableTyping: boolean;
}

/** Total; a type mismatch (`lt` on a boolean fact) evaluates to FALSE and is reported by bind(). */
export function evaluate(c: Condition | undefined, f: ConditionFacts): boolean;
```

Cheap-vs-expensive predicate split (research §1's Shimeji `${}` / `#{}` lesson): every fact above is
a plain field read off the last `SimSnapshot`, so the evaluator is cheap enough to run at the
**1 Hz condition re-poll** plus at every behaviour completion. It is **never** run per frame.

### 4.3 The weighted shuffle bag (R3-2)

R3-2: *"bag = each eligible behaviour repeated `round(weight×4)` times, refilled when empty, drawn
without replacement"*.

```ts
// packages/behaviors/src/bag.ts
export class WeightedShuffleBag {
  /** `rng` is the injected seeded source; the bag never calls Math.random. */
  constructor(rng: () => number);
  /** Rebuilds the bag from the eligible set. Called whenever the eligible set CHANGES. */
  refill(entries: readonly { id: string; weight: number }[]): void;
  /**
   * Deals one id without replacement; refills from the last `entries` when the bag empties.
   * Returns **null** when `entries` is empty — it does NOT refill-and-retry, so a caller that
   * refilled with an empty eligible set cannot spin. `BehaviorSelector.select()` treats null as
   * "nothing eligible" and the runner holds the current behaviour (§4.4's last rule).
   */
  draw(): string | null;
  /** On refill, if position 0 equals `lastDealt`, it is swapped with a random later position —
   *  this is what makes "no behaviour twice in a row" TRUE ACROSS a refill boundary too. */
  readonly size: number;
  readonly lastDealt: string | null;
}
```

Copies per entry: `Math.max(1, Math.round(weight * 4))`. With the §4.9 pack (16 behaviours,
weights 0.4–2.0) the bag holds 60–80 cards, so the whole pool is covered before anything recurs —
which is exactly Desktop Mate's failure inverted (research §1: *"she has about five animations total
and you will see all of them within two minutes"*).

The refill swap is the load-bearing detail: Fisher–Yates alone can put the just-dealt card first in
the next bag, which is a same-behaviour repeat across the seam. The swap makes an immediate repeat
impossible **by construction**, and `bag.test.ts` proves it over 10 000 seeded draws.

### 4.4 Recency, cooldown and the LRU fallback (R3-2)

- **Recency exclusion: the last 3 ids.** R3-2 fixes it at 3 and states why: *"D1's rule is 'no
  behaviour twice in a row'; last-10 with 12 behaviours leaves 2"*. Layered on top of the bag as
  defence in depth (Rabin's filtered randomness, research §1.6).
- **Cooldown:** a behaviour whose `cooldownMs` has not elapsed since its own last *start* is
  ineligible. Cooldowns are keyed by behaviour id and stored as monotonic deadlines.
- **LRU fallback:** when the eligible set is empty *after the recency exclusion*, the exclusion —
  **and only the exclusion** — is relaxed, and the least-recently-started eligible behaviour is
  chosen. R3-2: *"LRU fallback relaxes ONLY the recency exclusion, never conditions, cooldowns or
  safety."* When the set is still empty (every behaviour gated out by conditions), the selector
  returns `null` and the runner holds the current behaviour — it never invents one.

### 4.5 The selector API

```ts
// packages/behaviors/src/selector.ts
export interface SelectorOptions {
  pack: BoundPack;
  rng: () => number;
  /** livelinessMap(L) from @ds/sim — injected, so behaviors has no dependency on sim. */
  map: LivelinessMap;
}
export interface Selection {
  behavior: BoundBehavior;
  /** Drawn duration, ms: clamp(uniform(minMs, maxMs), 5000, 20000). */
  durationMs: number;
  /** Monotonic ms at which the runner must decide again (§4.6). */
  nextDecisionAt: number;
  /** Trace payload for `arb:trace` kind 'behaviourStart' (§2.4). */
  trace: { eligible: string[]; weights: number[]; seed: number };
}
export class BehaviorSelector {
  constructor(opts: SelectorOptions);
  /** Re-evaluates conditions and refills the bag only when the eligible SET changed. */
  update(facts: ConditionFacts, nowMono: number): void;
  /** Draws the next behaviour. Returns null when nothing is eligible (the runner then holds). */
  select(facts: ConditionFacts, nowMono: number): Selection | null;
  /** The runner reports the outcome so cooldowns and recency stay accurate. */
  finish(id: string, nowMono: number, result: LaneResult): void;
  setLivelinessMap(map: LivelinessMap): void;
}
```

Effective weight: `weight * (tags.includes('big') ? map.highEnergyWeight : 1)`, then the bag copy
count. A behaviour with `locomotion !== null` is additionally excluded unless a fresh
`rng() < map.locomotionProbability` roll passes for that decision.

### 4.6 The D16 density guard

```ts
export const DENSITY_WINDOW_MS = 60_000;      // bar §0's "60-s unattended recording"
export const DENSITY_MIN_STARTS = 4;          // bar §0's ">= 4 distinct behaviours"
export const DENSITY_GUARD_MIN_LIVELINESS = 0.30;   // R3-2: a MINIMUM, only at L >= 0.3
export const DENSITY_MAX_PERIOD_MS = 14_000;  // 60_000 / 14_000 = 4.28 starts per window
```

```
periodMs        = map.idleGapMs * uniform(0.75, 1.25)          # +/-25 % jitter, seeded
rawNext         = startedAt + max(durationMs, periodMs)
nextDecisionAt  = liveliness >= DENSITY_GUARD_MIN_LIVELINESS
                    ? min(rawNext, startedAt + DENSITY_MAX_PERIOD_MS)
                    : rawNext
```

At the shipped default `L = 0.30`, `idleGapMs = 15 800` and the guard clamps the period to 14 000 ms,
giving **4.28 starts per 60 s** with every behaviour still running its own 5–20 s duration — both
halves of bar §0 satisfied at once. Below `L = 0.30` the guard is off and density may fall; R3-2
states that explicitly, and §12.5 records that the D16 evidence run is at the default preset.

`selector.test.ts` asserts, over a 10-minute seeded simulation at `L = 0.30`: every rolling 60 s
window contains ≥ 4 starts, no two consecutive starts share an id, and every drawn duration is
within `[5000, 20000]`.

### 4.7 Two-stage validation and the ≥ 12 rule (R3-2)

**Stage 1 — structural, at JSON load:** `parseBehaviorPack(json)`. Pure zod. Runs in the renderer's
asset loader **and** in a repo test over every committed `characters/*/behaviors.json`.

**Stage 2 — resource binding, once the model is loaded:**

```ts
// packages/behaviors/src/bind.ts
export interface ResourceCatalogue {
  /** From CompanionModel.motionGroups(): group -> count. */
  motionGroups: Record<string, number>;
  /** From CompanionModel.expressionNames(). */
  expressions: readonly string[];
  /** Parameter ids the model actually declares, for the overlay presets. */
  parameters: readonly string[];
}
export interface BoundBehavior extends Behavior { /* resolved refs, no new fields */ }
export interface BoundPack {
  character: string;
  behaviors: BoundBehavior[];
  /** Every behaviour dropped at binding, with the reason. NEVER silently discarded. */
  dropped: { id: string; reason: string }[];
}
export class BehaviorBindError extends Error {
  readonly usable: number;
  readonly dropped: { id: string; reason: string }[];
}
/** THROWS BehaviorBindError when fewer than MIN_USABLE_BEHAVIORS remain (R3-2). */
export const MIN_USABLE_BEHAVIORS = 12;
export function bindResources(pack: BehaviorPack, cat: ResourceCatalogue): BoundPack;
```

A behaviour is dropped when its `motion` group is absent or its index is `>= count`, its
`expression` is not in the model's list, or an overlay preset touches a parameter the model does not
declare. **"Usable" = unique behaviour ids whose bound motion/expression resources all exist after
binding** (R3-2's definition, verbatim).

**Character validation FAILS if `usable < 12`** — `bindResources` throws, `Live2DStage.create`
rejects, and the pet renderer's existing `main().catch` path reports it through `stage:error` with
the message `角色行为不足：可用 ${usable}/${MIN_USABLE_BEHAVIORS}`. Silently disabling behaviours
would violate D1 (R3-2), so there is no degraded mode. The D16 evidence run cannot start on a
character that fails binding, which is the point.

**Hiyori is unselectable in Phase 3 (R3-31), and that is deliberate.** Hiyori's `model3.json` has
**no `Expressions` key at all**, `Idle` × 9, `TapBody` × 1 and one hit area (`Body`), so
`bindResources` drops the eleven starter behaviours that name an `F0n`, leaves five usable, and
throws `BehaviorBindError`. `MIN_USABLE_BEHAVIORS` is **not** relaxed per character (R3-31): a
12-behaviour floor that bends per model is not a floor. Concretely:

- No `characters/hiyori/behaviors.json` ships in Phase 3, and none is listed in §1.5.
- `bindResources` throws with the message
  `角色行为不足：可用 ${usable}/${MIN_USABLE_BEHAVIORS}（缺少：${missing.join('、')}）`, where `missing` is the
  distinct resource kinds that failed to bind (`表情` / `动作`) — so the reason is on screen, not in a log.
- `docs/evidence/phase2/deferred.md` gains one row: **Hiyori → Phase 4 (character import)**. Phase 3
  ships one playable character, and says so.

### 4.8 Proactive templates — schema, ids and the A14 linter

A14: *"Proactive per §0; every template audited against manipulation tactics (guilt, FOMO,
neediness)."* Research §3 makes the rule mechanical: *"A proactive line may reference the world, the
character's own state, or something the user said — **never the user's absence, silence, or failure
to respond.**"*

```ts
// apps/desktop/src/main/proactive-templates.ts
export const PROACTIVE_TEMPLATES: readonly ProactiveTemplate[];   // shape in §3.10.7
/** The A14 linter. Runs as a UNIT TEST over PROACTIVE_TEMPLATES, not at runtime. */
export function auditTemplate(t: ProactiveTemplate): string[];    // [] = clean
export const A14_FORBIDDEN: readonly { rule: string; re: RegExp }[] = [
  { rule: 'guilt-absence',  re: /(不理|没理|不来|不见|冷落|忘了我|抛下|一个人)/ },
  { rule: 'guilt-duty',     re: /(还没(跟|和)?我|该(来|陪)|答应过我|你欠)/ },
  { rule: 'fomo',           re: /(限时|最后一次|错过|仅剩|机会不多)/ },
  { rule: 'neediness',      re: /(求你|别走|再陪|多陪|离不开你|会消失|会难过)/ },
  { rule: 'silence-count',  re: /(\d+\s*(分钟|小时|天).{0,4}(没|未))/ },
  { rule: 'question-nag',   re: /(在吗|还在不在|你怎么不)/ },
];
```

**The Phase 3 floor is ≥ 15 hand-audited templates per bucket (R3-30)**, not research §3's ≥ 40.
The reduction is bounded by arithmetic, not by optimism:

> **No-exhaustion arithmetic.** The 30-day no-repeat ledger is enforced on `template_id` and only on
> **displayed** rows (§3.10.6). A bucket can only exhaust if it must supply more than its pool size
> inside 30 days. The binding caps are: **≤ 1 displayed / 20 min** (layer 1), **≤ `personaCap`
> displayed / local day** (layer 3, default **2**, persona max 5), and the per-bucket caps in
> §3.10.5 — `greeting` 1/day, `night` 1/day, `longGap` 1/return, `meal` 1/meal/day, `callback`
> 1/day. A once-per-day bucket therefore needs **at most 30** ids to never repeat inside the window;
> with **15** it repeats at day 16 at the earliest, and only if that bucket fired on all 15 prior
> days — which the global `personaCap` of 2/day across *six* buckets makes rare. The contract's rule
> is therefore: **when a bucket's unrepeated pool is exhausted, `pickTemplate` returns `null` and the
> pet stays silent for that occasion** (§3.10.3 already treats `null` as "stay quiet", not as an
> error). Silence beats a repeat — Miyamoto's own verdict on Navi (research §3). Phase 4 raises the
> floor toward 160 and re-derives this arithmetic at the higher persona cap.

The templates are written by the implementing task **in the persona's voice, read from
`character.json`** (R3-19: no name literal), and every line is audited **by a separate review agent**
against `character.json` and the exquisite-bar A-criteria before merge; a rejected line is
**rewritten, never padded** (R3-30).

`proactive-templates.test.ts` asserts: every template has `audited: true`, `auditTemplate` returns
`[]` for every one, each bucket holds **≥ 15** templates (`PROACTIVE_TEMPLATE_FLOOR = 15`), every id
is unique and matches `/^[a-z0-9_]{2,48}$/`, no template's `text` exceeds 30 characters (bar §0's
2-second reveal cap for proactive one-liners), and — the R3-29 invariant — every template carrying
an `instruction` has `bucket === 'callback'`.

Near-duplicate check, at selection time, over the trailing 30 days of `proactive_log`
(research §3: **character-bigram Jaccard ≥ 0.6 is the reject threshold; SimHash is explicitly not
used** — it is a document technique and degrades on 15-character Chinese strings):

```ts
/** Reuses the §8.3 tokeniser's bigram set. Rejects a candidate whose Jaccard >= 0.6 with any
 *  line displayed in the last 30 days. At 2/day the window holds <= 60 rows — brute force. */
export function nearDuplicate(candidate: string, recent: readonly string[]): boolean;
export const NEAR_DUPLICATE_JACCARD = 0.6;
```

A12's three greeting buckets are `greeting` (first-open-of-day), `night` (late-night) and `longGap`
— **template ids, no repeats within 30 days**, exactly as R3-17 requires.

### 4.9 The starter pack — `characters/haru/behaviors.json`

Every `motion` below is a real entry in `characters/haru/model/Haru.model3.json`
(`Idle` × 2, `TapBody` × 4) and every `expression` is a real `F0n` (§0.2). **Sixteen behaviours**, so
binding survives losing up to four to a model swap and still clears `MIN_USABLE_BEHAVIORS = 12`.

> **Labelling caveat, recorded rather than hidden.** Which of Haru's motions and expressions *reads*
> as which gesture is a visual judgement the Phase 1 debug panel settles (`character.json` already
> carries the same caveat for `emotionMap`), and §4.11's labelling pass is where it is settled.
> The **ids, weights, durations, cooldowns, `minLiveliness`, conditions, gaze patterns and overlays
> below are final**. Exactly two things may change afterwards, both recorded as Amendments:
> (a) the `motion` / `expression` value of an entry whose binding reads wrong, and (b) §4.11.2's
> re-bind of `idle_settle`, `hum` and `wander` onto labelled extras. **Nothing else may be
> re-tuned**, and no entry may be added or removed.

```json
{
  "version": 1,
  "character": "haru",
  "behaviors": [
    { "id": "idle_breathe", "weight": 1.4, "minMs": 8000, "maxMs": 16000,
      "motion": ["Idle", 0], "expression": null, "gaze": "follow", "overlay": "none",
      "tags": ["quiet"] },

    { "id": "idle_settle", "weight": 1.2, "minMs": 6000, "maxMs": 12000,
      "motion": ["Idle", 1], "expression": null, "gaze": "follow", "overlay": "none",
      "tags": ["quiet"] },

    { "id": "look_around", "weight": 1.0, "minMs": 5000, "maxMs": 9000,
      "motion": null, "expression": null, "gaze": "wander", "overlay": "headTilt",
      "cooldownMs": 30000, "tags": [] },

    { "id": "head_tilt", "weight": 0.9, "minMs": 5000, "maxMs": 8000,
      "motion": null, "expression": "F01", "expressionWeight": 0.45,
      "gaze": "cursorLock", "overlay": "headTiltHold", "cooldownMs": 45000, "tags": [] },

    { "id": "stretch", "weight": 0.6, "minMs": 6000, "maxMs": 10000,
      "motion": ["TapBody", 2], "expression": "F02", "expressionWeight": 0.5,
      "gaze": "up", "overlay": "lookUp", "cooldownMs": 90000,
      "minLiveliness": 0.35, "tags": ["big"],
      "when": { "allOf": [ { "fact": "energy", "gt": 40 },
                           { "fact": "presentation", "eq": "awake" } ] } },

    { "id": "hum", "weight": 0.8, "minMs": 6000, "maxMs": 12000,
      "motion": ["Idle", 1], "expression": "F01", "expressionWeight": 0.4,
      "gaze": "away", "overlay": "none", "cooldownMs": 40000, "tags": ["quiet"],
      "when": { "fact": "mood", "gt": 0.0 } },

    { "id": "fidget_hands", "weight": 0.7, "minMs": 5000, "maxMs": 9000,
      "motion": ["TapBody", 3], "expression": null, "gaze": "down", "overlay": "none",
      "cooldownMs": 45000, "tags": [] },

    { "id": "peek_at_cursor", "weight": 1.0, "minMs": 5000, "maxMs": 8000,
      "motion": null, "expression": "F06", "expressionWeight": 0.4,
      "gaze": "cursorLock", "overlay": "headTilt", "cooldownMs": 25000, "tags": ["social"],
      "when": { "fact": "cursorNear", "eq": true } },

    { "id": "yawn", "weight": 1.1, "minMs": 6000, "maxMs": 10000,
      "motion": ["TapBody", 1], "expression": "F05", "expressionWeight": 0.6,
      "gaze": "down", "overlay": "headDroop", "cooldownMs": 120000, "tags": ["sleepy"],
      "when": { "anyOf": [ { "fact": "phase", "eq": "night" },
                           { "fact": "energy", "lt": 35 } ] } },

    { "id": "doze", "weight": 2.0, "minMs": 12000, "maxMs": 20000,
      "motion": null, "expression": "F05", "expressionWeight": 0.75,
      "gaze": "none", "overlay": "headDroop", "tags": ["sleepy"],
      "when": { "fact": "presentation", "in": ["nap", "sleep"] } },

    { "id": "window_gaze", "weight": 0.7, "minMs": 7000, "maxMs": 13000,
      "motion": null, "expression": "F01", "expressionWeight": 0.35,
      "gaze": "up", "overlay": "lookUp", "cooldownMs": 60000, "tags": ["quiet"],
      "when": { "fact": "phase", "in": ["morning", "day"] } },

    { "id": "sulk", "weight": 0.8, "minMs": 6000, "maxMs": 11000,
      "motion": null, "expression": "F04", "expressionWeight": 0.5,
      "gaze": "away", "overlay": "headDroop", "cooldownMs": 60000, "tags": [],
      "when": { "fact": "mood", "lt": -0.25 } },

    { "id": "perk_up", "weight": 0.9, "minMs": 5000, "maxMs": 9000,
      "motion": ["TapBody", 0], "expression": "F02", "expressionWeight": 0.55,
      "gaze": "cursorLock", "overlay": "none", "cooldownMs": 50000,
      "minLiveliness": 0.3, "tags": ["big", "social"],
      "when": { "allOf": [ { "fact": "mood", "gt": 0.35 },
                           { "fact": "presentation", "eq": "awake" } ] } },

    { "id": "edge_peek", "weight": 0.9, "minMs": 5000, "maxMs": 9000,
      "motion": null, "expression": "F06", "expressionWeight": 0.45,
      "gaze": "edge", "overlay": "leanLeft", "cooldownMs": 45000, "tags": [],
      "when": { "fact": "nearEdge", "eq": true } },

    { "id": "wander", "weight": 0.5, "minMs": 8000, "maxMs": 14000,
      "motion": ["Idle", 1], "expression": null, "gaze": "wander", "overlay": "leanRight",
      "locomotion": "stroll", "cooldownMs": 120000,
      "minLiveliness": 0.4, "tags": ["big"],
      "when": { "allOf": [ { "fact": "onFloor", "eq": true },
                           { "fact": "nearEdge", "eq": false },
                           { "fact": "presentation", "eq": "awake" } ] } },

    { "id": "blush_fidget", "weight": 0.4, "minMs": 5000, "maxMs": 9000,
      "motion": null, "expression": "F07", "expressionWeight": 0.5,
      "gaze": "down", "overlay": "blush", "cooldownMs": 180000, "tags": [],
      "when": { "fact": "affection", "gt": 55 } }
  ]
}
```

Coverage check against the bar, which is a required test in
`packages/behaviors/src/schema.test.ts` over the committed file:

| Claim | Value |
|---|---|
| entries | **16** (D1 needs ≥ 12; `MIN_USABLE_BEHAVIORS` = 12) |
| entries with **no** `when` (always eligible — the LRU floor) | **5**: `idle_breathe`, `idle_settle`, `look_around`, `head_tilt`, `fidget_hands` |
| distinct `(motion, expression, gaze, overlay)` tuples | **16**, in the JSON below as it stands — this does **not** depend on §4.11.2's motion re-bind. The first draft had **15**: `idle_settle` and `wander` both read `(["Idle",1], null, follow, none)` and differed only in `locomotion`, which is invisible while she stands still. `wander` now takes `gaze: "wander"` and `overlay: "leanRight"`, so the stated test is *no two behaviours share a `(motion, expression, gaze, overlay)` tuple* with **no** locomotion escape clause. §4.11.2's re-bind only widens the margin |
| every `motion` resolves against `Haru.model3.json` | `Idle` 0–1, `TapBody` 0–3 ✔ |
| every `expression` resolves | F01, F02, F03, F04, F05, F06, F07 ✔. **F03 is shared**: the LLM expression lane uses it for `angry`, and §5.11's annoyance reaction uses it too — one face, two sources, arbitrated by the expression lane like any other pair. **F08 (`think`) is the only expression reserved exclusively for the LLM lane.** |
| durations inside bar §0's 5–20 s | ✔; mean of the drawn midpoints = **9.4 s**, and with the §4.6 period clamp the effective cycle at `L = 0.30` is **14.0 s** → 4.28 starts / 60 s |

### 4.10 `character.json` additions for Phase 3

Two additive blocks. `packages/stage`'s `CharacterConfigSchema` gains them as **optional**, so
Hiyori and any future bundle without them still parse (Phase 1's schema is otherwise untouched).

```jsonc
{
  // … every Phase 1/2 field unchanged …

  /** §6.4 — the opaque-pixel hit map. Keyed by Cubism PART id (from Haru.cdi3.json), which is
   *  stable and committed, unlike ArtMesh ids which live inside the gitignored moc3. */
  "hitParts": {
    "Part01Face001":     { "part": "face",     "participatesInHitTest": true },
    "Part01Eye001":      { "part": "face",     "participatesInHitTest": true },
    "Part01EyeBall001":  { "part": "face",     "participatesInHitTest": false },
    "Part01Brow001":     { "part": "face",     "participatesInHitTest": false },
    "Part01Mouth001":    { "part": "face",     "participatesInHitTest": false },
    "Part01Nose001":     { "part": "face",     "participatesInHitTest": false },
    "Part01Hoho001":     { "part": "face",     "participatesInHitTest": false },
    "Part01Tear":        { "part": "face",     "participatesInHitTest": false },
    "Part01Ear001":      { "part": "head",     "participatesInHitTest": true },
    "Part01HairFront001":{ "part": "hair",     "participatesInHitTest": true },
    "Part01HairSide001": { "part": "hair",     "participatesInHitTest": true },
    "Part01HairBack001": { "part": "hair",     "participatesInHitTest": true },
    "Part01Neck001":     { "part": "body",     "participatesInHitTest": true },
    "Part01Body001":     { "part": "body",     "participatesInHitTest": true },
    "Part01ArmLA001":    { "part": "arm",      "participatesInHitTest": true },
    "Part01ArmRA001":    { "part": "arm",      "participatesInHitTest": true },
    "Part01ArmLB001":    { "part": "arm",      "participatesInHitTest": true },
    "Part01ArmRB001":    { "part": "arm",      "participatesInHitTest": true },
    "Part01Core":        { "part": "body",     "participatesInHitTest": false },
    "Part01Sketch":      { "part": "body",     "participatesInHitTest": false }
  },
  /** D6's one ticklish zone, as a normalised MODEL-space rect. Overrides the part map inside it. */
  "ticklishRect": { "x0": 0.30, "y0": 0.55, "x1": 0.70, "y1": 0.80 },
  /** The part a participating drawable with no entry falls back to. */
  "hitPartDefault": "body",

  /** §3.10 — the persona's proactive settings. Absent = the SIM_DEFAULTS values. */
  "sim": {
    "moodBase": { "valence": 0.10, "arousal": 0.35 },
    "proactive": { "maxPerDay": 2 }
  },

  /**
   * REQUIRED IN PHASE 3 (R3-27/R3-28). Registers motion files that `model3.json` does not, so the
   * §4.11 labelling pass can widen the pool. The files are NOT redistributed (model/ stays
   * gitignored); only their names, a human label and classification tags are committed.
   * `name` is what §4.9 binds against; `tags` are what the labeller recorded.
   */
  "extraMotions": {
    "Extra": [
      { "file": "motions/haru_g_m01.motion3.json", "name": "wave_small",
        "tags": ["arm", "low", "loop-safe", "greet"] }
    ]
  },

  /** §8.9 and §9.1 read these. Phase 2's `cannedLines` has only `offline` and `empty`. */
  "cannedLines": {
    "offline": ["..."], "empty": ["..."],
    "remember": ["嗯，记下了。", "好啦，这件事人家记着。"],
    "forget":   ["那就当没听过。", "行，忘掉了。"],
    "mode": {
      "toPlain":     ["好，接下来正常回答。"],
      "toCharacter": ["嗯，回来了。"]
    }
  }
}
```

**`extraMotions` and the three new `cannedLines` groups need a schema widening, or they are inert.**
Two separate schemas read this file and **both** are strict-by-default `z.object`s, so an unknown key
is silently stripped:

- `packages/stage/src/character.ts`'s `CharacterConfigSchema` (`character.ts:13-27`) — gains
  `hitParts`, `ticklishRect`, `hitPartDefault`, `sim` and `extraMotions` as **optional** fields, so
  Hiyori and any future bundle without them still parse (owner row in §1.5).
- `packages/brain/src/persona.ts`'s `CharacterBundleSchema` (`persona.ts:64-70`) — its nested
  `cannedLines` is `z.object({ offline, empty })`, which would **drop** `remember` / `forget` /
  `mode`. Phase 3 widens exactly that nested object:

  ```ts
  cannedLines: z.object({
    offline: z.array(z.string()).min(1),
    empty: z.array(z.string()).min(1),
    remember: z.array(z.string()).min(1).default(['嗯，记下了。']),
    forget: z.array(z.string()).min(1).default(['那就当没听过。']),
    mode: z.object({
      toPlain: z.array(z.string()).min(1).default(['好，接下来正常回答。']),
      toCharacter: z.array(z.string()).min(1).default(['嗯，回来了。']),
    }).default({ toPlain: ['好，接下来正常回答。'], toCharacter: ['嗯，回来了。'] }),
  }),
  ```

  The defaults exist so a SillyTavern-imported card (X10, Phase 4) never fails to load for want of a
  忘掉这个 line. **§8.9's "the canned answer names which one was forgotten" is a template, not a
  bare line**: `忘了，「${fact}」不再记得了。` — pinned here as `FORGET_TEMPLATE` in
  `main/brain-service.ts`, with `${fact}` filled from the tombstoned row's sanitised `value`
  truncated to 24 graphemes. When nothing was retrieved the reply is
  `好像没有对应的记忆。` and nothing changes.

`hitParts` values are constrained to `HIT_PARTS` (§2.1); `ticklishRect` coordinates are in the same
normalised model space the picker reports (`[-1, 1]` mapped to `[0, 1]` by
`u = (x + 1) / 2`). `hitPartDefault` must also be a `HIT_PARTS` member.

### 4.11 The motion-labelling pass (R3-27, confirmed by R3-28)

R3-27, binding: *"A bounded motion-labelling pass IS in Phase 3. Haru ships 27 `motion3.json` but
registers 6; tuple variety alone is Desktop Mate's failure mode held off by hand."*
R3-28 confirms it and directs this contract to specify option (a). **The earlier §14 Q8 assumed the
opposite and is deleted.**

**Owner:** T3-B, **one task, ≤ 2 fix rounds** (R3-27's budget).
**Files:** `characters/haru/character.json` (`extraMotions`), `characters/haru/behaviors.json` (the
re-bind), `docs/evidence/phase3/motion-labels.md` + `motion-labels.json`, and the frame captures
under `docs/evidence/phase3/motions/`.

#### 4.11.1 Procedure

1. **Enumerate.** The 21 files in `characters/haru/model/motions/` that `Haru.model3.json` does not
   reference. The six it does reference are `haru_g_idle, haru_g_m15, haru_g_m26, haru_g_m06,
   haru_g_m20, haru_g_m09`; every other `haru_g_m*.motion3.json` is a candidate.
2. **Play each one** in the Phase 1 debug panel (`?debug=1` → `debug:motion`), which already accepts
   an arbitrary `{group, index}` once the file is registered under a scratch `extraMotions` group.
3. **Capture three frames each**, at **0.3 s / 1.0 s / 2.0 s** into the motion, captured with
   `page.screenshot` in the browser lane (`__stage.pixels()` returns `{opaque, hash}`, **not an
   image** — it is the determinism hook, not a frame buffer, so it is useful only as a cheap
   "did the pixels change" check beside the screenshots). Frames land at
   `docs/evidence/phase3/motions/<file>-{03,10,20}.png`.
4. **Classify by viewing the frames**, on four axes, recorded per motion in `motion-labels.json`:

   | Axis | Values |
   |---|---|
   | pose family | `idle` \| `gesture` \| `lean` \| `reach` \| `settle` \| `emote` |
   | energy | `low` \| `mid` \| `high` |
   | loop-safe | `true` when the 0.3 s and the last frame are visually continuous (every Haru motion is `Loop: true`, §0.2, so a motion that snaps is unusable as a hold) |
   | body part moved | any of `head` \| `arm` \| `torso` \| `hair` \| `face` |

5. **Register every motion that reads clearly** under `extraMotions` with a `name` and `tags`
   (§4.10's shape). "Reads clearly" = the three frames differ visibly from each other **and** the
   motion is distinguishable from every already-registered one; a motion that is a near-duplicate of
   `Idle[0]` is **not** registered, and the reason is recorded.
6. **Target ≥ 10 usable extra motions.** If fewer survive, **record the shortfall honestly** in
   `motion-labels.md` with the count and the rejected files' reasons — do not pad the pack, and do
   not lower the bar silently. A shortfall is a finding for the controller, not a task failure.

#### 4.11.2 The re-bind (R3-28)

Once the extras exist, the starter pack **re-binds every entry whose `motion` is an `["Idle", n]`
reuse**, because those are the tuples §4.9 could only distinguish by expression, gaze and overlay:

| Entry | Binds today | Re-binds to |
|---|---|---|
| `idle_breathe` | `["Idle", 0]` | **stays** — it is the resting loop and should be the registered idle |
| `idle_settle` | `["Idle", 1]` | an extra tagged `settle`/`low`/`loop-safe` |
| `hum` | `["Idle", 1]` | an extra tagged `idle`/`low`/`loop-safe`, different from `idle_settle`'s |
| `wander` | `["Idle", 1]` | an extra tagged `lean` or `torso`/`mid`, so a stroll does not read as standing still |

**Only the `motion` value of those three entries changes.** Ids, weights, durations, cooldowns,
`minLiveliness`, conditions, gaze patterns and overlays are unchanged — §4.9's "nothing else may be
re-tuned" still holds, and this is the one exception it names. If the pass yields fewer than three
suitable extras, the entries that cannot be re-bound keep their `Idle` binding and the
`(motion, expression, gaze, overlay)` distinctness test (§4.9) is what still guarantees they do not
look alike.

#### 4.11.3 Acceptance

- `motion-labels.json` parses against `MotionLabelSchema` (below) and covers all 21 candidates —
  every file is either registered or rejected with a reason. No file may be silently skipped.
- `character.json`'s `extraMotions` contains exactly the registered set, each with a unique `name`
  matching `/^[a-z][a-z0-9_]{1,31}$/`.
- `bindResources` binds every re-bound `behaviors.json` entry (a typo'd `name` is a binding failure,
  not a silent drop).

```ts
// packages/behaviors/src/schema.ts — the labelling artefact's shape
export const MotionLabelSchema = z.object({
  file: z.string().min(1),
  registered: z.boolean(),
  /** Present when registered. The `extraMotions` name §4.9 binds against. */
  name: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/).optional(),
  poseFamily: z.enum(['idle', 'gesture', 'lean', 'reach', 'settle', 'emote']).optional(),
  energy: z.enum(['low', 'mid', 'high']).optional(),
  loopSafe: z.boolean().optional(),
  bodyParts: z.array(z.enum(['head', 'arm', 'torso', 'hair', 'face'])).optional(),
  /** Present when NOT registered. Free text, one sentence. */
  reason: z.string().max(200).optional(),
});
export const MOTION_LABEL_TARGET = 10;   // R3-27's "target >= 10 usable extra motions"
```

---

## §5 The renderer arbiter (`src/renderer/pet/stage/`)

R3-3: *"Per-lane arbitration with generation-stamped leases; generation scope is per lane."*
The rulings v2 ownership table puts **body, expression and gaze** in the renderer and **locomotion
and speech** in main. This section owns the three renderer lanes and the presentation of the two
main-owned ones.

> **Cubism's own motion priorities are NOT the arbitration mechanism** (§0.2, measured). Every Haru
> motion is `Loop: true`, so `CubismMotionManager.isFinished()` never returns true, `_currentPriority`
> never resets, and `reserveMotion(p)` rejects every `p <= _currentPriority` forever — the first
> motion of the session would be the last. Research §8's "map the three sources onto Cubism's native
> priorities" is therefore **overruled by measurement**. The arbiter is the sole authority and issues
> **every** motion at `Priority.force`, implementing min-play, cooldown and pre-emption itself.
> `CompanionModel.tick()`'s internal auto-idle restart is disabled (§5.14) so there is one owner.

### 5.1 The lane table

| Lane | Owner | Priority order (highest first) | Generation scope |
|---|---|---|---|
| `body` | renderer | `drag` > `touch` > `llm` > `behaviour` > `idle` | per lane, monotonic in the renderer |
| `expression` | renderer | `touch` (overlay) > `llm` (R3-4 lease) > `behaviour` > `sim` (baseline) | per lane |
| `gaze` | renderer | `touch` (target) > `llm` (`look` lease) > cursor-rest > idle saccade | per lane |
| `locomotion` | **main** (`WindowMotionController`) | active drag > `llm` `walkTo` > idle walk | global per motion episode (§7) |
| `speech` | **main** (`BrainService` + `ProactiveController`) | user response > first message > proactive | `turnId` |
| breath · blink · physics · overlay | — | **additive layers, outside arbitration** (D2) | — |

Interruption matrix (R3-3), exact:

| Incoming | Current holder | Result |
|---|---|---|
| `drag` (body) | anything | pre-empt **immediately**, current lease → `preempted` |
| `touch` (body) | `llm` motion | pre-empt **at the next motion boundary, ≤ 250 ms** — the arbiter arms a `TOUCH_PREEMPT_MAX_MS = 250` deadline and swaps at whichever comes first, the motion's own `MIN_PLAY_MS` boundary or the deadline |
| `touch` (body) | `behaviour` / `idle` | pre-empt immediately |
| `touch` (expression) | `llm` lease | **cover**, do not cancel: the LLM lease keeps expiring underneath (R3-4) and is **restored with its remaining time** when the touch overlay ends |
| `llm` motion | `touch` | refused (`preempted` reported for the incoming command) |
| `llm` motion | `llm` motion | the newer wins; the older reports `preempted`. `MIN_PLAY_MS` does **not** protect an LLM motion from a newer LLM motion — a mid-utterance emotion change must land |
| `behaviour` | `llm` / `touch` | refused; the selector holds and re-decides at `nextDecisionAt` |
| proactive speech | active user turn | refused in main before `TurnRunner.send` (§3.10.7) |

### 5.2 The command envelope and lease semantics (R3-3)

```ts
// apps/desktop/src/renderer/pet/stage/lanes.ts
import { LANE_TTL_MAX_MS, type Lane, type LaneResult, type LaneSource } from '@ds/protocol';

/** R3-3: `{lane, source, generation, ttlMs, payload}`. The OWNER stamps the deadline. */
export interface LaneCommand<P> {
  lane: Lane;
  source: LaneSource;
  /** Assigned by the OWNING lane, monotonically increasing. Never crosses a process boundary. */
  generation: number;
  /** Requested lifetime. Clamped into [0, LANE_TTL_MAX_MS] by the owner. */
  ttlMs: number;
  payload: P;
}

/** A granted lease. `deadline` is in the OWNER's clock (performance.now() here) — R3-3 forbids
 *  comparing a deadline stamped in another process's clock. */
export interface LaneLease<P> extends LaneCommand<P> {
  issuedAt: number;
  deadline: number;
  onResult(result: LaneResult): void;
}

export class LaneHolder<P> {
  /** Returns the granted lease, or null when the incoming command loses arbitration. */
  request(cmd: LaneCommand<P>, nowMs: number): LaneLease<P> | null;
  /** Expires the lease if past its deadline; returns the lease that ended, if any. */
  tick(nowMs: number): LaneLease<P> | null;
  /** Ends the current lease with `result`, running its callback exactly once. */
  end(result: LaneResult, nowMs: number): void;
  readonly current: LaneLease<P> | null;
  readonly generation: number;
}
```

Rules that apply to every lane:

- **Generation is per lane and monotonic.** A completion callback compares its own `generation`
  against `holder.generation` and does nothing when it is stale. This is the same defect class
  `MotionFinishTracker` already solves for Cubism handles (Phase 1) — the arbiter reuses that
  tracker for motion completion and adds the generation check on top.
- **One terminal result per lease, ever**, drawn from `LANE_RESULTS`
  (`completed | expired | preempted | cancelled | renderer_lost`), reported on `arb:trace` with
  `kind: 'laneResult'`.
- A **covered** lease (expression only) keeps counting down while covered (R3-4). If it expires
  while covered, it reports `expired` and is not restored.
- **Renderer reload:** every renderer-owned lane restarts from idle, and main re-sends the
  authoritative state it owns — the current `SimSnapshot`, the live `WindowMotion` generation, and
  the speech state — on `stage:ready` (§3.11). Renderer-owned leases that were live at reload report
  nothing (the renderer is gone); main-owned commands whose renderer half vanished report
  `renderer_lost`.

### 5.3 The behaviour runner

```ts
// apps/desktop/src/renderer/pet/stage/behaviour-runner.ts
export class BehaviourRunner {
  constructor(deps: {
    selector: BehaviorSelector;
    arbiter: Arbiter;
    facts(): ConditionFacts;          // built from the latest SimSnapshot
    now(): number;                    // performance.now()
    trace(rec: ArbTrace): void;
  });
  /** Called at 1 Hz (the condition re-poll) AND at every body-lane `completed`/`expired`. */
  update(): void;
  /** Freezes selection without ending the current behaviour (D7: "wandering freezes"). */
  setFrozen(frozen: boolean): void;
}
export const CONDITION_POLL_MS = 1_000;   // research §1: the selector is event-driven + a 1 Hz re-poll
```

Selection happens **only** at a behaviour boundary or at `nextDecisionAt` — never per frame
(research §1: per-frame utility scoring produces oscillation; Graham's *inertia*). On selection the
runner requests the `body`, `expression` and `gaze` lanes with `source: 'behaviour'` and
`ttlMs = durationMs`, and emits one `arb:trace {kind:'behaviourStart', id, eligible, weights, seed}`.

### 5.4 The expression lane — R3-4's exact curve

D14's threshold: *"LLM expressions persist until the next ACT or **90 s**, then decay to neutral."*
R3-4 turns that into a curve with three fixed numbers:

```ts
// apps/desktop/src/renderer/pet/stage/expression-lease.ts
export const EXPR_INTENSITY_CLAMP = 0.65;      // R3-4: min(w, 0.65)
export const EXPR_SURPRISED_MAX = 1.0;         // R3-4: `surprised` may reach 1.0
export const EXPR_HOLD_AFTER_UTTERANCE_MS = 3_000;
export const EXPR_HOLD_CEILING_MS = 82_000;    // R3-4: min(utteranceEnd + 3 s, issuedAt + 82 s)
export const EXPR_DECAY_MS = 8_000;            // easeOutCubic to baseline
export const EXPR_TOTAL_CEILING_MS = 90_000;   // D14's never-exceed bound: 82_000 + 8_000
export const EXPR_FADE_MS = 300;               // bar §0: "expressions <= 300 ms"

/** easeOutCubic, the R3-4 curve. t in [0,1]. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** The applied weight at `nowMs`, given the lease. Exported so it is unit-testable alone. */
export function expressionWeightAt(lease: {
  issuedAt: number; utteranceEndAt: number | null; weight: number;
}, nowMs: number): number {
  const holdUntil = Math.min(
    (lease.utteranceEndAt ?? lease.issuedAt) + EXPR_HOLD_AFTER_UTTERANCE_MS,
    lease.issuedAt + EXPR_HOLD_CEILING_MS,
  );
  if (nowMs <= holdUntil) return lease.weight;
  const t = Math.min(1, (nowMs - holdUntil) / EXPR_DECAY_MS);
  return lease.weight * (1 - easeOutCubic(t));
}
```

- **Incoming clamp:** `weight = emotion === 'surprised' ? min(w, 1.0) : min(w, 0.65)`. The LLM never
  sends a weight today (the ACT grammar has no intensity attribute), so `w` is the character
  bundle's per-emotion default, itself capped by this clamp. This is airi#590's missing knob
  (research §8: *"emotions bound on stage-web are too raw… it smiles too much"*).
- **"Neutral" means the mood baseline, not literal neutral** (R3-4). The baseline expression is a
  pure function of the sim's valence:

  ```ts
  export function baselineExpression(valence: number): { name: string | null; weight: number } {
    if (valence >= 0.35) return { name: 'F01', weight: 0.25 };   // faint smile
    if (valence <= -0.20) return { name: 'F04', weight: 0.15 };  // faintly downcast
    return { name: null, weight: 0 };                             // rest face
  }
  ```

  **One disagreement, recorded.** `character.json`'s shipped `emotionMap` binds `curious → F01`,
  while §0.2's reading of the file (`F01 = ParamMouthForm +0.27`, a faint upturned mouth and nothing
  else) is what makes it the right *baseline* face. Both are true: F01 is a low-amplitude pleasant
  mouth shape that reads as "mildly interested" under the LLM lane and as "content" as a resting
  baseline. §4.11's labelling pass confirms or corrects it, and if it reads wrong, only this
  function's `'F01'` changes (an Amendment, §4.9's rule (a)).

  Names are resolved through the bound pack, so a model without `F01`/`F04` falls back to `null`.
- **Touch covers, then restores** (R3-3/R3-4): a touch overlay takes the lane with its own
  `TOUCH_EXPR_MS = 1_400` ms lease; when it ends, the LLM lease is restored **with its remaining
  time** — `expressionWeightAt` is evaluated at the current `nowMs`, so the cover costs the lease
  exactly the wall time it took, no more.
- **Applying the weight:** `ACubismMotion.setWeight(w)` on the loaded expression object
  (`acubismmotion.ts:207`), which multiplies into `updateFadeWeight` (`:142`). **Never**
  `CubismExpressionMotionManager.setFadeWeight()` — it is overwritten every frame
  (`cubismexpressionmotionmanager.ts:190`). Because the expression objects are shared (one per name,
  preloaded), the lane **must reset the weight to 1.0 when it releases an expression**; a released
  expression left at 0.2 would come back faint. `expression-lease.test.ts` pins that.
- **Fade times:** `CompanionModel` sets `setFadeInTime(0.30)` / `setFadeOutTime(0.30)` on every
  loaded expression at load time (§5.14). Without it the Framework's `DefaultFadeTime = 1.0` applies
  (§0.2) and bar §0's ≤ 300 ms is missed by 3.3×.

### 5.5 The body lane, motion timing, and drag visuals

```ts
// apps/desktop/src/renderer/shared/lane-metrics.ts  — shared with main's motor presentation
export const MOTION_FADE_TOUCH_S = 0.12;     // bar §0: "Tap motions fade-in <= 120 ms"
export const MOTION_FADE_LLM_S = 0.25;       // research §8: Unreal's montage default
export const MOTION_FADE_IDLE_S = 1.00;      // bar §0: "idle->idle 1 s"
export const MOTION_MIN_PLAY_MS = 800;       // research §8: LLM motion min play
export const MOTION_GROUP_COOLDOWN_MS = 1_500;
export const TOUCH_PREEMPT_MAX_MS = 250;     // R3-3's "<= 250 ms" motion boundary
export const TOUCH_EXPR_MS = 1_400;
```

A second `ACT` inside `MOTION_GROUP_COOLDOWN_MS` updates the **expression only** (research §8);
the motion request is dropped and reported `preempted`.

**Drag visuals** are pure presentation of main's snapshots (R3-5: *"the renderer interpolates
lean/squash at RAF and never calls setPosition"*):

```ts
// apps/desktop/src/renderer/pet/stage/drag-visual.ts
export const LEAN_LAG_REF_DIP = 120;      // lag magnitude that maps to full lean
export const LEAN_ANGLE_Z_DEG = 22;       // research §4: ParamAngleZ = clamp(lag/120,-1,1)*22
export const LEAN_BODY_Z_DEG = 8;
export const LEAN_ANGLE_X_DEG = 30;
export const SWAY_FOLLOW_RATE = 3.5;      // sway += (target-sway)*(1-exp(-3.5*dt))
export const SWAY_DECAY_RATE = 1.7;       // sway *= exp(-1.7*dt)
export const SQUASH_IMPULSE_REF = 1_200;  // DIP/s that maps to the full squash
export const SQUASH_MAX = 0.18;           // s = clamp(impulse/1200,0,1)*0.18
export const SQUASH_COMPRESS_MS = 90;     // ease-out
export const SQUASH_RECOVER_MS = 160;     // with ~4 % overshoot
```

- On `sim:windowMotion`, the renderer stores `{generation, vx, vy, lagX, lagY, phase, contact}` and
  **interpolates toward it at RAF**; a snapshot whose `generation` is lower than the last seen one
  is dropped. Snapshots arrive at 30 Hz while the ticker may run at 60 Hz, so the interpolation is
  what keeps the lean smooth.
- On `sim:landing`, the squash runs **only if `generation === lastWindowMotionGeneration`** — R3-5's
  *"stale landing must not affect a newer drag"*. Squash is applied through
  `CubismModelMatrix.scaleRelative(1 + s/2, 1 - s)` plus a compensating `translateY` so the feet stay
  planted (research §4: no global scale parameter exists; squash must come from the matrix).

### 5.6 The gaze lane (D3)

D3: *"Gaze: smoothed cursor-follow (**head 30° / eyes 1.0 / body 10°**), broken **every 8–20 s** by a
look-away-and-back saccade or hand fidget; **stops following after 5 s of cursor rest**."*

Phase 1 already ships the follow half (`GazeDriver`, `CubismLook` with exactly `ParamAngleX 30`,
`ParamAngleY 30`, `ParamAngleZ -30`, `ParamBodyAngleX 10`, `ParamEyeBallX/Y 1.0` — D3's three
numbers, unchanged). Phase 3 adds the state machine on top:

```ts
// apps/desktop/src/renderer/pet/stage/gaze-lane.ts
export type GazeState = 'follow' | 'saccadeBreak' | 'restDrift' | 'sleep';

export const CURSOR_REST_MS = 5_000;        // D3: "stops following after 5 s of cursor rest"
export const CURSOR_REST_EPS_DIP = 2;       // movement below this does not reset the rest timer
export const SACCADE_MIN_MS = 8_000;        // D3: "every 8-20 s"
export const SACCADE_MAX_MS = 20_000;
export const SACCADE_SIGMA_MS = 4_000;      // research §5: gamma/lognormal, mean 13 s, SD 4 s
export const SACCADE_SUPPRESS_MS = 4_000;   // no second break within 4 s of one
/** Break-type weights (research §5). Randomising the TYPE is what kills the metronome feel. */
export const SACCADE_TYPES = [
  { type: 'lookAwayBack', weight: 0.60, offsetDeg: [15, 35], holdMs: [500, 1_600], returnMs: 150 },
  { type: 'microFidget',  weight: 0.25, offsetDeg: [3, 5],   holdMs: [500, 700],   returnMs: 300 },
  { type: 'doubleGlance', weight: 0.15, offsetDeg: [10, 20], holdMs: [180, 220],   returnMs: 150 },
] as const;
/** Research §5: below this the shift is EYES ONLY; above it the head leads by GAZE_HEAD_DELAY_MS. */
export const EYES_ONLY_THRESHOLD_DEG = 12;
export const GAZE_HEAD_DELAY_MS = 100;      // eyes lead, head follows (58-200 ms measured)
export const GAZE_HEAD_FRACTION = 0.65;     // the head reaches ~65 % of the residual
export const GAZE_BODY_DELAY_MS = 480;      // torso lags the head
export const GAZE_BODY_FRACTION = 0.20;
```

The mean interval is `livelinessMap(L).saccadeIntervalMs` (16 400 ms at the default), drawn from a
lognormal with `SACCADE_SIGMA_MS` and **clamped to D3's `[8 000, 20 000]`**; the amplitude is scaled
by `livelinessMap(L).saccadeAmplitude`. Every break emits `arb:trace {kind:'gazeBreak', value: deg}`,
which is what D16's *"≥ 1 gaze break"* is asserted on (§12.5).

`restDrift` is entered after `CURSOR_REST_MS` of a cursor that moved < `CURSOR_REST_EPS_DIP`, and
left on the next real cursor movement. `sleep` is entered when `presentationMode === 'sleep'`.

An LLM `look` lease (§2.6) pre-empts the idle saccade with `source:'llm'`, `ttlMs = 6_000`, and maps
each anchor to a normalised target: `cursor` → the live cursor, `user` → `(0, 0.15)`, `screen` →
`(0, 0.35)`, `away` → a seeded ±(20–30°) offset, `up/down/left/right` → `(0, ±0.7)` / `(∓0.7, 0)`.

### 5.7 Additive layers (D2) — breath, blink, physics, overlay

D2: *"Breath, blink (**mean 4 s, jitter ± 1.5 s**), physics run as independent always-on layers;
low-amplitude wind keeps hair/clothes moving at rest."*

These sit **outside arbitration** (R3-3) and keep running whatever any lane is doing.

- **Breath:** unchanged from Phase 1 — the sample's deliberately incommensurable periods
  (`ParamAngleX 6.5345`, `ParamAngleY 3.5345`, `ParamAngleZ 5.5345`, `ParamBodyAngleX 15.5345`,
  `ParamBreath 3.2345`). Research §5: *"Copy the periods, not just the shape; do not round them."*
  Already correct in `companion-model.ts`; Phase 3 does not touch it.
- **Blink:** Phase 1 uses `CubismEyeBlink`, whose next-blink draw is
  `r * (2 * interval - 1)` — **uniform on `[0, 7)` s, mean 3.5 s**, which produces visible
  double-blinks and 7-second stares (research §5, source-verified). Phase 3 replaces the draw with a
  state-dependent lognormal, keeping the SDK's 0.10/0.05/0.15 s envelope:

  ```ts
  export const BLINK_MEAN_FOLLOW_MS = 4_000;   // D2's "mean 4 s"
  export const BLINK_SIGMA_FOLLOW_MS = 1_500;  // D2's "jitter +- 1.5 s"
  export const BLINK_MEAN_REST_MS = 6_500;     // research §5: measured IEBI while screen-focused
  export const BLINK_SIGMA_REST_MS = 2_400;
  export const BLINK_MIN_INTERVAL_MS = 1_200;  // floor: kills the double-blink artefact
  export const BLINK_DOUBLET_P = 0.12;         // 12 % chance of a 250-400 ms doublet
  export const BLINK_CLOSED_SLEEPY_S = 0.25;   // lengthened closed time while sleepy
  ```

  `sleep` blinks not at all. Every blink emits `arb:trace {kind:'blink'}`, which is what D16's
  *"continuous breath/blink (no gap > 6 s)"* (R3-15) is asserted on.
- **Physics / pose:** the Framework's `CubismPhysicsUpdater` / `CubismPoseUpdater`, unchanged. D2's
  "low-amplitude wind" is the breath layer driving `ParamAngleX/Z`, which the physics rig converts
  into hair and scarf motion — no separate wind source is added.
- **Overlay** (`packages/stage/src/overlay.ts`, CREATE): one `ICubismUpdater` at execution order
  **450** (between `Drag 400` and `Breath 500`, §0.2), applying the active `OverlayPreset`'s deltas
  through `addParameterValueById(id, delta * envelope, 1.0)` with a linear ease-in/ease-out envelope
  from §4.1's table. It is additive and always-on, so a behaviour's head tilt composes with the gaze
  and the breath instead of fighting them.

### 5.8 FPS policy

Phase 2's `fpsFor({hovering, speaking})` (`bubble/fps.ts`) is the **only** writer (D7's one-call-site
rule, Phase 2 §5.6). Phase 3 extends the state object rather than adding a second writer:

```ts
const fpsState = { hovering: false, speaking: false, moving: false };
export function fpsFor(s: { hovering: boolean; speaking: boolean; moving: boolean }): 30 | 60 {
  return s.hovering || s.speaking || s.moving ? 60 : 30;
}
```

`moving` is `true` from the first `sim:windowMotion` of an episode until 500 ms after `phase: 'rest'`
(research §4: bump to 60 Hz on pointer-down and hold until at rest 500 ms). The acceptance check
stays `grep -c 'setFps' apps/desktop/src/renderer/pet/main.ts === 1`.

### 5.9 D7 — the hover acknowledgement state machine

Bar §0, verbatim: *"hover **< 250 ms** → acknowledge (glance) and freeze wandering; click before any
fade → opens chat; **rest > 3 s while a 'work-mode' toggle is on** → fade to **35 %** +
pass-through (opt-in, default off); hotkey toggles pass-through globally. A faded pet regains
clickability the moment the cursor leaves and re-enters."*
D7: *"Hover acknowledgement per §0; wandering freezes under the cursor."*

```ts
// apps/desktop/src/renderer/pet/stage/hover-ack.ts
export type HoverState = 'out' | 'acknowledging' | 'held' | 'faded';
export const HOVER_ACK_MAX_MS = 250;      // the glance must START within 250 ms of entering
export const HOVER_ACK_GLANCE_MS = 400;   // how long the glance itself takes
export const WORK_MODE_FADE_AFTER_MS = 3_000;
export const WORK_MODE_FADE_OPACITY = 0.35;
export const WORK_MODE_FADE_MS = 250;     // --dur-overlay
export const WORK_MODE_DEFAULT = false;   // "opt-in, default off"
```

| From | Event | To | Effects |
|---|---|---|---|
| `out` | picker reports opaque (§6) | `acknowledging` | within `HOVER_ACK_MAX_MS`: gaze lane `source:'touch'` lease to the cursor for `HOVER_ACK_GLANCE_MS`; `BehaviourRunner.setFrozen(true)` (D7's "wandering freezes"); `arb:trace {kind:'hoverAck'}` |
| `acknowledging` | glance ends | `held` | gaze returns to `follow`; the freeze stays |
| `held` | cursor still, > `WORK_MODE_FADE_AFTER_MS`, work mode ON | `faded` | model opacity → 0.35 via `setModelOapcity()` (**note the Framework's typo**, §0.2) over 250 ms; send `arb:passthrough {faded:true}` |
| `faded` | cursor leaves | `out` | opacity → 1.0; `arb:passthrough {faded:false}`; `setFrozen(false)` |
| `held` / `acknowledging` | cursor leaves | `out` | `setFrozen(false)` |
| `acknowledging` / `held` | **click on an opaque pixel** | (unchanged) | bar §0's *"click before any fade → opens chat"*: the pet renderer sends `chat:open {source:'pet', focusComposer:true}` and main answers with `requestChat('pet', true)` (FW-4). It is a **single** click here, and it does **not** replace Phase 2's double-click — it fires only on a click whose press landed while `hoverAck` had already fired, so the tap reaction (§5.11) and the chat open are the same gesture and both happen. `hover-ack.test.ts` pins that a click before `WORK_MODE_FADE_AFTER_MS` produces exactly one `chat:open` |
| `faded` | click on an opaque pixel | — | **impossible by construction**: a faded window is pass-through, so the click reaches whatever is behind her. That is the point of the fade, and it is why the criterion reads "click *before any fade*" |
| `faded` | cursor leaves **and re-enters** | `acknowledging` | *"regains clickability the moment the cursor leaves and re-enters"* — the leave already restored pass-through, so the re-entry is an ordinary enter |

Work mode is a kv flag (`ui_work_mode`) toggled from the tray (`工作模式`), default off. The global
pass-through hotkey **does not exist and is deferred**: the preflight verified that the only global
shortcut registered anywhere is `Control+Shift+Space` → `requestChat('hotkey', true)`
(`apps/desktop/src/main/index.ts:405`) — neither bar §0's implied toggle nor D13's `Ctrl+Alt+H` is
in the codebase. Phase 3 ships work mode as a **tray checkbox only**; a global pass-through hotkey
and D13's `Ctrl+Alt+H` panic-hide land with the settings surface that can rebind them (Phase 4,
§13.2). `avatar:hover` keeps its Phase 1 meaning and its
50 ms debounce — `arb:passthrough` is a **second, independent** reason main may force click-through,
and main ORs the two.

### 5.10 D5 — the return reaction

D5: *"Absence awareness: **≥ 5 min without input** → nap/slack state; on return, visibly notices the
user **within 1 s**."*

On `sim:event {kind:'returned'}` the arbiter runs a fixed, non-negotiable sequence — it does **not**
go through the selector, because a bag draw could take up to `nextDecisionAt` and blow the 1-second
budget:

```
t+0   ms : gaze lane, source 'sim', ttl 900 ms -> snap to the cursor with a SHORTENED 120 ms ease
t+0   ms : blink layer -> force one blink now (the startle cue, research §5)
t+120 ms : expression lane, source 'sim', ttl 1200 ms -> F06 at weight 0.4 (eyes widen)
t+150 ms : body lane, source 'sim', ttl 1500 ms -> motion TapBody[0] at MOTION_FADE_TOUCH_S
t+1500ms : all three release -> BehaviourRunner.update() re-decides normally
```

The whole reaction is inside 1 s of the `sim:event`, and the `sim:event` is inside 500 ms of the OS
input (§3.3). Boundary test B-01 asserts the trace shows a `laneGrant` with `source:'sim'` within
1 000 ms of the `returned` record.

### 5.11 D6 — body-part touch, the 7-taps burst, and the cooldown

D6: *"Body-part-aware touch: head / face / body / one ticklish zone with distinct reactions;
**≥ 7 taps in 1 s** → annoyed reaction + cooldown."*

```ts
// apps/desktop/src/renderer/shared/lane-metrics.ts — the ONE home (§5.13).
// `stage/touch.ts` re-exports these; `packages/sim`'s SIM_DEFAULTS mirrors the first three with an
// equality test, because it may not import from apps/desktop (§1.2). Nothing re-declares them.
export const TAP_BURST_COUNT = 7;          // ">= 7 taps in 1 s"
export const TAP_BURST_WINDOW_MS = 1_000;
export const ANNOY_COOLDOWN_MS = 4_000;    // suppresses NORMAL tap reactions; the annoyed one plays
export const TAP_SLOP_DIP = 4;             // Phase 1's TAP_SLOP_PX, promoted to a shared constant
```

The burst detector is an **8-slot ring buffer of monotonic timestamps** (research §4 — this is
original design; no precedent exists in Shimeji, VPet, Tamagotchi or Nintendogs). It triggers when
`now - buf[(i - 6 + 8) % 8] < TAP_BURST_WINDOW_MS`, i.e. seven taps inside one second.

Per-part reactions, bound against the §4.9 resources (all real):

| Part | Motion | Expression (weight) | Gaze | Overlay |
|---|---|---|---|---|
| `head` | `TapBody[0]` | `F02` (0.55 × `touchVariantIntensity`) | `cursorLock` | `headTilt` |
| `face` | `TapBody[1]` | `F07` (0.60 × …) | `down` | `blush` |
| `hair` | `TapBody[3]` | `F01` (0.45 × …) | `cursorLock` | `headTiltHold` |
| `body` | `TapBody[2]` | `F01` (0.40 × …) | `follow` | `none` |
| `arm` | `TapBody[3]` | `F06` (0.40 × …) | `cursorLock` | `leanRight` |
| `ticklish` | `TapBody[0]` | `F02` (0.65 × …) | `away` | `leanLeft` |
| **annoyed** (burst) | `TapBody[1]` | `F03` (0.70, **not** scaled — R3-13's caps stay hard) | `away` | `headTilt` |

`touchVariantIntensity` is `livelinessMap(L).touchVariantIntensity` (0.65 at the default). R3-13:
*"a touch is ALWAYS answered"* — liveliness scales the **variant intensity**, never the probability,
and `touch.test.ts` asserts a reaction is produced for every accepted tap at `L = 0`.

During `ANNOY_COOLDOWN_MS` after a burst, further taps still send `arb:touch` (so the sim and the
trace see them) but produce **no** body/expression lease — the annoyed reaction is the last word
until the cooldown expires. Bar §0's *"Tap motions fade-in ≤ 120 ms"* is `MOTION_FADE_TOUCH_S`, and
the acknowledgement is applied with **zero fade on the same frame** as the pointer-down (research
§4); only the return eases.

### 5.12 X13 — sound

X13: *"Sound (P3): tap/notification SFX with mute/volume; accessibility: labelled settings controls,
high-contrast survives."*

Phase 3 ships the **audio half only**; the labelled settings controls are Phase 4 with the settings
window (R3-18), and that split is recorded in §13.

```ts
// apps/desktop/src/renderer/pet/stage/sfx.ts  — CREATE, owner T3-B
export const SFX = {
  tap: 'tap.ogg', annoyed: 'annoyed.ogg', land: 'land.ogg', proactive: 'notify.ogg',
} as const;
export const SFX_VOLUME_DEFAULT = 0.35;
export const SFX_MIN_INTERVAL_MS = 120;      // rate-limit so a tap burst is not a machine gun
export class SfxPlayer {
  constructor(baseUrl: string);
  setMuted(muted: boolean): void;
  setVolume(v: number): void;                 // 0..1
  play(name: keyof typeof SFX, gain?: number): void;
}
```

Assets live at `apps/desktop/public/sfx/*.ogg`. **Provenance is pinned, because "CC0 or self-made"
is not a source:** each of the four is generated by `scripts/make-sfx.mjs` — a ~40-line synthesiser
(a windowed sine/noise burst per sound, written to Ogg Vorbis) committed alongside the assets, so
the files are reproducible, self-made by construction, and carry no third-party licence at all. Each
is **≤ 24 KB** and **≤ 400 ms**. `NOTICE` gains one line: *"Sound effects in
`apps/desktop/public/sfx/` are generated by `scripts/make-sfx.mjs` and are part of this project's
MIT-licensed source."* If a hand-made replacement is ever substituted it must be CC0 with the source
URL recorded in `NOTICE`; nothing else may be committed there.
Mute and volume are kv keys `ui_sfx_muted` / `ui_sfx_volume`, exposed through a **new** tray
checkbox `静音` (§3.5's menu). C11 lists `静音` as a *requirement*; the shipped menu on `main`
(`tray.ts:49-58`) does **not** contain it, so Phase 3 adds it — no new window. **Volume has no
Phase 3 UI**: it is a kv value with the `SFX_VOLUME_DEFAULT` default, and the slider is Phase 4's
(§13.2), which is also where X13's "labelled settings controls" land. **Haru's `TapBody` motions each reference a `.wav`
in the model bundle; those are never played** (Phase 1's decision, unchanged — they are Japanese
voice lines for a different character).

### 5.13 `renderer/shared/lane-metrics.ts`

> **Amended by A3-5 (R3-43):** the permitted-duplication list is four pairs, not one — the
> `SIM_DEFAULTS` mirror below, `NEAR_DUPLICATE_JACCARD`/`FACT_MERGE_JACCARD`, the two `proactive_log`
> constants against `SIM_DEFAULTS`, and `FACT_MAX_CHARS` against `EXTRACT_VALUE_MAX`/`EXTRACT_ALIAS_MAX`.
> Each carries an identity assertion in the earliest file that can see both sides.

The one home for every constant main and the pet renderer both need — the same discipline
`chat-metrics.ts` established in Phase 2 §6.1. It contains §5.5's motion/fade/pre-empt constants,
§5.11's `TAP_SLOP_DIP`, `TAP_BURST_COUNT`, `TAP_BURST_WINDOW_MS` and `ANNOY_COOLDOWN_MS`, and §7's
`DRAG_*` / `FLING_*` / `LANDING_*` numbers. `main/window-motion.ts` and
`renderer/pet/stage/touch.ts` **re-export** them and re-declare none.

`packages/sim` is the one consumer that cannot import them — it may depend only on `@ds/protocol`
and `zod` (§1.2) — so `SIM_DEFAULTS` mirrors the three touch constants and
`packages/sim/src/state.test.ts` **imports both and asserts they are equal**. A mirror with an
equality test is the only duplication this contract permits, and only here.

### 5.14 `pet/main.ts` and `packages/stage` changes

`apps/desktop/src/renderer/pet/main.ts` gains, and nothing else:

- `bridge.on(Channels.simState, …)` → `facts` for the selector + `fpsState` inputs + the mode plate.
- `bridge.on(Channels.simEvent, …)` → the arbiter's one-shot reactions (§5.10, §5.11).
- `bridge.on(Channels.simWindowMotion, …)` / `simLanding` → `drag-visual.ts`.
- `bridge.on(Channels.modeChanged, …)` → in `plain` mode the arbiter refuses every `source:'llm'`
  command and holds the baseline expression (R3-12).
- The `Arbiter`, `BehaviourRunner`, `BehaviorSelector` and `Picker` construction, after
  `Live2DStage.create` resolves and `bindResources` succeeds.
- `press.ts` rewired to `arb:grab` / `arb:release` (§7.2) instead of `avatar:drag` / `avatar:dragEnd`.
- `__stage` (the `?test=1` hook) gains `arbiter(): { lane: Lane; source: LaneSource | null; generation: number }[]`
  and `behaviour(): string | null`, both added to the exported `StageTestHook` interface (Phase 2
  §5.7's rule: the interface is imported by the specs, so the object literal alone would not
  typecheck).

`packages/stage` changes, exactly **seven**:

1. `CompanionModel.setExpressionFades(inS: number, outS: number)` — applies `setFadeInTime` /
   `setFadeOutTime` to every loaded expression. Called with `(0.30, 0.30)` at load (§5.4).
2. `CompanionModel.setExpressionWeight(name: string, w: number)` — `ACubismMotion.setWeight` on the
   named expression; the arbiter is the only caller and must reset to `1.0` on release (§5.4).
3. `CompanionModel.autoIdle: boolean` (default **`true`** so Phase 1/2 behaviour is unchanged). The
   pet renderer sets it to `false` before `stage.start()`: with the arbiter owning the body lane,
   `tick()`'s internal `if (isFinished()) startMotion(idleGroup, …)` would be a second owner.
4. `CompanionModel.startMotionForced(group, index, fadeInS, onFinished?)` — sets the motion's
   fade-in, then `startMotion(group, index, Priority.force, onFinished)`. Every arbiter-issued motion
   goes through it (§5's opening note).
5. **`Live2DStage.currentProjection(): CubismMatrix44`** — without it §6.2's
   `Picker.pick(clientX, clientY, projection)` has **no supplier**: `Live2DStage.projection(w, h)` is
   `private` and rebuilds a `new CubismMatrix44()` on every call (`packages/stage/src/stage.ts:178-189`).
   The accessor returns the matrix the **last drawn frame** used — `frame()` stores it in a field
   before `model.draw(...)` and `currentProjection()` returns a clone, so a pick can never mutate the
   renderer's matrix and can never read a half-built one. Before the first frame it returns the
   matrix `resize()` computed, which is the same one `hitTestClient` already uses today.
6. **`CompanionModel.addUpdater(u: ICubismUpdater): void`** — without it §5.7's overlay layer
   **cannot register**: the scheduler is `private readonly scheduler = new CubismUpdateScheduler()`
   (`companion-model.ts:67`). `addUpdater` calls `scheduler.addUpdatableList(u)` and then
   `scheduler.sortUpdatableList()`, so an updater added after `setup()` still lands in execution
   order — which is what puts the overlay at 450, between `Drag 400` and `Breath 500` (§0.2). It is a
   no-op after `release()`.

7. **`CompanionModel.parameterIds(): readonly string[]`** — §4.7's `ResourceCatalogue.parameters`
   ("parameter ids the model actually declares") is reachable only through
   `CubismModel.getParameterCount()` / `getParameterId(i)` (`cubismmodel.ts:641`, `:690`), and
   `CompanionModel` exposes no accessor. Without it `bindResources` cannot check that an overlay
   preset's parameters exist, and §4.1's "an overlay preset touches a parameter the model does not
   declare" drop rule is unenforceable. Computed once at the end of `setup()` and cached.

`packages/stage/src/companion-model.ts` and `stage.ts` already have owner rows in §1.5 (T3-B); items
5, 6 and 7 are additions to those same two files, not new ones.

---

## §6 Opaque-pixel hit-testing (R3-6)

D6: *"Hit-testing is **opaque-pixel** (alpha readback), shared by hover, click-through and HitArea
resolution; HitArea names normalized (Head/HitAreaHead/头)."*

R3-6 makes this a **reference-renderer contract**: the reference is the framebuffer alpha and a
semantic-id pass; hover may use a cheaper predicate **only if it passes the §6.5 gate**; press is
always a GPU read.

> Live2D's own `isHit` is a **bounding box** — verified in
> `vendor/CubismWebFramework/src/model/cubismusermodel.ts`: it walks `getDrawableVertices` for
> `left/right/top/bottom` and does a rectangle containment test. No alpha, no triangles. Haru's
> `Head` box is a rectangle over the head mesh, so a click in the empty corner above the shoulder
> registers as `Head` today. D6's requirement must be **built**, not configured.

### 6.1 The three paths, and which one is authoritative for what

| Path | Used for | Authority | Cost |
|---|---|---|---|
| **CPU mesh + texture alpha** (§6.2) | hover, click-through, part attribution | candidate — ships only if it passes §6.5 | measured, must be ≤ 0.2 ms p95 per move |
| **1-px GPU read of the current frame** (§6.3) | **press**: pointer-down, tap, drag begin | **always authoritative** (R3-6b) | one `readPixels(1,1)` per press |
| **¼-scale FBO + async fence** (§6.6) | hover, if the CPU predicate fails the gate | fallback | one 105×180 read per 150 ms |

Phase 1's `Live2DStage.hitTestClient` (bounding-box `isHit`) is **kept** as the third rung of the
ladder and as the browser-harness path, but it is no longer what `HoverTracker` or `PressTracker`
consume.

### 6.2 The CPU predicate — exact algorithm

```ts
// packages/stage/src/picker.ts
export interface PickResult {
  /** Composited alpha at the point, 0..255. 0 means fully transparent. */
  alpha: number;
  /** The semantic part of the topmost PARTICIPATING drawable with its own alpha >= PART_MIN. */
  part: HitPart | null;
  /** Model-local coordinates of the point, [-1, 1] on both axes (the drag anchor, §7.2). */
  modelX: number;
  modelY: number;
}
export class Picker {
  constructor(model: CompanionModel, map: HitPartMap, textures: readonly ImageData[]);
  /** The predicate. `projection` MUST be the same matrix the frame drew with. */
  pick(clientX: number, clientY: number, projection: CubismMatrix44): PickResult;
  /** Invalidated by a texture reload or a model swap. */
  dispose(): void;
}
```

Steps, in this order, every one load-bearing:

1. **Same MVP as rendering.** `client px → device px` (through the canvas' `getBoundingClientRect`,
   exactly as `Live2DStage.toDevice` already does) `→ NDC → view` via
   `projection.invertTransformX/Y` `→ model space` via `modelMatrix.invertTransformX/Y`.
   The composition is the inverse of the frame's `NDC = projection · modelMatrix · vertex`
   (`Live2DStage.projection()` composes only `scale` / `scaleRelative` / `translateRelative` and the
   `CubismViewMatrix` — `packages/stage/src/stage.ts:178-189`, read on `main` — so it holds only
   scales and translations and the component-wise inverse is exact. §0.2 has no row for this; the
   source line is the citation). **Run after `model.update()`**, so `getDrawableVertexPositions` returns deformed vertices.
2. **Iterate drawables in descending render order.** `getRenderOrders()` returns an `Int32Array`
   indexed by drawable index; sort indices by that value descending — **render order, never index
   order** (GPT §B).
3. **Skip a drawable** when any of these holds:
   `!getDrawableDynamicFlagIsVisible(i)`;
   `getDrawableOpacity(i) * getModelOapcity() < DRAWABLE_MIN_OPACITY`;
   `getPartOpacityByIndex(getDrawableParentPartIndex(i)) < DRAWABLE_MIN_OPACITY`;
   the `hitParts` entry for its parent part has `participatesInHitTest: false`.
   (Note the Framework's typo `getModelOapcity()` — §0.2.)
4. **Point-in-triangle** over the drawable's index buffer (`getDrawableVertexIndices(i)`, triples)
   against `getDrawableVertexPositions(i)` (interleaved `x, y`). Barycentric test with the standard
   sign-consistency form. **Culling is honoured**: when `getDrawableCulling(i)` is true, a triangle
   whose signed area is negative (back-facing under Cubism's CCW front) is skipped — a culled
   triangle is not drawn, so it cannot be hit.
   A per-drawable AABB from the same vertex array rejects ~95 % of drawables before any triangle
   maths; the AABB is recomputed per pick, not cached, because the vertices deform every frame.
5. **Barycentric UV.** Interpolate `getDrawableVertexUvs(i)` with the same weights.
6. **Bilinear texture alpha** from the cached `ImageData` of `getDrawableTextureIndex(i)`.
   `u` maps to `px = u * (w - 1)`; **`v` is OpenGL-style (origin bottom-left) while `ImageData` is
   top-down**, so `py = (1 - v) * (h - 1)`. Bilinear, not nearest — GPT §B: *"nearest disagrees on
   thin hair and antialiased edges"*, and those are precisely the samples the §6.5 gate weights.
7. **Clipping masks.** `getDrawableMasks()[i]` lists the mask drawable indices,
   `getDrawableMaskCounts()[i]` their count. When the count is > 0:
   `coverage = max over mask drawables of (their own step-4→6 alpha at the point)`; if
   `getDrawableInvertedMaskBit(i)` is true, `coverage = 1 - coverage`. Masks are themselves never
   masked (Cubism forbids nesting), so the recursion is exactly one level deep. Mask **deformation
   and opacity are included**, because the mask's alpha is computed with the same steps against the
   same deformed vertices.
8. **Blend-mode policy, declared.** `CubismBlendMode_Normal (0)` contributes its alpha.
   `Additive (1)` and `Multiplicative (2)` are decorative (highlights, shadow multiply): they
   contribute **0** to the accumulated alpha and never attribute a part. They do not block either —
   iteration continues past them. This is GPT §B's *"additive highlights, blush and shadows must not
   steal hits from face/torso"*, made explicit rather than left to the `hitParts` flags alone.
9. **Accumulate front-to-back** with the over operator:
   `a_i = texAlpha/255 · drawableOpacity · modelOpacity · partOpacity · maskCoverage`,
   `acc ← acc + a_i · (1 − acc)`. Early-out when `acc ≥ 0.99`.
10. **Attribution.** `part` = the `hitParts` part of the **first** (topmost) participating drawable
    whose own `a_i ≥ PART_ATTRIBUTION_MIN`, overridden by `ticklishRect` when the model-space point
    falls inside it. When no drawable qualifies but `acc ≥ ENTER_ALPHA/255`, `part = hitPartDefault`.
11. **Result:** `alpha = round(acc · 255)`.

```ts
export const ENTER_ALPHA = 10;              // R3-6d: enter when alpha >= 10/255
export const LEAVE_ALPHA = 4;               // R3-6d: leave when every sample < 4/255
export const LEAVE_RADIUS_DIP = 5;          // R3-6d: a 5-DIP radius, 9 samples
export const LEAVE_SAMPLES = 9;             // centre + 8 at 45-degree steps
export const DRAWABLE_MIN_OPACITY = 0.01;
export const PART_ATTRIBUTION_MIN = 0.10;
export const MOVE_EPS_DIP = 2;              // skip re-evaluation for a move under 2 DIP
export const STATIONARY_REPICK_HZ = 5;      // R3-6: <= 5 Hz under a stationary pointer while animating
```

**Hysteresis, exactly (R3-6d):** the hover state enters when the single exact-point alpha is
`>= ENTER_ALPHA`, and leaves only when **all nine** samples on the `LEAVE_RADIUS_DIP` circle
(centre plus eight at 45° steps) are `< LEAVE_ALPHA`. AIRI's asymmetry, adopted for the reason AIRI
states: it stops `setIgnoreMouseEvents` thrashing at the silhouette edge. IPC is emitted only on
boolean flips, and a pointer move under `MOVE_EPS_DIP` skips the pick entirely.

**When it runs (R3-6):** on pointer move (subject to `MOVE_EPS_DIP`), at ≤ `STATIONARY_REPICK_HZ`
under a stationary pointer **while the model is animating**, and at press with the exact
coordinates. Never once per frame.

### 6.3 Press-time truth — the 1-px GPU read (R3-6b)

```ts
// packages/stage/src/picker-gpu.ts
export interface PendingPress { pressId: number; deviceX: number; deviceY: number }
export class GpuPressReader {
  /** Queued from the pointer-down handler; serviced inside the NEXT frame. */
  queue(p: PendingPress): void;
  /** Called by Live2DStage.frame() IMMEDIATELY after model.draw(), before the RAF returns. */
  service(gl: WebGL2RenderingContext): { pressId: number; alpha: number } | null;
}
```

- The read is `gl.readPixels(x, height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)` against the
  **default framebuffer**, issued inside the same RAF callback as the draw, so the backbuffer is
  still valid and `preserveDrawingBuffer` is **not** required (research §4 flags AIRI's
  `preserveDrawingBuffer: true` as the thing not to copy).
- It is **one pixel**, once per press. MDN classes `readPixels` as "finish + round-trip"; at press
  rates (single digits per second) that is a non-issue, and it is the only way press correctness can
  be independent of a fence or a CPU approximation (R3-6b).
- Latency: the press is serviced on the next frame — ≤ 33 ms at 30 Hz, and the ticker is already
  bumped to 60 Hz on pointer-down (§5.8), so ≤ 17 ms in practice. `PressTracker` therefore emits
  `arb:grab` on the frame after the pointer-down, not synchronously in the DOM handler.
- **The GPU alpha is the decision.** `alpha >= ENTER_ALPHA` → the press is on the model
  (drag begin / tap accepted); below → the press is off-model and is ignored, exactly as
  `PressTracker.offModel` already handles it.
- **The part is attributed by the CPU predicate at the same point.** R3-6b's "alpha/id target" is
  satisfied on the alpha branch — the binding on/off decision comes from the framebuffer — and a
  full semantic-id pass is built only for the oracle (§6.5), where it is the reference. When the two
  disagree (GPU says on-model, CPU says off), the **GPU wins** and the part falls back to
  `hitPartDefault`; every disagreement is emitted as `arb:trace {kind:'touch', value: alphaDelta}`
  so the §6.5 error rate is measured in production, not only in the test.

### 6.4 `hitParts` — the map and its resolution rule

The schema, the Haru values and `ticklishRect` are in **§4.10**. Two rules govern its use:

- **Keyed by Cubism PART id, not ArtMesh id.** R3-6c says `drawableId → part`; part ids are the
  **stable, committed** identifiers (`Haru.cdi3.json`, §0.2) while ArtMesh ids live inside the
  gitignored `moc3` and cannot be written into a committed file without inspecting a binary the
  repo does not carry. The resolution is one extra hop —
  `drawableIndex → getDrawableParentPartIndex → getPartId → string` — and it is strictly more
  robust: a re-export that renames meshes but keeps parts still binds.
  **A per-drawable override is still available**: any key in `hitParts` that is not a part id is
  matched against the drawable id, and the drawable match wins. Haru needs none.
- **HitArea name normalisation (D6)** stays: `Head` / `HitAreaHead` / `头` all normalise to `head`
  before lookup, in `packages/stage/src/character.ts`'s existing `tapMotions` resolution. Phase 3
  adds `normalizeHitArea(name: string): HitPart | null` there and uses it for the legacy
  `avatar:tap` path only; `arb:touch` never goes through it.

`bindResources` (§4.7) validates `hitParts` too: every key must resolve to a real part id (or
drawable id) and every value's `part` must be a `HIT_PARTS` member. An unknown key is a **binding
warning**, not a failure — a model may legitimately be missing a part another bundle has.

### 6.5 The oracle test and the R3-6 gate

R3-6e, verbatim: *"over ≥ 20 000 boundary-weighted samples (≥ 50 % within 3 px of an alpha edge or
hole, every part represented) **false-positive rate ≤ 0.5 % AND false-negative rate ≤ 0.5 %**, and
per-move cost ≤ 0.2 ms p95 excluding the model update; whichever hover implementation passes
ships (CPU first; FBO if CPU fails)."*

```
apps/desktop/tests/picker-oracle.spec.ts     Playwright, browser lane, ?test=1&seed=1
docs/evidence/phase3/picker-oracle.json      the machine-readable result (committed)
docs/evidence/phase3/picker-oracle.md        the human summary incl. the HARDWARE line (R3-6e)
```

Procedure, exact:

1. Load Haru at the shipping canvas size with `devicePixelRatio` forced to **1.5** (the machine's
   150 % scale, §0.2) and a seeded rng.
2. For each of **12 poses** — `Idle[0]` at t = 0/2/5 s, `Idle[1]` at t = 0/2 s, each `TapBody[0..3]`
   at t = 1 s, plus one frame with `F05` (eyes closed, a clipping-mask case) and one with the
   `blush` overlay active — freeze the frame (`stage.stop()` after a manual `frame(dt)`).
3. Render the frame, then render the **semantic-id pass** into an RGBA8 FBO of the same size: every
   participating drawable drawn with a flat colour `R = partIndex + 1`, `A` = its own composited
   alpha, using the model's real MVP, masks and culling. This pass exists **only in the test**
   (`picker-gpu.ts`'s `renderIdPass`, tree-shaken from production by `import.meta.env.DEV`).
4. Draw **≥ 20 000 sample points** per the weighting rule: at least 50 % are within 3 device px of
   an alpha edge (found by a Sobel pass over the framebuffer alpha) or inside a transparent hole
   enclosed by opaque pixels; the rest are uniform over the canvas; every `HIT_PARTS` member that
   the model exposes must appear ≥ 200 times in the reference.
5. For each sample compare `Picker.pick(...)` against the reference:
   - **false positive** = predicate `alpha >= ENTER_ALPHA` while reference alpha `< ENTER_ALPHA`;
   - **false negative** = predicate `alpha < ENTER_ALPHA` while reference alpha `>= ENTER_ALPHA`;
   - **part mismatch** counted and reported separately (it is not part of the pass/fail gate, but a
     part-mismatch rate above 2 % is recorded as a finding).
6. Timing: `performance.now()` around `Picker.pick` alone, 20 000 calls, report p50/p95/p99
   **excluding** `model.update()`.

Pass/fail, exactly R3-6e:

| Metric | Gate |
|---|---|
| false-positive rate | **≤ 0.5 %** |
| false-negative rate | **≤ 0.5 %** |
| `pick` cost p95 | **≤ 0.2 ms** |
| samples | **≥ 20 000**, ≥ 50 % boundary-weighted, every exposed part ≥ 200 |

`picker-oracle.md` must record the hardware line (R3-6e): CPU, GPU/driver, Windows build, display
scale. On this machine that is **Windows 11 Home 10.0.26200, integrated GPU, 3840×2160 @ 150 %** —
the GPU model is filled in by the run, not asserted here.

**If the CPU predicate fails either rate gate or the timing gate, the FBO fallback (§6.6) ships
instead**, and the same oracle is re-run against it with the same gates. The plan's fallback task is
conditional on this artefact; nothing else in Phase 3 changes, because both implementations satisfy
the same `Picker` interface.

### 6.6 The FBO fallback contract (R3-6a alternative)

```ts
// packages/stage/src/picker-gpu.ts
export const FBO_SCALE = 0.25;              // quarter scale: ~105 x 180 for a 420 x 720 window
export const FBO_REFRESH_MS = 150;          // R3-6a: "refreshed with an async fence every 150 ms"
export class FboPicker /* implements the same surface as Picker */ {
  /** Called from Live2DStage.frame(): re-draws the model into the quarter-scale FBO. */
  capture(gl: WebGL2RenderingContext, projection: CubismMatrix44): void;
  /** Starts an async readback if none is in flight and FBO_REFRESH_MS has elapsed. */
  poll(gl: WebGL2RenderingContext, nowMs: number): void;
  pick(clientX: number, clientY: number, projection: CubismMatrix44): PickResult;
}
```

- Readback is MDN's `readPixelsAsync` recipe: bind `PIXEL_PACK_BUFFER`,
  `bufferData(..., STREAM_READ)`, `readPixels(..., 0)`, `fenceSync(SYNC_GPU_COMMANDS_COMPLETE, 0)`,
  poll `clientWaitSync(sync, 0, 0)` from the ticker, then `getBufferSubData`. **Never a synchronous
  `readPixels` on the mouse path** and **never `gl.getError()` in the loop** (MDN: "flush +
  round-trip").
- The CPU mask is `Uint8Array(w*h*4)` ≈ 75 KB, held for the life of the stage.
- A 1–2-frame-stale silhouette is invisible for hover; an immediate re-capture is forced on motion
  start and on `resize()`.
- **Part attribution in this mode** comes from the same `hitParts` map through the CPU predicate's
  steps 1–5 and 10 (mesh only, no texture sampling) — the FBO carries alpha, not identity.
- **Press is unchanged**: §6.3's 1-px read of the default framebuffer, whichever hover path ships.
- If `fenceSync` is unavailable, the ladder's last rung is Phase 1's `isHit` bounding boxes, and the
  app logs one line saying hover precision is degraded. That rung never satisfies D6 and is a
  crash-avoidance path, not a shipping configuration.

---

## §7 `main/window-motion.ts` — `WindowMotionController` (R3-5)

D8: *"Drag has weight: dangling pose leans with cursor velocity; **release velocity from the last 4
samples**; gravity, edge bounce with decay, tumble + landing squash + stand-up. A fast fling shows
visible travel."*
D9: *"Grounded: **floor = work area (taskbar excluded)** … **never off-screen**, restored to a
visible corner at launch."*

R3-5 gives main the whole locomotion lane. The renderer **never calls `setPosition`** and never runs
the physics; it renders lean and squash from the 30 Hz snapshots (§5.5).

### 7.1 The API

```ts
// apps/desktop/src/main/window-motion.ts
import { CHAT_GAP } from '../renderer/shared/chat-metrics';
export {
  DRAG_STIFFNESS, DRAG_DAMPING_RATIO, DRAG_MAX_LAG_DIP, FLING_VELOCITY_CAP,
  GRAVITY_DIP_S2, BOUNCE_RESTITUTION, REST_SPEED_DIP_S, WALK_SPEED_DIP_S,
} from '../renderer/shared/lane-metrics';           // §5.13: one home, re-exported here

export interface WindowMotionDeps {
  pet: BrowserWindow;
  /** screen.getCursorScreenPoint(), injected so the motor is testable without Electron. */
  cursor(): { x: number; y: number };
  /** Work areas of every current display, DIP. */
  workAreas(): Rect[];
  /** The work area of the display the pet is on, DIP. */
  workArea(): Rect;
  setPosition(x: number, y: number): void;
  setClickThrough(ignore: boolean): void;
  /** Suspends/resumes the `avatar:hover` -> click-through switching (R3-5). */
  suspendHoverSwitching(suspend: boolean): void;
  send(channel: 'sim:windowMotion' | 'sim:landing', payload: WindowMotion | Landing): void;
  persist(x: number, y: number): void;              // -> savePetPosition (window.json)
  now?: () => number;                                // monotonic ms; default hrtime
}

export type MotionPhase = 'rest' | 'drag' | 'fling' | 'walk' | 'settling';

export class WindowMotionController {
  constructor(deps: WindowMotionDeps);
  /** From `arb:grab`. Starts a new generation and the drag. */
  grab(p: { pressId: number; modelX: number; modelY: number; screenX: number; screenY: number }): void;
  /** From `arb:release`. `wasTap` true -> settle in place, no fling. */
  release(p: { pressId: number; wasTap: boolean }): void;
  /** From an LLM `walkTo` (§2.6) or an idle `wander` behaviour. Returns the typed outcome. */
  walkTo(anchor: WalkAnchor, source: 'llm' | 'behaviour'): WalkOutcome;
  /** display-removed / display-metrics-changed. Rebases the active episode (R3-5). */
  rebase(): void;
  /** Cancels any live episode with `cancelled`; used by dispose and by VisibilityState hide. */
  cancel(): void;
  dispose(): void;
  readonly phase: MotionPhase;
  readonly generation: number;
}

/** Convai's typed outcome taxonomy (research §8), so a failed walk is never a silent stall. */
export type WalkOutcome =
  | 'started' | 'alreadyAtDestination' | 'unreachable' | 'busy' | 'unknownDestination';
```

### 7.2 The grab / release protocol

1. Pointer-down in the pet renderer → `GpuPressReader.queue` (§6.3) → next frame's 1-px read.
2. `alpha >= ENTER_ALPHA` → `PressTracker` sends **`arb:grab`** with the part, the model-local
   anchor and the **global** cursor at press. `alpha < ENTER_ALPHA` → nothing is sent (off-model).
3. Main's `grab()`: `generation++`, `phase = 'drag'`, stores
   `offset = windowTopLeft − cursorAtPress`, calls `suspendHoverSwitching(true)`, and **keeps the
   window interactive** (R3-5: *"during a user drag the pet window stays interactive"*).
4. From then on main reads the **global cursor** every motor step — never renderer deltas. R3-5's
   *"follows GLOBAL cursor state after the cursor leaves the window"*; it is also what makes the
   weight lag safe, because the pointer may legitimately be outside the window while the spring
   catches up.
5. Pointer-up → `arb:release {pressId, wasTap}`. A `pressId` that does not match the live grab is
   ignored (a stale release from a superseded press).
6. `wasTap === true` (travel < `TAP_SLOP_DIP`) → `phase = 'settling'` with zero velocity; the tap
   reaction is the renderer's (§5.11). Otherwise → `phase = 'fling'` with §7.5's release velocity.

`PressTracker`'s existing recovery paths are kept verbatim: a `buttons === 0` observed during a move
still ends the press, and the release that arrives afterwards is consumed rather than re-fired.

### 7.3 The integrator

Research §4 / Fiedler: **semi-implicit Euler at a fixed substep with an accumulator**, never a
variable-dt step.

```ts
export const MOTOR_HZ = 60;                 // R3-5: "at 60 Hz on the GLOBAL cursor"
export const MOTOR_SUBSTEP_S = 1 / 120;     // two substeps per motor frame
export const MOTOR_FRAME_CLAMP_S = 0.25;    // Fiedler's frameTime clamp
export const SNAPSHOT_HZ = 30;              // R3-5: sim:windowMotion at 30 Hz
```

The motor runs on a `setInterval(1000 / MOTOR_HZ)` that exists **only while `phase !== 'rest'`** —
there is no always-on 60 Hz timer, which is what keeps the idle CPU budget (bar §0: ≤ 4 %). Each
frame: `acc += min(realDelta, MOTOR_FRAME_CLAMP_S)`, then `while (acc >= MOTOR_SUBSTEP_S)` run one
substep. The window position is written **once per motor frame**, not per substep.

### 7.4 Drag — the spring/damper (R3-5)

```ts
export const DRAG_STIFFNESS = 180;          // R3-5: "stiffness 180 N/m-equivalent"
export const DRAG_DAMPING_RATIO = 0.85;     // R3-5
export const DRAG_MASS = 1;
/** c = 2 * zeta * sqrt(k * m) = 2 * 0.85 * sqrt(180) = 22.808 */
export const DRAG_DAMPING = 2 * DRAG_DAMPING_RATIO * Math.sqrt(DRAG_STIFFNESS * DRAG_MASS);
export const DRAG_MAX_LAG_DIP = 24;         // R3-5: "max pointer lag 24 DIP"
```

Per substep, per axis:

```
target = cursor + offset                       # where the window would be with no weight
lag    = clamp(target - pos, -DRAG_MAX_LAG_DIP, +DRAG_MAX_LAG_DIP)
a      = (DRAG_STIFFNESS * lag - DRAG_DAMPING * v) / DRAG_MASS
v     += a * dt
pos   += v * dt
```

The lag clamp is what R3-5 means by *"max pointer lag 24 DIP"*: the window may trail the pointer, but
never far enough for the cursor to leave the avatar — which would break the drag the moment hover
switching resumes. Settling time at ζ = 0.85, ωn = √180 = 13.42 rad/s is ≈ 4.6/(ζ·ωn) ≈ **403 ms**,
in the same band as react-spring's default preset (research §4: 170/26, ≈ 364 ms).

`lagX`/`lagY` in the snapshot are this clamped lag; the renderer maps them to the lean (§5.5).

### 7.5 Release velocity, fling, gravity, bounce, landing

```ts
export const FLING_SAMPLES = 4;             // D8: "release velocity from the last 4 samples"
export const FLING_EMA_ALPHA = 0.5;         // research §4: Shimeji's dx = (dx + delta) / 2
export const FLING_VELOCITY_CAP = 2400;     // R3-5: "velocity cap 2400 DIP/s"
export const GRAVITY_DIP_S2 = 1800;         // R3-5
export const BOUNCE_RESTITUTION = 0.35;     // R3-5: "edge bounce with restitution 0.35"
export const BOUNCE_DECAY = 0.8;            // per bounce, on top of the restitution
export const REST_SPEED_DIP_S = 40;         // R3-5: "decaying to rest under 40 DIP/s"
export const AIR_DRAG_X = 1.28;             // vx *= exp(-1.28 * dt)   (research §4)
export const AIR_DRAG_Y = 0.35;             // gentle; gravity dominates
export const LANDING_MIN_IMPULSE = 120;     // below this no `sim:landing` is emitted
```

- **Release velocity:** a ring buffer of the **last 4** global-cursor samples with their monotonic
  timestamps. `v = Σ (Δpos/Δt) · EMA(α = 0.5)` over the three deltas, then clamped componentwise to
  `±FLING_VELOCITY_CAP`. Shimeji's EMA is copied deliberately — it exists so a thrown velocity does
  not snap to zero when the last sample happens to be a pause.
- **Fling substep:** `v.y += GRAVITY_DIP_S2 · dt`; `v.x *= exp(−AIR_DRAG_X·dt)`;
  `v.y *= exp(−AIR_DRAG_Y·dt)`; `pos += v·dt`.
- **Tunnelling sweep (R3-5):** each substep moves at most 20 DIP at the velocity cap, but the sweep
  is done regardless — the segment `pos → pos + v·dt` is intersected against the four work-area
  edges of the display it is on, and the **first** intersection is resolved before the remainder of
  the step is applied. Post-hoc clamping is explicitly rejected (research §4: *"a 2500 px/s fling
  moves 83 px per tick; substep or sweep"*).
- **Bounce:** on an edge hit, the normal component is reflected and scaled by
  `BOUNCE_RESTITUTION · BOUNCE_DECAY^n` where `n` is the bounce count of this episode; the tangential
  component is untouched. When `|v| < REST_SPEED_DIP_S` after a floor contact, the episode enters
  `settling`.
- **Landing:** the **first** floor contact of an episode with `|v.y| >= LANDING_MIN_IMPULSE` emits
  one `sim:landing {generation, impulse: |v.y| clamped to FLING_VELOCITY_CAP, edge}`. Later bounces
  of the same episode do not re-emit — the squash is the arrival, not every touch.
- **Tumble and stand-up (D8's two words the first draft dropped).** D8 asks for "tumble + landing
  squash + stand-up", and R3-5 for a "landing squash impulse". Both are renderer presentation, and
  both ride on data that already crosses: **tumble** is `ParamAngleZ` and `ParamBodyAngleZ` driven
  from the fling's own velocity while `phase === 'fling'` —
  `tumbleDeg = clamp(vx / FLING_VELOCITY_CAP, -1, 1) * TUMBLE_MAX_DEG` with
  `TUMBLE_MAX_DEG = 18`, eased at `TUMBLE_RATE = 4.0` s⁻¹ so a gentle drop does not spin; **stand-up**
  is the recovery half of the squash envelope (`SQUASH_RECOVER_MS = 160` with ~4 % overshoot,
  §5.5) plus a `STAND_UP_MS = 320` return of `tumbleDeg` to 0 on `easeOutCubic`. Neither adds a
  channel: both are computed in `drag-visual.ts` from `WindowMotionSchema`'s `vx`/`phase` and
  `LandingSchema`'s `impulse`. §12.5's interaction clip already asserts the fling arc and the
  landing; `drag-visual.test.ts` pins that `tumbleDeg` returns to 0 within
  `SQUASH_RECOVER_MS + STAND_UP_MS` of a landing.
- **Settling → rest:** the window is left where it is, `persist(x, y)` writes `window.json`, one
  final snapshot with `phase: 'rest'` is sent, the motor interval is cleared, `setClickThrough` is
  restored to the hover state and `suspendHoverSwitching(false)` is called.

### 7.6 `walkTo` (D14, R3-5)

```ts
export const WALK_SPEED_DIP_S = 120;        // R3-5: "walkTo (120 DIP/s)"
export const WALK_MIN_DISTANCE_DIP = 48;    // below this -> 'alreadyAtDestination'
export const WALK_MAX_MS = 12_000;          // hard budget; then 'unreachable' + settle
export const WALK_COOLDOWN_MS = 5_000;      // research §8: at most one walkTo per 5 s
```

Anchors resolve against the pet's current display work area `W` and the pet size `S` (420×720):

| Anchor | Target top-left |
|---|---|
| `left` | `(W.x + CHAT_GAP, currentY)` |
| `right` | `(W.x + W.width − S.w − CHAT_GAP, currentY)` |
| `center` | `(W.x + (W.width − S.w) / 2, currentY)` |
| `corner-bl` | `(W.x + CHAT_GAP, W.y + W.height − S.h)` |
| `corner-br` | `(W.x + W.width − S.w − CHAT_GAP, W.y + W.height − S.h)` |
| `home` | the position stored in `window.json` at launch |

Rules:

- Horizontal movement at `WALK_SPEED_DIP_S`, gravity still applied on the vertical axis so a walk
  off a ledge falls (the same integrator, `phase = 'walk'`).
- **At most one in flight, one per `WALK_COOLDOWN_MS`.** A `walkTo` arriving during one is
  **dropped, never queued** (research §8), returning `'busy'`. An unknown anchor returns
  `'unknownDestination'` and is logged with the raw token so grammar compliance is measurable.
- An active **drag outranks it**: `grab()` during a walk cancels the walk with `cancelled` and
  starts a new generation.
- **The window is forced click-through for the whole autonomous episode** (R3-5): `walk`, `fling`
  and `settling` all call `setClickThrough(true)`, so a pet flying across the desktop never
  intercepts a click. It is restored on `rest`. This is the opposite of a user drag, where the
  window stays interactive.
- The outcome is written to the trace and, for an `llm` source, logged as a `walkTo` compliance
  result (Convai's taxonomy, so a failed move is visible rather than a stall).

### 7.7 Clamps, display topology, persistence, and what moves out of `index.ts`

- **Every position the motor writes goes through Phase 1's `clampDrag(pos, workAreas(), MIN_GRABBABLE)`**
  (`main/window-state.ts`), which keeps **≥ 48 DIP** of the window inside *some* work area on both
  axes — R3-5's *"keeps Phase 1's 48-DIP grabbable rule"*. `MIN_GRABBABLE = 48` is already exported;
  the motor imports it rather than re-declaring it.
- **Floor = work area** (D9), i.e. the taskbar is excluded, because `clampDrag` and the sweep both
  operate on `screen.getAllDisplays().map(d => d.workArea)` — exactly what Phase 1 already does.
- **`rebase()`** is called from the existing `onDisplaysChanged` handler in `main/index.ts`. It
  re-reads the work areas, re-clamps the current position, and — if the episode is a `fling` or
  `walk` whose target is now on a display that no longer exists — retargets to the nearest live work
  area and keeps the velocity. The generation is **not** bumped (it is the same episode), so the
  renderer's lean continues without a discontinuity. Boundary test B-07 (§12.7) covers unplug during
  both drag and fling.
- **Persistence** reuses `savePetPosition(win)` (`main/pet-window.ts`) unchanged; the motor calls it
  on `rest` and on `dispose()`. Phase 2's `before-quit` safety-net call stays.
- **`main/index.ts` changes, exactly:**
  - delete the `onFromPet(petWin, Channels.avatarDrag, …)` and `…avatarDragEnd…` handlers (§2.9);
  - add `onFromPet(petWin, Channels.arbGrab, …)` → `motion.grab(...)` and `…arbRelease…` →
    `motion.release(...)`;
  - `onDisplaysChanged` gains `motion.rebase()` before the existing `brain?.reposition()`;
  - `visibility`'s hide arm calls `motion.cancel()` (a pet that vanishes mid-fling must not land
    off-screen while invisible);
  - `before-quit` calls `motion.dispose()`.
  - `brain-service.ts` calls `motion.walkTo(ev.walkTo, 'llm')` inside its existing
    `runner.on('sentence', …)` handler, **before** relaying the sentence to the pet and bubble.
- **Hover switching** is suspended for the whole of a user drag (`suspendHoverSwitching(true)` in
  `grab`, `false` on `rest`), so `avatar:hover` cannot flip click-through under a live drag. The
  autonomous phases do not need it — they force click-through outright.
- **A renderer lost mid-drag must not strand the suspension.** Phase 1 already forces click-through
  on `render-process-gone` (`pet-window.ts:125`), but nothing clears
  `suspendHoverSwitching(true)`, so the recovered renderer's `avatar:hover` would be ignored for the
  life of the process. Phase 3 adds one line to that handler and one to `did-start-navigation`:
  `motion.cancel()`, which ends the episode with `cancelled`, clears the suspension and restores the
  hover-derived click-through state. Boundary test B-09 covers it.

### 7.8 The 30 Hz snapshot

`sim:windowMotion` is sent at `SNAPSHOT_HZ = 30` — i.e. on every second motor frame — for the whole
duration of an episode, plus one final frame with `phase: 'rest'`. Nothing is sent while at rest.

The payload is `WindowMotionSchema` (§2.4) with `tsMain` in main's monotonic domain. The renderer
**never compares `tsMain` to `performance.now()`** (R3-3's cross-process clock rule); it uses the
snapshot only as an interpolation target and detects staleness by `generation` alone.

`sim:landing` is a one-shot per episode, generation-stamped, and the renderer drops it when
`generation !== lastWindowMotionGeneration` (R3-5: *"stale landing must not affect a newer drag"*).

---

## §8 `@ds/memory` v2 — facts, CJK retrieval, extraction, placement

A11: *"Memory recall (P3): **20 facts over 5 sessions → ≥ 90 % recalled** when relevant,
paraphrase-robust; callbacks woven ('你上次说的那个面试呢'), **0** '根据你之前提到的'."*
Bar §0 memory budget: *"**≤ 600-token summary + ≤ 5 retrieved facts placed in the latest user
message**; prompt-cache hit rate target **≥ 70 %** over a 20-turn session."*

R3-10 overrules spec §6's `tokenize='trigram'` — §0.3's probe reproduces the failure
(`MATCH '面试'` → **0** rows on a trigram table) and the fix (bigram expansion → **1** row).

### 8.1 Schema v2 — the exact migration

`packages/memory/src/db.ts`: `SCHEMA_VERSION` goes **1 → 2**.

**`migrate()` has to be restructured first, and the restructuring is specified here** — on `main` it
reads `stored` only to *reject* a newer database (`db.ts:121-126`) and never binds a `from` variable,
so `if (from < 2)` has nowhere to attach. The new body, inside the existing single `BEGIN … COMMIT`:

```ts
const from = Number(getKv(db, KV_SCHEMA_VERSION) ?? '0');   // 0 on a brand-new file
if (from > SCHEMA_VERSION) throw new Error(`这个数据库来自更新的版本（schema_version=${from}，本版本支持 ${SCHEMA_VERSION}）`);
db.exec(DDL_V1);              // unchanged, idempotent, still runs for every `from`
if (from < 2) db.exec(DDL_V2);
setKv(db, KV_SCHEMA_VERSION, String(SCHEMA_VERSION));
```

The newer-schema message and its test (`.includes('这个数据库来自更新的版本')`) are unchanged. The v1
DDL is never rewritten (Phase 2 §4.2's rule); `DDL_V2` is the block below.

```sql
-- ============================ migration v1 -> v2 ============================
-- The Phase 2 `facts` table is written by NOTHING in Phase 2 (contracts.md §4.2, verbatim:
-- "facts is written by nothing in Phase 2. It exists so the Phase 3 change is additive"), so it
-- is provably empty on every real database. It is still copied rather than assumed, and the copy
-- is a no-op when the count is 0. It cannot be ALTERed into shape: SQLite forbids adding a
-- UNIQUE column with ALTER TABLE ADD COLUMN, and `key TEXT UNIQUE` is the upsert key.
CREATE TABLE IF NOT EXISTS facts_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  value       TEXT    NOT NULL,
  alias       TEXT    NOT NULL DEFAULT '',
  value_tok   TEXT    NOT NULL DEFAULT '',
  alias_tok   TEXT    NOT NULL DEFAULT '',
  confidence  REAL    NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  source_turn INTEGER,
  updated_at  INTEGER NOT NULL,
  tombstone   INTEGER NOT NULL DEFAULT 0 CHECK (tombstone IN (0,1)),
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  history     TEXT    NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO facts_v2 (key, value, value_tok, confidence, source_turn, updated_at)
  SELECT 'legacy:' || id, text, '', 0.6, NULL, ts FROM facts;
-- The copy writes an EMPTY value_tok, because SQL cannot run tok(). `FactStore`'s constructor
-- therefore reindexes on open: any row with `value_tok = ''` AND `value <> ''` is re-tokenised and
-- inserted into facts_fts, once, in one transaction. On every real database this loop runs zero
-- times (the v1 table is provably empty, D-37) -- but a migration that could leave a fact
-- unsearchable is a migration that lies about having migrated it.

DROP TABLE facts;
ALTER TABLE facts_v2 RENAME TO facts;

CREATE INDEX IF NOT EXISTS idx_facts_updated   ON facts(updated_at);
CREATE INDEX IF NOT EXISTS idx_facts_tombstone ON facts(tombstone);

-- R3-10: contentless FTS5 over the TOKENISED columns, unicode61, alias weighted 2.0 at query time.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts
  USING fts5(value_tok, alias_tok, content='', tokenize='unicode61');

-- R3-7: the proactive ledger (§3.10.6).
CREATE TABLE IF NOT EXISTS proactive_log (
  id           TEXT    PRIMARY KEY,
  template_id  TEXT    NOT NULL,
  bucket       TEXT    NOT NULL,
  reserved_at  INTEGER NOT NULL,
  generated_at INTEGER,
  displayed_at INTEGER,
  answered_at  INTEGER,
  outcome      TEXT,
  turn_id      TEXT,
  local_date   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proactive_template ON proactive_log(template_id, displayed_at);
CREATE INDEX IF NOT EXISTS idx_proactive_day      ON proactive_log(local_date, displayed_at);

-- R3-11: the exact wire envelope of every request, stored for AUDIT, never replayed.
ALTER TABLE metrics ADD COLUMN envelope TEXT;
```

Then `INSERT OR REPLACE INTO kv(key,value) VALUES('schema_version','2')` inside the same
transaction, exactly as v1 does.

New reserved `kv` keys (the complete Phase 3 list; Phase 2's three are unchanged):

| key | value | owner |
|---|---|---|
| `sim_snapshot` | `JSON.stringify(SimPersisted)` (§3.12) | `SimService` |
| `sim_affection` | decimal string — the corruption-proof mirror (§3.12) | `SimService` |
| `sim_days_seen` | decimal string | `SimService` |
| `sim_liveliness` | decimal string in `[0,1]` (§3.5) | tray → `SimService` |
| `sim_phases` | `JSON.stringify(PhaseHours)` (§3.9) | user config, no UI in Phase 3 |
| `sim_proactive_muted` | epoch ms, or `''` for off (§3.10.4) | tray → `ProactiveController` |
| `mode` | `'character'` \| `'plain'` (§9) | `ModeStore` |
| `ui_work_mode` | `'0'` \| `'1'` (§5.9) | tray |
| `ui_sfx_muted` / `ui_sfx_volume` | `'0'`/`'1'` and a decimal in `[0,1]` (§5.12) | tray |
| `mem_turns_since_extract` | decimal string, the N = 6 counter (§8.5) | `FactExtractor` |

### 8.2 `packages/memory/src/facts.ts` — the store

```ts
export const FACT_MAX_CHARS = 120;          // R3-10 sanitisation bound
export const FACT_MIN_CONFIDENCE = 0.6;     // R3-10: "<= 5 facts with confidence >= 0.6"
export const FACT_RETRIEVE_MAX = 5;         // bar §0: "<= 5 retrieved facts"
export const FACT_FALLBACK_MIN_HITS = 3;    // R3-10: "unigram fallback if < 3 hits"

export interface FactRow {
  id: number; key: string; value: string; alias: string;
  confidence: number; sourceTurn: number | null; updatedAt: number;
  tombstone: boolean; pinned: boolean; history: string;
}

export interface FactUpsert {
  key: string; value: string; alias: string[];
  confidence: number; sourceTurn: number | null;
}

export class FactStore {
  constructor(db: DatabaseSync, now?: () => number);
  /** Upsert by `key`. A contradicting value updates IN PLACE with provenance (R3-10). */
  upsert(f: FactUpsert): { id: number; changed: boolean };
  /** Tombstones instead of deleting (R3-10). Never removes a row. */
  tombstone(id: number): void;
  /** X4's 记住这个: confidence 0.95, pinned 1. */
  pin(key: string, value: string, sourceTurn: number | null): number;
  /** The two-pass retrieval of §8.4. Returns <= FACT_RETRIEVE_MAX sanitised value strings. */
  retrieve(query: string, nowWall: number): string[];
  /** X4: the whole non-tombstoned set, newest first, for export and the Phase 4 记忆 tab. */
  list(includeTombstoned?: boolean): FactRow[];
  /** X4 one-click wipe: tombstones every row and clears the FTS index. */
  wipe(): number;
}
```

**Upsert semantics, exact (R3-10: *"a contradicting value updates in place with provenance (old
value appended to `alias` history), never deleted"*):**

```sql
-- 1. read the existing row (needed for the contentless FTS delete command)
SELECT id, value, alias, value_tok, alias_tok, history FROM facts WHERE key = ?1;

-- 2a. new key
INSERT INTO facts (key, value, alias, value_tok, alias_tok, confidence, source_turn, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
INSERT INTO facts_fts (rowid, value_tok, alias_tok) VALUES (last_insert_rowid(), ?4, ?5);

-- 2b. existing key whose value CHANGED: retire the old index row, then update in place
INSERT INTO facts_fts (facts_fts, rowid, value_tok, alias_tok)
  VALUES ('delete', ?id, ?oldValueTok, ?oldAliasTok);
UPDATE facts SET value = ?2, alias = ?3, value_tok = ?4, alias_tok = ?5,
                 confidence = ?6, source_turn = ?7, updated_at = ?8,
                 tombstone = 0,
                 history = CASE WHEN history = '' THEN ?oldValue
                                ELSE history || char(10) || ?oldValue END
  WHERE id = ?id;
INSERT INTO facts_fts (rowid, value_tok, alias_tok) VALUES (?id, ?4, ?5);
```

The `'delete'` command form is required because `facts_fts` is contentless (`content=''`): SQLite
cannot recover the old tokens itself, so the caller supplies them. This is why `value_tok` and
`alias_tok` are also stored as **real columns on `facts`** — they are the only way to retire an
index row correctly, and they make the index rebuildable from the table alone.

`tombstone(id)` sets `tombstone = 1` and **leaves the FTS row in place**; retrieval filters on
`f.tombstone = 0` in the join (§8.4). Nothing is ever `DELETE`d — R3-10, and it is what keeps
"以前喜欢拿铁" answerable.

`history` is a newline-joined list of superseded values, capped at 5 entries (oldest dropped). It is
**never** interpolated into a prompt; it exists for X4's 记忆 view and for debugging.

### 8.3 `packages/memory/src/tok.ts` — the tokeniser (R3-10)

R3-10: *"`tok(s)` = NFKC → lowercase → for each CJK run emit every unigram and every bigram,
Latin/digit words as-is."*

```ts
/** The CJK ranges the expansion applies to. Identical to @ds/brain's estimateTokens ranges minus
 *  the punctuation blocks — punctuation is a separator here, not a token. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/u;
const LATIN = /[A-Za-z0-9_]+/u;

/**
 * NFKC-normalise, lowercase, then walk the string:
 *   - a maximal run of CJK code points emits every unigram AND every adjacent bigram, in order;
 *   - a maximal run of [A-Za-z0-9_] emits the word as one token;
 *   - anything else is a separator and emits nothing.
 * Tokens are joined with a single space. Deterministic, allocation-light, no dependencies.
 * `我今天面试` -> `我 我今 今 今天 天 天面 面 面试 试`
 * `喝 iced americano` -> `喝 iced americano`
 */
export function tok(s: string): string;

/** The same walk, but emitting ONLY unigrams (the §8.4 second pass). */
export function tokUnigram(s: string): string;

/** The character-bigram set of a string — reused by §4.8's near-duplicate Jaccard. */
export function bigramSet(s: string): Set<string>;
export function jaccard(a: Set<string>, b: Set<string>): number;

/** FTS5 query escaping: every token is wrapped in double quotes and OR-joined, so a token that
 *  happens to be an FTS5 keyword (`AND`, `NOT`, `NEAR`) cannot change the query's shape. */
export function toMatchQuery(tokens: string): string;   // `"我" OR "我今" OR "今" OR ...`
```

`tok.test.ts` pins the exact expansion of `我今天面试`, the Latin passthrough, mixed CJK+Latin, the
NFKC folding of full-width Latin (`ＡＢＣ` → `abc`), and — the load-bearing one — that
`toMatchQuery(tok('面试'))` matches a row indexed as `tok('我今天面试通过了')`, which is §0.3's
recorded probe result reproduced as a unit test.

### 8.4 Retrieval — bm25 weights and the two-pass fallback (R3-10)

```sql
-- PASS 1 (bigram). ?1 = toMatchQuery(tok(query)), ?2 = FACT_MIN_CONFIDENCE, ?3 = nowWall
SELECT f.id, f.value, f.confidence, f.updated_at, f.pinned,
       bm25(facts_fts, 1.0, 2.0) AS score
  FROM facts_fts
  JOIN facts f ON f.id = facts_fts.rowid
 WHERE facts_fts MATCH ?1
   AND f.tombstone = 0
   AND f.confidence >= ?2
 ORDER BY score ASC              -- bm25() returns NEGATIVE scores; ascending IS best-first
 LIMIT 20;

-- PASS 2 (unigram fallback), run ONLY when pass 1 returned fewer than FACT_FALLBACK_MIN_HITS rows.
-- ?1 = toMatchQuery(tokUnigram(query) minus STOPWORDS)
--   (identical statement otherwise)
```

Column weights are exactly R3-10's: **`bm25(facts_fts, 1.0, 2.0)`** — `value_tok` 1.0,
`alias_tok` **2.0**. The alias column is what buys paraphrase robustness; §0.3's control run shows
`腰疼` and `咖啡` retrieving through the alias column alone.

Final ranking, applied in TypeScript over the ≤ 20 candidates:

```ts
const hours = Math.max(0, (nowWall - row.updatedAt) / 3_600_000);
const rank  = (-row.score) * (0.5 + row.confidence) * Math.pow(0.995, hours);
// pinned rows first, then rank descending, then take FACT_RETRIEVE_MAX (5)
```

`0.995^hours` is the spec §6 recency shape, confirmed workable by the research measurement; the
importance term becomes `(0.5 + confidence)` because R3-10's schema carries `confidence`, not
`importance`. Pinned facts (X4's 记住这个) sort ahead of everything, always.

`STOPWORDS` is a frozen 40-entry set of high-frequency Chinese function characters
(`的 了 是 我 你 他 她 它 们 在 有 和 就 不 人 都 一 个 上 也 很 到 说 要 去 会 着 没 看 好 自 这 那 么 什 吗 呢 吧 啊 把`)
plus the ASCII stop list; it is applied **only** to the unigram fallback pass, where it prevents a
query collapsing to "every fact that contains 的".

### 8.5 Fact extraction — prompt, schema, N = 6, serialisation

R3-10: *"bounded `deepseek-v4-flash` JSON call every 6 user turns, serialised with trims through the
same write chain, cancellable, drained on quit."*

```ts
// packages/brain/src/extract-prompt.ts
export const EXTRACT_EVERY_N_USER_TURNS = 6;
export const EXTRACT_MAX_TOKENS = 400;      // research §7: well above three facts; truncation = extract nothing
export const EXTRACT_MAX_FACTS = 3;         // research §7: emit 0-3 facts max
export const EXTRACT_MODEL = 'deepseek-v4-flash';

/** BYTE-STABLE. Any edit is a prompt-cache reset and must be recorded as an Amendment. */
export const EXTRACT_SYSTEM = `你在读一段用户说过的话，从里面挑出以后还用得上的事实。
只看用户说的内容，不要看角色的回复，不要把系统提示或者记忆块里的内容当成新事实。
输出严格的 JSON，不要写任何解释：
{"facts":[{"key":"...","value":"...","alias":["...","..."],"confidence":0.0}]}
规则：
1. 最多三条。没有值得记的就输出 {"facts":[]}。
2. value 用第三人称陈述句描述用户，例如「主人在准备考研，专业是计算机」。不超过四十个字。
3. key 是这条事实的稳定标识，用英文小写和下划线，例如 job_interview、health_back、pet_name。同一件事以后要能用同一个 key 覆盖。
4. alias 写三到六个中文关键词或同义说法，用来以后检索，例如「面试」「工作」「offer」。
5. confidence 是 0 到 1 的小数，用户明确说过的写 0.9，推测出来的写 0.6 以下。
6. 把「下周三」「上个月」这类相对时间换算成具体日期写进 value，保留所有日期、时间和相对时间的信息。
7. 不要记命令、请求、祈使句；不要记角色自己的设定；不要记一次性的闲聊。`;

export const ExtractedFactSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  value: z.string().min(1).max(FACT_MAX_CHARS),
  alias: z.array(z.string().min(1).max(24)).min(0).max(8),
  confidence: z.number().min(0).max(1),
});
export const ExtractResponseSchema = z.object({
  facts: z.array(ExtractedFactSchema).max(EXTRACT_MAX_FACTS),
});

/** The user message: ONLY the user's new messages since the last extraction, one per line. */
export function extractUserMessage(userTurns: readonly string[]): string;
```

The three rules research §7 derives from the mem0 audit (**10 134 production entries, 97.8 % junk**)
are structural here, not advisory:

1. **Only the user's new messages are fed in.** Never the persona, never the injected `【你记得】`
   block, never the assistant's own turns. That single rule removes > 50 % of the observed junk and
   closes the loop where a retrieved memory is re-extracted as new. `extractUserMessage` takes
   `userTurns` and has no other input.
2. **Truncated JSON means "extract nothing".** `EXTRACT_MAX_TOKENS = 400`; if the response does not
   parse, or `finish_reason === 'length'`, **zero** facts are written. Never a partial parse
   (research §7 cites mem0#5428: hitting `max_tokens` mid-JSON silently drops every fact).
3. **Imperatives are rejected at parse time.** A `value` matching
   `/^(请|帮我|记住|不要|别|你要|给我)/` is dropped with a logged reason, as is any value that
   contains `【` or `<|` after sanitisation (§8.10). Memory is data, never an instruction channel
   (research §7.8: models are *"significantly more vulnerable to memory injection compared to prompt
   injection"*).

Dedup before insert: a candidate whose `bigramSet` Jaccard against any existing non-tombstoned
`value` is **≥ 0.6** is merged into that row instead of inserted (research §7 / mem0#7123). Same
threshold and same primitive as §4.8's near-duplicate check.

```ts
// apps/desktop/src/main/fact-extractor.ts
export class FactExtractor {
  constructor(deps: { client(): ChatClient | null; store: FactStore; history: HistoryStore;
                      db: DatabaseSync; now?: () => number });
  /** Called from BrainService on every completed USER turn. Counts, and fires at N = 6. */
  noteUserTurn(text: string): void;
  /** Awaited by the quit drain (§3.11). Cancels the in-flight call and awaits its writes. */
  dispose(): Promise<void>;
}
```

**Serialisation (R3-10):** the extractor shares **one write chain** with the trim/summarisation path
— a single `Promise` tail in `HistoryStore` that both `onTrimNeeded` and the extractor append to, so
an extraction can never interleave with a trim's `BEGIN…COMMIT`. It is cancellable through the same
`AbortController` discipline `TurnRunner` uses, and `dispose()` awaits the tail before returning.
This relies on the **closing fence** the fix wave adds to `HistoryStore`
(FW-3a, verified on `main`): a write attempted after the fence closes is
rejected rather than racing `db.close()`.

### 8.6 Placement — the exact envelope in the newest user message

Bar §0: *"**≤ 600-token summary + ≤ 5 retrieved facts placed in the latest user message**"*.
Phase 2's `assemblePrompt` already builds exactly that shape and **is not changed**. Phase 3 only
fills in what Phase 2 stubbed:

```ts
// packages/brain/src/prompt.ts — UNCHANGED. Reproduced here because it IS the contract.
const head: string[] = [
  `【状态】本地时间 ${s.weekday} ${s.localTime}｜心情 ${moodPhrase(s.mood)}｜精力 ${energyPhrase(s.energy)}｜好感 ${affectionPhrase(s.affection)}｜距离上次聊天 ${s.sinceLastChat}`,
];
if (input.summary) head.push(`【最近发生过什么】${input.summary}`);
const facts = input.facts.slice(0, MAX_FACTS);              // MAX_FACTS = 5
if (facts.length > 0) head.push(`【你记得】${facts.join('；')}`);
const phi = input.postHistoryInstructions ?? '';
if (phi) head.push(`【记住】${phi}`);
let latest = `${head.join('\n')}\n\n${input.userText}`;
```

**The two bounds this placement carries, stated (R3-10 requires the second one explicitly):**

- **≤ 5 facts** — `MAX_FACTS = 5` (`packages/brain/src/prompt.ts:61`), applied by `assemblePrompt`'s
  own `input.facts.slice(0, MAX_FACTS)`, not by the caller.
- **≤ 600 tokens of summary** — `SUMMARY_TOKEN_CAP = 600` (`prompt.ts:60`), enforced by
  `capSummary` inside `RunningSummary.setSync` (`packages/memory/src/summary.ts:33`), which drops
  whole sentences from the end until the estimate fits.

**The estimator disagreement, recorded rather than papered over.** R3-10 asks for the cap to be
"token-estimated, **CJK 1 token/char conservative**"; the shipped `estimateTokens`
(`prompt.ts:20-31`) counts CJK at **1/1.5**, so a summary at exactly 600 estimated tokens can be up
to **900 hanzi**, which a 1-token-per-char model would read as ~900 tokens. Phase 3 does **not**
change `estimateTokens` — it is the single token oracle for `planTrim`, `cardTokens`,
`messages.tokens` and the eval, and re-scaling it would move every one of those and invalidate
Phase 2's measured numbers. Instead `capSummary` gains a **second, conservative bound applied
alongside the first**:

```ts
/** R3-10's conservative CJK bound: one token per CJK code point, Latin words at 1.3. */
export function estimateTokensConservative(s: string): number;
export const SUMMARY_CHAR_CAP = 600;   // the conservative bound, in CJK code points

// capSummary keeps a sentence only while BOTH hold:
//   estimateTokens(next) <= maxTokens  AND  estimateTokensConservative(next) <= SUMMARY_CHAR_CAP
```

The conservative bound binds first for pure Chinese (600 hanzi → 600 conservative tokens vs 400 by
`estimateTokens`), which is exactly the case R3-10 is protecting. `summary.test.ts` pins both: a
2 000-hanzi input stores ≤ 600 hanzi and ends on a terminator.

Phase 3's only change to the prompt path is that **`HistoryPort.facts()` stops returning `[]`**:

```ts
// packages/memory/src/history.ts — the facts() body. NOT the only change in this file (see below).
facts(): Promise<string[]> {
  return Promise.resolve(this.factStore.retrieve(this.pendingQuery, this.now()));
}
```

**Everything Phase 3 changes in `history.ts`, enumerated** (the first draft claimed one line; the
preflight was right that it is four):

1. `facts()` — the body above, replacing Phase 2's `return Promise.resolve([])`.
2. a `private pendingQuery = ''` field and `setQuery(text: string): void`.
3. a `factStore: FactStore` constructor option, so `HistoryStore` reaches it without a global.
4. `record(m: MetricsRecord)` (`history.ts:209`) widens by one bound parameter for
   `metrics.envelope` (§8.1); `MetricsRecord` (`packages/brain/src/ports.ts`) gains
   `envelope: string | null`.

RESIDUAL-1's GC-1 rewrite of `private trim(plan)` is **not** touched by Phase 3; §8.5's shared write
chain attaches to it as it now stands (`TRIM_CHUNK_TOKENS = 24_000`, `chunkByTokens`,
`prefixStillMatches`).

`pendingQuery` is set by `TurnRunner` through a new `HistoryPort.setQuery(text: string): void`
called in `send()` immediately before `history.window()` — the user's raw text is the retrieval
query. That is one added port method with a synchronous void signature, and it is the **only**
`HistoryPort` change in Phase 3.

The `【你记得】` block is joined with `；` and each value has already passed §8.10's sanitiser, so a
fact can contain neither `【】` nor a control token. A11's *"0 根据你之前提到的"* is a persona-prompt
matter, not a placement one: the facts arrive as **data under a label**, never as an instruction to
cite them (research §7.8).

### 8.7 The documented cache resets (R3-11)

R3-11: *"canonical raw history on the wire; the cache break is at the previous user message, by
design."* The uncached suffix per request is exactly: *previous user envelope→raw substitution +
previous assistant reply + current envelope*. Everything before that is byte-stable.

The **four** intentional resets, and nothing else may cause one:

| Reset | When | Why it is legitimate |
|---|---|---|
| trim / summary compaction | `planTrim(...).drop.length > 0` → `onTrimNeeded` rewrites the summary and advances `last_trim_id` | leading messages leave the wire; the prefix genuinely changed |
| persona ↔ plain profile switch | `mode:changed` (§9) | two byte-stable system profiles; one switch = one reset (R3-12) |
| system-prompt change | a `character.json` card edit, or an edit to `HARD_RULES` / `PLAIN_RULES` / `tagGrammar` | the prefix is the persona; changing it is changing the cache key |
| new conversation | a fresh database, or X4's wipe | there is no prefix to hit |

Anything else that moves the prefix is a **defect**. The Phase 2 byte-identity test
(`prompt.test.ts`: the system message is byte-identical between consecutive turns when no trim
occurred) stays and is extended with a mode-switch case.

### 8.8 The cache audit column, and the ≥ 70 % authority (R3-11)

`metrics.envelope` (§8.1) stores `JSON.stringify(messages)` of the request **as it went on the wire**
— for audit only, never replayed. Two derived numbers are what R3-11 makes authoritative:

```ts
// scripts/phase3-cache.mjs  (extends the existing scripts/phase2-stats.mjs shape)
// per request:      hit / (prompt_cache_hit_tokens + prompt_cache_miss_tokens)
// token-weighted:   sum(hit) / sum(hit + miss) over the 20 turns
```

Bar §0's threshold is **≥ 70 %** (`prompt_cache_hit_tokens / prompt_tokens`) over a 20-turn session.
The live probe (Phase 2 T10's `eval/session.mjs`, blocked on account balance) is the authority.
**If the token-weighted ratio is < 70 %, replaying stored envelopes is a controller ruling change,
not an implementer choice** (R3-11) — no task may switch to append-only envelopes on its own.

### 8.9 X4 — the memory commands, export and wipe

X4 (P3): *"a 记忆 tab to view/edit/delete memories, '记住这个 / 忘掉这个' commands, export/import,
`%APPDATA%\ds` documented, one-click wipe."*

Phase 3 ships the commands, the export and the wipe. **The 记忆 tab is Phase 4**, because the
settings window that hosts it is Phase 4 (R3-18 and R3-24) — recorded in §13.2 and §14.1 Q5.

```ts
// packages/brain/src/mode.ts also owns the memory commands: they are intercepted in main
// BEFORE the text reaches the brain, exactly like TIMEOUT_SIGNAL (§9.1).
export const MEMORY_COMMANDS = {
  remember: /^(记住这个|记住这句|记一下)[。．.!！]?$/,
  forget:   /^(忘掉这个|忘了这个|别记这个)[。．.!！]?$/,
} as const;
export function matchMemoryCommand(text: string): 'remember' | 'forget' | null;
```

- **记住这个** → `FactStore.pin(key, value, sourceTurn)` where `value` is the **previous user
  message** (sanitised, ≤ 120 chars) and `key` is `pin_${fnv1a(value)}`; confidence 0.95,
  `pinned = 1`. The pet answers with a canned line from `character.json`'s `cannedLines.remember`.
- **忘掉这个** → `FactStore.tombstone(id)` on the **top retrieved fact** for the previous user
  message, and the canned answer **names which one was forgotten** (research §7: the user must see
  what went). If nothing was retrieved, the canned line says so and nothing changes.
- Neither command reaches DeepSeek; neither is written to history as a user turn.
- **Import is Phase 4 (R3-33).** The bar says "export/**import**"; Phase 3 ships export and wipe
  only, and §13.2 carries the deferral row. An import path that can write arbitrary rows into
  `facts` is a memory-injection surface (research §7.8) and belongs with the settings window that
  can show the user what is about to be imported.
- **Export** and **wipe** are tray items under `记忆 ▸ 导出… / 清空…`. Export writes
  `facts` + `summaries` + `kv` (minus `mode`, minus every `ui_*` key) as JSON through
  `dialog.showSaveDialog`. Wipe shows a `dialog.showMessageBox` confirmation naming
  `%APPDATA%\ds\ds.sqlite`, then tombstones every fact, clears the summary, and resets
  `mem_turns_since_extract`. It does **not** touch `messages` — the chat log is X5's, and a memory
  wipe that silently deleted the conversation would be a different, unasked-for action.

### 8.10 The shared sanitisation helper (R3-10, R3-17 carry item 3)

R3-10: *"LLM-written `value`/`alias` are untrusted text: sanitised (control chars, `【】` → `[]`,
whitespace collapse, ≤ 120 chars) BEFORE FTS insertion and before prompt interpolation."*

```ts
// packages/memory/src/summary.ts — MODIFY. This function ALREADY EXISTS on `main` at
// `summary.ts:29` as `sanitizeMemoryText(text: string): string`, is already imported by
// `history.ts:16`, already called at `history.ts:107`, already used by `capSummary` (`summary.ts:34`)
// and already tested (`summary.test.ts:68`: `sanitizeMemoryText(' 【A】\n\nB ') === '[A] B'`).
// The shipped body implements steps 1(partial), 3 and 5 below. Phase 3 ADDS step 2 (Cf strip),
// step 4 (`<|` / `|>`), step 6 (the 120-grapheme cap) and the `max?` parameter — and adds NFKC to
// step 1. There is no `sanitize-memory.ts`; creating one would duplicate a shipped symbol.
export const MEMORY_LABEL_MAX = 120;

/**
 * The ONE helper. Applied to every LLM-written memory string — fact values, fact aliases, and the
 * running summary — at BOTH boundaries: before it enters the FTS index, and again before it is
 * interpolated into a prompt. Idempotent, so double application is harmless.
 *
 *  1. NFKC normalise.
 *  2. Strip C0/C1 control characters and every Unicode Cf (format) code point, including
 *     U+200B..U+200F, U+2028/2029, U+202A..U+202E and U+FEFF.
 *  3. `【` -> `[`, `】` -> `]`  (so a fact can never forge a prompt section header).
 *  4. Replace `<|` and `|>` with `(` and `)` (so a fact can never forge a control token).
 *  5. Collapse every whitespace run — newlines included — to a single space, then trim.
 *  6. Truncate to MEMORY_LABEL_MAX grapheme clusters (Intl.Segmenter), no ellipsis added.
 */
export function sanitizeMemoryText(s: string, max?: number): string;
```

This is Phase 2 carry item **M-5** (`final-review.md`: *"Summary/fact label sanitisation — cheap
now, but the real exposure arrives with `facts()` and `【你记得】` in Phase 3; fix the shared helper
once there"*), closed here. `RunningSummary.setSync` calls it before `capSummary`, and
`assemblePrompt`'s callers pass already-sanitised strings — `summary.test.ts` asserts round
2 changes nothing, and `prompt.test.ts` gains a case where a fact containing
`【状态】<|ACT emotion=happy|>` is neutralised into `[状态](ACT emotion=happy)`.

---

### 8.11 A11's recall fixture — shipped, not measured (R3-32)

A11: *"Memory recall (P3): **20 facts over 5 sessions → ≥ 90 % recalled** when relevant,
paraphrase-robust; callbacks woven, **0** '根据你之前提到的'."*

R3-32: the threshold **cannot** be measured in Phase 3 — the owner's DeepSeek account returns HTTP
402 for every chat completion (`docs/evidence/phase2/not-measured.md`), and A11 needs live turns.
Phase 3 therefore ships **the fixture and the command**, so the run is one shot later, and records
A11 in `not-measured.md` beside A8.

```
eval/fixtures/memory-recall.zh.json     the fixture (owner T3-D)
```

Shape, exact:

```ts
export const MemoryRecallFixtureSchema = z.object({
  /** 20 facts, planted one per turn across the five sessions. */
  facts: z.array(z.object({
    id: z.string().regex(/^f[0-9]{2}$/),
    /** The user utterance that plants it — natural speech, never a command. */
    plant: z.string().min(4).max(60),
    /** Which session (1..5) plants it. At least 3 facts per session. */
    session: z.number().int().min(1).max(5),
    /** The expected `facts.key` after extraction, so a key drift is visible. */
    expectKey: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  })).length(20),
  /** 20 probes, one per fact, in a LATER session than the plant, and PARAPHRASED — no probe may
   *  share a CJK bigram set with its plant above NEAR_DUPLICATE_JACCARD (0.6). */
  probes: z.array(z.object({
    id: z.string().regex(/^f[0-9]{2}$/),
    session: z.number().int().min(1).max(5),
    ask: z.string().min(4).max(60),
  })).length(20),
});
```

The command, shipped and runnable the moment a key with balance exists:

```
pnpm --filter @ds/eval exec node run.mjs --suite memory-recall   --fixture fixtures/memory-recall.zh.json --sessions 5 --out out/memory-recall.json
```

It replays the five sessions against a throwaway `ds.sqlite`, runs the extractor at its real N = 6
cadence, and for each probe asserts the planted fact appears in `FactStore.retrieve(ask)`'s top 5.
**Pass = ≥ 18/20 (90 %).** A second assertion counts occurrences of `根据你之前提到的` in the
replies and requires **0**.

Until it runs, `docs/evidence/phase3/not-measured.md` carries the row verbatim:
*"A11 memory recall ≥ 90 % — NOT MEASURED. Fixture `eval/fixtures/memory-recall.zh.json` and the
command above ship; blocked on DeepSeek account balance, exactly as A8 is."* Never estimated, never
substituted with the §0.3 control corpus — B-12 tests the *mechanism*, not the threshold.

## §9 TIMEOUT_SIGNAL — mode as product state (R3-12)

R3-12: *"TIMEOUT_SIGNAL is product state — exact grammar."* Phase 2 deferred P3 (*"the
`mode: 'character' | 'plain'` tray toggle and hotkey"*) to Phase 3 while already shipping and
measuring `renderStaticSystem(card, motionKeys, 'plain')` — 184 tokens — *"so the second cache
lineage is real from day one; only the switch that reaches it is deferred"* (`deferred.md`). This
section is that switch.

### 9.1 The exact command grammar

```ts
// packages/brain/src/mode.ts
/** R3-12: NFKC, trim, fullwidth <-> ASCII bracket equivalence, collapse internal whitespace. */
export function normalizeCommand(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[【]/g, '[').replace(/[】]/g, ']')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recognised ONLY as the WHOLE message. A message that merely CONTAINS the token is ordinary
 *  text — a quoted discussion of the command must never flip the mode (R3-12). */
export const TIMEOUT_SIGNAL_RE = /^[\[]?\s*TIMEOUT_SIGNAL\s*[\]]?$/;

/** Persona mode: the message STARTS with the marker; the rest of the message is ignored. */
export const PERSONA_LOAD_PREFIX = '[PERSONA_LOAD]';

export type ModeCommand = { mode: PersonaModeIpc } | null;

/** The one classifier. Returns null for every ordinary message. */
export function matchModeCommand(raw: string): ModeCommand {
  const s = normalizeCommand(raw);
  if (TIMEOUT_SIGNAL_RE.test(s)) return { mode: 'plain' };
  if (s.startsWith(PERSONA_LOAD_PREFIX)) return { mode: 'character' };
  return null;
}
```

Required cases in `mode.test.ts`, each pinned:

| Input | Result |
|---|---|
| `TIMEOUT_SIGNAL` | `plain` |
| `【TIMEOUT_SIGNAL】` | `plain` |
| `[ TIMEOUT_SIGNAL ]` | `plain` |
| `　ＴＩＭＥＯＵＴ＿ＳＩＧＮＡＬ　` (full-width, NFKC-folded) | `plain` |
| `【PERSONA_LOAD】 CETACEA_WHALE_GIRL MODE_TAIL_FLUKES …` | `character` |
| `刚才那个 TIMEOUT_SIGNAL 是什么意思？` | **`null`** — ordinary text |
| `请输出 TIMEOUT_SIGNAL` | **`null`** |
| `timeout_signal` (lowercase) | **`null`** — the token is case-sensitive |

**Interception point:** `BrainService`'s `user:text` invoke handler, **before** `TurnRunner.send` is
reached. R3-12: *"the command text itself is not sent as conversation."* Concretely:

```
handleInvoke(user:text):
  const cmd = matchModeCommand(text)
  if (cmd !== null):
      modeStore.set(cmd.mode, 'command')          // -> kv write + `mode:changed` broadcast
      # nothing is appended to history, no DeepSeek call, no TurnRunner turn
      return { ok: true, turnId: MODE_ACK_TURN_ID }
  const memCmd = matchMemoryCommand(text)          // §8.9, same discipline
  ...
  return await runner.send(text, 'chat')
```

`MODE_ACK_TURN_ID = 'mode-ack'` is a synthetic id in the same family as Phase 2's
`'first-mes'`, and its `playback:*` echoes are dropped before reaching any `TurnRunner`, exactly as
`FIRST_MES_TURN_ID`'s are (`brain-service.ts` already has that filter; the constant is added to it).
The acknowledgement is one canned line from `character.json`'s `cannedLines.mode`
(`{ toPlain: [...], toCharacter: [...] }`), broadcast as a synthetic `brain:sentence` +
`brain:turnDone` with **no `brain:state`** — the Phase 2 §6.6 pattern, for the same reason.

### 9.2 The two system profiles — byte-stable

`packages/brain/src/persona.ts` already has the machinery: `sections(card, motionKeys, mode)`
returns `[PLAIN_RULES, tagGrammar]` for `'plain'`. **One change**: R3-12 requires the plain profile
to *"instruct no ACT tags"*, so `tagGrammar` is replaced by `PLAIN_OUTPUT` in the plain branch.

```ts
/** UNCHANGED from Phase 2, byte-for-byte. */
const PLAIN_RULES = `【当前模式】
现在不扮演任何角色。用中文正常、专业地回答，不用角色语气，不用昵称，不用颜文字。
不要用 markdown，不要列点，不要写标题，不要加粗。
答案要准确、直接、简短；不知道就说不知道，不确定就说不确定。`;

/** NEW in Phase 3. Byte-stable; any edit is a cache reset and needs an Amendment. */
const PLAIN_OUTPUT = `【输出格式】
不要写任何标记：不要写 <|ACT ...|>，不要写 <|PAUSE n|>，不要用尖括号或方括号包起来的控制符。
直接输出正文。`;

function sections(card, motionKeys, mode): Section[] {
  if (mode === 'plain') return [
    { owner: 'engine', text: PLAIN_RULES },
    { owner: 'engine', text: PLAIN_OUTPUT },     // was: tagGrammar(motionKeys)
  ];
  // the 'character' branch is UNCHANGED
}
```

Consequences, all recorded:

- The plain profile no longer depends on `motionKeys`, so it is byte-stable across character
  bundles as well as across turns. `renderStaticSystem(card, [], 'plain')` and
  `renderStaticSystem(card, Object.keys(motionMap), 'plain')` are now **identical strings**, and
  `persona.test.ts` asserts it.
- The measured plain-profile size changes from Phase 2's recorded **184 tokens**. The new number is
  measured by `persona.test.ts` and written into `docs/evidence/phase3/persona-tokens.txt`; it is
  **not** predicted here.
- The **character** profile keeps `tagGrammar` and its 9 emotions verbatim, so the persona lineage's
  prefix bytes are untouched and Phase 2's cache measurements still describe it.
- Both profiles keep the **safety and output grammar**: the Chinese-only rule
  (`用中文正常、专业地回答` / `只说中文口语`), the markdown ban, and the "say you don't know"
  instruction are present in both (R3-12: *"the safety/output grammar stays in both"*).

`BrainService` builds **both** strings once at startup and caches them:

```ts
private readonly profiles: Record<PersonaModeIpc, string> = {
  character: renderStaticSystem(bundle.card, Object.keys(bundle.motionMap), 'character'),
  plain:     renderStaticSystem(bundle.card, [], 'plain'),
};
```

A mode change calls `rebuildClient()` (which already tears down and recreates the `TurnRunner`), and
the new runner gets `persona.staticSystem = this.profiles[mode]`. **This is the one legitimate cache
reset a switch causes** (§8.7).

### 9.3 `ModeStore`

```ts
// apps/desktop/src/main/mode-store.ts
export const KV_MODE = 'mode';
export class ModeStore {
  constructor(db: DatabaseSync);
  /** Reads kv at construction; defaults to 'character'. */
  get(): PersonaModeIpc;
  /** Writes kv, then notifies. A no-op set does NOT notify (no spurious cache reset). */
  set(mode: PersonaModeIpc, reason: 'command' | 'restored' | 'tray'): void;
  onChange(cb: (mode: PersonaModeIpc, reason: 'command' | 'restored' | 'tray') => void): () => void;
}
```

Wiring: `main/index.ts` constructs it before `BrainService`, calls `set(get(), 'restored')` after the
windows exist (so the `mode:changed` broadcast lands), and `BrainService.start()` subscribes.
`SimService` also subscribes (`{type:'MODE'}`, §3.2), because the proactive gate reads
`state.mode === 'plain'` as a suppression (§3.10.2).

### 9.4 What plain mode disables (R3-12)

| Surface | Character mode | Plain mode |
|---|---|---|
| system profile | persona + `tagGrammar` | `PLAIN_RULES` + `PLAIN_OUTPUT` |
| `<\|ACT …\|>` in the stream | parsed | **dropped by the parser** — `StreamParser` is constructed with `{ dropAct: true }`; tags are consumed and discarded, `emotion` is forced to `'neutral'`, `motion` / `look` / `walkTo` are omitted, and `complianceMiss` is **not** raised (a missing ACT is correct here) |
| `<\|PAUSE n\|>` | honoured | dropped (no pacing beats), `PAUSE_MAX_S` unused |
| LLM lane commands | expression / body / gaze / locomotion leases | **none** — the arbiter refuses every `source: 'llm'` command while `mode === 'plain'` (§5.14) and holds the mood-baseline expression |
| mannerisms | persona card's speech section | absent from the profile |
| proactive speech | per §3.10 | **off** — gate reason `plain-mode` |
| bubble styling | ADV band | plain band (`data-mode="plain"` on the band root) |
| history | unchanged | unchanged — plain-mode turns are ordinary `kind: 'chat'` rows |

`StreamParser` gains exactly one option:

```ts
export interface StreamParserOptions { dropAct?: boolean }   // default false
export class StreamParser { constructor(turnId: string, opts?: StreamParserOptions); /* … */ }
```

### 9.5 The mode plate and the tray

Chat window, **exact copy** (R3-19: no persona name appears, so these are literals):

| Element | Copy |
|---|---|
| plate text, plain mode | `普通模式` |
| plate tooltip | `不扮演角色，只回答问题。发送 【PERSONA_LOAD】… 切回角色。` |
| plate in character mode | **hidden** — the absence of a plate is the character state |

The plate is a quiet chip in the chat window's status row, `--c-surface-2` background,
`--c-text-2` text, `--r-control` radius, `--fs-caption` size — all Phase 2 tokens, no new ones. It
is rendered from `mode:changed` and from nothing else.

Tray: a checkable item `普通模式` beneath 打开对话, calling `ModeStore.set(next, 'tray')`. There is
no hotkey in Phase 3 (P3 named one; the settings surface that would let a user rebind it is Phase 4,
and an unrebindable global hotkey is a worse default than none — recorded in §13).

### 9.6 X10 in Phase 3 — the 3-persona eval fixture and the plain profile

R3-18 scopes X10 to exactly two deliverables. The card editor and SillyTavern import are Phase 4.

- **The plain profile** — §9.2, shipped and reachable.
- **The 3-persona eval fixture**, which is what unblocks Phase 2's deferred **A8**
  (*"Persona-bleed: 3 personas × 20 prompts → blind judge attributes ≥ 85 %"*), recorded in
  `deferred.md` as *"unsatisfiable, not unmet"* with one persona:

  ```
  eval/personas/haru.json        the shipped card (a symlink-free copy of characters/haru/character.json's `card`)
  eval/personas/quiet.json       a low-affect, terse persona          (id `quiet`)
  eval/personas/blunt.json       a high-directness, no-mannerism persona (id `blunt`)
  eval/fixtures/persona-bleed.zh.json   20 prompts x 3 personas, the A8 fixture
  ```

  **What each file must contain, so it is buildable** (the first draft named paths only):

  | File | Contents |
  |---|---|
  | `eval/personas/haru.json` | a copy of `characters/haru/character.json`'s `card` object, byte-identical, regenerated by a script step rather than hand-edited so it cannot drift |
  | `eval/personas/quiet.json` | a card whose `personality` is **low-affect and terse**: short declarative replies, no 颜文字, no mannerism markers, `post_history_instructions` reinforcing brevity. It must be attributable **without** naming itself |
  | `eval/personas/blunt.json` | a card whose `personality` is **high-directness, no mannerisms**: contradicts the user readily, never opens with praise, no verbal tics |
  | `eval/fixtures/persona-bleed.zh.json` | **20 prompts**, each neutral enough that all three personas can answer it, and none naming a persona trait. Shape: `{ id, text }` with `id` matching `/^pb[0-9]{2}$/`. A11's fixture (§8.11) is separate |

  Each of the three cards passes the same `CharacterCardSchema` validation and the same
  `cardTokens(card) <= CARD_TOKEN_BUDGET` (700) assertion the shipped card passes, and — R3-19 —
  each reads its own name from its own `card.name`; no Phase 3 source file names any of them. `eval/run.mjs` gains
  `--persona <id>` (default `haru`); the A8 axis is added to `eval/judge.md` with its ≥ 85 %
  threshold. **The run itself stays blocked on account balance** (Phase 2's `not-measured.md`), so
  Phase 3 ships the fixture and the harness change, and A8 remains NOT MEASURED until a key with
  balance exists. That is stated in the evidence, never estimated.

### 9.7 The cache-reset note

A mode switch is **one** prefix change, not a per-turn one: both profiles are cached strings, the
switch is user-initiated and rare, and the turn immediately after a switch is expected to miss.
`metrics.envelope` (§8.8) makes that visible in the audit, and `scripts/phase3-cache.mjs` excludes
the first turn after a `mode:changed` from the token-weighted ratio — with the exclusion **counted
and reported**, so it can never quietly flatter the ≥ 70 % number.

---

## §10 Activity sensing (R3-9)

D11: *"Reacts to real activity: typing → glances at the screen; long streak → cheer; wiggle near her
→ curiosity; battery low / on charger → micro-reaction. Keystroke reactions are **opt-in** with
password-field masking; **no key logging by default**."*

R3-9 is absolute: **no keyboard hook at any tier.** Research §6 documents why in this project's exact
configuration — `uiohook-napi#58` is an unsigned Electron NSIS installer being flagged as malware
for adding a global listener, which is what this app would ship as. `WH_KEYBOARD_LL`,
`RIDEV_INPUTSINK`, `GetAsyncKeyState` and window titles are **never** used, at any tier.

### 10.1 The default tier — no consent needed, no native code beyond koffi

| # | Signal | API | Rate | What is kept |
|---|---|---|---|---|
| 1 | input age (ms) | Win32 `GetLastInputInfo` + `GetTickCount` via koffi | **2 Hz** (R3-9) | one integer, `inputAgeMs` |
| 2 | lock / unlock / suspend / resume / AC / battery | Electron `powerMonitor` events | event-driven | booleans |
| 3 | cursor point | Electron `screen.getCursorScreenPoint()` | sampled with (1) | the current point and the delta from the previous sample |
| 4 | DND / fullscreen / presentation | Win32 `SHQueryUserNotificationState` via koffi | **0.2 Hz** (every 5 s) | one enum value |
| 5 | foreground window **bounds** + hwnd identity | the existing `main/foreground.ts` (`GetForegroundWindow`, `GetWindowRect`, `IsZoomed`) | 0.5 Hz (2 s, unchanged) | a rect and a changed-flag. **No title, no executable path, ever** |
| 6 | battery level / charging | Win32 `GetSystemPowerStatus` via koffi | 0.1 Hz (10 s) and on every `powerMonitor` power event | a percentage and a boolean |

Nothing above is persisted as a time series. The sensor holds **one** current sample and the derived
state of §10.4; the trace (§12.2) records the derived state only.

`powerMonitor.getSystemIdleTime()` is **not** used for signal 1: it returns **seconds**, and R3-9's
typing predicate needs `input age < 1 s`. It is the degraded fallback (§10.5).

### 10.2 koffi signatures — the same shape `main/foreground.ts` established

```ts
// apps/desktop/src/main/activity-sensor.ts
// Loaded lazily through require(), exactly as foreground.ts does, so a missing or incompatible
// native binary degrades to "unknown" instead of taking the app down at import time.
const koffi = require('koffi') as typeof import('koffi');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// Namespaced struct names, because koffi.struct() throws when a name is registered twice and
// foreground.ts already registers DS_RECT in this process.
koffi.struct('DS_LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' });
koffi.struct('DS_SYSTEM_POWER_STATUS', {
  ACLineStatus: 'uint8', BatteryFlag: 'uint8', BatteryLifePercent: 'uint8',
  SystemStatusFlag: 'uint8', BatteryLifeTime: 'uint32', BatteryFullLifeTime: 'uint32',
});

const GetLastInputInfo = user32.func('bool __stdcall GetLastInputInfo(_Inout_ DS_LASTINPUTINFO* plii)');
const GetTickCount     = kernel32.func('uint32 __stdcall GetTickCount()');
const GetSystemPowerStatus =
  kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ DS_SYSTEM_POWER_STATUS* status)');
```

```ts
// apps/desktop/src/main/notification-state.ts
const shell32 = koffi.load('shell32.dll');
/** HRESULT SHQueryUserNotificationState(QUERY_USER_NOTIFICATION_STATE *pquns) */
const SHQueryUserNotificationState =
  shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int* pquns)');

export const QUNS = {
  NOT_PRESENT: 1,            // screensaver, LOCKED, or an inactive fast-user-switching session
  BUSY: 2,                   // a fullscreen app OR presentation settings
  RUNNING_D3D_FULL_SCREEN: 3,
  PRESENTATION_MODE: 4,
  ACCEPTS_NOTIFICATIONS: 5,  // the ONLY value on which a notification-like surface may appear
  QUIET_TIME: 6,             // documented as the first hour after a NEW user's first logon.
                             // It is NOT Focus Assist. Treated as DND anyway: it is quiet time.
  APP: 7,
} as const;

/** DND := state !== ACCEPTS_NOTIFICATIONS. Microsoft's own guidance, and the honest bound. */
export function isDnd(state: number): boolean;
```

**`GetLastInputInfo` wraparound, handled explicitly** (research §6.1: `dwTime` is a `GetTickCount`
value with a **49.7-day** wrap, and Microsoft states the tick *"is not guaranteed to be
incremental"*):

```ts
const info = { cbSize: 8, dwTime: 0 };
if (!GetLastInputInfo(info)) return null;                 // -> unknown
const now = GetTickCount() >>> 0;
const ageMs = (now - (info.dwTime >>> 0)) >>> 0;          // unsigned 32-bit wrap-safe subtraction
// A value above WRAP_SANITY_MS is a wrap artefact or a SendInput-supplied tick; report 0.
return ageMs > WRAP_SANITY_MS ? 0 : ageMs;
export const WRAP_SANITY_MS = 7 * 24 * 3_600_000;         // 7 days
```

**Two documented Win32 caveats, recorded so nobody "fixes" them later:**

- `GetLastInputInfo` reports only **this session's** input and **does not distinguish keyboard from
  mouse** — which is exactly why §10.4's typing predicate is `probableTyping` and not `typing`.
- `SHQueryUserNotificationState` sends no notification when a fullscreen app starts or stops, so it
  **must** be polled; and `QUNS_BUSY` false-positives on overlays such as the NVIDIA one (PowerToys
  maintains a "KnownTriggerApps" list for the same reason). Signal 5's geometry check is what keeps
  a false `BUSY` from hiding the pet — the two are independent and `VisibilityState` already ORs
  them.

### 10.3 Polling and the one timer

`ActivitySensor` owns exactly **one** `setInterval` at `SENSOR_TICK_MS = 500` (2 Hz) and divides it:

```ts
export const SENSOR_TICK_MS = 500;          // signals 1 and 3, every tick
export const DND_EVERY_N_TICKS = 10;        // signal 4: 0.2 Hz
export const POWER_EVERY_N_TICKS = 20;      // signal 6: 0.1 Hz
```

Signal 5 keeps its own 2 s interval inside the existing `startForegroundWatch` (Phase 1, unchanged),
and gains one callback, `onForegroundChanged(): void` (**no argument** — it fires only when the hwnd
actually changed, so a boolean would always be `true`; §10.5's declaration is the binding one) — the coarse breakpoint (a) the
proactive deferral waits for (§3.10.3). The hwnd itself is compared and then discarded; it is never
stored, logged or traced.

### 10.4 The derived-state schema

> **Amended by A3-2 (R3-36):** the cursor-wiggle block near the end of this section is **superseded**.
> The predicate is owned by `apps/desktop/src/main/activity-sensor.ts`, `ActivityDerived` gains
> `wiggle: boolean`, and the constants are 240 DIP / 10 Hz / 15-slot ring / `|dx| >= 6 DIP` /
> `>= 4` reversals in 1.5 s / 20 s cooldown. Read A3-2 at the top of this file before implementing it.

```ts
export interface ActivitySample {
  /** null when the sensor could not read it (koffi missing, API failure). */
  inputAgeMs: number | null;
  cursor: { x: number; y: number } | null;
  /** Distance in DIP from the previous sample's cursor, or null on the first sample. */
  cursorDeltaDip: number | null;
  dnd: boolean | null;
  battery: { charging: boolean; level: number | null } | null;
  tsMono: number;
}

export interface ActivityDerived {
  /** R3-9: 4 consecutive samples (2 s) with input age < 1 s and cursor delta < 2 DIP. */
  probableTyping: boolean;
  /** Monotonic ms the current streak started, or null. */
  typingStreakStartedMono: number | null;
  /** Monotonic ms probableTyping last went true->false, or null. Drives breakpoint (b). */
  typingFellAtMono: number | null;
  /** False after any hard sensor failure; suppresses proactive (R3-9). */
  healthy: boolean;
}
```

**The `probableTyping` predicate, exactly R3-9:**

```
per 2 Hz sample:
  isTypingSample = inputAgeMs !== null && inputAgeMs < TYPING_INPUT_AGE_MAX_MS   # 1000
                   && cursorDeltaDip !== null && cursorDeltaDip < TYPING_CURSOR_DELTA_MAX_DIP  # 2
  if isTypingSample:  typingSamples++;  typingIdleSamples = 0
  else:               typingIdleSamples++;  typingSamples = 0
  if !probableTyping && typingSamples >= TYPING_ENTER_SAMPLES:   # 4 samples = 2 s
      probableTyping = true;  typingStreakStartedMono = now - 4 * SENSOR_TICK_MS
  if probableTyping && typingIdleSamples >= TYPING_EXIT_SAMPLES: # 2 samples
      probableTyping = false; typingFellAtMono = now
```

R3-9: *"It suppresses proactive speech (conservative) and drives only the SOFT A22 reaction (glance
toward the screen, no expression change); it is never presented as a fact."* Concretely:

- Proactive: layer-4 reason `typing` (§3.10.2). Conservative — a false positive costs silence.
- A22 / D11 glance: `sim:event {kind:'typingGlance'}` on the **rising** edge, rate-limited to
  `TYPING_GLANCE_COOLDOWN_MS` (60 s). The arbiter answers it with a **gaze-only** lease
  (`source:'sim'`, 900 ms, target `screen`) — **no expression, no motion**. This is Phase 2 carry
  item **A22** (§13 item 1), and it deliberately does **not** arm the chat window's light-dismiss
  guard, which is what `final-review.md` I-14 asked for: the guard is driven by `chat:composing`
  from the IME and by nothing else.
- D11 cheer: on the **falling** edge, `TYPING_CHEER_DELAY_MS` (5 s) later, when the streak lasted
  `>= TYPING_CHEER_MIN_STREAK_MS` (5 min) and the last cheer was `>= TYPING_CHEER_COOLDOWN_MS`
  (15 min) ago → `sim:event {kind:'cheer'}`. Never during typing (bar §0's suppression rule).
- **D11's "wiggle near her → curiosity", which the first draft left unimplemented.** The bar asks
  for a reaction to the cursor being *jiggled* next to her, which `cursorNear` alone cannot express
  — `cursorNear` is a position, and a wiggle is a pattern. The predicate, computed from signal 3
  alone (the same 2 Hz cursor samples, no new sensor):

  ```
  WIGGLE_WINDOW_MS      = 1_500   // 3 samples at 2 Hz
  WIGGLE_MIN_REVERSALS  = 3       // direction flips on either axis inside the window
  WIGGLE_MIN_TRAVEL_DIP = 24      // total path length, so a slow drift never counts
  WIGGLE_MAX_NET_DIP    = 40      // net displacement, so crossing the screen never counts
  WIGGLE_COOLDOWN_MS    = 45_000
  ```

  It fires `sim:event {kind:'cursorWiggle'}` only while `cursorNear` is true, at most once per
  `WIGGLE_COOLDOWN_MS`. The arbiter answers with a **gaze + expression** lease
  (`source:'sim'`, 1 200 ms, gaze `cursorLock`, `F06` at 0.4) — the "curiosity" the bar names — and
  no motion, so it never fights a running behaviour on the body lane.
- Nothing about typing or cursor movement ever reaches DeepSeek. The preamble carries only what
  Phase 2 already sends: local time, weekday, mood/energy/affection **phrases**, and the gap since
  the last chat.

### 10.5 `ActivitySensor` — API, health, and the degraded path

```ts
export interface ActivitySensor {
  start(): void;
  stop(): void;
  /** The latest sample; `SimService` reads it on every TICK. */
  readonly sample: ActivitySample;
  readonly derived: ActivityDerived;
  /** Fired the MOMENT input age drops below SENSOR_TICK_MS — this is R3-1's immediate USER_INPUT. */
  onInput(cb: () => void): () => void;
  onForegroundChanged(cb: () => void): () => void;
  onDndChanged(cb: (dnd: boolean) => void): () => void;
  onBattery(cb: (b: { charging: boolean; level: number | null }) => void): () => void;
}
export function createActivitySensor(deps: {
  cursor(): { x: number; y: number };
  scaleFactor(): number;                    // to convert the cursor delta into DIP
  win32?: ActivityWin32 | null;             // tests inject; production loads koffi
}): ActivitySensor;
```

**Degradation ladder (R3-9: *"Sensor errors degrade to 'unknown' and suppress proactive"*):**

1. koffi loads → full default tier, `healthy = true`.
2. koffi missing or `GetLastInputInfo` fails → fall back to
   `powerMonitor.getSystemIdleTime() * 1000` (second resolution). `probableTyping` is then
   **permanently false** (the predicate needs sub-second age), `healthy = false`, and the proactive
   gate refuses with reason `sensor-unknown`. The pet still lives — presence, nap and return all
   work at second resolution — she just never speaks first. One `console.warn` on entry, never a
   repeating stream.
3. `SHQueryUserNotificationState` fails → `dnd = null`, treated as **DND on** (conservative), and
   `healthy = false`.

### 10.6 The opt-in tier (R3-9)

Phase 3 ships the **flag and the plumbing**, not a UI (R3-18 keeps settings in Phase 4):

```ts
export const KV_SENSING_TIER = 'sensing_tier';     // '' (default) | 'exe-category'
export const EXE_CATEGORIES = {
  editor:  ['code.exe', 'devenv.exe', 'idea64.exe', 'sublime_text.exe', 'notepad++.exe'],
  browser: ['chrome.exe', 'msedge.exe', 'firefox.exe'],
  terminal:['windowsterminal.exe', 'powershell.exe', 'wt.exe', 'cmd.exe'],
  media:   ['vlc.exe', 'mpv.exe', 'spotify.exe'],
} as const;
export type ExeCategory = keyof typeof EXE_CATEGORIES;
```

- Enabled **only** when `kv.sensing_tier === 'exe-category'`, which no Phase 3 UI sets — it is set by
  hand, and the Phase 4 settings screen is where it gets its dialog, its visible indicator and its
  revocation.
- It adds **one** derived value: `foregroundCategory: ExeCategory | null`, matched from the process
  image **basename, lowercased**, against the closed allow-list above. A name not on the list yields
  `null`. **Window titles are never read at any tier**, and the executable path is discarded
  immediately after the basename comparison.
- Nothing derived from it is ever sent to DeepSeek. It exists for D11 reactions only
  (e.g. a different idle behaviour weight while `media` is foreground), and Phase 3 wires it to
  **nothing** — the condition fact is not added to §4.2's list. The plumbing exists so Phase 4 does
  not have to reopen the sensor.

### 10.7 The X14 privacy statement — plain Chinese, sensing section

X14: *"Privacy page in plain Chinese: what is sent to DeepSeek (PRC processing), what is stored
where, one-click wipe."* The **page** is Phase 4 (bar §5's phase mapping). What Phase 3 owns is the
sensing paragraph, because Phase 3 is what makes the claim true or false. It lives at
`docs/PRIVACY-SENSING.md` and is quoted verbatim by the Phase 4 page:

```
## 她能感觉到什么

默认情况下，她只知道这些：

- 距离上一次有人动过键盘或鼠标过了多少秒。系统只告诉我们「有输入」，不告诉我们按了什么键，
  所以程序里没有任何地方能知道你打了什么字。
- 鼠标现在在屏幕上的位置，以及它有没有在动。
- 电脑有没有锁屏、有没有睡眠、在不在用电池、电量剩多少。
- Windows 现在允不允许弹通知（全屏、投影、专注模式的时候不允许）。她只在允许的时候才会主动说话。
- 最前面那个窗口的位置和大小——只有位置和大小。窗口标题、网址、文件名、程序名，一个都不读。

「她好像知道我在打字」是猜的：程序看到「一直有输入，但鼠标没动」，就当作你可能在打字。
这个猜测只用来让她少打扰你，以及让她朝屏幕看一眼。它不会被写进聊天记录，也不会发给 DeepSeek。

**我们不做的事：** 不装键盘钩子，不读按键，不读剪贴板，不读窗口标题，不截屏，不记录你用了什么软件。

如果你手动打开了「按程序类别反应」这个开关，她会额外知道最前面的程序属于哪一类
（编辑器 / 浏览器 / 终端 / 播放器），只看程序文件名，仍然不看标题。这个开关默认是关的。

发给 DeepSeek 的内容里，关于你的活动只有一句：现在几点、星期几、距离上次聊天多久。
```

`docs/PRIVACY-SENSING.md` is an evidence artefact: `activity-sensor.test.ts` asserts that every
capability the document denies is absent from the source —
`grep -rn 'SetWindowsHookEx\|WH_KEYBOARD\|RIDEV_INPUTSINK\|GetAsyncKeyState\|clipboard\|GetWindowText\|desktopCapturer\|capturePage' apps/desktop/src packages`
must return nothing. **The scope is all of `apps/desktop/src` and `packages` — not just `main`**: a
renderer-side `navigator.clipboard` read or a `packages/` addition would falsify the same sentence,
and a `main`-only grep would catch neither (preflight F-4). A privacy claim that no test can falsify is a marketing line; this one has a
grep behind it.

---

## §11 Memory footprint (R3-14)

Bar §0: *"Measured on the whole Electron process tree: **≤ 4 % CPU / ≤ 250 MB at 30 Hz idle**;
ticker **stopped (0 frames)** when hidden, occluded, fullscreen-vacated, locked; **≤ 0.5 % CPU** in
that state."*

Phase 2 measured **750.3 MB** and recorded it as a 3× miss (`deferred.md`), with the honest caveat
that `sample-resources.ps1` sums `WorkingSet64`, **which double-counts shared pages**. R3-14
replaces the metric before anything is renegotiated: *"no amendment of the 250 MB bar before
profiling the lazy topology."*

### 11.1 The binding metric

R3-14: *"Binding metric = **sum of 'private working set' over the process tree** (what Task Manager
shows; `PROCESS_MEMORY_COUNTERS_EX2.PrivateWorkingSetSize` via koffi, summed over main + every
child); aggregate commit (`PrivateUsage`) is reported alongside, **never added**."*

```ts
// apps/desktop/src/main/memory-metric.ts  — CREATE, owner T3-E
koffi.struct('DS_PMC_EX2', {
  cb: 'uint32', PageFaultCount: 'uint32',
  PeakWorkingSetSize: 'size_t', WorkingSetSize: 'size_t',
  QuotaPeakPagedPoolUsage: 'size_t', QuotaPagedPoolUsage: 'size_t',
  QuotaPeakNonPagedPoolUsage: 'size_t', QuotaNonPagedPoolUsage: 'size_t',
  PagefileUsage: 'size_t', PeakPagefileUsage: 'size_t',
  PrivateUsage: 'size_t', PrivateWorkingSetSize: 'size_t', SharedCommitUsage: 'size_t',
});
const psapi = koffi.load('psapi.dll');
const kernel32 = koffi.load('kernel32.dll');
const GetProcessMemoryInfo =
  psapi.func('bool __stdcall GetProcessMemoryInfo(void* hProcess, _Out_ DS_PMC_EX2* c, uint32 cb)');
// `GetProcessMemoryInfo` takes a HANDLE, and `app.getAppMetrics()` gives PIDs — so the handle has
// to be opened and closed per sample, or the sampler leaks one handle per process per second.
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_VM_READ = 0x0010;
const OpenProcess =
  kernel32.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');

export interface TreeMemory {
  /** THE number the 250 MB bar is measured against. Sum over main + every child. */
  privateWorkingSetMb: number;
  /** Reported alongside. NEVER added to the number above (R3-14). */
  privateCommitMb: number;
  processes: number;
}
export function sampleTreeMemory(pids: readonly number[]): TreeMemory;
```

Per PID: `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, pid)` →
`GetProcessMemoryInfo(h, c, sizeof)` → **`CloseHandle(h)` in a `finally`**. A PID that has already
exited returns a null handle and is skipped, with the skip counted in `TreeMemory.processes` — a
sample that silently drops a renderer would under-report the very number the 250 MB bar is measured
against.

PIDs come from `app.getAppMetrics()` (main, GPU, every renderer and utility process), so no process
in the tree can be missed by a name filter. `cb` is set to `koffi.sizeof('DS_PMC_EX2')`; a Windows
build that predates `PROCESS_MEMORY_COUNTERS_EX2` returns `false`, and the sampler then falls back to
`process.memoryUsage()`-derived numbers **and marks the sample `degraded: true`** rather than
silently reporting a different quantity.

`scripts/sample-resources.ps1` (Phase 2) is **kept unchanged** so the two numbers stay comparable,
and the new script (§11.4) reports both, side by side, clearly labelled. Phase 2's 750.3 MB is not
retracted — it is re-expressed.

### 11.2 The lazy window lifecycle (R3-14)

| Window | Phase 2 | Phase 3 |
|---|---|---|
| pet | eager, kept | **unchanged** — eager, kept for the app's life |
| bubble | eager, kept, hidden | **eager at first need**, destroyed after `BUBBLE_IDLE_GRACE_MS` hidden, recreated on demand (§11.3) |
| chat | eager at startup, hidden on close | **warm-lazy**: pre-created **once** 2 s after `stage:ready` and re-created on demand thereafter; **destroyed** on close (FW-4, verified). Not "lazy" — see the pre-create bullet below, which is honest about what that costs |
| key | eager at startup, hidden on close | **lazy**: created on the first `openKeyWindow(reason)`, destroyed on close |

```ts
// apps/desktop/src/main/window-lifecycle.ts
export const BUBBLE_IDLE_GRACE_MS = 60_000;      // R3-14: "grace default 60 s" — declared HERE only;
                                                 // §11.3's rule references it, never re-declares it
export const RECREATE_BUDGET_MS = 400;           // R3-14: "recreation <= 400 ms"
export const FIRST_MESSAGE_BUDGET_MS = 3_000;    // R3-14: "visible <= 3000 ms from launch"

export class LazyWindow<T extends BrowserWindow> {
  constructor(create: () => T, opts?: { onCreated?(w: T): void; onDestroyed?(): void });
  /** Creates if absent; always returns a live, non-destroyed window. */
  get(): T;
  /** The live window or null — for code that must not resurrect it (e.g. a visibility broadcast). */
  peek(): T | null;
  destroy(): void;
  readonly alive: boolean;
  /** Wall ms the last create() took. Written into the evidence (§11.4). */
  readonly lastCreateMs: number;
}
```

Consequences that must be handled, each with its rule:

- **`sendTo(win, …)` already tolerates `null`** (Phase 2 §2.7), so every broadcast site changes from
  `sendTo(chat, …)` to `sendTo(chatWin.peek(), …)` — a message to a window that does not exist is
  dropped, which is correct: a destroyed chat window has no state to keep in sync.
- **`handleInvoke(channel, [win], …)`** authenticates against a window list. The list becomes a
  **getter**: `handleInvoke(InvokeChannels.userText, () => [chatWin.peek()].filter(Boolean), …)`.
  `main/invoke.ts`'s signature widens to accept `readonly BrowserWindow[] | (() => readonly BrowserWindow[])`;
  the existing array form keeps working, and `ipc.test.ts`'s cases are unchanged.
- **`onFromAny([pet, bubble, key], Channels.chatOpen, …)`** likewise takes the getter form.
- **`holdWindowOpen` is removed for chat and key** — its whole purpose was converting `close()` into
  `hide()` so the eager window survived. With lazy windows, `close()` **is** the destroy, and
  `markQuitting()` keeps its meaning for the pet and bubble only.
- **Cold-start cost.** The chat window's first open now pays a real create. C8's bar is
  *"opens ≤ 250 ms"*; a cold Chromium window will not meet it. Mitigation, pinned: the chat window is
  **pre-created once, in the idle callback after `stage:ready`** (`setTimeout(…, 2000)` after the
  pet is on screen), so the first user-visible open is warm, and it is destroyed on close like any
  other. **Say what this is, plainly: the chat window is eager-with-a-delay for the first open and
  lazy for every one after it.** The `after-chat-close` row of §11.4's table is what shows whether
  the reclaim is real; if it is not, the pre-create is the first thing to drop.

  **The pre-create is guarded, because D10 is a bar criterion** (*"never steals focus
  (`focusable:false`, `showInactive`)"*): it goes through the same `createChatWindow()` Phase 2
  ships, which already sets `show: false` (`chat-window.ts`) and never calls `show()`/`focus()`
  outside `openChat`. `window-lifecycle.test.ts` asserts the pre-created window reports
  `isVisible() === false` and that no `focus()` call is made, and records `lastCreateMs`; the
  evidence records the measured open latency.

### 11.3 The bubble's destroy ordering — R3-14 ↔ R3-17, resolved

R3-14: *"bubble window destroyed after a hidden/idle grace **only when no speech lease is active**
(R3-17 retire runs first)"*.
R3-17: *"if the shell verdict stays hidden > 10 min while a turn is speaking, main retires the turn
as interrupted (history shows `[中断]`) — and only after that may the bubble window be destroyed"*.

The single ordered rule, which is what an implementer follows:

```
HIDDEN_PLAYBACK_RETIRE_MS = 600_000       # R3-17: 10 minutes (declared in window-lifecycle.ts)
BUBBLE_IDLE_GRACE_MS      = 60_000        # R3-14 (declared in §11.2's block — not re-declared here)

on the bubble window becoming hidden (VisibilityState, or the linger expiring):
  start graceTimer(BUBBLE_IDLE_GRACE_MS)

on graceTimer firing:
  if speechLeaseActive:                      # a TurnRunner turn is not idle
      if hiddenFor >= HIDDEN_PLAYBACK_RETIRE_MS:
          await turnRunner.cancel()          # R3-17 retire: history row gets interrupted = true
          # FW-1, verified on main
          destroy the bubble window
      else:
          re-arm graceTimer(BUBBLE_IDLE_GRACE_MS)     # wait; never destroy under a live turn
  else:
      destroy the bubble window

on anything that needs the bubble (brain:state leaving idle, hint:show, proactive:turn, first-mes):
  graceGeneration += 1                       # invalidates any armed timer (see below)
  clear graceTimer
  bubbleWin.get()                            # recreate, then send; measured against RECREATE_BUDGET_MS
```

**The grace timer is generation-stamped, because a hide→show→hide cycle otherwise leaves two live
timers racing to destroy the window.** `LazyWindow` holds a `graceGeneration` counter; arming
captures it, and the callback returns immediately when `captured !== graceGeneration`. Every show,
every recreate and every explicit cancel bumps it. `window-lifecycle.test.ts` pins the cycle
(hide → show at t+10 s → hide at t+20 s → exactly **one** destroy at t+80 s).

The same discipline applies to §5.10's return sequence: it captures a `returnGeneration` at t+0 and
each of its four scheduled steps aborts if a **second** `returned` arrived meanwhile — the lane
leases carry generations, but the *schedule* did not, and a user who wakes the machine twice in
1.5 s would otherwise get two overlapping startles.

`speechLeaseActive` is `runner.state !== 'idle'` **or** `SpeechController` reports a reveal in
flight. The renderer half of that is the fix wave's explicit `visible` state on `SpeechController`
(FW-5, verified at `speech.ts:186`, with its hidden-cancel half verified at `speech.ts:106` and
`:152-155`): while `visible === false` the controller
pauses acknowledgements rather than draining the queue into a window nobody can see, which is what
makes "hidden for 10 minutes with a turn still speaking" a real, reachable state rather than a race.

A recreated bubble must **replay** what it missed: main re-sends `bubble:place`, the current
`shell:visibility`, `mode:changed` and the latest `sim:state` on the recreated window's
`did-finish-load`, then the pending sentence(s). The first-message path (Phase 2 §6.6) already has
the `webContents.isLoading()` guard this reuses.

**Bars this must not break, and how they are checked (§11.4 records both):**
`FIRST_MESSAGE_BUDGET_MS = 3000` from launch to a visible first message, and
`RECREATE_BUDGET_MS = 400` for a bubble recreate. If the measured recreate exceeds 400 ms,
`BUBBLE_IDLE_GRACE_MS` is **revised upward from the measurement** (R3-14 says the grace is *"revised
from the measured recreation latency … and MB reclaimed"*) — the constant moves, the bar does not.

### 11.4 The measurement script contract

```
scripts/measure-memory.ps1
  -Out   <path>    the markdown table it appends to (default docs/evidence/phase3/memory.md)
  -Label <string>  the scenario name
  -Seconds <int>   sampling window, default 20
  -Json  <path>    optional machine-readable sibling
```

It must:

1. Enumerate the Electron process tree by **PID from `app.getAppMetrics()`**, written by the app to
   `%TEMP%\ds-pids.json` on a `DS_MEASURE=1` build — not by matching process names, which cannot
   tell two Electron apps apart.
2. Report, per scenario, **three columns**: `privateWorkingSetMb` (the bar), `privateCommitMb`
   (alongside, never added), and `processes`.
3. Cross-check the private working set against
   `Get-CimInstance Win32_PerfRawData_PerfProc_Process | Select IDProcess, WorkingSetPrivate` and
   report the delta. The raw-data CIM class has **English property names on a Chinese Windows
   install**, unlike the localized performance counters `sample-resources.ps1` avoids for the same
   reason.
4. Run with **no DevTools, on a production `electron-vite build`**, and with recording **not**
   running (R3-15's separation).
5. Record the scenarios in this fixed order, so the table is comparable run to run:

   | Label | State |
   |---|---|
   | `idle-30hz` | pet visible, nothing else open, ticker at 30 Hz |
   | `idle-hidden` | tray-hidden; ticker stopped (0 frames) — bar §0's ≤ 0.5 % CPU case |
   | `speaking` | mid-reply, bubble alive, ticker at 60 Hz |
   | `chat-open` | composer open |
   | `after-chat-close` | 5 s after closing the chat (the lazy destroy must show up here) |
   | `after-bubble-grace` | `BUBBLE_IDLE_GRACE_MS + 5 s` after the last line |
   | `merged-bubble` | only for the §11.5 spike build |

6. Also record the two latency numbers §11.3 depends on — first-message-visible from launch and
   bubble recreate — sourced from the trace (§12.2), not from the script's own clock.

The evidence lands at `docs/evidence/phase3/memory.md` (+ `.json`), with a header stating the
metric, the build, and that Phase 2's 750.3 MB used a different, shared-page-double-counting metric.

### 11.5 The merged-bubble spike — go/no-go

R3-14: *"A merged-DOM-bubble spike is a bounded task with go/no-go = **MB saved ≥ 60** vs.
click-through complexity."*

The spike builds one variant where the **bubble DOM lives inside the pet window** (one renderer
process instead of two) and measures the same scenario table.

| Criterion | Threshold | Source |
|---|---|---|
| **GO if** private working set drops by | **≥ 60 MB** at `idle-30hz` | §11.4's table, both builds, same machine, same session |
| and the pet window's bounds grow by | ≤ `BUBBLE_MAX.width` on the anchored axis only | the merged window must still be a small WebGL surface, not full-screen |
| and hover click-through still passes | the §6.5 oracle gates, unchanged | `picker-oracle.json` for the spike build |
| and C14 still holds | the band never crosses a monitor edge | `bubble-place.test.ts`, re-run against the merged geometry |
| **NO-GO otherwise** | — | the two-window topology ships; the spike branch is deleted, not merged |

GPT's note is recorded so the spike is judged on the right axis: *"whole-window
`setIgnoreMouseEvents` is not a blocker — the avatar already needs dynamic hit testing; the real
costs are enlarged bounds, anchoring, and clamping."*

**The 250 MB bar is renegotiated only with §11.4's numbers in hand** (R3-14). No Phase 3 task may
propose an amendment; the controller does, from the artefact.

---

## §12 Evidence and tests (R3-15, R3-16)

D16: *"Evidence gate: **60-s unattended recording** (**≥ 4 idle behaviours**, continuous
breath/blink, **≥ 1 gaze break**) and **20-s interaction recording** (hover ack, **3 touch
reactions**, drag-fling arc + landing)."*

R3-15 makes the **trace the primary assertion source** and the video the corroboration.

### 12.1 The evidence root

```
docs/evidence/phase3/
  trace-idle-60s.jsonl          the behaviour timeline for the unattended clip
  trace-interaction-20s.jsonl   the behaviour timeline for the driven clip
  phase3-idle-60s.mp4           ddagrab, 30 fps, cropped to the pet
  phase3-interaction-20s.mp4    ddagrab, 30 fps, draw_mouse=1
  phase3-idle-alpha.mp4         OPTIONAL gfxcapture take (real alpha, isolated pet)
  ydif-idle.txt                 signalstats metadata dump
  freeze-idle.txt               freezedetect dump (DIAGNOSTIC ONLY - R3-15)
  d16-report.json / .md         the machine verdict + the human summary
  picker-oracle.json / .md      §6.5, incl. the hardware line
  memory.md / .json             §11.4
  not-measured.md               everything blocked on account balance, named and unestimated
                                (A8 persona bleed, A11 recall ≥ 90 %, R4 first-sentence p50,
                                 X1 prompt-cache ≥ 70 %, the addendum's paint latency)
  motion-labels.md / .json      §4.11's pass: every one of the 21 candidates registered or rejected
  motions/*.png                 §4.11's 3 frames per candidate (0.3 / 1.0 / 2.0 s)
  persona-tokens.txt            §9.2's re-measured character and plain profile sizes
```

`docs/evidence/` is already `.gitattributes -text` (Phase 2 A-5) and every artefact must be produced
with the cwd banner `D:\ds\…`, never a worktree path.

### 12.2 The trace JSONL schema

One JSON object per line, written by `apps/desktop/src/main/trace.ts` under `DS_TRACE=<path>`.
Main stamps the wall clock and its own monotonic clock; renderer records carry their own
`tsRenderer` (§2.4) and are **not** rebased — the two clocks are reported side by side, never
compared (R3-3).

```ts
// apps/desktop/src/main/trace.ts
export interface TraceLine {
  /** Main monotonic ms since the trace opened. */
  m: number;
  /** Wall clock, epoch ms. */
  w: number;
  /** Renderer monotonic ms, present only on records that came over `arb:trace`. */
  r?: number;
  /** Record type. */
  t: 'presence' | 'visibility' | 'behaviourStart' | 'behaviourEnd' | 'laneGrant' | 'laneResult'
   | 'gazeBreak' | 'blink' | 'hoverAck' | 'touch' | 'motion' | 'landing' | 'proactive'
   | 'mode' | 'fps' | 'resource';
  [k: string]: unknown;    // the per-type payload below
}
```

| `t` | Payload fields | Source |
|---|---|---|
| `presence` | `presence`, `presentationMode`, `phase`, `inputAgeMs`, `probableTyping`, `valence`, `arousal`, `energy`, `affection`, `liveliness` | `SimService` on every snapshot change |
| `visibility` | `hidden`, `reason` | `VisibilityState` |
| `behaviourStart` | `id`, `durationMs`, `eligible[]`, `weights[]`, `seed`, `bagSize` | `arb:trace` |
| `behaviourEnd` | `id`, `result` | `arb:trace` |
| `laneGrant` | `lane`, `source`, `generation`, `id`, `ttlMs` | `arb:trace` |
| `laneResult` | `lane`, `source`, `generation`, `result` | `arb:trace` |
| `gazeBreak` | `type` (`lookAwayBack`/`microFidget`/`doubleGlance`), `deg` | `arb:trace` |
| `blink` | `doublet` (bool) | `arb:trace` |
| `hoverAck` | `state` (the §5.9 machine's new state) | `arb:trace` |
| `touch` | `part`, `alpha`, `burst`, `annoyed` | `arb:touch` |
| `motion` | `phase`, `generation`, `vx`, `vy`, `lagX`, `lagY`, `clamped` (bool) | `WindowMotionController` |
| `landing` | `generation`, `impulse`, `edge` | `WindowMotionController` |
| `proactive` | `verdict`, `reason`, `templateId`, `bucket`, `reservationId`, `displayedToday`, `unansweredToday` | `ProactiveController` |
| `mode` | `mode`, `reason` | `ModeStore` |
| `fps` | `fps`, `frameMs` (p50 over the last second) | `arb:trace`, 1 Hz |
| `resource` | `privateWorkingSetMb`, `privateCommitMb`, `cpuPct`, `processes` | `SimService`, 1 Hz, **only** when `DS_TRACE_RESOURCE=1` |

**What the trace must never contain (R3-15), enforced by a test:** API keys, window titles,
executable paths, user text, assistant text, fact values, summary text, or a proactive template's
rendered line (only its `templateId`). `trace.test.ts` guards this **twice**, because a bare
negative regex over a synthetic session is exactly the test that cannot fail (preflight F-3):

1. **Allow-list, not deny-list — this is the load-bearing one.** Every emitted line is parsed and
   every key is checked against the table above for its `t`; an unknown key **fails**. A future
   field that leaks user text therefore fails by *existing*, not by matching a pattern someone
   thought of in advance.
2. The deny regex `/^(?!.*(sk-|apiKey|title|\.exe|content|"text")).*$/` stays as cheap defence in
   depth, and is run over a session driven by the **real** `TraceWriter` fed from recorded
   `arb:trace` / `sim:state` payloads, not from hand-built lines. `DeepSeekError.detail` is likewise never traced — only
`code` (FW-7, verified). `ErrorCodeSchema` already carries the `'storage'` member RESIDUAL-2 added
(`packages/protocol/src/index.ts:49`, `ERROR_HINTS.storage` at `:376`), so §12.2's `code` field and
`ERROR_HINTS`'s exhaustiveness test cover it today.

The writer appends with a bounded buffer (flush every 200 ms or 256 lines), rotates at 32 MB, and is
a no-op when `DS_TRACE` is unset, so production pays nothing.

### 12.3 The ddagrab command lines — exact

> **Deviation from R3-15's literal, recorded.** R3-15 writes
> `ffmpeg -f ddagrab -offset_x/-offset_y/-video_size … -framerate 30`. On the installed
> **ffmpeg 8.1.2**, `ddagrab` is a **filter**, not an input device: `ffmpeg -devices` lists
> `gdigrab` and not `ddagrab`, while `ffmpeg -filters` lists
> `ddagrab  |->V  Grab Windows Desktop images using Desktop Duplication API`. The `-f ddagrab` form
> does not exist and fails immediately. The commands below are the **verified** filter form
> (research §9 recorded 1799/1800 frames over 60 s with it), carrying **exactly the option names
> R3-15 names** — `offset_x`, `offset_y`, `video_size`, `framerate` — as filter options. The ruling
> is honoured in substance; only the `-f` spelling could not be.

```bash
# 60-s unattended clip. -init_hw_device d3d11va is REQUIRED for ddagrab.
# offset/size are PHYSICAL pixels: DIP x scaleFactor (150 % here -> x1.5). Prefer
# screen.dipToScreenRect() in-app over multiplying by hand.
ffmpeg -y -init_hw_device d3d11va -filter_complex \
 "ddagrab=output_idx=0:framerate=30:draw_mouse=0:offset_x=$X:offset_y=$Y:video_size=${W}x${H},hwdownload,format=bgra" \
 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -t 60 \
 docs/evidence/phase3/phase3-idle-60s.mp4

# 20-s interaction clip. draw_mouse=1 is what makes hover and drag legible as evidence.
ffmpeg -y -init_hw_device d3d11va -filter_complex \
 "ddagrab=output_idx=0:framerate=30:draw_mouse=1:offset_x=$X:offset_y=$Y:video_size=${W}x${H},hwdownload,format=bgra" \
 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -t 20 \
 docs/evidence/phase3/phase3-interaction-20s.mp4

# OPTIONAL real-alpha isolated take. `gfxcapture=hwnd=<decimal>` returns "Invalid argument";
# the window_title regex form is the one that works, and it needs an explicit fps.
ffmpeg -y -filter_complex \
 "gfxcapture=window_title='(?i)ds-pet':capture_cursor=0:display_border=0,hwdownload,format=bgra,fps=30" \
 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -t 60 \
 docs/evidence/phase3/phase3-idle-alpha.mp4

# Corroboration passes.
ffmpeg -i docs/evidence/phase3/phase3-idle-60s.mp4 \
 -vf "signalstats,metadata=mode=print:file=docs/evidence/phase3/ydif-idle.txt" -an -f null -
ffmpeg -i docs/evidence/phase3/phase3-idle-60s.mp4 \
 -vf "freezedetect=n=0.003:d=2,metadata=mode=print:file=docs/evidence/phase3/freeze-idle.txt" -f null -
```

Hard rules, each with its measured reason:

- **30 fps, never 60.** Measured: 60 fps loses 3.5 % of frames at 10 s and **5.5 % at 20 s** (the
  deficit grows); 30 fps loses **1 frame in 1800** over 60 s.
- **Never `gdigrab -i hwnd=` or `-i title=` on the pet window** — verified **pure black** on
  GPU-composited Chromium (28 594-byte all-black PNG, `YAVG 16`).
- **Crop with ddagrab's own options**, before `hwdownload`. A `crop` filter placed before
  `hwdownload` is silently ignored and the output stays 3840×2160 — a gotcha that wastes a whole run.
- **No NVENC.** `h264_nvenc` fails on this machine: *"Driver does not support the required nvenc API
  version. Required: 13.1 Found: 13.0"*. Do not write it into the script.
- **If Desktop Duplication is unavailable the run FAILS visibly** (R3-15) — DDA has a documented
  ~4-concurrent-duplication limit, so OBS/Discord/Teams must be closed. There is **no fallback
  capture**: a silently different capture path would make the evidence unfalsifiable.
- **Resource numbers are measured in a separate run WITHOUT recording** (R3-15, §11.4).
- Hosted Windows CI is a dead end (research §9); record locally or on a self-hosted runner.

`scripts/record-phase3.ps1` wraps all of the above: launch → poll for the pet window by title →
`SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` → `FindWindowW([NullString]::Value, title)`
(**`$null` marshals as `""` and silently returns HWND 0** — the trap that cost the researcher two
runs) → `GetWindowRect` → pad 10 % → open the trace → record → close the trace → run the assertion
script (§12.6).

### 12.4 The SendInput driver contract

R3-15: the interaction clip is driven by `SendInput`. **Playwright and CDP cannot do this**:
`setIgnoreMouseEvents(true)` sets `WS_EX_TRANSPARENT | WS_EX_LAYERED`, enforced by **win32k
hit-testing above Chromium**, while `Input.dispatchMouseEvent` injects into the renderer's pipeline
*downstream* of that — it bypasses the exact mechanism under test and produces **false passes**.

```
scripts/sendinput-drive.ps1
  -BoundsFile <path>   JSON { x, y, width, height, scaleFactor } in Electron DIP
  -Script     <path>   JSON array of steps (below)
  -DryRun               print the resolved physical coordinates and exit
```

Requirements, each one a documented failure mode:

- Call `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` **first**. Without it every coordinate
  lands 1.5× off on this 150 % display.
- `MOUSEEVENTF_ABSOLUTE` normalises to `0..65535` **against the primary monitor**, so divide by the
  **physical** `SM_CXSCREEN`/`SM_CYSCREEN` (3840×2160 here), not by the DIP size.
- Assert `[Runtime.InteropServices.Marshal]::SizeOf([type]'INPUT') -eq 40` on x64 before sending;
  a wrong struct size fails silently.
- **Run non-elevated.** `SendInput` fails *silently* into a higher-integrity process under UIPI.
- Move in **steps with sleeps**, never one jump: a teleporting cursor produces no drag arc. The
  AutoHotkey equivalent would need `SendMode "Event"` for the same reason.

The 20-second script, fixed, so the clip is comparable run to run:

| t (s) | Step |
|---|---|
| 0.0 | move to a point 400 DIP away from the pet (off-model) |
| 1.0 | glide onto the pet's head over 500 ms, dwell **2.0 s** → asserts the hover ack |
| 3.5 | click on `head` |
| 5.0 | click on `body` |
| 6.5 | click on `face` |
| 8.0 | press on `body`, glide 220 DIP right + 40 DIP up over 260 ms, release → fling |
| 12.0 | wait for `landing` in the trace |
| 14.0 | seven clicks on `head` inside 900 ms → the D6 annoyance burst |
| 17.0 | move off-model, hold |
| 20.0 | end |

### 12.5 D16 pass criteria (R3-15)

The trace is the assertion source; the video corroborates that the renderer was genuinely animating.

**60-second unattended clip passes iff all four hold:**

| # | Assertion | Source |
|---|---|---|
| 1 | `new Set(behaviourStart.map(r => r.id)).size >= 4` | trace |
| 2 | continuous breath/blink: **no gap > 6 s** between consecutive `blink` records, and the whole 60 s is covered | trace |
| 3 | `gazeBreak` count `>= 1` | trace |
| 4 | `signalstats.YDIF` shows motion in **≥ 90 % of 1-second windows** (a window counts when its max YDIF exceeds `YDIF_MOTION_MIN = 0.35`) | `ydif-idle.txt` |

`freezedetect` is **diagnostic only** (R3-15) — intentional stillness is allowed, so a `freeze_start`
is reported in `d16-report.md` and never fails the run. This is a deliberate change from the research
digest's stricter "assert zero freeze_start".

**20-second interaction clip passes iff:** the trace contains a `hoverAck` with
`state === 'acknowledging'`, **three** `touch` records with three **distinct** `part` values, a
`landing` record whose `generation` matches the preceding `motion` records, and at least one
`motion` record with `phase === 'fling'` and `|vx| >= 200` DIP/s.

**60-Hz claims come from the trace's `fps` records, not from the 30-fps video** (R3-15).

The run is performed at the **shipped default liveliness (0.30)**, and `d16-report.md` states it —
§4.6's density guard is only active at `L >= 0.30`, so a run at 安静 would be measuring a different
configuration.

### 12.6 The assertion script contract

```
node scripts/assert-trace.mjs \
  --trace docs/evidence/phase3/trace-idle-60s.jsonl \
  --ydif  docs/evidence/phase3/ydif-idle.txt \
  --mode  idle|interaction \
  --out   docs/evidence/phase3/d16-report.json
```

- Exits **0** only when every applicable §12.5 assertion passes; exits 1 and prints the failing rows
  otherwise. It never "warns".
- Emits `d16-report.json` with, per assertion: `id`, `expected`, `actual`, `pass`, and the raw counts
  it derived them from — so a reviewer can recompute every number from the artefacts alone.
- Emits `d16-report.md` as the human summary, including the liveliness preset, the build hash, the
  hardware line and the exact ffmpeg command lines used.
- Has its own unit tests (`scripts/assert-trace.test.mjs`, `node:test`, matching Phase 2's
  `eval/` convention of `node --test lib/*.test.mjs`) over **synthetic** traces: one that passes, one
  missing a behaviour, one with a 7-second blink gap, one with no gaze break, and one whose YDIF
  windows fall below the threshold. A gate script with no negative controls proves nothing.

### 12.7 The boundary tests (R3-16)

R3-16: *"for each boundary, the input, the expected state, the emitted commands/generations and the
persisted result"*. Every row below is a named fixture; the pure ones use fake clocks and seeds, the
platform ones run in the adapter integration lane (R3-16: *"GPU/native-window/topology behaviour is
covered by the adapter integration lane and the D16 traces, not by fake clocks"*).

| # | Fixture | Input | Expected state | Emitted | Persisted |
|---|---|---|---|---|---|
| **B-01** | `sim/presence-299-vs-300.fixture.ts` | ticks with `inputAgeMs` 299 900 then 300 000, then `USER_INPUT` | `active` → `idle-present` (`presentationMode='nap'`) → `active` | `sim:event {kind:'returned', awayMs}` **within 1 000 ms** of the input; a `laneGrant` with `source:'sim'` follows inside 1 000 ms (§5.10) | snapshot's `presence`; `affection` unchanged |
| **B-02** | `sim/lock-suspend-no-mood.fixture.ts` | `LOCKED` → 3 h of ticks → `UNLOCKED`; then `SUSPEND` → 3 h → `RESUME` | valence/arousal **bit-identical** across the gap except the single return settling step; `expenditure` unchanged | no `simEvent` except `returned` | `affection`, `earnedToday`, `neglect` unchanged |
| **B-03** | `sim/clock-rollback-dst.fixture.ts` | wall clock +1 h (DST forward), −1 h (DST back), and a manual −26 h rollback | `phase` recomputed from the new wall clock each tick; `firedToday` reset exactly once per distinct `localDate` | at most one `mealCue` per meal per `localDate` | `gate.displayedToday` never gains a second quota for a repeated date |
| **B-04** | `proactive/interrupt-during-generation.fixture.ts` | gate eligible → intent reserved → breakpoint → generation starts → `probableTyping` goes true (variant: `FULLSCREEN on`) | verdict `suppressed`, reason `typing` / `fullscreen`; **no line displayed** | `TurnRunner.cancel()` awaited **(FW-1)**; `proactive:gate {verdict:'suppressed'}` | `proactive_log.outcome='suppressed'`, `displayed_at IS NULL`; caps **not** charged |
| **B-05** | `arbiter/touch-preempt-restore.fixture.ts` | LLM expression lease at t=0 (ttl 90 s) → touch at t=2 s → touch overlay ends at t=3.4 s | expression lane: `llm` → `touch` (covered) → `llm` restored **with its remaining time**; weight follows §5.4's curve from the real elapsed time | `laneResult` `preempted` for the touch lease only; the LLM lease reports nothing until its own end | — |
| **B-06** | `motion/stale-generation.fixture.ts` | fling generation 7 in flight → `grab()` starts generation 8 → generation 7's landing callback fires | generation 7's landing is **ignored** | no `sim:landing` for gen 7 after gen 8 exists; renderer drops it on `generation` mismatch | position from generation 8 only |
| **B-07** | `motion/display-unplug.fixture.ts` (adapter lane) | `display-removed` during a drag; and again during a fling | `rebase()` re-clamps into a live work area, keeps the velocity, **does not** bump the generation | `motion` records continue with the same `generation` and `clamped: true` | `window.json` holds an on-screen position with ≥ 48 DIP grabbable |
| **B-08** | `picker/holes-and-parts.fixture.ts` (browser lane) | the §6.5 oracle's boundary-weighted samples over the 12 poses | FP ≤ 0.5 %, FN ≤ 0.5 %, p95 ≤ 0.2 ms | — | `picker-oracle.json` |
| **B-09** | `arbiter/renderer-reload.fixture.ts` (adapter lane) | reload the pet renderer mid-behaviour, mid-drag and mid-reply | renderer lanes restart from idle; main re-sends `sim:state`, the live `WindowMotion` generation and the speech state on `stage:ready` | in-flight main-owned commands report `renderer_lost` | no duplicate history rows; the turn continues or retires per R3-17 |
| **B-10** | `sim/midnight-caps.fixture.ts` | cross local midnight with `displayedToday = 2`, `unansweredToday = 3` | both counters reset; `earnedToday` resets; `distinctDaysSeen` increments once | `proactive:gate` with a new `nextEligibleAt` | `local_date` on new ledger rows is the new date |
| **B-11** | `memory/extract-truncation.fixture.ts` | an extraction response truncated mid-JSON (`finish_reason: 'length'`) | **zero** facts written | one `console.warn` | `facts` unchanged; `mem_turns_since_extract` still reset (the attempt counted) |
| **B-12** | `memory/fts-paraphrase.fixture.ts` | the §0.3 control corpus + `我腰疼`, `咖啡`, `医院` | 腰疼 and 咖啡 retrieve through the alias column; 医院 returns nothing; the unigram fallback fires only when pass 1 returns < 3 | — | — |

Every fixture name above is final; a task that needs a boundary not listed here stops and asks.

---

## §13 Phase 2 carry items owned by Phase 3 (R3-17)

R3-17 names four; `deferred.md` and the Phase 2 `final-review.md` "Phase 3 carry list" name the rest.
Each row has a file and an owner, so none of them can go missing between the plan and the code.

### 13.1 The four R3-17 items

| # | Carry item | Where it is specified | File(s) | Owner |
|---|---|---|---|---|
| 1 | **A22 listening producer** — the SOFT `probableTyping` glance (R3-9), **not** the IME | §10.4 | `main/activity-sensor.ts`, `main/sim-service.ts`, `renderer/pet/stage/gaze-lane.ts` | T3-A |
| 2 | **A12 distinct greetings** — first-open-of-day / late-night / long-gap, from the D4 phases; template ids, no repeats within 30 days | §3.10.5 (buckets `greeting` / `night` / `longGap`), §4.8 (ids + the A14 audit) | `main/proactive-templates.ts` | T3-C |
| 3 | **The shared summary/fact sanitisation helper** (R3-10) | §8.10 | `packages/memory/src/summary.ts` **(MODIFY, not CREATE)** — `sanitizeMemoryText` already exists at `summary.ts:29` and already implements steps 1, 3 and 5 | T3-D |
| 4 | **Hidden-playback retire policy** — hidden > 10 min while speaking → retire the turn as interrupted (`[中断]`), **and only then** may the bubble window be destroyed | §11.3 | `main/window-lifecycle.ts`, `main/brain-service.ts` | T3-E |

Item 1 closes `final-review.md` **I-14**'s second half explicitly: the glance is driven by the
sensor, is **gaze-only** (no expression, no motion), and **does not arm the chat window's
light-dismiss guard** — that guard stays driven by `chat:composing` from the IME and nothing else.

### 13.2 The rest of the carry list, each with a decision

| Item | Source | Phase 3 decision | Where |
|---|---|---|---|
| **A8** persona bleed (3 personas × 20 prompts, blind attribution ≥ 85 %) | `deferred.md` — *"unsatisfiable, not unmet"* with one persona | **Fixture and harness ship in Phase 3**; the judged run stays NOT MEASURED until an account with balance exists | §9.6 |
| **A14** proactive templates + manipulation audit | `deferred.md` | **Ships**: the layered gate, the ledger, and the A14 linter as a unit test | §3.10, §4.8 |
| **E-3** `trait` probes and the `trait_hit ≥ 0.80` threshold | `deferred.md` — the axis ships wired with **zero** prompts | **12 probes authored in Phase 3**, against the card as it stands after Phase 2 tuning (which was zero iterations, so the card is byte-identical to its Task-3 state). Each probe names **one** card trait and carries a `condition` string stating what a hit looks like (`final-review.md` M-19's missing field, closed here); the axis stays `SKIP` until ≥ 12 exist, and `trait_hit ≥ 0.80` becomes a real gate at the first run with balance | `eval/fixtures/prompts.zh.json`, `eval/judge.md`, owner T3-C |
| **P3** the `mode` tray toggle **and hotkey** | `deferred.md` | **Toggle ships** (tray item + the command grammar). **The hotkey does not**: a global hotkey nobody can rebind is a worse default than none, and the settings surface that would rebind it is Phase 4 (R3-18) | §9.5 |
| `trait_hit` `condition` field (M-19), A18 per-reply emoji gate (M-20) | `final-review.md` item 4 — *"add before the first live judged run"* | **Ship in Phase 3** alongside the A8 fixture, since Phase 3 is what makes the first judged run possible | `eval/judge.md`, `eval/lib/shape.mjs`, owner T3-C |
| **Lazy key window**, and the bubble-inside-pet-window question | `final-review.md` item 7 | **Both ship**: the lazy lifecycle in §11.2, the merged-bubble question as the bounded §11.5 spike with its go/no-go | §11 |
| CSP on all four renderers (M-26), versioned pre-commit hook (M-27) | `final-review.md` item 5 | **Phase 4** (R3-17 says so explicitly) | — |
| **HEAD / Range support in the `app://` handler** | R3-17 names it in the same Phase-4 sentence as CSP; the first draft dropped the row and the preflight caught it (C-30) | **Phase 4** (R3-17). It is tracked in `docs/evidence/phase2/` at commit `c77ff21`; nothing in Phase 3 serves ranged media, and §5.12's `.ogg` files are small enough that the current handler suffices | — |
| **X4 import** | bar §4's "export/**import**" | **Phase 4 (R3-33).** Export and wipe ship in Phase 3 (§8.9); import is a memory-injection surface (research §7.8) and waits for a UI that can show the user what is about to be written | §8.9 |
| **A global pass-through hotkey, and D13's `Ctrl+Alt+H`** | bar §0 / D13. The preflight verified neither exists: `index.ts:405` registers only `Control+Shift+Space` | **Phase 4**, with the settings surface that can rebind them. Phase 3 ships work mode and 静音 as tray checkboxes | §5.9, §0.4's D13 row |
| **X13's volume slider and labelled controls** | bar §3 | **Phase 4** with the settings window. Phase 3 ships the audio path, the 静音 checkbox and a kv volume value | §5.12 |
| **Hiyori** | D-102 / R3-31 | **Phase 4 (character import).** Unselectable in Phase 3: no `behaviors.json`, `MIN_USABLE_BEHAVIORS` not relaxed, and the loader says why on screen. One row added to `docs/evidence/phase2/deferred.md` | §4.7 |
| `nativeTheme` handling / un-emulated dark capture (M-18) | `final-review.md` item 6 | **Phase 4** (R3-17) | — |
| `metrics` table retention | `final-review.md` item 8 | **Phase 4** (R3-17). Note that Phase 3 *adds* to the row (`metrics.envelope`, §8.1), so the retention question gets bigger, not smaller — flagged for the Phase 4 metrics tab | §8.8 |
| Untracked `.superpowers` contracts-copy divergence | `final-review.md` item 9 | **Docs-only.** `docs/superpowers/plans/2026-08-29-phase2-contracts.md` is the authority this document extends; any `.superpowers` copy is stale and is not read by Phase 3 | §0.1 |
| **C7** bubble stacking + a draggable, persisted offset | `deferred.md` routes it to Phase 3 | **Phase 4 (R3-20).** `deferred.md`'s routing is overruled: C7 interacts with the destroyable bubble window (R3-14) and with `placeBubble`'s single-rect geometry, and belongs with the settings/packaging pass. **No Phase 3 task builds it**, and nothing in this contract specifies it | §14.1 Q1 |
| **X13** labelled settings controls / high-contrast | bar §3 | **Split**: the audio half ships (§5.12); the labelled controls are Phase 4 with the settings window | §5.12 |
| **X4** 记忆 tab, and X4 **import** | bar §4 | **Split**: commands, export and wipe ship (§8.9); the tab is Phase 4 (R3-24) and import is Phase 4 (R3-33) | §8.9, §14.1 Q5, §14.2 P6 |

### 13.3 What Phase 3 explicitly does **not** touch

`packages/brain`'s streaming parser, sentence splitter, sanitizer and slop linter; the bubble's
`RevealPlan` and its cadence; `placeBubble`'s geometry; the key window's flow; the Phase 1 pet-window
options; `HistoryStore.list/deleteTurn/countSince/lastMessageTs`. Phase 3's edits to those files are
limited to the ones named in §1.5, and each is listed there with its section.

---
## §14 Question ledger — every question is resolved; nothing is open

This section was eight open questions in the first draft. All eight were ruled on in `rulings.md`
**v2.1** (R3-20 … R3-27); the preflight then raised eight more, ruled on in **v2.2**
(R3-28 … R3-34). **There are no open questions.** The ledger below records what each ruling decided
and where the contract implements it, so a reviewer can check the contract against the ruling
without re-deriving either.

### 14.1 Resolved by rulings v2.1 (the first §14)

| # | Question | Ruling | Where |
|---|---|---|---|
| Q1 | Who owns C7 (bubble stacking / draggable band offset)? | **R3-20: Phase 4.** `deferred.md`'s Phase 3 routing is overruled — it interacts with the destroyable bubble window and belongs with the settings/packaging pass. No Phase 3 task builds it | §13.2 |
| Q2 | May the plain profile's measured token count change? | **R3-21: yes.** `PLAIN_OUTPUT` replaces `tagGrammar`; the new count is measured into `docs/evidence/phase3/persona-tokens.txt`; Phase 2's 184 is superseded, not retracted | §9.2 |
| Q3 | Is alpha-only enough for press, or must a semantic-id pass ship? | **R3-22: alpha-only in production**, id pass in the oracle; part attribution at press comes from the CPU predicate and every disagreement is traced | §6.3, §6.5 |
| Q4 | Should idle `wander` ship at all? | **R3-23: ship it, gated at liveliness ≥ 0.4** — off at 安静 (0.15) and 默认 (0.30), on at 活泼 (0.70) | §4.9 |
| Q5 | Is X4's 记忆 tab Phase 4? | **R3-24: yes.** Phase 3 ships 记住这个 / 忘掉这个, export and one-click wipe via tray, plus the data path | §8.9 |
| Q6 | What is the per-day token cap for proactive LLM calls? | **R3-25: 1 LLM-generated proactive line per local day**, `max_tokens` 300 (≤ ~300 completion tokens/day); every other bucket is a zero-token template | §3.10.5, §3.10.7 |
| Q7 | Confirm the `ddagrab` spelling deviation? | **R3-26: R3-15 is corrected.** `ddagrab` is a FILTER in ffmpeg 8.1.2 (re-verified live by the preflight: `-devices` does not list it, `-filters` does); the binding form is the `-filter_complex "ddagrab=…"` one | §0.2, §12.3 |
| Q8 | Run a motion-labelling pass and register more of Haru's motions? | **R3-27: YES, a bounded pass IS in Phase 3.** The draft's assumed default (*"not in Phase 3"*) was the opposite of the ruling and is **deleted** | §4.11 |

### 14.2 Resolved by rulings v2.2 (the preflight's §G questions)

| # | Question | Ruling | Where |
|---|---|---|---|
| P1 | Run the labelling pass, or reverse R3-27? | **R3-28: R3-27 stands**, option (a). §4.11 specifies the pass; §4.10's `extraMotions` becomes `{file, name, tags}`; the starter pack re-binds the `["Idle", …]` reuses | §4.9, §4.10, §4.11 |
| P2 | Is the `world` bucket template-only? | **R3-29: yes.** Only `callback` may carry an `instruction`; R3-25's one-line-per-day budget is therefore the callback bucket's cap, and the invariant is stated once and tested | §3.10.5, §3.10.7 |
| P3 | Who writes ≥ 160 audited Chinese templates, and is a smaller floor acceptable? | **R3-30: ≥ 15 per bucket for Phase 3**, written by the implementing task in the persona's voice, **audited line-by-line by a separate review agent** before merge; rejected lines are rewritten, never padded; the no-exhaustion arithmetic is stated; Phase 4 raises the floor toward 160 | §4.8 |
| P4 | Hiyori: ship a pack, relax the floor, or accept unselectable? | **R3-31: unselectable in Phase 3.** No `behaviors.json`, `MIN_USABLE_BEHAVIORS` **not** relaxed per character, the loader reports the reason on screen, `deferred.md` gains a Phase 4 row | §4.7, §13.2 |
| P5 | A11: ship a fixture, or record it as not-measured? | **R3-32: both.** The fixture file and the harness command ship so the run is one shot later; the threshold goes to `not-measured.md` beside A8 until the DeepSeek balance exists | §8.11, §12.1 |
| P6 | X4 import? | **R3-33: Phase 4.** Export and wipe ship in Phase 3 | §8.9, §13.2 |

### 14.3 Resolved by default under R3-34

R3-34: *"the drafter applies the preflight's own recommended default and records it in §14 as
'resolved by default under R3-34'; the controller reviews those at plan time."* Two questions fall
here.

**P7 — D12's "default quiet" versus R3-13's `默认 0.30`. Resolved by default under R3-34: the ruling
overrides the bar, and the override is now recorded.** D12 asks for a slider whose default is
"quiet"; R3-13 fixes the presets at `安静 0.15 / 默认 0.30 / 活泼 0.70` and R3-23 calls 0.30 "the
default preset". The contract ships `LIVELINESS_DEFAULT = 0.30` and now **says so** in §3.4 and
§3.5: 0.30 is still firmly in D12's "quiet cat in the corner" half of the range — it is 30 % of the
way from silent to playful, it never moves her unprompted (R3-23's `wander` gate at 0.4), and it
produces one behaviour change every 14 s rather than every 8. The D16 evidence run is at **0.30**,
stated in §12.5, because §4.6's density guard is only active at `L ≥ 0.30` and a run at 0.15 would
be measuring a different configuration. *If the controller prefers the letter of D12, the change is
one constant and one evidence re-run.*

**P8 — §11.2's chat pre-create makes the chat window eager-with-a-delay, not lazy. Resolved by
default under R3-34: keep it, guarded, and let the measurement decide.** C8's bar is "opens
≤ 250 ms" and a cold Chromium window will not meet it, so the pre-create stays — but three things
now make it honest rather than a hidden eager window: §11.2's table calls it **warm-lazy** instead
of lazy; the pre-create goes through `createChatWindow()`'s existing `show: false` and is asserted
never to take focus (D10); and §11.4's `after-chat-close` scenario is what shows whether the reclaim
is real. **If it is not, the pre-create is the first thing to drop** — that sentence is in §11.2, and
the number that would trigger it is in the evidence table, not in anyone's judgement.

### 14.4 What is left for the controller

Nothing to decide. Three artefacts to **look at** once they exist, each already named in the
contract together with the number that would change the answer:

1. `docs/evidence/phase3/motion-labels.md` — if §4.11's pass yields fewer than **10** usable extras,
   the shortfall is recorded there rather than padded, and the pool's variety becomes a Phase 4
   question.
2. `docs/evidence/phase3/memory.md` — the 250 MB bar is renegotiated only from these numbers
   (R3-14), and §11.5's merged-bubble spike is go/no-go at **≥ 60 MB** saved.
3. `docs/evidence/phase3/picker-oracle.md` — if the CPU predicate misses FP/FN ≤ 0.5 % or
   p95 ≤ 0.2 ms, §6.6's FBO path ships instead, behind the same `Picker` interface and the same
   gates.
