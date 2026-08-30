# Phase 3 research digest — behaviour engine, pet sim, proactive speech, memory

Date: 2026-08-30 · Status: research input for the Phase 3 implementation plan · Extends `docs/research/2026-08-28-landscape-research.md` (does not repeat it).

Binding criteria this digest serves: `docs/superpowers/specs/2026-08-29-exquisite-bar.md` §0 + D1–D16, A11, A14, X4, X10, X13; `docs/superpowers/specs/2026-08-28-live2d-companion-design.md` §2.2, §5, §6; persona rulings P0–P5 in `.superpowers/sdd/2026-08-29-phase2-brain/rulings.md`.

## Method and honesty note

Nine parallel researchers ran against this brief. **The session's WebSearch budget (200 calls) was exhausted early**, so discovery for most areas fell back to direct URL fetches, GitHub raw source, the PubMed / Europe PMC / OpenAlex / Crossref / Steam / npm APIs, and DeepWiki reads of actual repository source. That is in some ways a better evidence base — nearly every number below is quoted from source code, a spec, or a paper rather than from a search snippet — but it means **discovery was not exhaustive**. Every claim that could not be verified is flagged inline as **UNVERIFIED**. No URL in this document was invented; all were fetched.

Findings **empirically verified on this machine** (commands and output in the relevant sections):

1. **The spec's FTS5 `tokenize='trigram'` plan does not work for Chinese** — two-character words (面试, 医院, 出差) never match. §7.
2. **`node:sqlite` on the installed Node 24.17.0 ships SQLite 3.53.0 with FTS5, trigram, porter, `bm25()` and `fts5vocab`** — but not `sqlite-vec`. §7.
3. **A dependency-free bigram index + LLM-written alias column scored recall@3 = 10/10** on paraphrased Chinese probes (small fixture — see the caveat). §7.
4. **`ddagrab` records this desktop correctly at 150 % DPI**, 1799/1800 frames over 60 s at 30 fps, with machine-checkable per-frame statistics. §9.
5. **A layered, topmost, translucent window is captured correctly** by both `ddagrab` and `gdigrab -i desktop` — but `gdigrab -i hwnd=` on a GPU-composited Chromium window returns **pure black**, while ffmpeg 8.1's `gfxcapture` returns it correctly **with real alpha**. §9.

Two of these contradict the current specs and are the highest-value items for the planner: **finding 1 breaks spec §6's tokenizer choice**, and §0's absence-economics ruling **contradicts spec §5's "−1/day after 3 days without contact"** (§2).

---

## 1. Idle behaviour systems (D1, D2, D9, D12)

### References

| # | Source | URL |
|---|---|---|
| 1.1 | Shimeji-Desktop (maintained Shimeji-ee fork) — `conf/behaviors.xml`, `conf/actions.xml`, `Manager.java` | https://github.com/DalekCraft2/Shimeji-Desktop |
| 1.2 | VPet-Simulator — `MainLogic.cs`, `EventTimer_Elapsed` | https://github.com/LorisYounger/VPet · https://deepwiki.com/LorisYounger/VPet |
| 1.3 | Desktop Goose (decompiled) — `SamEngine/Deck.cs`, `TheGoose.cs` | https://github.com/arkangel-dev/desktop-goose-source · https://samperson.itch.io/desktop-goose |
| 1.4 | Graham, *Breathing Life into Your Background Characters*, Game AI Pro ch. 36 | http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter36_Breathing_Life_into_Your_Background_Characters.pdf |
| 1.5 | Graham, *An Introduction to Utility Theory*, Game AI Pro ch. 9 | http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf |
| 1.6 | Rabin, Goldblatt & Silva, *Advanced Randomness Techniques for Game AI*, Game AI Pro ch. 3 | http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter03_Advanced_Randomness_Techniques_for_Game_AI.pdf |
| 1.7 | Booth, *The AI Systems of Left 4 Dead* (Valve) | https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf |
| 1.8 | Lively Wallpaper — occlusion/pause architecture | https://github.com/rocksdanister/lively/wiki/Performance |
| 1.9 | Desktop Mate (Steam) — reviews as evidence | https://store.steampowered.com/app/3301060/Desktop_Mate/ |

### Numbers worth copying

**Shimeji** runs the whole simulation at `TICK_INTERVAL = 40` ms → **25 Hz**, one thread for all mascots. Selection happens **only when a behaviour ends** (`Configuration.buildNextBehavior()`), never per frame: it filters candidates by `Frequency > 0` AND all conditions true, sums frequencies, and does `random = Math.random()*total; for (b : candidates) { random -= b.getFrequency(); if (random < 0) return b; }`. Real data shape:

```xml
<Condition Condition="#{mascot.environment.floor.isOn(mascot.anchor)}">
    <Behavior Name="SitDown" Frequency="200">
        <NextBehaviorList Add="true">
            <BehaviorReference Name="SitWhileDanglingLegs" Frequency="100"/>
        </NextBehaviorList>
    </Behavior>
</Condition>
```

57 behaviours, 40 hidden engine states, **13 freely selectable**, 10 condition groups. Frequency histogram: 36×100, 9×50, 6×1, 4×20, 2×200, 2×10. Durations are frames on `ActionReference`: `Duration="${500+Math.random()*1000}"` = **20–60 s per idle hold**; connective beats `${20+Math.random()*20}` = 0.8–1.6 s. `${...}` compiles once, `#{...}` re-evaluates **every frame** — that two-sigil distinction is worth stealing as a "cheap vs expensive predicate" flag.

**VPet** ticks every **15 s** (`LogicInterval`, user slider 5–60 s). Its liveliness mechanic is an **escalating hazard rate**: `rnddisplay = Math.max(20, InteractionCycle - CountNomal)` where `InteractionCycle` defaults to **200** and `CountNomal` counts consecutive uneventful ticks; then `rnd = Random.Next(0, rnddisplay)` buckets 0–2 → move, 3–5 → idle, 6 → StateONE, 7 → sleep, 8–10 → random interaction, higher → nothing. The longer nothing happens, the likelier something happens. One slider controls it monotonically and the settings screen reports the derived "about N minutes between spontaneous interactions".

**Desktop Goose** uses a **shuffle bag, not weighted random**: `Deck.cs` is Fisher–Yates dealing without replacement, reshuffling when exhausted, with weights encoded by repeating entries (`TrackMud, TrackMud, CollectWindow_Meme, CollectWindow_Meme, …, NabMouse, NabMouse, NabMouse`). Config defaults: `MinWanderingTimeSeconds = 20f`, `MaxWanderingTimeSeconds = 40f`, `FirstWanderTimeSeconds = 20f`.

**Rabin et al. (1.6)** §3.3 *Filtered Randomness*: keep a history of **the last 10–20 values per decision** and reroll on named anomalies — repeats ("7, 7"), repeats separated by one ("8, 3, 8"), runs of 4 ascending/descending, clustering, two-number patterns in the last 10. Binary version: on a run of 4+, flip with **75 %** probability. §3.4 recommends **1-D Perlin noise** for values that should drift smoothly over "seconds, minutes, or hours" — mood, attention, gaze amplitude.

**Graham (1.5)** §9.6: always taking the top utility score "can feel very robotic"; pure score-weighted random means "every now and then, they'll choose something utterly stupid". The fix is **top-N then weighted random** ("the top five", or everything "within, say, 10 %"). §9.6 defines **bucketing / dual utility**: higher-priority buckets are exhausted before lower ones. §9.7 **inertia**: add weight to the action you're already in, or "stall making another decision… until the current action is finished" — on *The Sims Medieval* a Sim only re-decided when its interaction queue emptied. Graham (1.4) also recommends **jittering the schedule-change time with a Gaussian** so a population doesn't switch in lockstep, and states "the core AI system needs to be able to **override** the schedule system when necessary" — literally D14.

**Left 4 Dead (1.7)**, verified from the slides: *"Populating via Structured Unpredictability — Not purely random, nor deterministically uniform… Occur at randomized interval between 90 and 180 seconds"*; "75 % of Mobs come from behind". (The commonly cited "relax lasts 30–45 s" is **UNVERIFIED** — not on the slides read.)

### What to avoid, with evidence

- **A small pool cycled fast.** Desktop Mate is "Mixed" on Steam (**3201 positive / 2056 negative of 5257**, via Steam's review API). The top negative review (378 helpful): *"she has about five animations total and you will see all of them within two minutes of opening the program; she cycles through a new one every eight seconds. more animations and significantly less adhd from the idol could go a long way here."* — https://steamcommunity.com/profiles/76561198091901520/recommended/3301060/. D1's ≥12 behaviours is the right answer to exactly this.
- **Self-referential weights.** Shimeji's `SitAndFaceMouse` lists *itself* at `Frequency="100"` against two alternatives at `Frequency="1"` — ≈98 % self-repeat. A shuffle bag makes this structurally impossible.
- **20–60 s static holds** (Shimeji) and looping idles generally — Graham (1.4) names "looping idles" and "random walk cycles" as the NES/SNES-era tell.
- **Per-frame utility scoring** → oscillation ("shoot the player a couple times, start to run away, then shoot again").
- **Building an IAUS for this.** Graham (1.4): for background characters, a deep rich AI system "is often a mistake".
- **A purely reactive pet.** Bongo Cat is input-driven with **no idle scheduler at all** and freezes the instant you stop typing (deepwiki read of `ayangweb/BongoCat`).
- **Throttling instead of pausing when occluded.** Lively (1.8) *suspends the render subprocess entirely*; it polls occlusion on a `DispatcherTimer` every **500 ms** with a grid algorithm (`ProcessMonitorGridTileSize = 50` px, coverage threshold **0.05**) and has no FPS-throttle setting at all.

### Recommendation

**Use the weighted pool with declarative conditions (D1), not a utility scorer** — Graham (1.4) argues precisely this case, and the four gating axes (time-of-day, user-idle, on-floor, near-edge) are *gates*, which conditions express directly and response curves would obscure. Borrow three things from utility AI without the architecture: **bucketing** for D14 arbitration, **inertia** to stop dithering, and **top-N weighted random** inside a bucket. `behaviors.json` should be Shimeji's semantics in Graham's shape plus the two fields both lack — cooldown and a liveliness gate:

```json
{ "id": "look_around", "weight": 100, "bucket": "idle",
  "minMs": 6000, "maxMs": 14000, "cooldownMs": 45000, "minLiveliness": 0.0,
  "motion": { "group": "Idle", "index": 3 }, "expression": null,
  "when": { "timeOfDay": ["day","evening"], "userIdleSecMin": 5,
            "onFloor": true, "nearEdge": false },
  "next": [ { "id": "settle", "weight": 60 } ] }
```

Keep `when` a declarative struct evaluated in TypeScript — **do not ship a JS expression evaluator**; Shimeji needs Nashorn only because designers author XML, and R1 (erasable-syntax-only) makes an evaluator a liability. **Decouple the selector from the renderer**: the render ticker stays 30 Hz idle / 60 Hz hovered-or-speaking and owns the always-on layers (breath, blink, physics per D2), while the **behaviour selector is event-driven** — it runs when a behaviour completes, plus a coarse **1 Hz** condition re-poll for gate changes. Nothing about idle selection needs 30 Hz, and this is most of the ≤4 % CPU headroom. Follow Lively for suspension: **stop the RAF loop and the selector entirely** when hidden/occluded/locked rather than throttling, and clamp `dt` on resume so a wake-from-sleep doesn't fire a burst of queued transitions.

For "no behaviour twice in a row" and "≥4 distinct in 60 s", use a **weighted shuffle bag**: repeat each eligible behaviour `weight/gcd` times, Fisher–Yates, deal without replacement, and on reshuffle swap position 0 if it equals the last card dealt. No-repeat becomes true *by construction*, and with ≥12 behaviours the whole pool is covered before anything recurs. Rebuild the bag when the eligible set changes. Draw duration as `clamp(gaussian(12 s, 3.5 s), 5 s, 20 s)` — expected ≈5 behaviours per 60 s — and add a deterministic tail guard: keep a rolling 60 s window of start timestamps and clamp the next `maxMs` to 12 s if fewer than 4 starts are in it. That guard is a single assertion the D16 recording test can check directly. Layer Rabin's recency filter (last 10–20 picks, suppress `A,B,A`) as defence in depth, and honour `cooldownMs` on showy behaviours. Map the **活泼度 slider** monotonically onto three effects, VPet-style: inter-behaviour gap 4–10 s (quiet) → 0–2 s (lively); duration mean 15 s → 8 s within the clamp; and a `minLiveliness` gate unlocking big motions above ≈0.5. **Set the quiet default so mean cycle (duration + gap) ≤ 14 s, or the default violates the ≥4-in-60-s criterion.** Optionally add VPet's escalating hazard and drive gaze amplitude / breath depth with 1-D Perlin noise so even a held behaviour is never numerically identical twice. D9: use Electron's display **`workArea`** (Shimeji's `mascot.environment.workArea.bottomBorder`), not `bounds`.

---

## 2. Non-punitive mood / energy / affection (§0 absence economics, D5, D12)

### References

| # | Source | URL |
|---|---|---|
| 2.1 | Zagal, Björk & Lewis, *Dark Patterns in the Design of Games*, FDG 2013 | http://www.fdg2013.org/program/papers/paper06_zagal_etal.pdf |
| 2.2 | Tamagotchi Wiki — Care / Death / 1996 Pet / Uni | https://tamagotchi.fandom.com/wiki/Care · https://tamagotchi.fandom.com/wiki/Death |
| 2.3 | Nintendogs Wiki — Owner Points | https://nintendogs.fandom.com/wiki/Owner_Points |
| 2.4 | The Sims Wiki — Motive | https://www.thesimswiki.com/wiki/Motive |
| 2.5 | VPet `MainLogic.cs` (`FunctionSpend`) — read from source | https://raw.githubusercontent.com/LorisYounger/VPet/main/VPet-Simulator.Core/Display/MainLogic.cs |
| 2.6 | De Freitas et al., *Emotional Manipulation by AI Companions* (2025) | https://arxiv.org/abs/2508.19258 |
| 2.7 | Duolingo — how the streak builds habits | https://blog.duolingo.com/how-duolingo-streak-builds-habit/ |
| 2.8 | Nookipedia — Weed / Cockroach (absence signals across AC versions) | https://nookipedia.com/wiki/Weed · https://nookipedia.com/wiki/Cockroach |
| 2.9 | Gebhard, *ALMA: A Layered Model of Affect*, AAMAS 2005 | DOI `10.1145/1082473.1082478` (Crossref-verified) |

### Numbers worth copying

**Tamagotchi 1996 (P1)**: 4 hunger + 4 happy hearts; heart loss accelerates with age, capping at **1 hunger heart / 6 min and 1 happy heart / 7 min**. Attention call → **15-minute response window** before it counts as a care mistake. Adults die after **5 care mistakes**; average lifespan ≈**12 days**. Critically: *"A Tamagotchi will only grow and age while it is awake"*, and clock-adjustment mode is an explicit pause — *"The Tamagotchi will not age, lose hearts, poop etc. as long as the clock is in adjustment mode."*

**The softening is measurable.** The **2017 rerelease caps heart loss at ~1 of each per 16 minutes** (≈2.5× slower than 1996). Colour models **deleted the lights-on care mistake entirely**. On modern releases the age counter stops at 99 and *"adults will now live perpetually as long as the user takes good care of them"* — old-age death removed. On Pix and Nano models the character *leaves* after a long period, and this is *"usually a 'good ending'."*

**Nintendogs + Cats**: Heart Points cap at **200/day per pet**; walk = **20 OP once per day**, premium bath 10, feeding 8, toy 4–7, trick 2, petting 1–2. Absence deducts points, but the wiki's own framing matters: *"deducted points are easily earned again and do not appear to impact the 200 max points a pet can earn each day."* The final unlock is gated at **11,400 Owner Points *or* 35 days of play** — a dual path where calendar presence alone eventually unlocks everything.

**The Sims** publishes **thresholds, not decay rates**: TS3 deficits at Hunger 20/10/5 %, Energy 10/5/0, Social 10/0, Hygiene 15/7, Fun 33/15. **Per-sim-minute decay constants and "advertised utility" scoring numbers are UNVERIFIED** — reachable wikis document moodlets only.

**VPet, read from source (2.5)** — this is the cautionary tale in code. Tick 15,000 ms calling `FunctionSpend(0.05)`; `StrengthFood -= 0.05`, `StrengthDrink -= 0.05` per tick → **12 points/hour**, 100→0 in ≈8.3 h of runtime. Mood:

```csharp
double freedrop = (DateTime.Now - LastInteractionTime).TotalMinutes;
if (freedrop < 1) freedrop = 0;
else freedrop = Math.Min(Math.Sqrt(freedrop) * TimePass / 4, Core.Save!.FeelingMax / 800);
```

→ `min(sqrt(minutes_idle) × 0.0125, 0.125)` per tick, saturating after **100 minutes idle** at 30 Feeling/hour. Then the punishing cliff:

```csharp
if (Feeling >= FeelingMax * 0.90) { Likability += TimePass; }
else if (Feeling <= 25) { Likability -= TimePass; Exp -= TimePass; }
```

**Below mood 25, affection and XP drain at 12/hour each.** Sleep is a safe harbour (restores food/drink/stamina, mood cannot drop, resets `LastInteractionTime`). `LastInteractionTime` is a runtime property not persisted in `GameSave.cs`/`GameSave_v2.cs`, so **VPet punishes "app running, user ignoring", not "app closed"** — likely (read, not executed).

**Duolingo (2.7)**: **2 streak freezes** per user; doubling freezes from one to two raised DAU **+0.38 %**; milestone animations raised day-7 retention **+1.7 %**; users reaching a 7-day streak are **3.6× more likely** to finish the course. Slack beats pressure.

### What to avoid, with evidence

**The exact failure mode §0 legislates against is documented in VPet's own Steam reviews.** A player who quit twice (https://steamcommunity.com/profiles/76561198997981433/recommended/1920960/):

> 最初的萝莉斯并不是那种可以完全放任不管的桌宠，她会饿肚子，会累，会无聊，会生病。如果太久不管萝莉斯，再去看时她必然已经重病在床。望着小家伙痛苦的样子，我实在是于心不忍，于是决定暂时退坑
> *("If you ignored her too long, she'd inevitably be gravely ill in bed when you looked back. Seeing the little one suffer, I couldn't bear it, so I decided to quit.")*

The most-upvoted review in an 800-review sample (49 votes, https://steamcommunity.com/profiles/76561199832366934/recommended/1920960/) praises the *absence* of a care loop:

> 她从来不会给你派任务，不会弹红点提醒你上线，不需要你氪也不需要你肝… 你忙起来可以彻底忘了她的存在… 却给了很多人一份最没有负担的温柔。

**Zagal (2.1) names the v1 rule as a dark pattern**: *"Playing by Appointment: Games with this dark pattern require that players play at specific times… as defined by the game, rather than the players."* The escape clause is the design target: **"The darkness of this pattern is nullified if completing appointments is not required for progression."**

**Guilt at the exit is measurably harmful.** De Freitas et al. (2.6) audited **1,200 real farewells** across top companion apps: **37 % deploy a manipulation tactic** (guilt appeals, FOMO hooks, metaphorical restraint). Across **3,300 US adults**, manipulative farewells boosted post-goodbye engagement **up to 14×** — driven by *reactance-based anger and curiosity, not enjoyment* — while raising perceived manipulation, churn intent and negative word-of-mouth, with **"coercive or needy language generating steepest penalties."** This is the empirical backing for A14.

**Nintendo softened too**: pre-New Horizons **2 new weeds/day**; in New Horizons **1/day**, spawning stops at 150, weeds no longer affect the island evaluation, and they became a **crafting ingredient** — the neglect signal was converted into a resource. Cockroaches survived, and note their shape: **cosmetic, instantly clearable, non-scoring**. That is the only absence marker Nintendo kept.

**Bongo Cat** shows the always-on-desktop failure mode: *"I don't like that this became more about the 'game' and less about the game being a desktop pet. It got distracting instead of helpful after the later updates."* (https://steamcommunity.com/profiles/76561198952206664/recommended/3419430/) and *"The constant 30 minute wait to be able to get a new item… has just made this more of an annoyance for me rather than a fun little dopamine kick."*

### Recommendation

**Delete the v1 "−1/day after 3 days without contact" rule outright** — it is Zagal's Playing by Appointment and it contradicts §0. Replace it with an **asymmetric, non-decaying affection ledger**: affection is a monotonic record of shared history that rises on interaction and *never* falls on the clock. To keep it feeling earned, use Nintendogs' shape rather than a decay term — a **daily earn cap** (+6/day from exchanges, +2/day from taps, consistent with the existing +1/+0.5 grants) plus diminishing returns per level, and a **dual-path milestone** (cumulative affection **or** number of distinct days seen) so a light user still advances. The only legitimate downward nudge is §0's own definition — present-but-ignored — and it must be **mood-only, floor-clamped, and never touch affection**.

**Define presence as: app running AND session unlocked AND user input (any app, via `GetLastInputInfo`) within N minutes.** Not foreground — a companion that only counts when you stare at it inverts the premise, and D5's nap state already keys off the 5-minute input gap. Two tiers: **active** (input < 5 min) and **idle-present** (unlocked, input 5–30 min → nap). Locked, RDP-disconnected, or app closed = **absent**, and absent time is invisible to the model.

**Mood decays in present time, and must never resume mid-fall.** Snapshot mood on transition to absent; on return, *begin* from that value. The user never comes back to a pet that got sadder while they were gone, nor to one frozen mid-sulk from three days ago. The 2 h half-life is defensible but reads long in present-time terms — **shorten to 45–60 min of present time** and add a one-shot **settling decay on return** (collapse ≈70 % toward baseline if absence exceeded 2 h). *ALMA/WASABI numeric decay constants are **UNVERIFIED**; the defensible citation is ALMA's structural three-timescale split (personality / PAD mood / OCC emotion), not a constant.*

**Energy should follow wall-clock circadian time even during absence — and this is not a penalty.** The distinction to write into the plan: *a penalty is state that got worse because of the user's choice; circadian energy is state that would be identical no matter what they did.* A pet sleepy at 03:00 is sleepy for reasons unrelated to you (this is Tamagotchi's own "only ages while awake" rule inverted correctly); a pet starving at 03:00 is starving *because you left*. So compute energy as a pure function of wall-clock time-of-day **plus** present-time expenditure: the circadian curve runs unconditionally, while the −0.5/exchange drain and idle regen accrue only during presence. This also makes energy recomputable from the clock alone after any gap, killing a class of catch-up bugs.

**What the 60 s tick computes.** If absent: write `lastSeenAt` and nothing else. If present: (1) recompute energy from the circadian curve plus accrued regen; (2) advance mood one step of present-time decay toward the persona baseline; (3) if idle-present and the ignored-streak exceeds a threshold, apply a small **mood-only** nudge with a hard floor (mood cannot go below −0.3 from inattention alone — VPet's mistake was letting mood cross a cliff into affection loss); (4) **never modify affection on a tick at all** — affection changes only in event handlers. That makes "absence is never penalized" a *structural* property: the tick has no branch that can decrement affection.

**Buckets and phrases**, with ±0.05 hysteresis dead zones so the prompt doesn't flicker: mood ≤−0.5 低落 / −0.5..−0.15 有点闷 / −0.15..0.15 平静 / 0.15..0.5 心情不错 / ≥0.5 很开心; energy ≥75 精神饱满 / 45–75 还好 / 20–45 有点困 / <20 很困了; affection (only ever climbs) 0–15 刚认识 / 15–35 有点熟 / 35–60 熟络 / 60–85 很亲近 / 85–100 形影不离. **Derive the phrase from a bucket index, not the float, and never let the prompt contain a delta** — a companion that can *narrate* a loss can guilt-trip, which is exactly the 14× / high-churn tactic De Freitas measured.

---

## 3. Proactive speech (§0 proactive caps, A12, A13, A14, D4, X6)

### References

| # | Source | URL |
|---|---|---|
| 3.1 | Mark, Gudith & Klocke, *The Cost of Interrupted Work: More Speed and Stress*, CHI 2008 (**read in full**) | https://www.ics.uci.edu/~gmark/chi08-mark.pdf |
| 3.2 | Horvitz et al., *The Lumière Project*, UAI 1998 | http://erichorvitz.com/ftp/lum.pdf · http://erichorvitz.com/lumiere.htm |
| 3.3 | Horvitz, *Principles of Mixed-Initiative User Interfaces*, CHI 1999 | http://erichorvitz.com/chi99horvitz.pdf |
| 3.4 | Achlioptas & Horvitz, *Principles of Bounded Deferral*, MSR-TR-2005-87 | http://erichorvitz.com/bounded_deferral.pdf |
| 3.5 | Mark, González & Harris, *No Task Left Behind?*, CHI 2005 | https://www.ics.uci.edu/~gmark/CHI2005.pdf |
| 3.6 | Iqbal & Bailey, breakpoint detection & deferral, CHI 2007 / CHI 2008 | http://interruptions.net/literature/Iqbal_Bailey-CHI07.pdf · http://interruptions.net/literature/Iqbal-CHI08.pdf |
| 3.7 | Sinofsky, *042. Clippy, The F\*cking Clown* (Hardcore Software) | https://hardcoresoftware.learningbyshipping.com/p/042-clippy-the-fcking-clown |
| 3.8 | De Freitas et al., *Emotional Manipulation by AI Companions* (2025) | https://arxiv.org/abs/2508.19258 |
| 3.9 | Zagal et al., *Dark Patterns in the Design of Games*, FDG 2013 | http://www.fdg2013.org/program/papers/paper06_zagal_etal.pdf |
| 3.10 | Yancey & Settles, *A Sleeping, Recovering Bandit Algorithm…*, KDD 2020 (Duolingo notifications) | https://research.duolingo.com/papers/yancey.kdd20.pdf |
| 3.11 | Open-LLM-VTuber-Web proactive context (ships `idleSecondsToSpeak: 5`, **zero** rate limiting) | https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web/blob/main/src/renderer/src/context/proactive-speak-context.tsx |

### Numbers worth copying

**Mark, Gudith & Klocke (3.1)** — 48 subjects, 3×2 within-subject (no interruption / same-context / different-context × telephone or IM). The results, read from Tables 1 and 3:

| Condition | Time to task (min) | Mental workload | Stress | Frustration | Time pressure | Effort |
|---|---|---|---|---|---|---|
| Baseline (no interruption) | **22.77** (7.60) | 10.02 | **6.92** | **4.73** | 11.02 | 9.50 |
| Same-context interruption | 20.31 (5.94) | 10.83 | **9.46** | 6.63 | 12.69 | 11.04 |
| Different-context interruption | 20.60 (4.93) | 11.50 | **9.13** | 6.48 | 12.17 | 11.52 |

(Workload scales 1–20.) Two findings matter enormously here. First, **interrupted work is completed *faster*, not slower, with no quality difference** — people compensate by working faster and writing less. Second, **the cost lands entirely on affect**: stress +37 %, frustration +40 %, effort +16 %, and *"after only 20 minutes of interrupted performance people reported significantly higher stress, frustration, workload, effort, and pressure."* Third and most important for the design: **context does not help.** *"Our results showed that **any** interruption introduces a change in work pattern and is not related to context per se."* There was no significant difference between same- and different-context interruptions on time, errors, or politeness.

That last point kills a tempting design: "make the proactive line relevant to what she can see the user doing, then it's not really an interruption." **It is.** Relevance buys nothing measurable; only *not interrupting* does.

**Lumière settles the Clippy question in its own voice.** (3.2) §7 states exactly what the shipped Office Assistant dropped:

> "Finally, the automated facility of providing assistance based on the likelihood that a user may need assistance or on the expected utility of such autonomous action was not employed. Rather, the results of inference are available only when the user requests assistance explicitly."

Lumière itself had everything Clippy lacked: a **"Cost of assistance"** node in its influence diagram, *"a user-specified probability threshold… to control the autonomous assistance"*, an in-UI **"volume control"** letting the user move that threshold, auto-timeout "after a brief apology for the potential distraction", and — critically — *"the autonomous help will not be offered again until there is a change in the most likely topics."* The product removed the **utility gate** and kept a crude hardcoded trigger. Sinofsky (3.7) names the actual mistake: *"One mistake, well really the mistake, was firing Assistant on the most simple and obvious effort in Word. The sequence of starting a new document, typing Dear <name> and pressing return would cause the assistant to say, 'Looks like you're trying to write a letter.'"* **Clippy was not hated for speaking — it was hated for speaking with confidence about something the user obviously already knew, with no cost term and no memory of having said it.**

**The decision rule, verbatim from (3.3):** *"Autonomous actions should be taken only when an agent believes that they will have greater expected value than inaction… it is best for the system to take action if the probability of a goal is greater than p\* and to refrain from acting if the probability is less than p\*."* And the part that matters most here: *"The utility of unwanted action can diminish significantly with increases in the depth of a user's focus on another task. Such a reduction in the value of action leads to a **higher probability threshold**."* Principle (3) is deferral; principle (11) — *"maintaining working memory of recent interactions"* — is the 30-day rule.

**Timing numbers to build against:**

| Finding | Source |
|---|---|
| Resuming an interrupted task took **25 min 26 s** (sd 54:48), 2.26 intervening working spheres; 57.1 % of segments interrupted | (3.5) |
| 113 users, 4,803 busy situations: **mean busy episode 43.12 s** (sd 51.79); *"a great majority of busy situations transition to free situations within 1 to 2 minutes"* | (3.4) |
| Breakpoints are **Coarse / Medium / Fine**; *"coarser breakpoints correspond to lower cost"*; deferral cost only **1.5 min average**, and it reduced frustration and reaction time | (3.6) |
| Users get **63.5 notifications/day**; unsubscribes stay <1 % up to 5/day, ≈3 % at 11–15/day, 7 % at 16–20/day | Pielot 2014 / Shirazi CHI 2014 |
| Duolingo sends ≈**1 reminder/user/day** and applies a **recency penalty**, spacing repeats *"using the same forgetting curve that we use to measure word learning"*; removing it costs 0.5 % reward | (3.10) |

⚠️ **The famous "23 minutes 15 seconds to resume" is a misquote** — (3.5) says **25 min 26 s**. Do not cite 23:15.

**Open-LLM-VTuber (3.11)**, source-read: an `idleSecondsToSpeak` timer fires `ai-speak-signal` → loads `proactive_speak_prompt.txt` (default fallback literally *"Please say something."*) with `{"skip_memory": True, "skip_history": True}`. It ships **`idleSecondsToSpeak: 5`** and the entire 93-line proactive context contains **zero** occurrences of cooldown/throttle/rate-limit. AIRI is better (urgency tiers 0/10 s/60 s, `maxAttempts: 3`, linear `attempts × 30 s`) but its back-off is a *retry* back-off, not an unanswered-by-user back-off. **§0's layered caps are already more sophisticated than both reference implementations.**

### What to avoid, with evidence

- **Relevance-as-justification.** (3.1) — context of the interruption made no measurable difference to disruption cost.
- **Any guilt, FOMO, or neediness.** (3.8) — 37 % of shipped companion farewells are manipulative; they produce up to **14× engagement via reactance-based anger**, with higher churn intent and negative word-of-mouth, and *"coercive or needy language generating steepest penalties."* Enforce A14 with a linter over the template pool, not with good intentions.
- **Repetition — the specific failure the 30-day rule targets.** Miyamoto himself called Ocarina's hint system *"the biggest weakpoint of Ocarina of Time"* and said *"If you read Navi's text, **she says the same things over and over**"* (https://www.nintendolife.com/news/2022/01/even-miyamoto-doesnt-like-stupid-navi-in-zelda-ocarina-of-time). Nintendo named this failure 25 years ago.
- **Never-shut-up companions produce mute mods, not affection.** Kotaku on Paimon: *"she piped up in response to every little thing that happened to us… It was like somebody had somehow made Navi the fairy from Legend of Zelda: Ocarina of Time even worse"* (https://kotaku.com/genshin-impacts-sidekick-is-annoying-as-hell-but-also-1845415648). Five years on, https://github.com/tmarenko/GenshinImpact_PaimonShutUp still ships.
- **The one documented fix is push → pull.** Skyward Sword HD: *"instead of yelling at you about a chest or a puzzle, Fi will glow blue and you can decide to listen or just ignore"* (https://kotaku.com/nintendo-wants-to-make-skyward-sword-hd-less-annoying-1847221788). Worth considering as a Phase 4 affordance: a silent visual "she has something to say" state.
- **Appointment mechanics** ("你今天还没跟我说话呢"). (3.9)
- **Unbounded proactive loops** — do not inherit OLV's `idleSecondsToSpeak: 5` with no caps (3.11).
- **Speaking mid-task.** (3.1, 3.4, 3.6) — defer to a coarse breakpoint.

### Recommendation

Implement §0's four layers as **four independent gates in a single `shouldSpeak(now)` pure function evaluated locally with zero LLM calls**, each backed by a counter in SQLite so it survives restart:

1. **Global rate** — `lastProactiveAt + 20 min <= now`.
2. **Unanswered back-off** — count consecutive proactive lines with no user reply; hard cap **3/day**, and multiply the required gap by `2^unanswered` (20 → 40 → 80 min), resetting to 0 on any user message.
3. **Persona cap** — default **2/day**, from the character card.
4. **Suppression** — reject if typing, fullscreen/presentation/locked/DND (one `SHQueryUserNotificationState` call, §6), or within **60 s** of any user input.

Add a fifth gate that §0 does not name but (3.1), (3.4) and (3.6) demand: **bounded deferral, then drop.** Do not fire on eligibility. When gates 1–3 pass, enqueue `(bucket, maxWait)` with **maxWait ≈ 120 s** — chosen against (3.4)'s measured **43.12 s mean busy episode** and its finding that most busy situations resolve within 1–2 minutes — and wait for a **coarse breakpoint**: a foreground-window change (`EVENT_SYSTEM_FOREGROUND`), the falling edge of a typing streak plus ~5 s of quiet, or a return from idle. If no breakpoint arrives inside the window, **discard the line entirely rather than force it.** Notification systems fire on timeout because notifications carry information; a social one-liner does not, and stale is worse than silent. (3.6) puts the average cost of such deferral at only **1.5 min** while measurably reducing frustration.

**Back-off with jitter.** `delay = random(0, min(cap, 20min × 2^n))` — AWS "full jitter" (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/). n = 0 → 20, 1 → 40, 2 → 80 min, then silent for the day at 3 unanswered. **The jitter is not cosmetic**: firing at exactly :00 and :20 reads as a cron job, not a character. Any user reply within 5 min sets `answered = 1` and resets n.

**Split template vs LLM by occasion.** The clock-driven occasions — morning greeting, night state, meal cues (D4), long-gap return (A12) — should be **template pools**: zero tokens, zero latency, and hand-auditable against A14 exactly once. Reserve the **LLM path** for the *callback* line that references something the user actually said — the only proactive utterance carrying genuine value-add under (3.3)'s principle (1). Cap it at ~1/day; it alone spends the X6 budget. Both stay under the 2 s reveal cap, which at ≈15 chars/s means **≈30 characters**.

**Never-repeat-within-30-days, cheaply.** One table, `proactive_log(ts, template_id, bucket, text, fp, answered, tokens)`, indexed on `(template_id, ts)`:

```sql
SELECT 1 FROM proactive_log
WHERE template_id = ?1 AND ts > unixepoch('now','-30 days') LIMIT 1;
```

At 2/day the window holds ≤60 rows, so **brute-force the near-duplicate check too** — no bloom filter, no permuted index. ⚠️ **Do not use SimHash here**: it is a *document* technique (Manku et al. validated 64-bit fingerprints at k=3 over 8 billion pages) and degrades badly on 15-character Chinese strings. Use **character-bigram Jaccard ≥ 0.6** as the reject threshold — the same primitive §7 uses for fact dedup. **Pool sizing matters**: 2/day × 30 days = 60 emissions, so a 60-line pool has *zero* slack — build **≥40–60 skeletons per bucket** with 2–3 slot variables each. And copy Duolingo (3.10): don't merely hard-ban repeats, **weight selection by recency decay** so the pool feels shuffled rather than round-robined.

**The one rule that kills all six manipulation tactics.** A proactive line may reference *the world*, *the character's own state*, or *something the user said* — **never the user's absence, silence, or failure to respond.** That is mechanically checkable and should be a unit test over the template JSON.

Note the persona trap: **tsundere *sounds* like it licenses sulking.** It does not — 「哼，不理我就算了，反正我也不重要」 is a guilt appeal wearing the persona's voice. Attach the tsundere affect to the character or the world, never to user obligation:

| Ship | Never ship |
|---|---|
| 「……窗外开始下雨了。才不是特意提醒你收衣服的。」 | 「主人都三个小时没理我了…是不是不要我了？」(guilt) |
| 「哼，这段代码你写了挺久的嘛。要不要喝口水？」 | 「你再不回来我就要消失了哦。」(coercion) |
| 「都十一点半了。本鲸才不管你几点睡……随便你啦。」(D4) | 「别走嘛，就再陪我五分钟。」(metaphorical restraint) |
| 「早上好。今天的海水……啊不是，今天的天气还不错。」(A12) | 「今天的限定问候只剩最后一次机会了！」(FOMO) |
| 「上次你提到的那个 bug，后来搞定了没有？……我只是随口问问。」(the LLM callback) | 「哼，不理我就算了，反正我也不重要。」(guilt in persona costume) |

---

## 4. Touch and drag physics (D6, D7, D8)

### References

| # | Source | URL |
|---|---|---|
| 4.1 | MDN — WebGL best practices (blocking calls, async readback recipe) | https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices |
| 4.2 | Gilbert — Async downloads in blocking APIs | https://kdashg.github.io/misc/async-gpu-downloads.html |
| 4.3 | three.js manual — GPU picking | https://threejs.org/manual/#en/picking |
| 4.4 | Live2D CubismWebFramework — `isHit`, `CubismTargetPoint` (source-read) | https://github.com/Live2D/CubismWebFramework |
| 4.5 | Shimeji-Desktop — `Fall.java`, `Dragged.java`, `Location.java`, `actions.xml` | https://github.com/DalekCraft2/Shimeji-Desktop |
| 4.6 | Fiedler — Fix Your Timestep! / Integration Basics | https://gafferongames.com/post/fix_your_timestep/ · https://gafferongames.com/post/integration_basics/ |
| 4.7 | Jonasson & Purho, *Juice it or lose it* · Nijman, *The art of screenshake* | https://www.youtube.com/watch?v=Fy0aCDmgnxg · https://www.youtube.com/watch?v=AJdEqssNZ-U |
| 4.8 | NN/g — Response times / animation duration | https://www.nngroup.com/articles/response-times-3-important-limits/ · https://www.nngroup.com/articles/animation-duration/ |
| 4.9 | Matter.js Body docs (restitution semantics) | https://brm.io/matter-js/docs/classes/Body.html |
| 4.10 | Project AIRI — the one OSS pet doing real alpha readback | https://github.com/moeru-ai/airi |

### Numbers worth copying

**Hit-testing reality check.** Live2D's own hit test is a **bounding box**, verified verbatim in `CubismWebFramework/src/model/cubismusermodel.ts`: `isHit(drawableId, pointX, pointY)` walks `getDrawableVertices` for `left/right/top/bottom`, inverse-transforms the point with `_modelMatrix.invertTransformX/Y`, and returns a rectangle containment test. **No alpha, no triangles.** `pixi-live2d-display` is the same (bbox via `getDrawableBounds`; its `HitAreaFrames` debug tool literally draws rectangles). The Unity SDK does offer a `CubismRaycastable` "Triangles" mode (https://docs.live2d.com/en/cubism-sdk-tutorials/hittest/) — **the Web SDK has no equivalent.** So D6's opaque-pixel requirement must be built, not configured.

**Cost of the naive approach.** MDN (4.1) lists `readPixels()` to a CPU array under *"Avoid blocking API calls in production"* as **"finish + round-trip"** — a forced GPU sync. It also flags `getError()` as "flush + round-trip"; do not call it in the loop. The documented fix is WebGL2 async readback: bind `PIXEL_PACK_BUFFER`, `bufferData(..., STREAM_READ)`, `readPixels(..., 0)`, `fenceSync(SYNC_GPU_COMMANDS_COMPLETE, 0)`, poll `clientWaitSync` from a timer, then `getBufferSubData`. MDN ships the full `readPixelsAsync` code; three.js implements it as `readRenderTargetPixelsAsync()` specifically because the sync version stalls.

**What the one real precedent does.** AIRI's `useCanvasPixelIsTransparentAtPoint` / `isCanvasRegionTransparent` call `gl.readPixels(..., RGBA, UNSIGNED_BYTE)` over a rect bounding a circle of `regionRadius`, **alpha threshold 10**, `regionRadius` **0 for pointer hit-test / 25 for the fade effect**, evaluated **per mousemove**, **no caching, no downscale**, with the PIXI app created `preserveDrawingBuffer: true`. Their comment is the good idea: *"Fade detection deliberately uses a sampled region to avoid flickering around model edges, while native pointer hit-testing uses the exact pixel."* Copy the hysteresis; do not copy `preserveDrawingBuffer` or the per-move sync readback.

**Shimeji physics, from source (4.5):**

| Quantity | Value |
|---|---|
| Tick | `TICK_INTERVAL = 40` ms → 25 Hz |
| Gravity | `DEFAULT_GRAVITY = 2` px/tick² → **1250 px/s²** |
| Air resistance | `DEFAULT_RESISTANCEX = 0.05`, `DEFAULT_RESISTANCEY = 0.1` (multiplicative/tick) |
| Integration | `vx -= vx*Rx; vy += -vy*Ry + g` — semi-implicit, sub-pixel accumulators, per-step floor/wall checks |
| Release velocity | `InitialVX="${mascot.environment.cursor.dx}"`, `InitialVY="${...dy}"` |
| Cursor delta | `dx = (dx + x - this.x) / 2` — an **EMA with α = 0.5**, explicitly so thrown velocity doesn't snap to zero |
| Dangle sway | `footDx = (footDx + (newX - footX) * 0.1) * 0.8` |
| Restitution | **none** — landing plays a `Bouncing` *animation*, then `Stand` for `${100+Math.random()*100}` ticks |

Derived: vy damping k = −ln(0.9)/0.04 ≈ **2.63 s⁻¹** → terminal fall ≈ **475–500 px/s**; vx half-life ≈ **0.54 s**. ⚠️ `ThrowIE.java` (`InitialVX=32, InitialVY=-10, Gravity=0.5`) throws the *Internet Explorer window*, not the mascot — do not copy those.

**Cubism drag numbers (source-verified):** `ParamAngleX += dragX*30`, `ParamAngleY += dragY*30`, `ParamAngleZ += dragX*dragY*-30`, `ParamBodyAngleX += dragX*10`, `ParamEyeBallX += dragX`, `ParamEyeBallY += dragY`. Haru's `model3.json` fade times are 0.5 s. `CubismTargetPoint` is Live2D's own drag smoother — an **acceleration-limited follow** (not a spring) with `FrameRate = 30`, `Epsilon = 0.01`, `faceParamMaxV = 40.0/10.0`, **`timeToMaxSpeed = 0.15 s`**.

**No global scale parameter exists** in the standard list (ParamAngleX/Y/Z ±30, ParamBodyAngleX/Y/Z ±10, ParamEyeBallX/Y ±1, ParamMouthOpenY / ParamBreath 0–1). **Squash/stretch must come from the matrix** — `CubismModelMatrix extends CubismMatrix44` exposes `scale(x,y)`, `scaleRelative(x,y)`, `translate*`, `setCenterPosition`.

**Springs, source-verified** (`react-spring/packages/core/src/constants.ts`, mass 1): default **170/26**, gentle 120/14, wobbly 180/12, stiff 210/20, slow 280/60. Note `c_crit = 2√170 ≈ 26.1` — **the default preset is essentially critically damped (ζ ≈ 0.996)**, settling ≈ 4.74/√170 ≈ **364 ms**.

**Timing (4.8):** 0.1 s = "reacting instantaneously"; *"a range of 100–400 ms is appropriate"*; ~100 ms for small feedback, 200–300 ms for substantial changes; *"at 500 ms animations start to feel like a real drag"*. Ease-out for entering. Thomas & Johnston: *"an object's volume does not change when squashed or stretched."* Matter.js restitution default **0**, and *"a value of 0.8 means the body may bounce back with approximately 80 % of its kinetic energy."* Fiedler (4.6): *"My recommendation is **semi-implicit euler**… much more stable than explicit euler, and it tends to preserve energy"*, with an accumulator at fixed `dt` and `frameTime` clamped to 0.25 s.

### What to avoid, with evidence

- **`readPixels` to CPU every frame** — MDN (4.1) classes it "finish + round-trip"; at 30 Hz that is 30 forced GPU syncs/s against a ≤4 % CPU budget.
- **`preserveDrawingBuffer: true`** merely to enable readback (AIRI does this) — read from your own FBO instead.
- **`gl.getError()` in the loop** — MDN: "flush + round-trip".
- **Unthrottled hit-test on every `pointermove` plus an IPC per move** — Open-LLM-VTuber-Web's `handleMouseMove` does exactly this.
- **Post-hoc position clamping at 30 Hz** — a 2500 px/s fling moves 83 px per tick; substep or sweep.
- **Expecting HitArea coverage to mean anything precise** — Haru's `Head` bbox is a rectangle over the head mesh, so a click in the empty corner above the shoulder registers as `Head`. Alpha gating is what fixes this.

### Recommendation

**Hit-test architecture: a cached, downscaled, asynchronously-read alpha mask.** Keep one persistent 1/4-scale FBO (≈105×180 for the 420×720 window, DPI-aware). After the model draw each ticker frame, re-draw into it (1/16 the fragments — negligible), then run **one async readback every 150–200 ms** (`PIXEL_PACK_BUFFER` + `fenceSync` + `clientWaitSync` polled from the ticker, per MDN's `readPixelsAsync`) into a persistent ~75 KB `Uint8Array`. Hover, click-through and HitArea resolution all read that CPU mask — **zero GPU sync on the mouse path**, and a 1–2-frame-stale silhouette is invisible for hit testing. Force an immediate readback on motion start and window resize. Fallback ladder: (1) async mask; (2) if `fenceSync` is unavailable, synchronous `readPixels` of a **9×9** region at the cursor, throttled and on `pointermove` only; (3) `isHit` bboxes (the Phase 1 behaviour). Adopt AIRI's asymmetry to kill `setIgnoreMouseEvents` thrash: **enter** on exact-pixel alpha ≥ 10, **leave** only when a 5 px radius is fully transparent. Emit IPC only on boolean flips, and skip re-evaluation if the cursor moved < 2 px.

**Zones, given Haru has only Head/Body.** Alpha decides *on-model / off-model*; zones are normalized rectangles in model space resolved with `_modelMatrix.invertTransformX/Y` exactly as `isHit` does. Compute the `Head` and `Body` drawable bboxes once per frame from `getDrawableVertices`, then: **head** = top 45 % of the Head bbox, **face** = bottom 55 % of it, **body** = Body bbox minus Head bbox, **ticklish** = x ∈ [0.30, 0.70], y ∈ [0.55, 0.80] of the Body bbox. For Hiyori (Body only), synthesize a head bbox as the top 30 % of the model bbox. Put the rects in per-model JSON so tuning needs no code, and normalize `Head` / `HitAreaHead` / `头` before lookup.

**Physics constants to start from.** Fixed **1/60 s** substeps with Fiedler's accumulator (2 substeps per 30 Hz frame), `frameTime` clamped to 0.25 s, semi-implicit Euler, render-interpolated by `alpha = accumulator/dt`. **g = 1250 px/s²**; `vy *= exp(-2.63·dt)`, `vx *= exp(-1.28·dt)` → terminal fall ≈ 475 px/s. Release velocity from the last 4 pointer samples as Δpos/Δt with **EMA α = 0.5** (Shimeji's rule, and D8 already specifies 4 samples), clamped to **2500 px/s**. Floor restitution **0.45**, walls **0.35**, ×0.8 per bounce, stop below **60 px/s**. Floor = `screen.getDisplayMatching(bounds).workArea` bottom. Drag follow: critically damped spring **k = 170, c = 26, m = 1** (≈360 ms settle); lean from the lag vector — `ParamAngleZ = clamp(lagX/120,−1,1)·22`, `ParamBodyAngleZ = ·8`, `ParamAngleX = ·30`. Dangle sway retimed frame-rate-independently: `sway += (target−sway)·(1−exp(−3.5·dt)); sway *= exp(−1.7·dt)`. **Landing squash**: `s = clamp(impactSpeed/1200,0,1)·0.18` via `CubismModelMatrix.scaleRelative(1+s/2, 1−s)` plus a compensating `translateY` so the feet stay planted — **90 ms compress (ease-out) + 160 ms recover with ≈4 % overshoot**, inside NN/g's 100–400 ms band and under the 300 ms expression budget. Tap motion fade-in **100 ms** (≤120 ms budget, at NN/g's "instantaneous" line).

**Not floaty at 30 Hz:** physics never runs at 30 Hz — it runs at fixed 60 Hz substeps regardless of render rate (six floats, free). Bump the ticker to 60 Hz on `pointerdown` and hold until at rest 500 ms. Apply the pointerdown acknowledgement with **zero fade** on the same frame; ease only the return.

**Rapid-tap (≥7 in 1 s):** no published precedent was found in Shimeji, VPet, Tamagotchi or Nintendogs — **this is original design**. Implement as an 8-slot ring buffer of timestamps, trigger when `now − buf[i−6] < 1000`, then a 3–5 s cooldown that also suppresses normal tap motions.

---

## 5. Gaze and real-clock rhythms (D2, D3, D4, D5)

### References

| # | Source | URL |
|---|---|---|
| 5.1 | Bentivoglio et al. (1997), *Analysis of blink rate patterns in normal subjects*, Mov Disord 12(6):1028–34 | https://pubmed.ncbi.nlm.nih.gov/9399231/ |
| 5.2 | Doughty (2002), *Gender- and blink-pattern-related differences in spontaneous eyeblink activity* | https://doi.org/10.1097/00006324-200207000-00013 |
| 5.3 | Sheppard & Wolffsohn (2018), *Digital eye strain*, BMJ Open Ophthalmol 3:e000146 (open access) | https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6020759/fullTextXML |
| 5.4 | Sidenmark & Gellersen (2019), *Eye, Head and Torso Coordination During Gaze Shifts in VR*, ACM TOCHI | https://doi.org/10.1145/3361218 |
| 5.5 | Pejša, Andrist, Gleicher & Mutlu (2015), *Gaze and Attention Management for ECAs*, ACM TiiS 5(1) | https://doi.org/10.1145/2724731 |
| 5.6 | Ho, Foulsham & Kingstone (2015), *Speaking and Listening with the Eyes*, PLoS ONE (open) | https://doi.org/10.1371/journal.pone.0136905 |
| 5.7 | Ruhland et al. (2015), *A Review of Eye Gaze in Virtual Agents*, CGF 34(6) | https://doi.org/10.1111/cgf.12603 |
| 5.8 | Live2D `CubismEyeBlink` / sample `setupBreath()` (source-read) | https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/effect/cubismeyeblink.ts |
| 5.9 | Bulbapedia — Pokémon time-of-day buckets and clock-change penalties | https://bulbapedia.bulbagarden.net/wiki/Time |

### Numbers worth copying

**Blink.** (5.1), N = 150: **rest 17 blinks/min, conversation 26, reading 4.5**; conversation > rest > reading in 67.3 % of subjects. (5.2): spontaneous rate **10.3 ± 3.1/min**, **inter-eyeblink interval 6.4 ± 2.4 s** — note SD/mean ≈ 0.375, jitter scales with the mean. (5.3), verbatim: *"Patel et al reported a mean rate of **18.4 blinks/min before computer use, decreasing to 3.6 blinks/min** during operation"*; *"Tsubota and Nakamori observed a mean rate of **22 blinks/min**… reducing to **seven blinks/min** when viewing an electronic display."*

**Gaze shifts and head/eye coordination (5.4**, 7,600 gaze shifts, 20 participants, 5°–100°**).** Eyes rarely rotate beyond **30° relative to the head**; neck 80–90° horizontal. **Shifts under 20° are almost entirely eye movement** — eyes perform **>90 % of the shift at ≤25°**, falling to 30–35 % at 100°; head contributes **<10 %** at small amplitudes, up to 60 % at 100°. **Eyes lead, head follows**: head onset relative to eye onset peaks at **~100–200 ms** for in-FOV targets, ~0–50 ms beyond view; one cited study measured an **average 58 ms** delay with mean gaze **14 ± 12°** relative to head orientation. **VOR counter-roll is explicit**: *"the head will typically continue to move while the eyes fixate the target by performing compensatory eye movement in the opposite direction."* Torso lags head by **~550 ms**. Crucially for graphics, (5.4) states the animation literature renders gaze **eyes-only below a 10–15° threshold** (citing 5.5) — the single most transferable number here.

**Turn-taking (5.6):** partner speech lags gaze onset by **423 ms (SD 388)** / **432 ms (SD 557)**; own direct gaze lags own speech onset by **780 ms (SD 923)** / **736 ms (SD 724)**. Speakers **avert gaze when starting a turn and return direct gaze to end it.** Mean spacing between gaze events **1574 ms / 2272 ms**.

**Cubism defaults, source-verified (5.8).** `CubismEyeBlink`: `_blinkingIntervalSeconds = 4.0`, `_closingSeconds = 0.1`, `_closedSeconds = 0.05`, `_openingSeconds = 0.15` — total blink **300 ms**. **Critical gotcha** in `determinNextBlinkingTiming()`:

```ts
return this._userTimeSeconds + r * (2.0 * this._blinkingIntervalSeconds - 1.0);   // r = Math.random()
```

That is **uniform on [0, 7.0) s, mean 3.5 s** — not 4 s — and it can return near-zero (visible double-blinks) or 7 s gaps. **Do not inherit it.**

`CubismBreath` has **no built-in defaults**; the sample sets them in `setupBreath()` (offset, peak, cycle s, weight): ParamAngleX 0/15/**6.5345**/0.5 · ParamAngleY 0/8/**3.5345**/0.5 · ParamAngleZ 0/10/**5.5345**/0.5 · ParamBodyAngleX 0/4/**15.5345**/0.5 · ParamBreath 0.5/0.5/**3.2345**/1.0. The deliberately incommensurable periods are the trick — the composite never visibly repeats. **Copy the periods, not just the shape; do not round them.**

**Time-of-day precedent (5.9).** Pokémon Gen VI: morning 04:00–10:59 / day 11:00–17:59 / evening 18:00–20:59 / night 21:00–03:59. **DST gotcha with teeth:** Gen IV/VI apply a **24-hour penalty** if the console clock changes (time-based events suppressed); Gen II blocks the DST toggle when it would change the current day. VPet has a `dayTime` enum (1 Morning, 2 Afternoon, 4 Night, 8 Midnight) conditioning dialogue, but **no automatic real-clock sleep trigger**.

### What to avoid, with evidence

1. **Don't inherit `CubismEyeBlink`'s uniform [0,7) timing** — double-blinks and 7-second stares (5.8).
2. **Don't blink at a "rest" rate while the user is working** — (5.1)/(5.3) put screen-focused humans at **3.6–7/min**; 17/min next to a coding session reads as agitated.
3. **Don't move the head on every gaze shift** — under 10–15° it's eyes-only (5.4/5.5); head+eyes in lockstep is the "puppet on a stick" tell.
4. **Don't let eyes and head arrive together** — eyes lead 58–200 ms, head over-travels while eyes counter-roll; omitting VOR is the "dead eyes" tell (5.4).
5. **Never constant-stare** — (5.6) shows gaze is systematically broken at turn boundaries.
6. **Never derive day/night from a cached timestamp** — Pokémon's 24 h penalty exists because RTC drift/DST breaks naive schedulers (5.9).

### Recommendation

**Four-state gaze machine: `FOLLOW → SACCADE_BREAK → REST_DRIFT → SLEEP`.** In `FOLLOW`, keep the critically-damped ~250 ms ease but **split channels by amplitude**: map cursor error below ≈12° equivalent to `ParamEyeBallX/Y` only (the 10–15° eyes-only threshold); above that, feed `ParamAngleX/Y` with a **60–150 ms delay** behind the eyes, let the head reach only ~60–70 % of the residual, then **counter-roll the eyeballs back toward centre by the head's over-travel** — that VOR recentring is what sells it. Cap head 30° / eyes 1.0 / body 10° per D3, and add `ParamBodyAngleX` at ~1/5 head amplitude with a further ~400–550 ms lag.

**Make the 8–20 s break organic, not metronomic.** Do not use `uniform(8,20)`. Sample from a **gamma/lognormal with mean 13 s, SD 4 s, clamped to [8,20]** — right-skewed, clustering around 10–12 s with occasional long holds, matching the measured IEBI spread. Then pick the break *type* by weighted draw: **60 % look-away-and-back** (offset 15–35° in a random direction, hold `lognormal(mean 900 ms, SD 400 ms)`, return with a *faster* ≈150 ms ease because return saccades to a known target are ballistic), **25 % micro-fidget** (±3–5° on ParamAngleZ + ParamBodyAngleX over ~600 ms, no eye change), **15 % double-glance** (two 200 ms hops). Suppress a break if one fired < 4 s ago. Randomising the *type* matters more than the period — metronomic feel comes from a single repeated gesture.

**Blink: reconcile D2 with the literature by making it a state variable.** D2's "mean 4 s ± 1.5 s" is 15 blinks/min — that matches *rest* (17/min) but is ≈3× too fast for a user staring at a screen (3.6–7/min). Keep **FOLLOW mean 4.0 s (σ 1.5)** as specified, but use **REST_DRIFT mean 6.5 s (σ 2.4)** — the measured IEBI — and **no blinks in SLEEP**. Sample lognormal, floor the interval at 1.2 s to kill double-blinks, and add a **12 % chance of a blink doublet** (two blinks 250–400 ms apart); real blinking clusters and the doublet is a strong liveness cue. Use the SDK's 0.10/0.05/0.15 envelope, lengthening closed-time to ≈0.25 s when sleepy. Breath and physics stay always-on independent layers on the incommensurable periods.

**Day/night table (defaults, all configurable):** Morning **06:00–10:59** (greeting once per calendar date, tracked by local `YYYY-MM-DD`, not elapsed hours), Day **11:00–17:59**, Evening **18:00–21:59** (slower saccades, ×1.3 blink interval), Night **22:00–05:59** (yawn on entry, sleepy pose, ×2 blink interval, **no proactive requests**). Meal cues 08:00 / 12:30 / 19:00 ±30 min jitter, at most once per window per day. **Recompute the bucket from `new Date()` every tick and store last-fired markers as local date strings** — that alone immunises against DST and time-zone travel.

**Absence and return.** Poll `powerMonitor.getSystemIdleTime()` at 1 Hz in main; ≥300 s → nap. **D5's "notices within 1 s" is then free**: the same 1 Hz tick that sees idle drop to 0 queues a startle — snap head/eyes to the cursor with a shortened ≈120 ms ease plus a blink — before resuming `FOLLOW`.

---

## 6. Activity reactions without key logging (D11, X14)

### References

| # | Source | URL |
|---|---|---|
| 6.1 | `GetLastInputInfo` / `LASTINPUTINFO` | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo |
| 6.2 | `RAWINPUTDEVICE` / `RAWKEYBOARD` (RIDEV_INPUTSINK) | https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawinputdevice |
| 6.3 | `LowLevelKeyboardProc` / `SetWindowsHookExW` | https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc |
| 6.4 | `SHQueryUserNotificationState` / `QUERY_USER_NOTIFICATION_STATE` | https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state |
| 6.5 | UI Automation threading / caching / security | https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading |
| 6.6 | `SetWinEventHook` + event constants | https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook |
| 6.7 | Electron `powerMonitor` | https://www.electronjs.org/docs/latest/api/power-monitor |
| 6.8 | uiohook-napi #58 "False positive malware" | https://github.com/SnosMe/uiohook-napi/issues/58 |
| 6.9 | RescueTime privacy policy · ActivityWatch | https://www.rescuetime.com/privacy · https://activitywatch.net/ |

### Numbers and API facts worth copying

**`GetLastInputInfo` (6.1)** returns `LASTINPUTINFO { cbSize, dwTime }` — a `GetTickCount` value with **49.7-day wraparound**. Microsoft is explicit that it *"does not provide system-wide user input information across all running sessions… [only] the session that invoked the function"* and that the tick *"is not guaranteed to be incremental"* (`SendInput` supplies its own). **It does not distinguish keyboard from mouse.** Chromium's `ui/base/idle/idle_win.cc` implements `CalculateIdleTime()` with exactly this plus explicit wraparound handling, and gets lock state from `WTS_SESSION_LOCK`/`UNLOCK` — so **`powerMonitor.getSystemIdleTime()` costs one user32 call and nothing else.**

**Electron `powerMonitor` (6.7)**, verified: events `suspend`, `resume`, `on-ac`, `on-battery`, `lock-screen`, `unlock-screen`, `speed-limit-change` (all macOS + Windows); methods `getSystemIdleState(threshold)` → `active|idle|locked|unknown`, `getSystemIdleTime()` → **seconds**, `isOnBatteryPower()`. **`shutdown` is Linux/macOS only — do not wire it on Windows.** Electron exposes **no battery percentage**; use `navigator.getBattery()` in a renderer (still present in Blink: `third_party/blink/renderer/modules/battery/navigator_battery.idl`) or Win32 `GetSystemPowerStatus` → `SYSTEM_POWER_STATUS { ACLineStatus, BatteryFlag (1 High>66 %, 2 Low<33 %, 4 Critical<5 %, 8 Charging), BatteryLifePercent, SystemStatusFlag }`. Also note **`GUID_SESSION_USER_PRESENCE`** (PowerUserPresent=0 / NotPresent=1 / Inactive=2) — a presence signal with zero input interception.

**`SHQueryUserNotificationState` (6.4)** values: `QUNS_NOT_PRESENT=1` (screensaver, **locked**, or inactive FUS session), `QUNS_BUSY=2` (fullscreen app **or** presentation settings), `QUNS_RUNNING_D3D_FULL_SCREEN=3`, `QUNS_PRESENTATION_MODE=4`, `QUNS_ACCEPTS_NOTIFICATIONS=5`, `QUNS_QUIET_TIME=6`, `QUNS_APP=7`. Microsoft's guidance: show notification-like UI **only** on `QUNS_ACCEPTS_NOTIFICATIONS`. Caveat, verbatim: *"there are no notifications sent when the user starts or stops a full-screen application"* — you must poll. **PowerToys ships exactly this pattern** (`WindowHelper.GetUserNotificationState`, `_ignoreHotKeyWhenFullScreen`/`_ignoreHotKeyWhenBusy`) and maintains a "KnownTriggerApps" list because **`QUNS_BUSY` false-positives on things like the NVIDIA overlay**.

**⚠️ There is still no documented, supported API for Windows 11 Focus Assist / DND state.** `NotificationSetting` is per-app enablement only; `UserNotificationListener` reads *other apps'* notifications and requires a capability + `RequestAccessAsync()` — massively over-privileged. PowerToys contains no WNF-based detection. Use `QUNS_BUSY` as an approximate DND proxy and say so. `QUNS_QUIET_TIME` is documented as *"the first hour after a new user logs in for the first time"* — **not** Focus Assist.

**Module survey (npm, queried 2026-08-29):** `get-windows` 9.3.0 (2026-03-08) uses `GetForegroundWindow` → `GetWindowThreadProcessId` → `QueryFullProcessImageNameW`, returns title, bounds, contentBounds, owner{name,processId,path} — **use it, discard the title**. `uiohook-napi` 1.5.5 uses `WH_KEYBOARD_LL`/`WH_MOUSE_LL` and exposes keycodes. `node-global-key-listener` spawns `WinKeyServer.exe` and streams `vkCode` — **repo archived, README itself warns of AV**. `active-win` superseded; `node-window-manager` (2020) and `iohook` (2021) dead.

### What to avoid, with evidence

- **Any global keyboard hook.** [uiohook-napi #58](https://github.com/SnosMe/uiohook-napi/issues/58) (open, 2026-03-14): *"Windows Keeps thinking that my electron app installer exe is a malware whenever i add these global listener libraries like iohook… without signing or whatever"* — an unsigned Electron NSIS installer, i.e. exactly this project's configuration. Baseline SmartScreen/AV pain for unsigned NSIS is already documented (electron-builder [#6334](https://github.com/electron-userland/electron-builder/issues/6334), [#8764](https://github.com/electron-userland/electron-builder/issues/8764)); a global hook stacks a categorically worse detection on top.
- **`RIDEV_INPUTSINK` raw input** — the docs confirm it delivers `VKey` system-wide and requires an `hwndTarget`; it is a keylogger-capable channel. Also *"Only one window per raw input device class may be registered… within a process"* and it *"should not be used from a library."*
- **`WH_KEYBOARD_LL`** — global-only, must complete within `LowLevelHooksTimeout` (capped 1000 ms since Win10 1709), and *"the hook is silently removed without being called. There is no way for the application to know whether the hook is removed."* Microsoft itself says *"in most cases… it should monitor raw input instead."*
- **`GetAsyncKeyState` polling** — a keylogger by construction.
- **Window titles.** They contain document names, URLs and chat contents. ActivityWatch ships `--exclude-title`; RescueTime's policy enumerates what it stores and adds *"We do not (and never will) collect keystrokes, form input, screenshots, window or page body content."* ManicTime's policy addresses neither — do not model on it.
- **UI Automation as a "password field" guarantee.** All calls must come from a non-UI **MTA** thread or *"conflicts can lead to very slow performance, or even cause the application to stop responding"*; uncached property reads are cross-process per property; and a medium-IL app **cannot** read UI of elevated processes without a signed `uiAccess="true"` binary in Program Files — so `IsPassword` is silently unavailable for any elevated app. **That breaks password-field masking as a guarantee.** (`UIA_IsPasswordPropertyId` = 30019, `UIA_ControlTypePropertyId` = 30003, `UIA_HasKeyboardFocusPropertyId` = 30008 are verified; **`UIA_IsTextPatternAvailablePropertyId`'s numeric value is UNVERIFIED** — do not hardcode it.)

### Recommendation

**Ship a no-consent default tier that needs no native code beyond `get-windows`, installs no hooks, and reads no input content:**

1. `powerMonitor.getSystemIdleTime()` polled at **1 Hz** (one `GetLastInputInfo` call — free against the 4 % budget).
2. `powerMonitor` events: `suspend`, `resume`, `lock-screen`, `unlock-screen`, `on-ac`, `on-battery`; plus `navigator.getBattery()` for level/charging.
3. `screen.getCursorScreenPoint()` sampled alongside (1) to separate pointer from non-pointer input.
4. `SHQueryUserNotificationState` via a small N-API/FFI shim polled at **0.2 Hz**; speak only on `QUNS_ACCEPTS_NOTIFICATIONS`. That one call covers §0's fullscreen, presentation, locked and (approximately) DND suppression.
5. Foreground-window **bounds only** via `get-windows`, ≤ every 2 s, to catch borderless fullscreen that (4) misses — **read `bounds`, drop `title` and `owner.path` before the value reaches any store.**

**Opt-in tier**: one dialog, two independent toggles, each with a persistent visible indicator and individually revocable — (a) process name only, never titles; (b) typing cadence counters. **Never ship** low-level hooks, `GetAsyncKeyState`, raw-input sinks, window titles, or any title-derived text sent to DeepSeek.

**The typing-streak algorithm, computable entirely from the no-consent tier.** Sample every 1000 ms: `idle = getSystemIdleTime()`, `p = getCursorScreenPoint()`. **Active tick** if `idle <= 1`; **keyboard-ish tick** if active AND `|p − p_prev| < 3 px`; **pointer tick** if active AND the cursor moved. A **streak** is a run of keyboard-ish ticks surviving up to **3 consecutive non-keyboard-ish ticks**. Store only `{streakStartMs, lastTickMs, kbTickCount}`. **Glance (D11)** fires on the 0→3 s edge, rate-limited to one per 60 s. **Cheer** requires streak ≥ **300 s** with `kbTickCount / streakSeconds ≥ 0.7`, once per streak, ≥15 min apart — and fires on the **falling edge**, ≈5 s after typing stops, never during (§0). This delivers all of D11's typing behaviours from an input surface that is honestly describable in one plain-Chinese sentence for X14: *"只知道『距离上次有人动过键盘或鼠标过了多少秒』，以及鼠标有没有移动。"*

---

## 7. Memory tiers (spec §6, A11, A14, X4)

> The assigned researcher returned only a late addendum; the core of this section is **first-hand empirical work on this machine**, which is stronger evidence for the load-bearing question than any survey would have been.

### Empirical findings (verified — commands and output)

Run under the installed **Node v24.17.0** (`packages/memory` already uses `node:sqlite`; `apps/desktop` pins Electron 43.4.1):

```
sqliteVersion : 3.53.0
fts5          : OK            trigram : OK          porter : OK
bm25()        : OK (negative scores, ORDER BY ascending = best first)
fts5vocab     : OK
loadExtension : function (requires { allowExtension: true })
vec0          : ERR no such module: vec0        ← no sqlite-vec
```

**Finding 1 — the spec's `tokenize='trigram'` plan is broken for Chinese.** The FTS5 docs state it verbatim: *"Substrings consisting of fewer than 3 unicode characters do not match any rows when used with a full-text query."* Measured on real sentences:

| Query | trigram result |
|---|---|
| `面试` | **[] (no match)** |
| `医院` | **[]** |
| `出差` | **[]** |
| `面试通` | hit |
| `今天面试` | hit |

Two-character words are the dominant word length in Chinese. **`tokenize='trigram'` in spec §6 must be replaced.** (LIKE `%面试%` does work on a trigram table — but that is a scan, not a ranked search, and gives no `bm25()`.)

**Finding 2 — `unicode61` is worse.** `fts5vocab` shows it tokenises an entire CJK run as **one token**: the vocabulary for four sentences was literally `我今天面试通过了好开心`, `明天要去医院复查身体`, … Only an exact full-string match works; even `面试*` fails because the token starts with 我.

**Finding 3 — pre-segmented text + `unicode61` works perfectly.** Indexing `我 今天 面试 通过 了 好 开心` yields a clean vocabulary and correct ranked retrieval for `面试`, `医院`, `米饭`, `复查`, `出差 上海`, `面试 OR 医院`.

**Finding 4 — a dependency-free unigram+bigram expansion index reproduces that without jieba.** Indexing `我 我今 今 今天 天 天面 面 面试 试 …` and querying with the query's bigrams matched `面试`, `医院`, `出差`, `米饭` correctly. This avoids a native module (`@node-rs/jieba`/`nodejieba`) entirely — which matters given §6's AV/prebuild findings and Electron ABI churn.

**Finding 5 — the paraphrase problem, and a measured fix.** Plain bigram matching is literal: `我腰疼` failed to retrieve `主人最近腰不太好，久坐会痛` (the bigram 腰疼 is absent). Adding **(a) an `alias` column of keywords written by the extraction model**, weighted `bm25(f, 1.0, 2.0)`, and **(b) a two-pass fallback** (bigrams first; if zero rows, retry with unigrams minus a stopword set) gave **recall@3 = 10/10** on paraphrased probes:

```
HIT  Q=我腰疼        → 主人最近腰不太好，久坐会痛
HIT  Q=最近有运动吗    → 主人周末常去健身房
HIT  Q=你还记得我妈住哪吗 → 主人的妈妈住在杭州
HIT  Q=咖啡          → 主人喜欢喝冰美式
HIT  Q=我不吃那个绿色的菜 → 主人不喜欢吃香菜
HIT  Q=考试准备得如何   → 主人在准备考研，专业是计算机
recall@3 = 10/10
```

**Honest caveat:** 11 facts, 10 probes, aliases hand-written to be good. This demonstrates the *mechanism* works; it does **not** establish A11's ≥90 % at scale. The alias quality becomes the extraction prompt's job, and that is where it can fail.

Scoring used: `score = (−bm25) × (0.5 + importance/10) × 0.995^hours` — the spec's shape, confirmed workable. FTS5's `bm25()` is hard-coded **k1 = 1.2, b = 0.75**, and column weights are trailing real arguments.

### References

| # | Source | URL |
|---|---|---|
| 7.1 | SQLite FTS5 — trigram rule, bm25, tokenizers, fts5vocab | https://www.sqlite.org/fts5.html |
| 7.2 | Node.js `node:sqlite` — status, `DatabaseSync`, `allowExtension` | https://nodejs.org/api/sqlite.html |
| 7.3 | SillyTavern World Info / lorebooks | https://docs.sillytavern.app/usage/core-concepts/worldinfo/ |
| 7.4 | Park et al., *Generative Agents*, arXiv 2304.03442 | https://arxiv.org/abs/2304.03442 |
| 7.5 | mem0 #4573 — production memory-quality audit | https://github.com/mem0ai/mem0/issues/4573 |
| 7.6 | *The Sleeping Agent* — summaries drop temporal detail | https://arxiv.org/abs/2608.11775 |
| 7.7 | *Total Recall at What Cost?* — memory systems vs full context | https://arxiv.org/abs/2608.11879 |
| 7.8 | MINJA / CrAIBench — memory-injection attack class | https://arxiv.org/abs/2503.03704 · https://arxiv.org/abs/2503.16248 |
| 7.9 | Letta — benchmarking agent memory | https://www.letta.com/blog/benchmarking-ai-agent-memory |

**`node:sqlite` status (7.2)**: **Stability 1.2 — Release candidate**; added v22.5.0, no longer behind `--experimental-sqlite` since v23.4.0/v22.13.0, RC as of v25.7.0. `allowExtension` defaults to **`false`**. The docs **do not state** which compile-time options are included — hence the empirical probe above, which is now the authority for this project.

**SillyTavern World Info (7.3)** — the UX vocabulary a 猫娘/桌宠 audience expects: primary keys (case-insensitive, regex-capable), secondary keys with AND ANY / AND ALL / NOT ANY / NOT ALL, **🔵 constant vs 🟢 keyword-triggered vs 🔗 vector**, numeric **insertion order** (higher inserts later), positions including before/after character definitions and **"@ D" depth-N with a role (system/user/assistant)**, **scan depth** (0 = recursion + A/N only, 1 = last message), a token budget as "Context %" or absolute, recursion with max steps, and inclusion groups with **group weight default 100**. Note how closely "@ D depth with role" matches §0's ruling to place facts in the **latest user message**.

### What to avoid, with evidence

- **Indiscriminate extraction.** (7.5) audited **10,134 production mem0 entries: 97.8 % junk** — 52.7 % was the system prompt/boot file restated as "facts" (one preference stored 200+ times), 11.5 % cron/heartbeat noise, 7.4 % transient task state, 5.2 % hallucinated profiles, 2.1 % privacy leaks; one hallucination existed in 668 copies. Swapping a small model for a frontier one *worsened* the ratio to 89.6 %: *"A better model follows the extraction prompt more faithfully, which means it extracts more indiscriminately. **The extraction prompt is the bottleneck, not the model.**"* (n = 1, self-reported.) Related: [#7123](https://github.com/mem0ai/mem0/issues/7123) — dedup with no similarity threshold produced 8 near-identical memories in an hour; [#5428](https://github.com/mem0ai/mem0/issues/5428) — hitting `max_tokens` mid-JSON silently drops **every** fact.
- **Summaries that eat the dates.** (7.6): compressed summaries score far below full context on **temporal** questions because the summariser *"preserves relational and event structure while discarding dates and times."* A one-line prompt fix moved temporal-expression preservation **3.05 % → 62.39 %**.
- **Believing retrieval beats context.** (7.7) benchmarked Mem0/Hindsight/Mastra against a rolling window and full transcript over 400 turns: memory-system accuracy **21–54 %**, with cost break-even ranging *"from the first tens of turns … to never within 400 turns."* The honest reading: the ≤5-facts design is justified by **DeepSeek cache economics and distractor avoidance**, not by recall superiority. A11's ≥90 % is above what these benchmarks report for any general system — it is reachable here only because the fact set is small, importance-tagged, and user-pinnable.
- **Memory as an instruction channel.** (7.8): models are *"significantly more vulnerable to memory injection compared to prompt injection"*; Letta [#3388](https://github.com/letta-ai/letta/issues/3388) documents core-memory poisoning leaking across sessions.

### Recommendation

**Replace `tokenize='trigram'` with a bigram-expansion FTS5 table plus an alias column** — schema v2 is purely additive to the existing `facts` table (which already has `ts`, `text`, `importance`, `source_turn_id`):

```sql
ALTER TABLE facts ADD COLUMN alias      TEXT NOT NULL DEFAULT '';
ALTER TABLE facts ADD COLUMN valid_at   INTEGER;          -- resolved absolute date
ALTER TABLE facts ADD COLUMN superseded_by INTEGER;       -- never delete, supersede
ALTER TABLE facts ADD COLUMN pinned     INTEGER NOT NULL DEFAULT 0;
CREATE VIRTUAL TABLE facts_fts USING fts5(body, alias, tokenize='unicode61');
```

Write `expand(text)` into `body` and `expand(alias) + alias` into `alias` on insert. Retrieve with `bm25(facts_fts, 1.0, 2.0)`, two passes (bigram → unigram-minus-stopwords), then rank by `(−bm25) × (0.5 + importance/10) × 0.995^hours`, pinned facts first, take **≤5**. **Keep everything in the latest user message** (§0), never in the system prefix — that is what preserves the ≥70 % cache-hit target, and it is exactly SillyTavern's "@ D depth 0" placement.

**The extraction call is where quality is won or lost.** Run it in the existing consolidation pass (once/day at first idle after 03:00, or on quit if >20 new turns), one non-streaming `deepseek-v4-flash` call. Three rules follow directly from (7.5): **(a) feed only the user's new messages since last consolidation** — never the persona, never the injected `<记忆>` block, never the assistant's own turns; that single rule removes >50 % of the observed junk and closes the feedback loop where a retrieved memory is re-extracted as new. **(b) Set `max_tokens` well above three facts (~400) and treat truncated JSON as "extract nothing", never partial.** (c) Emit **0–3** facts max, each a **third-person declarative about the user** (`主人…`), with `importance` 1–10 and **an alias list of 3–6 keywords/synonyms** — the aliases are what buy paraphrase robustness, per the measurement above. Reject imperatives and instructions at parse time. Resolve every relative date to an absolute one at extraction (7.6): store `下周三` as a real date in `valid_at` and keep the phrase only in the text.

**Contradictions: supersede, never delete** (Graphiti's interval logic, verified from `edge_operations.py`: on overlap with `edge.valid_at < new.valid_at`, set `invalid_at`/`expired_at`; nothing is removed). Set `superseded_by` and exclude superseded rows from retrieval by default — this keeps 以前喜欢拿铁 answerable. Dedup before insert with a **jieba-free token Jaccard ≥ 0.6** against the last ~50 episodes (7.5 #7123).

**Summary tier:** keep the trim-event cadence, and put the (7.6) instruction literally in the prompt — 保留所有日期、时间和相对时间. Cap at ≤600 tokens per §0.

**「记住这个 / 忘掉这个」 (X4)** map to direct writes, not to the LLM: 记住这个 inserts the preceding turn's content as a fact with `importance = 9, pinned = 1`; 忘掉这个 sets `superseded_by = -1` on the top retrieved fact and shows which one was forgotten. The 记忆 tab lists `facts` with edit/delete/export. **Never let a fact rewrite `core_memory.persona`** — consolidation may touch only `human` and `relationship` — and frame the injected block as data (`你记得的事`), never as instructions (7.8).

---

## 8. LLM behaviour arbitration (D14)

### References

| # | Source | URL |
|---|---|---|
| 8.1 | Convai — Actions API, action list, Move To failure taxonomy | https://docs.convai.com/api-docs/welcome |
| 8.2 | NVIDIA ACE — `animation-graph-microservice`, Audio2Emotion smoothing | https://github.com/NVIDIA/ACE · https://developer.nvidia.com/ace |
| 8.3 | Project AIRI — `<\|ACT …\|>` grammar, `useLlmmarkerParser` | https://github.com/moeru-ai/airi |
| 8.4 | Open-LLM-VTuber-Web — priority mapping; issue #332 on expression hold | https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/issues/332 |
| 8.5 | AITuberKit — tag carry-over + reset on queue drain; issues #224/#233/#197 | https://github.com/tegnike/aituber-kit/issues/233 |
| 8.6 | Greta (SEMAINE lineage) — `FaceSignal.schedule()` ADSR timings | https://github.com/isir/greta |
| 8.7 | Cubism motion priority (source) + SDK manual | https://github.com/Live2D/CubismUnityComponents/blob/develop/Assets/Live2D/Cubism/Framework/Motion/CubismMotionPriority.cs · https://docs.live2d.com/en/cubism-sdk-manual/motion/ |
| 8.8 | Unity animation layers · Unreal animation slots | https://docs.unity3d.com/Manual/AnimationLayers.html · https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-slots-in-unreal-engine |
| 8.9 | DeepSeek strict tool schemas (`/beta`) | https://api-docs.deepseek.com/guides/tool_calls |

### Numbers and mechanics worth copying

**Convai (8.1)** is the strongest prior art for a bounded vocabulary. The action set is declared **before the session opens** (`actionConfig.actions[]` plus named `objects[]`/`characters[]`) and is *"fixed for the session — adding/removing actions at runtime only affects the next session."* Actions return as **structured JSON on a parallel lane to speech**, not inline in prose. A new response **keeps the first (running) action and replaces only the queued remainder** — copy that. Timings: per-action `FadeInSeconds`/`FadeOutSeconds`, authored `HoldSeconds`, and `ActionWaitForBotSpeechTimeoutSec` **default 2.0 s**. Spatial commands are **validated, not trusted**: `Move To` returns typed codes `Unknown Destination`, `Unreachable`, `Move Failed`, `Reached`, `Already At Destination`. **But its unknown-action behaviour is an anti-pattern**: no handler → not invoked → the queue *stalls*.

**NVIDIA ACE (8.2)** is the best architectural analogue: animation is split into **typed channels** (`posture`, `gesture`, `facial_gesture`, `position`), each with a **`default_clip_id`** fallback and long-running states as `duration: -1`; external logic never plays a clip, it calls `UpdateAnimationGraphVariable` and the graph decides. Audio2Emotion output is **smoothed, never applied raw**: `live_blend_coef` (temporal smoothing), `emotion_contrast`, `emotion_strength` (global scale vs neutral), `max_emotions` (cap on simultaneous sliders), `preferred_emotion_strength`. **⚠️ "Project Mockingbird" could not be found anywhere — not on developer.nvidia.com/ace, the NVIDIA blog, or general results. Do not cite it.** **⚠️ Inworld has pivoted**: the site now sells Realtime TTS/STT/API/Inference/Router/Compute with **no mention of the character engine, Studio, Goals/Actions, emotions or Triggers**; docs are behind a login and the Unity/Unreal SDKs are gone from the org. Treat its old emotion model as historical.

**Cubism, source-verified (8.7):** `PriorityNone=0, PriorityIdle=1, PriorityNormal=2, PriorityForce=3`, and `PlayAnimation` rejects when `(_motionPriorities[layer] >= priority) && (priority != PriorityForce)` — **equal priority is rejected**, so two Normal requests cannot chain. The manual is blunt: *"Denial of playback by priority must be done outside of CubismMotionManager."* Fade defaults: `motion3.json` `Meta.FadeInTime`/`FadeOutTime` **default 1 second** (substituted when `< 0`), `exp3.json` `FadeInTime` **default 1.0**, `CubismExpressionMotion.DefaultFadeTime = 1.0`. **This conflicts with the spec**: tap fade-in ≤120 ms and expression ≤300 ms are 8× and 3× faster than the SDK defaults — they must be set explicitly via `SetFadeInTime`/`SetFadeOutTime` or the JSON Meta. You will not get them for free. **Unreal's montage default is 0.25 s in / 0.25 s out** (verified in `AnimMontage.cpp`: `BlendIn.SetBlendTime(0.25f); BlendOut.SetBlendTime(0.25f);`) — a good anchor for the LLM-motion tier.

**Greta (8.6)** gives the only real number for expression duration: `FaceSignal.schedule()` uses ADSR markers with expected phase durations **0.2 / 0.1 / 0.5 / 0.2 s**, scaled by intensity — a full ECA facial display at intensity 1 is **≈1 second**, not 90.

**Open-source persistence behaviour**: Open-LLM-VTuber-Web maps idle → `PriorityIdle(1)`, LLM "Talk" → `PriorityNormal(2)`, **tap → `PriorityForce(3)`** — already D14's ordering — and calls `resetExpression()` when AI state → IDLE. AITuberKit has the best rule: **tags carry over to following sentences until a new tag, code block, or newline**, and **expression auto-resets when the speak queue drains**. AIRI's parser keeps a marker-safety tail (`minLiteralEmitLength: 1`) so a split marker is never emitted as prose — but **AIRI's Live2D `setMotion` uses `MotionPriority.FORCE` for LLM motions**, so the LLM always beats idle *and* tap, and the Live2D path has **no decay and no priority table**.

### What to avoid, with evidence

- **Unknown tag falling through to the previous expression** — Amica/ChatVRM's `ExpressionController` does this, so a typo'd emotion silently *extends* stale affect. D14's "unknown → neutral, logged" is right.
- **Unknown action stalling the queue** — Convai (8.1).
- **Raw, unclamped intensity** — [airi#590](https://github.com/moeru-ai/airi/issues/590): *"emotions bound on stage-web are too raw. It achieves raw expression, so it smiles too much."* ACE's `emotion_strength` is the missing knob.
- **Holding an expression across many sentences** — [OLV #332](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/issues/332): *"the retained duration is often far too long… some expressions are eyes-closed; talking through two sentences with eyes shut is terrifying."* The user's requested fix is min-play-time **plus** max-hold, scoped to sentences.
- **Not storing tags in history** — [aituber-kit#233](https://github.com/tegnike/aituber-kit/issues/233): *"emotion tags aren't saved in conversation history, so emotion disappears as the conversation continues."* That is prompt-position drift confirmed in a shipping app.
- **Assuming you cannot stream prose from structured output** — this is **false**: `vercel/ai`'s `partialObjectStream` emits growing string values via `parsePartialJson`. The real reasons inline tags still win here are mid-utterance emotion changes, `max_tokens: 300`, and repair-flicker on partial JSON.

### Recommendation

**Map the three sources onto Cubism's native priorities so you never fight the SDK**: `idle → PriorityIdle(1)`, `LLM motion → PriorityNormal(2)`, `tap → PriorityForce(3)`. This gives D14's `tap > LLM > idle` for free, and because Cubism **rejects equal priority**, a second LLM motion arriving mid-motion is automatically dropped — that *is* your min-play-time. On top: LLM motion **min play 800 ms**, **cooldown 1.5 s** per motion group, where a second `ACT` inside the cooldown updates the **expression only** (separate manager, free to change at the 300 ms fade). Tap preempts with **120 ms** fade-in; on tap completion hand back to **idle**, not to the interrupted LLM motion. Set fades explicitly: **0.12 s** tap, **0.25 s** LLM motion (Unreal's montage default), **1.0 s** idle→idle, **0.3 s** expressions.

**Validate and rate-limit the spatial vocabulary.** `look` is cheap and continuous — clamp to a unit vector, accept up to ~4 Hz, and let the gaze controller own it (the LLM sets a *target*, the engine interpolates — ACE's `UpdateAnimationGraphVariable` pattern). `walkTo` is expensive — **at most one in flight, one per 5 s**, snapped to a **named anchor set** (Convai's `objects[].name` model: never free coordinates), returning typed outcomes mirroring Convai's taxonomy. **Drop, don't queue,** a `walkTo` arriving during one. Unknown *emotion* → `neutral` + log (never Amica's fall-through). Unknown *motion* → fall back to the emotion's `motionMap` default group, **not to nothing** (never Convai's stall). Log both with the raw token so grammar compliance is measurable per model version.

**Argue the 90 s expression persistence down to an upper bound.** Greta budgets ≈1 s per facial display; OLV's users call multi-sentence holds "terrifying"; AITuberKit resets on queue drain. Recommend: **full intensity for the utterance + 3 s, then ramp intensity toward neutral over ≈8 s, with 90 s kept in the spec as a never-exceed ceiling.** Cubism expressions blend additively with a weight, so decay is a per-frame weight multiplier, not a re-trigger. Also **clamp incoming `intensity`** — cap the additive weight around 0.6–0.7 for most emotions, 1.0 only for `surprised` — which is precisely what airi#590 is missing.

**Share the manager without fighting.** Give `packages/sim` sole ownership of the Cubism managers and expose one `request(source, intent)` API; the LLM channel never calls `startMotion` directly. The sim holds the arbitration table, cooldowns, decay clock, and a **veto**: if sim state contradicts the proposal (energy 0 with `ACT happy`), keep the emotion but scale intensity by an energy factor and substitute a low-energy motion group — the LLM's *intent* survives, its *amplitude* does not. On API failure or malformed ACT the sim simply receives no request and idle continues; nothing to unwind. Finally, **persist ACT tags into history** (aituber-kit#233) and re-inject the grammar reminder in the latest-user-message position each turn — the same slot the memory block uses.

---

## 9. Evidence gates — recording the pet (D16)

### Empirical findings (verified on this machine)

`ffmpeg version 8.1.2-full_build-www.gyan.dev` is installed at `C:\Users\jiami\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`, built `--enable-d3d11va --enable-d3d12va`. **OBS is not installed.** `ffmpeg -devices` lists `gdigrab`; `ffmpeg -filters` lists **`ddagrab  |->V  Grab Windows Desktop images using Desktop Duplication API`**.

**ddagrab works, verified:**

```bash
ffmpeg -init_hw_device d3d11va \
  -filter_complex "ddagrab=output_idx=0:framerate=30,hwdownload,format=bgra" \
  -t 3 -c:v libx264 -pix_fmt yuv420p dda.mp4
# → width=3840 height=2160 r_frame_rate=30/1 nb_frames=89
```

Content is real, not black: `blackdetect=d=0.1:pic_th=0.98` reported **no black frames**, and per-frame `signalstats` gave `YAVG ≈ 45.89` across frames. **Cropping to a DIP-derived physical rect works**: this display is 3840×2160 physical at **150 % scaling** → 2560×1440 DIP, so **physical = DIP × 1.5**. A 420×720 DIP window at DIP (100,100) is `crop=630:1080:150:150`, which produced a correct 630×1080 stream.

**Layered always-on-top capture — verified by direct experiment.** A second researcher built a `WS_EX_LAYERED`, topmost, borderless, `Opacity=0.85` window with an animated disc and captured it: **both `ddagrab` and `gdigrab -i desktop` captured it identically** (mean RGB `38/14/39` vs `36/15/37` — within 2/255), with desktop text visible through the translucent window. `gdigrab` passes `SRCCOPY|CAPTUREBLT` (`libavdevice/gdigrab.c:629`), and Microsoft documents CAPTUREBLT as *"Includes any windows that are layered on top of your window."* **The transparency caveat is resolved for the desktop-capture route.**

**The black-frame failure was also reproduced.** Against a live GPU-composited Chromium window — exactly the Electron case — via the documented `hwnd=` input:

- `gdigrab -i hwnd=…` → **28,594-byte PNG, visually pure black** (YAVG 16, from one stray caret pixel).
- `gfxcapture=window_title=…` on the *same window, same moment* → **657,658 bytes, full correct content.**

**Never use `gdigrab -i title=` / `hwnd=` on the pet window.**

**An upgrade this ffmpeg makes available: `gfxcapture`.** ffmpeg 8.1.2 ships a **Windows.Graphics.Capture** filter, confirmed present in `-filters` here. Captured against the layered test window it returned the window **isolated at 600×600 in pixel format `rgba`, background genuinely transparent, only the disc opaque** — a per-window capture with *real alpha* that neither gdigrab nor ddagrab can produce. Options include `hwnd`, `window_title`, `capture_cursor`, `premultiplied`, `crop_*`, and **`display_border` defaulting to `false`** (so no yellow WGC recording border). ⚠️ `gfxcapture=hwnd=<decimal>` returned "Invalid argument" in testing; **use the `window_title` regex form**. It does not hold a stable rate, so append an explicit `fps=30`.

**Frame-rate reliability, measured** (cropped 900×1350, libx264 veryfast crf18):

| fps | duration | frames captured | vs nominal |
|---|---|---|---|
| 60 | 10 s | 579 | −3.5 % |
| 60 | 20 s | 1134 | **−5.5 % (deficit grows)** |
| 30 | 20 s | 599 / 600 | −0.2 % |
| **30** | **60 s** | **1799 / 1800** | **−0.06 %** |

**Use 30 fps.** 60 fps drops frames progressively because x264 cannot keep up. ⚠️ **NVENC is not available on this machine**: `h264_nvenc` fails with *"Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0"* (installed driver 591.86, needs ≥610). Do not write NVENC into the script.

**DPI, measured precisely.** A DPI-*unaware* process sees `SM_CXSCREEN` = 2560×1440 and `GetCursorPos` = (1129,741); after `SetProcessDPIAware()` the same cursor reads **(1694,1112)** on a **3840×2160** desktop, with `GetDpiForMonitor` = **144 (150 %)**. `1129 × 1.5 = 1693.5 ≈ 1694`. Electron's `getBounds()` returns DIPs in the 2560×1440 space; **every coordinate needs ×1.5** — or better, use `screen.dipToScreenRect()` rather than multiplying by hand.

### References

| # | Source | URL |
|---|---|---|
| 9.1 | ffmpeg devices — gdigrab (`desktop`, `title=`, `hwnd=`, `draw_mouse`, `offset_x/y`, `video_size`, `show_region`) | https://ffmpeg.org/ffmpeg-devices.html |
| 9.2 | ffmpeg filters — ddagrab (`output_idx`, `draw_mouse`, `framerate`, `video_size`, `offset_x/y`, `output_fmt`, `dup_frames`; needs `-init_hw_device d3d11va`) | https://ffmpeg.org/ffmpeg-filters.html#ddagrab |
| 9.3 | Electron `webContents.capturePage([rect, opts])` → `Promise<NativeImage>`, `stayHidden`, `stayAwake`, `isBeingCaptured()` | https://www.electronjs.org/docs/latest/api/web-contents |
| 9.4 | Electron `desktopCapturer` | https://www.electronjs.org/docs/latest/api/desktop-capturer |
| 9.5 | Windows.Graphics.Capture (per-window capture of GPU-composited content) | https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture |

Note from (9.1): `show_region` *"is incompatible with grabbing the contents of a single window"*, and for multi-monitor negative offsets *"the offset calculation is from the top left corner of the primary monitor"*.

### Recommendation

**Primary route: `ddagrab` on the composited desktop, cropped to the pet's physical-pixel bounds, at 30 fps.** Verified end to end here (1799/1800 frames, duration exactly 60.000000 s, 0.995× realtime), needs no new dependency, and captures what the user actually sees — which is what an evidence gate should assert.

⚠️ **Gotcha that silently wastes a run: `crop` placed *before* `hwdownload` is ignored** (output stays 3840×2160). Crop with ddagrab's own options — which also crops in the DDA stage, so it's cheaper — or after `hwdownload`.

```bash
# PRIMARY — 60 s composited desktop, cropped to the pet, 30 fps
ffmpeg -y -filter_complex \
 "ddagrab=output_idx=0:framerate=30:draw_mouse=1:offset_x=X:offset_y=Y:video_size=WxH,hwdownload,format=bgra" \
 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -t 60 docs/evidence/phase3-idle-60s.mp4

# SECONDARY — isolated pet with REAL ALPHA (ffmpeg 8.1+)
ffmpeg -y -filter_complex \
 "gfxcapture=window_title='(?i)YourPetWindowTitle':capture_cursor=0:display_border=0,hwdownload,format=bgra,fps=30" \
 -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -t 60 docs/evidence/phase3-idle-alpha.mp4
```

`draw_mouse=1` matters on the interaction clip — the cursor in frame is what makes hover and drag legible as evidence.

**Make the gate machine-checkable, not eyeballed.** Have the app write a **behaviour-timeline JSONL** (`{ts, behaviourId, bucket, source}`) alongside the recording; D16's "≥4 distinct behaviours, ≥1 gaze break" then becomes `new Set(rows.map(r => r.behaviourId)).size >= 4` and `rows.some(r => r.bucket === 'gazeBreak')`. Cross-check against pixels so the log cannot lie — these metadata keys were confirmed by running them, not from memory: **`lavfi.signalstats.YDIF`** (frame-to-frame difference = "did it move"), `YAVG`, `lavfi.scd.mafd` / `lavfi.scd.score`, **`lavfi.freezedetect.freeze_start`** / `freeze_duration` / `freeze_end`, `lavfi.black_start`.

```bash
ffmpeg -i phase3-idle-60s.mp4 -vf "signalstats,metadata=mode=print:file=ydif.txt" -an -f null -
ffmpeg -i phase3-idle-60s.mp4 -vf "freezedetect=n=0.003:d=2" -f null -    # assert ZERO freeze_start
```

Verified on a 60 s clip: 1799 frames parsed with per-frame YDIF, and `freezedetect` correctly flagged a static desktop as frozen at t=0 — the negative control works. Assert `freeze_start` count == 0 (proves breath/blink never stalled) plus a high count of `YDIF > threshold`. **Pixel diffing proves motion, not *which* behaviour** — that is why the timeline carries the "≥4 distinct" claim and ffmpeg corroborates that the renderer was genuinely animating. No off-the-shelf tool does this: Chromatic pauses animations, Loki disables `requestAnimationFrame`, BackstopJS and jest-image-snapshot are single-still.

**Driving the 20-second interaction clip — Playwright and CDP cannot do it, structurally.** Electron's `setIgnoreMouseEvents(true)` sets `WS_EX_TRANSPARENT | WS_EX_LAYERED` (`shell/browser/native_window_views.cc:1394`), enforced by **win32k hit-testing, above Chromium**. CDP `Input.dispatchMouseEvent` injects into the *renderer's* pipeline, downstream of that — so it bypasses the very mechanism under test and would produce **false passes**. Use real OS input via **`SendInput`**: a PowerShell P/Invoke helper (call `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` first; `MOUSEEVENTF_ABSOLUTE` normalizes 0..65535 against the **primary monitor**, so divide by *physical* 3840×2160; verify `Marshal.SizeOf(INPUT) == 40` on x64; **run non-elevated** — SendInput fails *silently* into a higher-integrity process under UIPI), or `@nut-tree-fork/nut-js@4.2.6` (Apache-2.0; note plain `@nut-tree/nut-js` is **404 on npm**, and the fork's DPI behaviour at 150 % is **UNVERIFIED**). `robotjs` is dead (NAN, not N-API, last changelog 2018). AutoHotkey v2 works but needs `CoordMode "Mouse","Screen"` and **`SendMode "Event"`** — the default `Input` mode ignores Speed and teleports the cursor, destroying the drag-fling arc.

⚠️ One more PowerShell trap, and it cost the researcher two runs: `FindWindowW($null, $title)` **silently returns HWND 0** because PowerShell marshals `$null` as `""`. Use `[NullString]::Value`. Prefer Electron's `screen.dipToScreenRect()` in-app over manual ×1.5 arithmetic.

**Acceptance script shape for D16:** launch → poll until the pet window exists by title → `SetProcessDPIAware` → `FindWindowW([NullString]::Value, title)` → `GetWindowRect` → physical rect, padded ~10 % → wait ~5 s for idle settle → start timeline JSONL → **record 60 s @30 fps** → assert (`freeze_start` == 0, YDIF distribution, ≥4 distinct behaviours, ≥1 gaze break) → **record 20 s @30 fps with `draw_mouse=1`** while the SendInput driver does hover→dwell 2 s, three taps at distinct hit regions, then press→arc→release with velocity → assert `avatar:tap` ×3, `avatar:dragEnd`, and hover-ack in the timeline.

⚠️ Two operational limits: DDA has a documented **~4 concurrent duplication limit** (OBS/Discord/Teams running can exhaust it), and **hosted Windows CI is a dead end** — GitHub code search finds one repo using `gdigrab` in a workflow, zero using `ddagrab`, and that one excludes its always-on-top test from CI as unreliable. Record locally or on a self-hosted runner.

---

## Open decisions for the controller

1. **Chinese retrieval tokenizer.** Spec §6 says `tokenize='trigram'`; measurement proves two-character Chinese words never match. → **Adopt the bigram-expansion `unicode61` index + LLM-written `alias` column + two-pass (bigram → unigram) fallback, `bm25(f, 1.0, 2.0)`.** No native jieba dependency. Schema v2 is additive to the existing `facts` table.
2. **Absence economics vs the v1 affection rule.** §0 and spec §5 contradict each other ("−1/day after 3 days without contact"). → **Delete the decay term entirely.** Affection is monotonic with a daily earn cap and a dual-path milestone (cumulative affection *or* distinct days seen). The 60 s tick gets **no branch that can decrement affection**.
3. **Does energy decay during absence?** → **Yes for the circadian component, no for the expenditure component.** Energy = f(wall-clock time-of-day) + present-time expenditure. A pet sleepy at 03:00 is a world-fact, not a punishment; make that distinction explicit in the plan so it is not "fixed" later.
4. **Mood half-life.** Spec says 2 h. → **Shorten to 45–60 min of *present* time**, snapshot on absence, and add a one-shot ~70 % settling decay on return if absence exceeded 2 h. (Note: no published constant was verifiable; this is a judgement call, so make it a tunable.)
5. **Behaviour selection algorithm.** → **Weighted shuffle bag, not weighted random**, plus Rabin's last-10 recency filter and a rolling-60 s tail guard that clamps the next duration if fewer than 4 behaviours started. This makes D1's "no behaviour twice in a row" and D16's "≥4 in 60 s" structural rather than statistical.
6. **Expression persistence.** D14 says 90 s. → **Keep 90 s as a never-exceed ceiling but make the visible behaviour intensity-decaying**: full for utterance + 3 s, ramp to neutral over ~8 s. Also clamp incoming intensity to ~0.6–0.7 additive weight (1.0 only for `surprised`). Evidence: Greta's ~1 s displays, OLV #332, airi#590.
7. **Hit-test cost model.** D6 demands opaque-pixel testing; Live2D provides only bounding boxes and per-move `readPixels` is a documented GPU stall. → **Cached 1/4-scale FBO + async `fenceSync` readback every 150–200 ms**, with a 9×9 sync readback and then bboxes as the fallback ladder. Enter/leave hysteresis (alpha ≥ 10 to enter; 5 px radius fully transparent to leave).
8. **Activity sensing tier.** → **Ship the no-consent tier only by default** (idle time, lock/suspend, power, cursor point, `SHQueryUserNotificationState`, foreground *bounds*). Derive typing streaks from idle-time + cursor-delta; **no keyboard hook at any tier** — uiohook-napi#58 describes this exact unsigned-NSIS configuration being flagged. Note that UIA password-masking cannot be guaranteed for elevated apps, so do not promise it.
9. **Proactive gating.** §0's four layers cap *how often* but not *when* within the allowed window. → **Add bounded deferral as a fifth gate**: enqueue rather than fire, wait up to **120 s** for a coarse breakpoint (foreground-window change, typing falling edge + 5 s, return from idle), and **discard if none arrives** — never fire on timeout. Justified by Mark et al. (context does not reduce interruption cost, only timing does) and Achlioptas & Horvitz's measured 43 s mean busy episode. Add **full-jitter** back-off so the cadence never reads as a cron job.
10. **D16 recording route.** → **`ffmpeg ddagrab` cropped via its own `offset_x/offset_y/video_size` options at 30 fps** (verified: 1799/1800 frames over 60 s; 60 fps loses 5.5 %), paired with a **behaviour-timeline JSONL** asserted programmatically and corroborated by `freezedetect` + `signalstats.YDIF`, and **`SendInput` injection** for the interaction clip. Optionally also record a **`gfxcapture`** take for a real-alpha isolated-pet artefact. The transparent-window caveat is **resolved** — a layered topmost window was captured correctly by both ddagrab and gdigrab-desktop; the remaining untested link is only that this was a WinForms analogue, not the actual Electron window. **Never** use `gdigrab -i hwnd=/title=` on it (verified pure-black output on GPU-composited Chromium), and do not attempt Playwright/CDP for the interaction half — it bypasses the win32k hit-test under test and yields false passes.
