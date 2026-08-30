# Final review — renderer craft lens (bubble · chat · key · shared)

Reviewer scope: `apps/desktop/src/renderer/{bubble,chat,key,shared}` on `main` (16bf16a) vs `phase1-stage`,
checked against `task-0-direction.md`, `DESIGN.md`, contracts §5/§6 (+ Amendments), rulings and the T10
deferral ledger. Read-only. Probes were run from a scratch vitest config outside the repo
(`%TEMP%\claude\...\scratchpad\probe\`); nothing in `D:\ds` was written except this file.

Baseline: `apps/desktop` vitest suite — **28 files / 267 tests passed** (`vitest run --config vitest.config.ts`).

## Findings

### F1 · important · hover-then-leave during the linger does NOT re-arm the 3 s — the stale hide timer wins
`apps/desktop/src/renderer/bubble/speech.ts:343-348` and `:463-470`

```ts
setPinned(inside: boolean): void {
  this.bubble.pinned = inside;
  if (!inside && this.hideAt !== null) {
    this.hideAt = this.now() + LINGER_MS;
    this.scheduleHide();          // schedules a SECOND timer; the first one is still pending
  }
}
...
private schedule(ms: number, cb: () => void): void {
  const gen = this.gen;
  const id = this.timer(() => { if (gen !== this.gen) return; cb(); }, ms);
  if (this.ownsTimer) this.handle = id;   // overwrites; the earlier hide timer can no longer be cleared
}
```
`scheduleHide()` never cancels the previously armed hide timer (only `cancelPending()` bumps `gen`, and
`setPinned` does not call it). The direction says "hover freezes" and the code comment says leaving
re-arms the linger, but when the pointer enters and leaves *before* the original deadline, the original
callback still fires at the original deadline: `hideAt !== null`, `pinned === false` -> `bubble.hide()`.
The re-armed 3 s is silently ignored. The shipped test (`speech.test.ts:172`) only covers the case where
the pointer is still inside when the first deadline passes, so it cannot see this.

Failure scenario: reply finishes at t=0; user moves the mouse over the band at t=1.0 s to read it, moves
off at t=1.5 s — the band dissolves at t=3.0 s instead of t=4.5 s. With real DOM timers there is also an
accumulating pile of pending hide callbacks per hover cycle.

**Confirmed by running** (scratch probe, same Clock as the shipped test): `expect(visible).toBe(true)` at
`LINGER_MS - 1` after the leave -> received `false`.

Fix: give the hide its own handle (`hideHandle`) and clear it in `scheduleHide()` before arming, or make the
callback compare a per-arm token (`const armed = ++this.hideGen; ... if (armed !== this.hideGen) return;`).
Add the probe above as a regression test.

### F2 · important · a message over 2000 chars is silently destroyed (invoke rejects, composer already cleared)
`apps/desktop/src/renderer/chat/Composer.tsx:236-248`, `packages/protocol/src/index.ts:244`,
`apps/desktop/src/main/invoke.ts:22-23`

```ts
const submit = useCallback(async (text: string) => {
  setValue('');                       // cleared BEFORE the send is known to be accepted
  const res = await onSend(text);     // rejects -> nothing below runs, no restore
  ...
```
`user:text` is `z.object({ text: z.string().min(1).max(2000) })`; `handleInvoke` turns a schema failure
into `throw new Error('[ipc] rejected user:text: ...')`, which the renderer sees as a **rejected** promise,
not `{ok:false}`. The textarea has no `maxLength`, so nothing stops the user reaching 2001 chars.

Failure scenario: paste a long article / code block (>2000 chars — a paste, not typing), press Enter ->
composer empties, no hint, no error, text gone, `Uncaught (in promise)` in the chat renderer. Spec §8 /
§6.2 rule 6 ("restore on failure") is violated on exactly the failure the protocol itself guarantees.

**Confirmed by running**: probe rendered `<Composer onSend={() => Promise.reject(...)}>`, typed 2001 x `字`,
Enter -> `ta.value.length === 0`, vitest reported an *Unhandled Rejection*.

Fix (both halves): wrap `onSend` in try/catch in `submit` and call `restore(text)` on throw; add
`maxLength={2000}` (import the limit from `@ds/protocol` rather than a literal) and a `--c-text-3`
counter or a warn-level hint when the cap is hit.

### F3 · important · band element is never re-shown after a hidden->shown visibility edge mid-turn
`apps/desktop/src/renderer/bubble/main.ts:586-590`, `speech.ts:363-380`

```ts
bridge?.on(Channels.shellVisibility, ({ hidden }) => {
  if (!hidden) return;      // the shown edge is ignored in the renderer
  hint.dismiss();
  bubble.hide();            // root.hidden = true -> display:none
});
```
`main/index.ts:62-67` deliberately re-shows the bubble **window** on the hidden->shown edge "when the
brain still wants her speaking", but the renderer's band **element** stays `hidden` — `Bubble.show()` is
only called from `beginTurn()`. The SpeechController keeps ticking (mouth sync, `playback:sentenceDone`,
`playback:turnDone` all still go out), so main believes she is speaking into a window that paints nothing.

Failure scenario: a reply is mid-reveal, a fullscreen app / the visibility rule hides her for a moment,
she comes back — the rest of that reply (and its linger) is invisible; the next turn is fine. Any
`hint:show` in that gap is also dropped (`hint.dismiss()`), e.g. a 429 hint.

**Confirmed by reading** (the `!hidden` early-return is unconditional; no other `show()` call site).

Fix: on `{hidden:false}`, if `speech` has an active turn (`turnId !== null && (!finished || hideAt !== null)`)
call `bubble.show()` and `scheduleReport()`; expose `speech.active` for that.

### F4 · minor · the anchor notch floats 13 px away from the band — reads as a stray white tick
`apps/desktop/src/renderer/bubble/bubble.css:222-240`; visible in `docs/evidence/phase2/app-first-message-cold.png`
and `app-placement.png` (the lone vertical bar to the right of the band, x~678).

`.bubble[data-side='left'] .bubble__anchor { right: var(--sp-2); width: 3px; height: var(--sp-6); }` is
positioned against the band ROOT, but the visible surface is inset from that root by
`padding-right: calc(var(--sp-3) + var(--notch))` = 24 px. 24 - 8 - 3 = 13 px of transparent gap between
the surface edge and the notch. DESIGN.md's rule is "the notch protrudes from the edge; it never overlaps
the band" — protrudes, not floats. On the dark desktop it is a detached cream dash; it does not read as
part of the silhouette and looks like a rendering glitch. Same for `data-side='right'` (`left: var(--sp-2)`).

Fix: `right: calc(var(--sp-3) + var(--notch) - 3px)` (flush with the surface edge, protruding outward
by `--notch`), or drop the notch — the direction already says the ADV box needs no pointer.

### F5 · minor · the ▼ advance mark sits on top of the last glyph of a full line
`bubble.css:192-201`; visible in `app-first-message-cold.png` (`...等你。▼`, the ▼ overlaps `。`).

`.bubble__advance { position:absolute; right: var(--sp-3); bottom: var(--sp-2); }` inside
`.bubble__surface` whose padding is `12px 16px`; the text box runs to 16 px from the edge, the ▼ spans
~12-24 px from the edge and its bottom edge is inside the last line's box. Every sentence that fills a
24-hanzi line collides. ADV boxes reserve the corner (galgames put the marker on its own baseline below
the last line, or pad the text box's right edge).

Fix: `padding-right: calc(var(--sp-4) + var(--fs-caption))` on `.bubble__text` (keeps the 24-hanzi cap
since `max-width` is on the content box) or `padding-bottom: var(--lh-caption)` on the surface with the
▼ in that strip.

### F6 · minor · the bubble plate is the odd one out: skewed text, no outline
`bubble.css:167-184`, `bubble.html:36`

Chat and key plates wrap their label in `.plate__text { transform: skewX(calc(-1 * var(--adv-skew))) }`
(counter-skew, "derived from the token so the two can never disagree"). The bubble plate is a single
`<div data-bubble-plate>` whose text is skewed with the box — `小春` renders italic in
`app-first-message-cold.png` / `app-band-dark.png`, while `你` and `API Key` are upright. DESIGN.md
"adv-plate" also specifies a `1px --c-border-strong outline so the shape reads on any tint`; the bubble
plate has `border-radius` but no border, and `[data-emotion='happy']`'s `#F2B3C2` on the light paper band
has almost no edge. Three surfaces, one device, two renderings.

Fix: `<div class="bubble__plate" data-bubble-plate hidden><span class="bubble__plate-text"></span></div>`,
`setName()` writes into the span, add `border: 1px solid var(--c-border-strong)` per DESIGN.md.

### F7 · minor · reduced-motion still moves the composer
`apps/desktop/src/renderer/chat/chat.css:225-243, 509-512`

`.app { animation: adv-appear ... }` translates 8 px; the reduce block only shortens
`animation-duration` to 80 ms, so the movement remains. Direction: "Reduced motion: opacity only";
`bubble.css` gets this right (`transform: none`).

Fix: under `prefers-reduced-motion: reduce` set `.app { animation-name: adv-appear-fade }` (opacity-only
keyframes) or `animation: none`.

### F8 · minor · 7+ row messages become unreachable in the composer
`Composer.tsx:176-195`, `chat.css:334-348`

Rows cap at `CHAT_MAX_ROWS` (6) and the textarea is `overflow: hidden`, so a pasted 10-line message can
only be inspected by moving the caret; the wheel does nothing and the first lines are hidden with no
affordance. Fix: `overflow-y: auto` once `rows === CHAT_MAX_ROWS` (scrollbar styled with the tokens), or
`scrollbar-width: thin`.

### F9 · minor · the band's transparent padding is part of the click/hover target
`bubble.css:48-61` (`.bubble { padding: 26px 12px 24px; pointer-events: auto }`), `bubble/main.ts:596-606`

`pointerenter`/`click` are bound on `#bubble`, the root that includes 26 px of transparent room above
(plate space) and 24 px below / 12-24 px beside the surface. Hovering empty desktop pixels next to the
band pins it and turns off click-through; clicking them opens the chat. The pet's own transparent
pixels were made click-through in Phase 1 precisely to avoid this class of ghost target.

Fix: bind the listeners on `.bubble__surface` + `.bubble__plate` (or set `pointer-events: none` on
`.bubble` and `auto` on its children).

### F10 · minor · re-opening the chat selects and thereby clobbers a retained draft (contract-driven)
`apps/desktop/src/renderer/chat/App.tsx:14-19`, contracts §2.3 `chat:opened` "C (focus + select)"

`closeChat` only hides the window, so a draft survives Escape; on the next `chat:opened` the App
`focus()`+`select()`s the whole textarea, and the first keystroke replaces the draft. The select-all is
meant for the *restored* text (§6.2 rule 6) and is already done there by `restoreTick`. This one is
against the letter of the contract, so it is a contract fix: `chat:opened` should focus and place the
caret at the end; selection stays with `restore()`.

### F11 · minor · dark theme evidence is emulated; the shipping app has no theme handling at all
`shared/tokens.css:437`, `tests-e2e/app.ts:87-90`, `task-10-report.md:265-269`

The only dark switch is `@media (prefers-color-scheme: dark)`. Main never touches `nativeTheme`, and
T10's probe recorded that `nativeTheme.themeSource = 'dark'` did *not* flip the renderers'
`matchMedia`, so `setTheme` added `page.emulateMedia({colorScheme})` — a harness-only fix. That is
principled for the harness (it tests the CSS, not Chromium), but it means every `app-*-dark.png` proves
the stylesheet, not that a user on Windows "dark app mode" gets the ink-navy band. The `.md` evidence
does not say so. Plausible, not verified here (one machine, one theme). Suggested: one manual capture
with Windows set to dark (no emulation) filed next to the sheet, or `nativeTheme.themeSource = 'system'`
noted explicitly as the contract.

## Observations, not findings
- `app-first-message-cold.png` and `app-placement.png` both show a dim grey `▼` at ~(880, 960), well
  outside the band and the composer. No renderer source emits a grey ▼ (`--c-advance` is gold/ochre);
  origin unknown — could be the capture lane. Worth a look when the lane is next run.
- Reveal timing: chained `setTimeout` per grapheme accrues ~1-2 ms/step of scheduler drift (~60-80 ms on a
  40-hanzi sentence). Cosmetic; noted only because contracts name the injectable timer `raf`.

## Checked and found clean
- **IME**: `handleKeyDown` guards `isComposing || keyCode === 229 || composingRef` before every branch;
  `compositionend` clears on the next macrotask; Escape while composing is swallowed (Windows IMEs cancel
  the composition themselves); no double-submit path found; jsdom tests cover it (`Composer.test.tsx`).
- **Focus**: bubble window `focusable:false` + `showInactive()`; band never calls `focus()`; the chat
  window is only shown from user gestures (band click, pet dblclick, tray, hotkey, key save) — every
  caller passes `focusComposer:true`, none fires spontaneously (e.g. not on `brain:sentence`).
- **Escape rules**: busy -> `user:cancel` (stays open); idle -> `chat:close`; `停` mirrors it.
- **Timers/leaks**: `Bubble.show()` clears the exit handle; `HintSurface.dismiss()` clears its TTL; the
  rAF `scheduleReport` is single-flight; `beginTurn`/`onError`/`complete` bump `gen`. Only F1's hide
  timer escapes the scheme.
- **ResizeObserver / `bubble:size`**: coalesced to one rAF per frame, de-duplicated by `lastSize`,
  clamped to `BUBBLE_MIN..MAX` so a hidden 0x0 band never reaches `z.number().positive()`.
- **Direction**: 8° rail (`.bubble__rail`, skewX(-8°), `--adv-cut` inset, contract §5.5 form), plate
  hanging above the band, sentence-by-sentence reveal at 70/35 ms with 150/300 ms pauses, mouth open on
  letter graphemes and closed on punctuation/whitespace (`RevealPlan.mouth`), `speech:mouth` sent only on
  transitions, 3 s linger once per turn, dissolve = opacity + 4 px drift, ▼ at 1 Hz `steps(1,end)`,
  static under reduced motion, thinking dots CSS-only. `hanziMs 70 / latinMs 35` verified in
  `REVEAL_DEFAULTS`.
- **Tokens**: light on bare `:root`, dark under the media query only; no literal colours in
  `bubble.css`/`chat.css`/`key.css` (`--c-advance` has a token fallback only). Nine `[data-emotion]`
  tints tied to `EMOTIONS` by `emotion-tokens.test.ts`.
- **Fonts / CJK**: stack degrades to `Microsoft YaHei UI` / `Segoe UI Variable Text`; NOTICE records
  MiSans as not bundled. `line-break: strict; overflow-wrap: anywhere; text-autospace: normal` on every
  Chinese surface; `white-space: pre-wrap` keeps model newlines; `max-width: 24em` + 6-line clamp with
  oldest-sentence eviction (`render()`); a single sentence longer than 6 lines is clipped, but
  `sentences.ts` hard-splits on `。！？!?…\n`, so that needs a 144-hanzi run without punctuation — accepted.
- **a11y**: textarea `aria-label`, history toggle `aria-expanded`, `role="log"`/`role="status"`/
  `role="alert"` where appropriate, visible `--c-focus-ring` on every focusable in chat and key, key
  window Tab trap and `<label for>`.
- **Rendered result vs direction** (`app-band-*.png`, `app-chat-*.png`, `app-key-*.png`,
  `app-first-message-cold.png`, `app-placement.png`): ink-navy / warm-paper band, pink plate, pink rail,
  ochre/gold ▼, off-axis placement to her left with her in the right third, composer skinned as the same
  band with `你` plate — it does not read as a generic chat bubble or a shadcn card. The two things that
  do read as defects are F4 and F5.
