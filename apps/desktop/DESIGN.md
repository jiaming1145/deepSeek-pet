---
name: ds · 小春
description: A desktop companion whose words land in an ADV message window, not a chat bubble.
colors:
  bg: "#EDEAE3"
  surface: "#FAF8F4"
  surface-2: "#F1EDE6"
  surface-hint: "#E8E2D7"
  border: "#DCD5C9"
  border-strong: "#8C8474"
  text: "#1B2238"
  text-2: "#46506B"
  text-3: "#5F6885"
  accent: "#E8A0B4"
  accent-text: "#3A1420"
  accent-weak: "#F7DDE4"
  ok: "#2E7D5B"
  warn: "#B4762A"
  warn-text: "#6B4408"
  danger: "#C2452F"
  danger-text: "#7A1F13"
  focus-ring: "#4A6FA5"
  bubble-surface: "rgba(250, 248, 244, 0.92)"
  bubble-text: "#1B2238"
  bubble-border: "rgba(27, 34, 56, 0.14)"
  advance: "#9A6A12"
  hint-text: "#4A5570"
  scrim: "rgba(27, 34, 56, 0.32)"
typography:
  title:
    fontFamily: '"MiSans VF", "MiSans", "HarmonyOS Sans SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Segoe UI Variable Text", system-ui, sans-serif'
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "normal"
  bubble-large:
    fontFamily: "{typography.title.fontFamily}"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: "28px"
    letterSpacing: "normal"
  bubble:
    fontFamily: "{typography.title.fontFamily}"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "26px"
    letterSpacing: "normal"
  body:
    fontFamily: "{typography.title.fontFamily}"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
    letterSpacing: "normal"
  caption:
    fontFamily: "{typography.title.fontFamily}"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "normal"
  plate:
    fontFamily: "{typography.title.fontFamily}"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.04em"
rounded:
  window: "8px"
  popover: "8px"
  bubble: "14px"
  control: "6px"
  tooltip: "4px"
spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "20px"
  sp-6: "24px"
components:
  adv-band:
    backgroundColor: "{colors.bubble-surface}"
    textColor: "{colors.bubble-text}"
    typography: "{typography.bubble}"
    rounded: "{rounded.bubble}"
    padding: "16px 20px 20px"
    # 460 x 320 is BUBBLE_MAX, the bubble WINDOW budget (contracts 5.3), and 24 px of it is
    # reserved for --shadow-bubble (5.2). The shipping band ELEMENT is inset from it; the token
    # sheet draws a flat 460 because a specimen board has no window edge. See Layout.
    width: "460px"
  adv-plate:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    typography: "{typography.plate}"
    rounded: "0px"
    padding: "3px 12px"
  adv-advance:
    backgroundColor: "{colors.bubble-surface}"
    textColor: "{colors.advance}"
    typography: "{typography.caption}"
    rounded: "0px"
    padding: "0px"
  hint-strip:
    backgroundColor: "{colors.surface-hint}"
    textColor: "{colors.hint-text}"
    typography: "{typography.caption}"
    rounded: "{rounded.tooltip}"
    padding: "8px 12px"
    width: "460px"
  composer-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.popover}"
    padding: "12px"
    width: "360px"
    height: "48px"
  key-field:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    width: "392px"
---

# DESIGN.md — ds · 小春

> Direction contract, seed key `94ed1849`, owner-locked 2026-08-29. The normative source of
> every value below is `apps/desktop/src/renderer/shared/tokens.css`. The frontmatter above
> carries the **light** values; dark is the `@media (prefers-color-scheme: dark)` redefinition
> and is tabulated under Colors. Shadows, motion and narrative live in
> `apps/desktop/.impeccable/design.json`, which the frontmatter schema cannot hold.

## The direction contract, verbatim

Reproduced byte-for-byte from `.superpowers/sdd/2026-08-29-phase2-brain/task-0-direction.md`, the
owner-locked authority for this world. The same six blocks open `tokens.css` (as a CSS comment)
and `src/renderer/tokens-sheet.html` (as the opening HTML comment); T7 additionally places them as
the first child of `<body>` in `bubble.html` so `94ed1849` survives into the production build.

> **THESIS:** Her words land in the box every ACG reader has read ten thousand lines in — a
> translucent ink-navy band with a slanted name plate, typewriter reveal and a blinking ▼ — and
> the box does what an ADV box does: click to skip, flips to input mode when it is your line. It
> refuses the glass chat bubble with a tail, the toast, and the card.
>
> **OWN-WORLD:** ink-navy band `rgba(20,27,46,.92)` (light theme: `rgba(250,248,244,.92)`),
> cool-white text `#EEF1F7` (light: `#1B2238`), a slanted parallelogram name plate in the
> character's own accent (`haru: #E8A0B4`, from character.json), gold advance mark `#FFD166`, a
> separate grey-blue system voice `#8FA3BF` for hints. One family (MiSans if licence verified,
> else Microsoft YaHei UI / Segoe UI Variable), weights 400/600; sizes from the C5 ramp: body
> 16/26, plate 13/16 tracked .04em, hint 13/18, composer 16/24, key window 14/20. Radii, shadows
> and durations are the fixed C5 tokens. The band's left edge is cut at the plate's 8° — the one
> signature device; everything else is quiet.
>
> **STORY:** she is a character in a game you happen to be inside; you read her line as it types,
> tap to skip when you're impatient, double-click her (or click the box) when it's your turn, and
> the box turns into your line. Hints from the app are never in her voice.
>
> **FIRST VIEWPORT:** Haru bottom-right (420×720 pet window). The band (its own transparent
> BrowserWindow, max 460 wide, up to 6 lines) sits over her lower third, extending LEFT from her
> body so she stands in its right third (ma: never centred on her); flips to the right when the
> work area has no room. Name plate on the band's top-left corner, hanging 6 px above the band.
> Text types in at the reveal cadence with mouth sync; ▼ blinks at 1 Hz when a sentence closes
> (static under reduced-motion). A thin hint strip may appear above the band. Composer: a
> focusable window skinned identically, shown at the band's exact rect with plate "你" and a
> caret; Enter sends, Shift+Enter newlines, IME-safe. Key window: the same band, 520 wide, plate
> "API Key", one field, a one-line PRC disclosure, a 测试 action.
>
> **FORM:** ADV message window — grounded candidate 1 of 7; seed key 94ed1849; raises kept from
> the declined hand: ruling-as-baseline (26 px line grid), state-as-material (emotion changes the
> plate tint and text weight, never a badge), ma (off-axis placement with a fixed gap), drawn
> edges (hairline top rule, no glow beyond the C5 shadow), idle-dissolve (linger → fade + drift
> down 4 px; hover freezes).
>
> **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review,
> the verdict, DESIGN.md, and every shipping raster carrying its provenance.

**Motion grammar** (same source): Appear: `translateY(8px)→0` + opacity over the C5 overlay
duration/easing. Sentence advance: 80 ms crossfade of the ▼. Skip: reveal jumps to sentence end in
one frame. Dismiss: `opacity→0` + `translateY(4px)` over the C5 exit duration. Reduced motion:
opacity only.

**Where a later authority overrides the contract**, and it does in five places, each recorded at
the point of use below: the hint strip ships *below* the band (§5.5), the key window is 440 wide
not 520 (§6.1), the plate hangs 20 px above the band rather than 6 (the plate is 24 px tall, so
6 px would bury it in the band's padding), `--c-accent` is authored in `tokens.css` rather
than read from `character.json` (§5.8 — the file has no `accent` key in Phase 2), and the
contract's "left edge cut at 8°" ships as §5.5's skewed `.bubble__rail` rather than a literal
`clip-path` cut (see Shapes — a `clip-path` would also clip `--shadow-bubble`).

## Overview

**North star: the ADV message window.** Her words land in the box every ACG reader has read ten
thousand lines in — a translucent ink-navy band with a slanted name plate, typewriter reveal and
a blinking advance mark — and the box does what an ADV box does: click to skip, flip to input
mode when it is your line. This world refuses the three defaults the category converges on: the
glass chat bubble with a tail, the toast, and the card.

Five disciplines carried over from the direction round's declined hand, each named for its donor:

- **Ruling as baseline** — a 26 px line grid. `--lh-bubble` is the ruling; the plate, the hint
  strip and the composer all land on multiples of it.
- **State as material** — emotion changes the plate's tint and the line's weight. Never a badge,
  never an emoji, never a label.
- **Ma** — the band is placed off-axis: it extends *left* from Haru so she stands in its right
  third, at a fixed 12 px gap. It is never centred on her.
- **Drawn edges** — a hairline top rule on the band, and no glow beyond the C5 shadow.
- **Idle dissolve** — after the linger the band fades and drifts down 4 px; hovering freezes it.

The build is **code-led** (`.impeccable/config.json` → `buildPath: "code"`): no image generation
was available, so there is no approved comp, and the ambition lives in the FIRST VIEWPORT block
of the contract at the top of `tokens.css` plus the signature device below.

**The signature device, and the only one:** the band's left edge carries the plate's 8°
(`--adv-skew: -8deg`, `--adv-cut: 14px` = `tan(8°) × 100px`), rendered as contracts §5.5's skewed
`.bubble__rail` — see Shapes. Everything else is quiet.

## Colors

One accent, tinted neutrals, light and dark (addendum C12). The neutrals are not grey: light is
warm paper, dark is ink navy — the two grounds the ADV form has always used.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--c-bg` | `#EDEAE3` | `#0E1220` | Window ground behind chat and key windows |
| `--c-surface` | `#FAF8F4` | `#141B2E` | Panels, composer, key field container |
| `--c-surface-2` | `#F1EDE6` | `#1C2439` | Recessed rows, the key window's input well |
| `--c-surface-hint` | `#E8E2D7` | `#232C44` | The system voice. Never the character's. |
| `--c-border` | `#DCD5C9` | `#2C3652` | Hairline separators |
| `--c-border-strong` | `#8C8474` | `#6B7590` | Plate outline, focusable control edges (≥ 3:1) |
| `--c-text` | `#1B2238` | `#EEF1F7` | Primary type |
| `--c-text-2` | `#46506B` | `#C2CADA` | Secondary type |
| `--c-text-3` | `#5F6885` | `#8FA3BF` | Section labels, token values (still ≥ 4.5:1) |
| `--c-accent` | `#E8A0B4` | `#E8A0B4` | Haru's plate — identical in both themes |
| `--c-accent-text` | `#3A1420` | `#2A0E17` | Type on the plate |
| `--c-accent-weak` | `#F7DDE4` | `#3A2430` | Selected history row, accent-tinted surface |
| `--c-ok` | `#2E7D5B` | `#5BC08D` | Key verified |
| `--c-warn` / `--c-warn-text` | `#B4762A` / `#6B4408` | `#E3A94B` / `#F2C97E` | Retry, rate limit |
| `--c-danger` / `--c-danger-text` | `#C2452F` / `#7A1F13` | `#E2705A` / `#F0A392` | 401/402, SQLite failure |
| `--c-scrim` | `rgba(27,34,56,.32)` | `rgba(0,0,0,.45)` | Key window modal ground |
| `--c-focus-ring` | `#4A6FA5` | `#7FA8DC` | 2 px outline, 2 px offset |
| `--c-bubble-surface` | `rgba(250,248,244,.92)` | `rgba(20,27,46,.92)` | The band. Alpha is **exactly 0.92** (C-4) |
| `--c-bubble-text` | `#1B2238` | `#EEF1F7` | Her line |
| `--c-bubble-border` | `rgba(27,34,56,.14)` | `rgba(238,241,247,.12)` | The hairline top rule |
| `--c-bubble-tail` | same as surface | same as surface | See "there is no tail" below |
| `--c-plate` | `var(--c-accent)` | `var(--c-accent)` | Overridden per emotion |
| `--c-advance` | `#9A6A12` | `#FFD166` | The advance mark. Light is darkened from the contract's `#FFD166` to clear 3:1 on paper. |
| `--c-hint-text` | `#4A5570` | `#8FA3BF` | The system voice's body type |

**Measured contrast** (`src/renderer/shared/tokens.test.ts`, WCAG 2.2, band composited over
`--c-bg`): her line on the band is **14.71:1** light and **15.25:1** dark. Every text pair in the
system clears 4.5:1; the worst is `--c-text-3` on `--c-surface` at 5.20:1 light. Every non-text
pair clears 3:1; the worst is `--c-border-strong` on the band at 3.46:1 light. `--c-accent-text`
clears 4.5:1 on all nine plate tints; the worst is `angry` at 6.28:1 light.

**State as material — the nine plate tints.** These are theme-independent: the plate is the
character's colour, not the interface's.

| Emotion | `--c-plate` | `--fw-line` |
|---|---|---|
| `neutral` | `#E8A0B4` | 400 |
| `happy` | `#F2B3C2` | 500 |
| `curious` | `#DDA8C6` | 400 |
| `question` | `#D4A6CE` | 400 |
| `surprised` | `#F3C08F` | 500 |
| `think` | `#B9A8CE` | 400 |
| `awkward` | `#D9B39C` | 400 |
| `sad` | `#A9AEC8` | 400 |
| `angry` | `#E08A8A` | 500 |

**T7 acceptance line — keep the nine tints tied to `@ds/protocol`'s `EMOTIONS` (D3).** The list
above exists in three places: `EMOTIONS` in `@ds/protocol` (contracts §2.1, "Emotions — one
definition"), the nine `[data-emotion='<e>']` rules in `tokens.css`, and the `EMOTIONS` literal in
`tokens.test.ts`. §2.1 pins identity tests for `@ds/stage` and `@ds/brain` only, so the CSS is a
fourth, uncovered copy. Task 0 could not import the definition — `@ds/protocol.EMOTIONS` lands in
T1, in a parallel worktree — so the literal list here and in the token test is deliberate, not
drift. **T7 closes it:** in its jsdom lane, import `EMOTIONS` from `@ds/protocol` and assert that
`tokens.css` carries a `[data-emotion='<e>']` rule for every member and none for a non-member.
Without that assertion, a tenth emotion added in Phase 3 ships with no plate tint while every
token test stays green.

**One accent, one owner.** `--c-accent` is Haru's. It is authored in `tokens.css` rather than
read from `characters/haru/character.json`, because Phase 2 ships one character; a per-character
`accent` key is a Phase 3 change, at which point the bubble renderer sets `--c-accent` inline on
the band root and nothing else moves. (P4: Haru is a stand-in for the eventual commissioned
model; when that model lands, this accent is re-derived from it and only this table changes.)

## Typography

One family. The stack is C5's, with `"Segoe UI Variable Text"` inserted before `system-ui`
because Chromium on Windows 11 resolves `system-ui` to Segoe UI, not the Variable family, and
R7 names the Variable family as the fallback:

```
"MiSans VF", "MiSans", "HarmonyOS Sans SC", "Noto Sans SC", "Source Han Sans SC",
"Microsoft YaHei UI", "Segoe UI Variable Text", system-ui, sans-serif
```

**No font file is bundled** — see `NOTICE` item 4 for the licence finding. The stack degrades to
faces Windows 11 already ships, so the design is proven on the fallback, not on a font that may
not be installed.

| Role | Size / line | Weight | Where |
|---|---|---|---|
| title | 20 / 28 | 600 | Key window heading |
| bubble-large | 18 / 28 | 400 | Reserved for a future large-text setting |
| bubble | 16 / 26 | 400, 500 on `happy` / `surprised` / `angry` | Her line. **The 26 px ruling.** |
| body | 14 / 22 | 400 | Composer, history rows, key field |
| caption | 12 / 18 | 400 | Hint strip, timestamps |
| plate | 13 / 16 | 600, tracking `.04em` | The name plate |

Wherever Chinese renders: `text-autospace: normal; line-break: strict; overflow-wrap: anywhere;`
(the `.ds-cjk` class in `tokens.css`). Her line is capped at **24 hanzi per line and 6 lines**
(`max-width: calc(24 * 1em)` at `--fs-bubble`) — contracts §5.2 derives 24 from
`460 − 24 − 12 − 32 − 2 = 390 px`, and §8.6 row 3 rejects 26 as unreachable at
`BUBBLE_MAX.width = 460`. **24 is the line cap; 26 is the line grid** (`--lh-bubble`), and the
two numbers are unrelated.

## Layout

There is no responsive grid: every surface is a fixed-size Electron window.

| Surface | Size (DIP) | Placement |
|---|---|---|
| Pet window | 420 × 720 | Owner-dragged; unchanged from Phase 1 |
| Band (bubble window) | ≤ 460 × 320 | `placeBubble(...)`, gap 12, padding 16, preferred side `left` when the pet is on the right half |
| Chat window | 360 × 48, growing 22 px per row to 158 | 12 px above the pet's top edge, left-aligned |
| Key window | 440 × 360 | Centred, mica |

**460 × 320 is a window budget, not an element size.** `BUBBLE_MAX = { width: 460, height: 320 }`
(contracts §5.3) sizes the transparent bubble **window**; §5.2 then derives the 24-hanzi line cap
from `460 − 24 (shadow room) − 12 − 32 (padding) − 2 (border) = 390 px`, so 24 px of that 460 is
reserved for `--shadow-bubble` to paint into. The band **element** must therefore be inset from
the window's 460, never sized to it: a 460-wide band inside a 460-wide transparent window has its
shadow clipped flat at the window edge — the same class of failure the clip-path caused on the
sheet. The token sheet and `.impeccable/design.json` draw the band at a flat 460 only because a
specimen board has no window edge.

**Ma.** The band's preferred side is the roomier half of the pet's own display's work area, so
Haru stands in the band's right third rather than behind its centre. The 12 px gap is constant;
the band never touches her and never crosses the work-area edge.

Rhythm: the 26 px ruling for her line, the 22 px ruling for everything the user types, and the
4 px spacing scale for gaps.

## Elevation & Depth

Three shadows, no glows, no gradients, no halos. `--shadow-popover` is C5's literal and may not
be changed. Windows carry `hasShadow: false` so the corners stay CSS-only and survive the
device-scale-factor pixel-peep (C3).

| Token | Light | Dark |
|---|---|---|
| `--shadow-popover` | `0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)` | `.28` / `.20` |
| `--shadow-bubble` | `0 10px 24px rgba(0,0,0,.16), 0 0 2px rgba(0,0,0,.12)` | `.30` / `.20` |
| `--shadow-hint` | `0 4px 10px rgba(0,0,0,.10), 0 0 2px rgba(0,0,0,.10)` | `.24` / `.18` |

Depth order, front to back: hint strip → band → composer → pet. The hint strip is its own layer
in its own voice, so a system message is never read as her line. **In the shipping bubble it is
placed *below* the band**, separated by `HINT_GAP` (8 px): `contracts.md` §5.5 rules on this and
wins over the direction contract's "a thin hint strip may appear above the band". The token sheet
draws it above the band because the sheet is a specimen board, not the bubble.

Chromium disables LCD sub-pixel antialiasing on transparent compositing surfaces, so type on the
band is greyscale-antialiased. That is accepted (C-4): the evidence bar is crisp greyscale AA at
a 300 % crop with no colour fringing.

## Shapes

All five radii are C5 literals: `--r-window 8px`, `--r-popover 8px`, `--r-bubble 14px`,
`--r-control 6px`, `--r-tooltip 4px`.

**The cut.** The band's left edge carries the plate's angle. Two custom properties describe it:
`--adv-skew: -8deg` (the plate's own skew, its text counter-skewed) and `--adv-cut: 14px`, the
edge's horizontal run — `tan(8°) × 100px`, i.e. 8° at the band's 100 px reference height. These
are the only two non-rectilinear angles in the product; adding a third breaks the device.

**The shipping form of the cut is the rail. This is normative.** `contracts.md` §5.5, and §5.8's
comment on the token itself, rule on this and are unambiguous: `--adv-cut` has **one** consumer,
**`.bubble__rail`** — a 3 px `--c-plate` rail on the band's left edge,
`transform: skewX(var(--adv-skew))`, horizontal run `var(--adv-cut)` — **not a `clip-path`**. It
is the same technique §6.4 deviation 3 uses for the composer (`.composer__rail`), and for the same
reason. **T7 ships the rail.** This document licences no alternative: where DESIGN.md and
`contracts.md` disagree, the contract wins.

**Why the contract chose the rail — proven here, keep this.** Put a `clip-path` on the band
element itself and it silently destroys two things: `--shadow-bubble` (an outset box-shadow is
painted outside the border box, so the polygon clips all of it away) and the name plate, which
hangs 20 px *above* the band's top edge and is therefore entirely outside the polygon. The token
sheet proved both failures on its first render. **A bare `clip-path` on the band root is wrong
everywhere** — specimen and shipping alike.

**The two-layer fill-layer cut is the token sheet's technique, and only the sheet's.** To keep a
*literal* cut on a specimen board, `tokens-sheet.html` moves the `clip-path` off the band root and
onto a dedicated fill layer — `.band__surface`, `position: absolute; inset: 0`, carrying the
background, the `--r-bubble` radius and the `--c-bubble-border` top rule — while `.band` keeps
`box-shadow: var(--shadow-bubble)` and parents the plate, the notch and the line. That is correct
on a token sheet, which has no window edge and no `bubble:size` report to distort, and
`.impeccable/design.json`'s ADV Band recipe carries it with the same specimen-only label. It is
**not** a sanctioned form for `bubble/`, `chat/` or `key/`.

> **Open ruling request — raised to the controller before T7 starts.** Two authorities genuinely
> conflict here: `contracts.md` §5.5 pins `.bubble__rail` as the single consumer of `--adv-cut`,
> while impeccable's craft floor lists a 3 px coloured left stripe on its Refuse list. Task 0 has
> no standing to settle that, and reconciling it locally would be reopening a controller ruling.
> The conflict is recorded here and written up as a ruling request in
> `.superpowers/sdd/2026-08-29-phase2-brain/task-0-report.md` § Fix round 1. **Until the
> controller rules, §5.5 governs and T7 ships the rail.**

**There is no tail.** `--c-bubble-tail` exists because `placeBubble` returns an `arrowOffset` and
contracts §5.8 requires the name, but the ADV form refuses a triangle. The token colours a 3 px
notch on the band's **pet-facing edge** at `arrowOffset` — the edge named by `bubble:place`'s
`side`, which `placeBubble` returns as one of `'left' | 'right' | 'top' | 'bottom'`, so T7 draws
it under a `.bubble[data-side='…']` rule per side and never always on top (contracts §5.8). It
points at Haru without turning the band into a speech balloon. **The notch protrudes from the
edge; it never overlaps the band.** `--c-bubble-tail` is the same 0.92-alpha colour as the
surface, so a notch drawn *on top of* the band composites twice and reads as a blemish rather
than as part of the silhouette — visible on the token sheet's first render, fixed by moving it
3 px outside the edge.

## Components

- **adv-band** — `--r-bubble`, `--shadow-bubble`, 1 px `--c-bubble-border` top rule, the 8° left
  rail (`.bubble__rail`, contracts §5.5 — see Shapes), padding `16px 20px 20px`. **The 460 in the
  frontmatter and on the token sheet is `BUBBLE_MAX.width`, the bubble *window*'s budget, not the
  band element's width** (see Layout): the shipping band is inset from it so `--shadow-bubble`
  keeps the ~24 px §5.2's arithmetic reserves. §5.2 derives the 24-hanzi cap assuming 32 px of
  horizontal padding; this band's `16px 20px 20px` is 40 px horizontally, which makes the text box
  *narrower*, never wider, so the cap holds a fortiori and `max-width: calc(24 * 1em)` remains the
  governing line cap. `data-emotion` on the root drives `--c-plate` and `--fw-line`. Text
  accumulates within a turn; the oldest sentence is dropped when 6 lines are exceeded. Click
  anywhere completes the reveal *and* opens the chat.
- **adv-plate** — hangs 20 px above the band's top edge, `--sp-5` from its left, skewed −8°,
  `--c-plate` fill, 1 px `--c-border-strong` outline so the shape reads on any tint, 13/16 at
  600 with `.04em` tracking. Content: the character's name; `你` in the composer; `API Key` in
  the key window. (The direction contract says 6 px; the plate is 24 px tall, so 6 px would sink
  it into the band's 16 px top padding. 20 px is the value that renders the contract's intent.)
- **adv-advance** — the ▼, `--c-advance`, bottom-right, blinking at `--dur-blink` (1 Hz) once a
  sentence closes. Static under reduced motion.
- **hint-strip** — the system voice. `--c-surface-hint` ground, `--c-hint-text` body,
  `--c-warn-text` / `--c-danger-text` by level, `--r-tooltip`, `--shadow-hint`, 12/18 caption.
  **In the shipping bubble it sits *below* the band**, separated by `HINT_GAP` (8 px, mirroring
  `--sp-2`; contracts §5.5) — the token sheet draws it above the band because the sheet is a
  specimen board, not the bubble. T7 gets there with `flex-direction: column` on `#content`;
  `column-reverse` is the one-line swap if the controller ever prefers the strip on top. It is
  `pointer-events: auto` (clicking it dismisses, which also fires `bubble:hover`) and is never
  styled with the band's tokens. At most one visible; up to 3 queued (`HINT_QUEUE_MAX = 3`).
- **composer-field** — 360 × 48, `--r-popover`, `--shadow-popover`, 14/22, growing 22 px per row
  to 6 rows. Focus is a 2 px `--c-focus-ring` outline at 2 px offset — never a colour change.
- **key-field** — the key window's single input, `--c-surface-2` well, `--r-control`, tabular
  digits via `font-variant-numeric: tabular-nums`.

Motion: only `transform` and `opacity` animate, ever. Appear = `translateY(8px) → 0` + opacity
over `--dur-overlay` / `--ease-enter`. Sentence advance = an 80 ms crossfade of the advance mark.
Skip = the reveal jumps to the sentence end in one frame. Dismiss = opacity → 0 +
`translateY(4px)` over `--dur-exit` / `--ease-exit`. Under `prefers-reduced-motion` every
duration collapses to 80 ms, easings become `linear`, and the advance mark stops blinking.

## Do's and Don'ts

- **Do** read every colour, radius, duration and size from `tokens.css`. A hard-coded value in
  `bubble/`, `chat/` or `key/` is a defect, not a shortcut.
- **Do** put system messages on the hint strip. She never says "请求失败 (429)".
- **Do** keep the band off-axis, extending away from Haru's body.
- **Do** keep the 26 px ruling for her line and the 22 px ruling for the user's.
- **Don't** add a tail, a pointer triangle, or a rounded speech balloon.
- **Don't** add a second angle. −8° is the whole vocabulary.
- **Don't** use purple or indigo gradients, gradient text, or radial halos (C12).
- **Don't** signal emotion with a badge, an emoji or a coloured dot. The plate tint and the line
  weight are the signal.
- **Don't** animate anything but `transform` and `opacity`.
- **Don't** invert the light palette to make dark. Light is warm paper; dark is ink navy.
- **Don't** put the cut's `clip-path` on the band root, and don't lay the anchor notch on top of
  the band. Both were tried on the token sheet's first render and both broke (see Shapes).
- **Don't** ship the sheet's two-layer fill-layer cut in `bubble/`, `chat/` or `key/`. It is a
  specimen technique; contracts §5.5's `.bubble__rail` is the shipping form of the 8° signature.
- **Don't** size the band element to 460. That is the bubble *window*'s budget and 24 px of it is
  `--shadow-bubble`'s room (see Layout).
