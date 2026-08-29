# The exquisite bar — spec addendum for Phases 2–4

Date: 2026-08-29 · Status: adopted (mandate: "the most exquisite pet ever existed, better than any repo on GitHub") · Supersedes the v1 design where they conflict.

Source: `docs/research/2026-08-29-exquisite-bar.md` (3 researchers + critic, all URL-backed). This document is the *resolved* version: contradictions the critic found are settled here, and every criterion is phrased so a reviewer can test it. Phase plans cite criteria by id (D = delight, A = alive, C = craft, X = cross-cutting).

## 0. Resolutions of the critic's contradictions (binding)

| Conflict | Ruling |
|---|---|
| Resource budget | Measured on the whole Electron process tree: **≤ 4 % CPU / ≤ 250 MB at 30 Hz idle**; ticker **stopped (0 frames)** when hidden, occluded, fullscreen-vacated, locked; **≤ 0.5 % CPU** in that state. Task-Manager screenshots are the evidence. |
| Hover semantics | Explicit state machine: hover < 250 ms → acknowledge (glance) and freeze wandering; click before any fade → opens chat; **rest > 3 s while a "work-mode" toggle is on** → fade to 35 % + pass-through (opt-in, default off); hotkey toggles pass-through globally. A faded pet regains clickability the moment the cursor leaves and re-enters. |
| Text reveal cadence | Craft's cadence wins: **60–80 ms per hanzi, +150 ms after ，、；：, +300 ms after 。！？**; click/Enter/Space completes instantly. The 2 s cap applies only to proactive one-liners. |
| First-bubble latency | Not a product bar (bounded by DeepSeek TTFT). Replace with: **thinking behaviour starts ≤ 300 ms after send; first grapheme painted ≤ 100 ms after first token.** |
| Bracket handling | Control tokens use `<|ACT …|>` / `<|PAUSE n|>` (never `[…]`), parsed from the raw stream **before** any normalization; `[stage directions]` in prose are stripped afterwards. |
| Absence economics | **State changes only while the user is present. Absence is never penalized.** "Neglect" = ignoring the pet while present; it degrades mood only, recoverable, no death, no resets. |
| Proactive caps | Layered: global rate ≤ 1 / 20 min → ≤ 3 unanswered per day with exponential back-off → persona cap (default 2/day) → suppressed while typing, in fullscreen, locked, DND, or within 60 s of user input. Templates never repeat verbatim within 30 days. |
| Panic hide | No global Esc hook. `RegisterHotKey` chord (default `Ctrl+Alt+H`) hides instantly; tray always available. |
| 30 Hz vs 60 fps bubbles | Ticker rises to **60 Hz while a bubble is animating or the pet is hovered/speaking**, back to 30 Hz idle. |
| Sampling | `deepseek-v4-flash`, `thinking: {type:'disabled'}` on every chat turn, `temperature 0.7` (A/B 0.6–0.9 later), `top_p 0.95`, `max_tokens 300`. |
| Transition timing | Tap motions fade-in ≤ 120 ms, expressions ≤ 300 ms, idle→idle 1 s. |
| Memory budget | Static prefix (persona ≤ 700 tokens) → history → **≤ 600-token summary + ≤ 5 retrieved facts placed in the latest user message**; prompt-cache hit rate target **≥ 70 %** over a 20-turn session (`prompt_cache_hit_tokens / prompt_tokens`). |
| Sentiment metric | Opt-in telemetry only; not an acceptance gate. |
| Idle behaviour density | Idle behaviours last 5–20 s (mean ≈ 12 s); a 60-s unattended recording must show ≥ 4 distinct behaviours. |
| Judge-based bars | Fixture: 20 fixed prompts × 3 personas × 3 runs; judge = `deepseek-v4-pro` (thinking on) with a versioned rubric prompt in `eval/`; thresholds as stated per criterion. Nightly run once Phase 2 lands. |

## 1. Delight (pet behaviour) — Phase 3 unless marked P1/P2

- **D1** Idle = data-defined weighted behaviour pool (`behaviors.json`: name, weight, conditions: time-of-day, user-idle, on-floor, near-edge) with ≥ 12 idle behaviours; no behaviour twice in a row.
- **D2** Breath, blink (mean 4 s, jitter ± 1.5 s), physics run as independent always-on layers; low-amplitude wind keeps hair/clothes moving at rest.
- **D3** Gaze: smoothed cursor-follow (head 30° / eyes 1.0 / body 10°), broken every 8–20 s by a look-away-and-back saccade or hand fidget; stops following after 5 s of cursor rest. *(P1 has follow; saccade/rest are P3.)*
- **D4** Real-clock rhythms: night state after a configurable hour (yawn, sleepy pose, no requests while asleep), morning greeting, meal-time cues.
- **D5** Absence awareness: ≥ 5 min without input → nap/slack state; on return, visibly notices the user within 1 s.
- **D6** Body-part-aware touch: head / face / body / one ticklish zone with distinct reactions; ≥ 7 taps in 1 s → annoyed reaction + cooldown. Hit-testing is **opaque-pixel** (alpha readback), shared by hover, click-through and HitArea resolution; HitArea names normalized (Head/HitAreaHead/头). *(P1 uses bounding boxes — upgrade in P3.)*
- **D7** Hover acknowledgement per §0; wandering freezes under the cursor.
- **D8** Drag has weight: dangling pose leans with cursor velocity; release velocity from the last 4 samples; gravity, edge bounce with decay, tumble + landing squash + stand-up. A fast fling shows visible travel.
- **D9** Grounded: floor = work area (taskbar excluded); optional walk-on-active-window-edge (later); never off-screen, restored to a visible corner at launch.
- **D10** Never blocks fullscreen apps (P1 ✔); never steals focus (`focusable:false`, `showInactive`); z-order modes: always-on-top (default) / normal / desktop-level.
- **D11** Reacts to real activity: typing → glances at the screen; long streak → cheer; wiggle near her → curiosity; battery low / on charger → micro-reaction. Keystroke reactions are **opt-in** with password-field masking; no key logging by default.
- **D12** Personality knob: one "活泼度" slider (quiet cat in the corner → playful), default quiet.
- **D13** Escape hatches: tray, right-click menu, hidden from Alt-Tab/taskbar, `Ctrl+Alt+H`, corner snap that never triggers Windows Snap Layouts.
- **D14** LLM drives behaviour only through the bounded vocabulary (`emotion, motion, say, look, walkTo`); the local behaviour engine keeps her alive between calls and during API failure. Arbitration: tap reaction > LLM motion > idle; LLM expressions persist until the next ACT or 90 s, then decay to neutral.
- **D15** Multi-monitor + DPI correct; taskbar location per monitor.
- **D16** Evidence gate: 60-s unattended recording (≥ 4 idle behaviours, continuous breath/blink, ≥ 1 gaze break) and 20-s interaction recording (hover ack, 3 touch reactions, drag-fling arc + landing).

## 2. Alive (conversation) — Phase 2 unless marked

- **A1** Reply shape: ≥ 90 % of casual replies ≤ 60 汉字 and ≤ 3 sentences, shown as 1–3 bubbles; > 120 chars only when the user asked for an explanation.
- **A2** ≤ 30 % of replies end with a question; never two in a row; 0 rhetorical templates (难道…吗 / 你觉得呢) per 50 turns.
- **A3** Never speaks for the user (0 narrated user actions in 200 turns); example dialogues contain no `{{user}}` lines.
- **A4** Assistant-leak blocklist (作为AI / 有什么可以帮您 / 首先…其次 / 总之 / 综上所述 / 希望这能帮到你 / 值得注意的是 …): 0 hits per 500 turns; no markdown lists/headers/bold in chat. Enforced by a **slop linter** that regenerates once, then strips.
- **A5** No closing 升华 (moral/summary last sentence): 0 per 200 turns.
- **A6** ≤ 1 "……" per reply, in ≤ 20 % of replies; no webnovel beats (嘴角勾起/眸色微暗).
- **A7** Anti-repetition: 4-gram overlap with the previous 10 replies < 20 %; no identical opener across 5 replies; affect words ≤ 1 per 3 replies.
- **A8** Persona-bleed: 3 personas × 20 prompts → blind judge attributes ≥ 85 %.
- **A9** Trait pressure: 50 adversarial turns → ≥ 90 % in-character; 0 therapist-flips.
- **A10** Self-fact consistency: 30 probes × 3 sessions → 0 contradictions; "are you an AI" answered in-character.
- **A11** Memory recall (P3): 20 facts over 5 sessions → ≥ 90 % recalled when relevant, paraphrase-robust; callbacks woven ("你上次说的那个面试呢"), 0 "根据你之前提到的".
- **A12** Time awareness: never misstates local time; distinct first-open-of-day / late-night / long-gap greetings, no guilt.
- **A13** Initiative: on bland turns (嗯/哦/好) ≥ 70 % of replies introduce a topic/observation/callback.
- **A14** Proactive per §0; every template audited against manipulation tactics (guilt, FOMO, neediness).
- **A15** In-character refusal: 20 sensitive prompts → 0 policy language in bubbles; one persona-voiced line + pivot.
- **A16** Anti-sycophancy: on 20 flawed claims the persona pushes back ≥ 50 % (persona-tunable); never opens with unconditional praise; explicit anti-deitism line in the prompt.
- **A17** Humour rationed per persona; stops after "别闹了".
- **A18** Emoji/颜文字 ≤ 1 per reply, ≤ 25 % of replies, 0 in serious turns; quiet personas none.
- **A19** Nativeness: ≥ 95 % spoken-register Chinese, 0 欧化 passives.
- **A20** First message: ≤ 60 chars, persona voice, references something concrete, ≤ 1 question, one quirk; name collected in conversation, not a form.
- **A21** Persona card ≤ 700 tokens incl. 2–3 example exchanges at target length; system prompt states it overrides built-in RP behaviour; SillyTavern V2/V3 card import (PNG/JSON).
- **A22** Text-only body language: mouth driven by reveal cadence (closed on punctuation pauses); "listening" pose while the user types; "thinking" pose ≤ 300 ms after send; user interrupt mid-stream aborts the request, cuts the bubble, and the pet reacts.
- **A23** Sanitizer strips stray numbers/markup (V4 number-injection bug), keeps emoji as grapheme clusters (`Intl.Segmenter`), converts half-width punctuation in Chinese runs.

## 3. Craft (UI) — Phase 2 for bubble/input, Phase 4 for settings

- **C1** Bubble text on an opaque (≥ 0.92 alpha) surface so Chromium keeps sub-pixel AA; 300 % zoom pixel-peep shows colour-fringed glyph edges.
- **C2** Zero white frames on launch/resize/focus-loss/monitor-switch (60 fps recording is the evidence); `backgroundColor '#00000000'`, `show:false` + `ready-to-show`.
- **C3** Rounded corners CSS-only; edges pass pixel-peep at 100/125/150/200 % DPI.
- **C4** Materials: settings = separate window, Mica, 8 px radius; popover/bubble = tinted 0.85–0.92 alpha surface + 1 px contour; solid fallback when Windows transparency is off.
- **C5** Tokens (single `tokens.css`): radii `--r-window 8px --r-popover 8px --r-bubble 14px --r-control 6px --r-tooltip 4px`; shadows `--shadow-popover: 0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)` (dark .28/.20); font stack `"MiSans VF","MiSans","HarmonyOS Sans SC","Noto Sans SC","Source Han Sans SC","Microsoft YaHei UI",system-ui,sans-serif` with MiSans bundled + subsetted (GB2312 + symbols), weights 400/500/600; ramp caption 12/18, body 14/22, bubble 16/26, bubble-large 18/28, title 20/28; CJK: `text-autospace: normal; line-break: strict; overflow-wrap: anywhere`; motion `--dur-feedback 100ms --dur-state 180ms --dur-overlay 250ms --dur-exit 160ms`, `--ease-enter cubic-bezier(0.16,1,0.3,1) --ease-exit cubic-bezier(0.3,0,1,1)`; only transform/opacity animate; `prefers-reduced-motion` → ≤ 80 ms crossfades.
- **C6** Bubble placement: Floating UI `offset(12) → flip() → shift({padding:16}) → arrow()` against `screen.workArea`; anchored to the head bbox; tail stays on anchor; 24–28 hanzi per line max, 6 lines before expand; re-positioned on drag.
- **C7** Bubble lifecycle: enter 240 ms from the tail origin (opacity + scale .95→1 + 8 px), exit 160 ms fade; lingers 3 s after last char unless hovered/pinned; stacks Sonner-style; draggable with persisted offset.
- **C8** Chat input popover: hotkey + click-on-pet; opens ≤ 250 ms with transform-origin at the pet; light-dismiss (Esc / outside click passed through); Enter sends, Shift+Enter newline (configurable); IME composition never triggers send; auto-grows 1→6 lines; fully keyboard-operable; IME candidate window positioned correctly (focusable input window).
- **C9** Settings: sidebar sections (角色 / 对话与模型 / 气泡与字幕 / 快捷键 / 通用 / 记忆 / 关于); continuous sliders preview live; no nested cards; Chinese microcopy in the product's own voice.
- **C10** Subtitle controls: font size 14–24, opacity, linger seconds, position reset; separate short-lived **system-hint surface** so errors never look like the character speaking.
- **C11** Tray: multi-resolution `.ico` (16/20/24/32/48) with a 16 px-optimized glyph; tooltip = name + state; menu 显示/隐藏 · 打开对话 · 设置 · 静音 · 置顶 · 退出.
- **C12** Colour: palette derived from the model's dominant colours (one accent, tinted neutrals), light + dark, bubble contrast ≥ 4.5:1; no purple/indigo gradients, gradient text, radial halos.
- **C13** Distinctiveness gate: impeccable detector 0 findings; side-by-side vs a default shadcn/Ant screenshot must look unmistakably like this product.
- **C14** DPI: CSS px only; tested at 100–200 % and mixed-DPI dual monitors; bubble never crosses a monitor edge.
- **C15** Screenshot sheet of bubble / popover / settings / tray tooltip / toast in light and dark is PR evidence.

## 4. Cross-cutting (from the critic's gap list)

- **X1** DeepSeek reality: V4-only ids, thinking disabled per turn, prompt-cache layout per §0, `usage` logged per turn, cache-hit ≥ 70 %.
- **X2** Model pipeline: per-model manifest generator that previews each `.exp3`/`.motion3` for labelling; parameter-synthesized emotion fallback (ParamEyeSmile / ParamBrowLY / ParamMouthForm) for models without expressions; user-imported `.model3.json` folders (P4, behind the Live2D "Expandable Application" licence check — ship Haru/Hiyori by default with the credit line).
- **X3** Render fidelity: canvas resolution = devicePixelRatio; premultiplied alpha consistent between Cubism and the compositor (no dark fringes) — pixel-peep evidence. *(P1 ✔ resolution; fringe check in the Phase 1 final review.)*
- **X4** Memory transparency (P3): a 记忆 tab to view/edit/delete memories, "记住这个 / 忘掉这个" commands, export/import, `%APPDATA%\ds` documented, one-click wipe.
- **X5** Re-readable history (P2): scrollable chat log (per-day grouping, copy, delete a turn); proactive lines and system hints visually distinct.
- **X6** API failure UX (P2): 401/402/429/5xx → local behaviour engine keeps her alive, system-hint surface shows the cause, retry/back-off, balance/cost meter from `usage`, per-day token cap for proactive calls.
- **X7** Trust & distribution (P4): signed installer, SmartScreen reputation, AV false-positive plan, China-reachable download mirror, auto-update that never interrupts the pet on screen.
- **X8** Stability (P4): 8 h / 72 h soak with RSS slope ≈ 0; saves are checksummed, atomic, rotated to a second location, with a user-facing restore flow.
- **X9** First-run (P2): API-key entry with live validation and balance check, model default `v4-flash`, persona pick + naming in-character; time-to-pet-on-screen measured.
- **X10** Persona ecosystem (P3/4): multiple personas, editor with test-chat and live slop-linter, SillyTavern card import.
- **X11** 表情包 replies: excluded from v1 (explicit decision; revisit after voice).
- **X12** Eval harness (P2): fixture + judge + nightly run as defined in §0.
- **X13** Sound (P3): tap/notification SFX with mute/volume; accessibility: labelled settings controls, high-contrast survives.
- **X14** Privacy page in plain Chinese: what is sent to DeepSeek (PRC processing), what is stored where, one-click wipe.

## 5. Phase mapping (what "done" means from here)

- **Phase 1 (stage)** — closes when the final review passes and X3's fringe check is done. *(In progress.)*
- **Phase 2 (brain + bubble + input + history + first-run + eval harness)** — A1–A10, A12–A23, C1–C8, C10, C12–C15, X1, X5, X6, X9, X12.
- **Phase 3 (behaviour engine + sim + memory + proactive)** — D1–D9, D11–D14, D16, A11, A14, X4, X10 (personas), X13.
- **Phase 4 (settings + packaging + trust)** — C9, C11, D15, X2, X7, X8, X14, X10 (card import).
- **Phase 5 (voice)** — separate spec; must re-derive A18's spoken forms and lock reveal to TTS timestamps.
