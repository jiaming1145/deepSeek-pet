# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron 43 on Windows 11 — a Chromium renderer inside transparent/normal native windows; Windows 11 material conventions (Mica, Fluent radii/shadows) apply to the settings window and popovers, but the design language is web, not a native toolkit.)

## Users

Primary user: Jiaming (the owner), alone at their own Windows 11 desk during daily work, study and gaming sessions — a technically capable person who is *not* experienced with Live2D. The pet lives in the corner of the screen all day; the job is companionship that never gets in the way: glance at her, poke her, exchange a few lines of Chinese, and get back to work. [confirmed 2026-08-29]

Secondary audience: none confirmed. A future open-source release for Chinese hobbyists was explicitly *not* chosen as the design target; onboarding for strangers is a later concern, not a constraint on this surface. [confirmed]

## Product Purpose

A desktop pet with a Live2D avatar (Haru, later a commissioned model) whose personality and conversation are driven by DeepSeek. Success is felt, not measured: she feels alive (idle behaviours, gaze, reactions), talks like a real Chinese-speaking person with a consistent character, remembers you, and stays out of the way of real work. Goal set by the owner: "the most exquisite pet ever existed, better than any repo on GitHub" — the quality bar is `docs/superpowers/specs/2026-08-29-exquisite-bar.md`. [confirmed]

## Positioning

Every existing Live2D/LLM pet (Open-LLM-VTuber, Project AIRI, the Chinese 桌宠 scene) treats the avatar as a chat client with a face. This product inverts it: a local behaviour engine keeps her alive every second regardless of the API, the LLM only chooses from a bounded action vocabulary, and the writing bar for Chinese conversation (no assistant-speak, no 反问, no 升华, woven memory) is enforced by a linter and an eval harness — not hoped for. Text-first, voice later. [inferred from spec + research; owner-approved spec]

## Operating Context

- Windows 11, single primary display at 150 % scaling today (mixed-DPI setups must not break); frequent fullscreen games and video (she must vacate); lock/sleep cycles.
- Chinese-first interaction (zh-CN UI copy and persona), occasional English/code on screen.
- Bring-your-own DeepSeek API key (`deepseek-v4-flash`, thinking disabled per turn, prompt-cache-aware prompt layout); prompts are processed in the PRC — disclosed in-app.
- Runs from a tray icon; launches at login later; no taskbar presence; must never steal focus.
- Data lives in `%APPDATA%\ds` (SQLite); Live2D sample models and proprietary Cubism Core are fetched at install, never redistributed.

## Capabilities and Constraints

Confirmed (Phase 1, shipped on `main`): transparent always-on-top pet window, hover click-through, tap reactions, drag, cursor gaze, tray, position persistence, fullscreen/lock hiding, debug panel.

Planned: Phase 2 brain (streamed DeepSeek chat with `<|ACT …|>` emotion/motion tags, speech bubble with Chinese reveal cadence, chat input popover with IME support, re-readable history, first-run key entry, eval harness); Phase 3 behaviour engine + mood/affection/energy sim + memory + proactive speech; Phase 4 settings window, packaging, trust; Phase 5 voice.

Constraints: Electron pinned 43.4.1; official Cubism Framework 5-r.5 (hand-wrapped); `node:sqlite`; no user-uploaded models until the Live2D "Expandable Application" licence question is settled; no keystroke logging by default; proactive messages are rate-capped and never guilt-based.

Undecided (explicitly): the product's real name (codename **ds** for now — tray/window/README say "ds"); the persona (owner will describe her — name, age vibe, voice, relationship); the eventual commissioned model.

## Brand Commitments

- Codename "ds" until renamed. [confirmed]
- Persona: to be written from the owner's description; Chinese-native voice; the character's own name is the likely eventual product name. [open]
- Required credit line for Live2D sample data must appear in 关于 and README (licence). [confirmed]
- Voice of UI copy: the product's own Chinese voice — short, warm, never assistant-speak. [confirmed via spec]

## Evidence on Hand

- Working Phase 1 build with desktop screenshots: `docs/evidence/phase1/*.png` (idle, hover, debug, fullscreen-hidden, browser render).
- Research with named references: `docs/research/2026-08-28-landscape-research.md`, `docs/research/2026-08-29-exquisite-bar.md`.
- No testimonials, users, metrics, or marketing claims exist — do not fabricate any.

## Product Principles

1. **She is alive before she is smart** — local behaviour never depends on the network; the API adds conversation, it does not animate her.
2. **Never in the way** — click-through, fullscreen vacating, no focus theft, no nagging; being ignorable is a feature.
3. **Talks like a person, not an assistant** — enforced by lint and evals, not by hope.
4. **Owner's desk, owner's data** — everything local, transparent, deletable; what leaves the machine is disclosed.
5. **Craft over features** — every surface passes the exquisite bar's evidence gates before it ships.

## Accessibility & Inclusion

No product-specific requirement established beyond: respect `prefers-reduced-motion`, labelled settings controls, and legible Chinese type at 100–200 % Windows scaling.
