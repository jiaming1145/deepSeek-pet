# Phase 2 — Brain, Bubble, Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Haru talks. Typed Chinese in a popover → streamed DeepSeek reply parsed into emotion/motion-tagged sentences → shown in a speech bubble with Chinese reveal cadence and synchronized mouth → written to a local history the user can reread; API key entered once; a lint + eval harness enforces the "alive" writing bar.

**Architecture:** `packages/brain` (pure TS, no Electron) owns the streaming tag/sentence parser, sanitizer, slop linter, persona card → prompt assembler with cache-stable prefix, a fetch-based DeepSeek SSE client, and the turn state machine. `packages/memory` owns `node:sqlite` history + running summary. `apps/desktop` main wires brain ↔ IPC, stores the key with `safeStorage`, and adds two focusable windows (chat popover, API-key window). The pet renderer gains the bubble (DOM overlay on an opaque-ish surface), the reveal-cadence engine coupled to `TextMouthDriver`, and thinking/listening poses. `eval/` runs fixtures through the real API with a judge model. The bubble/popover visual world is decided with the impeccable new-work ritual (Task 7) before any UI code.

**Tech Stack:** as Phase 1 (Electron 43.4.1, electron-vite 5, vite 7, vitest 3, zod 4, `@ds/stage`) + `node:sqlite` (verified in Electron 43) + React 19 for the popover/key windows (vanilla TS stays in the pet window) + Floating UI (`@floating-ui/dom`) for bubble placement + `MiSans` bundled font. **No Tailwind** (deviation from spec §7 — the exquisite bar wants a single hand-written `tokens.css`; recorded ruling).

**Spec:** `docs/superpowers/specs/2026-08-28-live2d-companion-design.md` §3, §5 (tier 1 only), §7 (input window), §8, §9 + addendum `docs/superpowers/specs/2026-08-29-exquisite-bar.md` §0, A1–A10, A12–A23, C1–C8, C10, C12–C15, X1, X5, X6, X9, X12. Product truth: `apps/desktop/PRODUCT.md`.

## Global Constraints

- DeepSeek: base `https://api.deepseek.com`, model `deepseek-v4-flash`, every chat request carries `"thinking": {"type": "disabled"}`, `stream: true`, `stream_options: {include_usage: true}`, `temperature 0.7`, `top_p 0.95`, `max_tokens 300`, `stop: ["\n用户：", "\n用户:", "\nUser:"]`. Log `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` / `completion_tokens` per turn. (addendum §0, X1)
- Prompt layout: `[system: static persona block, byte-identical] [user/assistant pair #1: 长期记忆] [history, append-only] [latest user = 【状态】preamble + text]`. Dynamic state ONLY in the latest user message. Trim in big steps (history > 24K est. tokens → drop oldest 8K into the running summary). Assert byte-identical prefix in tests. Cache-hit target ≥ 70 % over 20 turns. (spec §3.2, addendum §0)
- Control grammar: reply starts with `<|ACT emotion=<e> [motion=<m>]|>`; later `<|ACT …|>` allowed before any sentence; `<|PAUSE n|>` beats. Emotions exactly `happy sad angry think surprised awkward question curious neutral`. Missing leading ACT → `neutral` + a logged compliance miss. Tags parsed from the raw stream BEFORE sanitizing. (spec §3.4, addendum §0)
- Sentence split on `。！？!?…` and `\n`; first sentence may also split on `，,` after ≥ 6 chars. (spec §3.5)
- State machine `idle → thinking → speaking → idle`; `thinking` emitted the instant the request is sent; user text during `speaking` cancels pacing, writes the displayed-so-far text to history, starts a new turn; during `thinking` aborts and restarts with concatenated text. (spec §3.6, A22)
- Reveal cadence: 60–80 ms per hanzi (Latin chars 35 ms), +150 ms after `，、；：`, +300 ms after `。！？`; click/Enter/Space completes instantly; mouth open during char reveal, closed during pauses. (addendum §0, A22)
- Bubble: text on a ≥ 0.92-alpha surface; Floating UI `offset(12) → flip() → shift({padding:16}) → arrow()` against the work area, anchored to the head bbox; enter 240 ms `cubic-bezier(0.16,1,0.3,1)`, exit 160 ms `cubic-bezier(0.3,0,1,1)`; lingers 3 s after the last character unless hovered; max 26 hanzi/line, 6 lines. (C1, C6, C7)
- Chat popover: hotkey `Ctrl+Shift+Space` + click-on-pet; opens ≤ 250 ms; Esc / outside click dismisses; Enter sends, Shift+Enter newline; IME composition never sends; auto-grows 1→6 lines; keyboard-operable; it is a **separate focusable window** (the pet window is `focusable:false`). (C8, spec §2)
- Errors: 401/402 → key window with the reason; 429/5xx/network → 3 jittered retries then `awkward` + canned line; malformed ACT → neutral; system hints go to a **separate hint surface**, never into the character's bubble. (spec §8, X6, C10)
- Slop linter (A2, A4, A5, A6, A3): on violation regenerate once, then strip; violations counted in metrics.
- Tokens (single `apps/desktop/src/renderer/shared/tokens.css`) per addendum C5; final values are set by Task 7's DESIGN.md — tasks after Task 7 read tokens from there, never hard-code.
- Privacy: prompts go to the PRC; first-run key window shows the one-line disclosure and links the privacy note. (spec §11, X14 minimal)
- Renderer owns FPS: 60 Hz while a bubble is animating/revealing or hovered, 30 Hz idle. (addendum §0)
- All IPC payloads zod-validated in main; new channels added to `@ds/protocol` with tests.
- Commits end with the two trailers (see `git log -1`); one commit per task minimum; screenshots of the real desktop for every visual claim under `docs/evidence/phase2/`.
- Real-API tests are gated on `DEEPSEEK_API_KEY` in the environment and skipped otherwise; everything else runs offline against fakes.

---

## File structure

```
packages/brain/
  package.json, tsconfig.json (extends base; strict; no Electron)
  src/index.ts
  src/tags.ts            control-token scanner (chunk-safe)            + tags.test.ts
  src/sentences.ts       zh/en sentence splitter                       + sentences.test.ts
  src/stream-parser.ts   tags+sentences → SentenceEvent stream         + stream-parser.test.ts
  src/sanitize.ts        display normalization (markdown, [..], punct)  + sanitize.test.ts
  src/slop-lint.ts       A2/A3/A4/A5/A6 rules                          + slop-lint.test.ts
  src/persona.ts         Character Card V3 schema + static block render + persona.test.ts
  src/prompt.ts          assembler + token estimate + trim plan         + prompt.test.ts
  src/deepseek.ts        fetch+SSE client, retries, abort, usage        + deepseek.test.ts (local http server)
  src/turn.ts            TurnRunner + state machine                     + turn.test.ts (fake client)
  src/types.ts           shared types (Emotion, SentenceEvent, Usage, TurnState…)
packages/memory/
  package.json, tsconfig.json
  src/index.ts
  src/db.ts              open/migrate node:sqlite at a path             + db.test.ts (tmp file)
  src/history.ts         HistoryStore (append, list, delete, window)    + history.test.ts
  src/summary.ts         RunningSummary (get/set) + trim executor       + summary.test.ts
packages/protocol/src/index.ts   + channels: user:text, user:cancel, brain:state, brain:sentence, brain:turnDone, brain:error, hint:show, key:status, key:set, key:test, history:list, history:delete, chat:open, chat:close, avatar:listening
apps/desktop/src/main/
  brain-service.ts       glue: TurnRunner + stores + IPC + hint routing
  key-store.ts           safeStorage-encrypted key at %APPDATA%/ds/key.bin
  chat-window.ts         focusable popover window (positioning near the pet)
  key-window.ts          first-run / re-auth window
  summarizer.ts          non-streaming v4-flash call for trims
apps/desktop/src/preload/chat.ts, key.ts
apps/desktop/src/renderer/shared/tokens.css, fonts/MiSans-*.woff2, hint.ts (system-hint surface)
apps/desktop/src/renderer/pet/bubble.ts       DOM bubble + Floating UI placement + lifecycle
apps/desktop/src/renderer/pet/reveal.ts       cadence engine (pure)                    + reveal.test.ts
apps/desktop/src/renderer/pet/speech.ts       queue of SentenceEvents → bubble + mouth + expressions
apps/desktop/src/renderer/chat.html, chat/main.tsx, chat/App.tsx, chat/Composer.tsx, chat/History.tsx
apps/desktop/src/renderer/key.html, key/main.tsx, key/App.tsx
apps/desktop/DESIGN.md                        written by Task 7
characters/haru/persona.json                  Character Card V3 (from the owner's description)
eval/fixtures/prompts.zh.json, eval/judge.md, eval/run.mjs, eval/README.md
docs/evidence/phase2/*.png
```

---

### Task 1: `@ds/brain` — control-token scanner and sentence splitter

**Files:**
- Create: `packages/brain/package.json`, `packages/brain/tsconfig.json`, `packages/brain/src/types.ts`, `packages/brain/src/tags.ts`, `packages/brain/src/tags.test.ts`, `packages/brain/src/sentences.ts`, `packages/brain/src/sentences.test.ts`, `packages/brain/src/index.ts`

**Interfaces:**
- Produces: `EMOTIONS` re-exported from `@ds/stage`'s list (duplicate the tuple here to keep brain Electron/DOM-free: `export const EMOTIONS = ['happy','sad','angry','think','surprised','awkward','question','curious','neutral'] as const`), `type Emotion`;
  `type Tag = { kind:'act'; emotion: Emotion; motion?: string } | { kind:'pause'; seconds: number }`;
  `class TagScanner { push(chunk: string): Array<{ kind:'text'; text: string } | { kind:'tag'; tag: Tag } | { kind:'badtag'; raw: string }>; flush(): same }` — chunk-safe (a `<|…|>` split across pushes is reassembled; a `<|` never closed within 64 chars is emitted as text);
  `class SentenceSplitter { push(text: string): string[]; flush(): string[] }` with `firstChunkCommaSplit` behaviour and `minFirstChars = 6`.

- [ ] **Step 1: Package + failing tests**

`packages/brain/package.json`:
```json
{
  "name": "@ds/brain", "version": "0.1.0", "private": true, "type": "module",
  "main": "src/index.ts", "types": "src/index.ts",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "zod": "^4.0.0" }
}
```
`packages/brain/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["ES2022"], "types": ["node"] }, "include": ["src"] }`

`packages/brain/src/tags.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TagScanner } from './tags';

const run = (chunks: string[]) => { const s = new TagScanner(); const out = chunks.flatMap((c) => s.push(c)); return [...out, ...s.flush()]; };

describe('TagScanner', () => {
  it('parses a leading ACT with motion', () => {
    expect(run(['<|ACT emotion=happy motion=nod|>你好'])).toEqual([
      { kind: 'tag', tag: { kind: 'act', emotion: 'happy', motion: 'nod' } },
      { kind: 'text', text: '你好' },
    ]);
  });
  it('reassembles a tag split across chunks', () => {
    expect(run(['今天<|ACT emo', 'tion=curious|>怎么样'])).toEqual([
      { kind: 'text', text: '今天' },
      { kind: 'tag', tag: { kind: 'act', emotion: 'curious' } },
      { kind: 'text', text: '怎么样' },
    ]);
  });
  it('parses PAUSE seconds', () => {
    expect(run(['<|PAUSE 1.5|>'])).toEqual([{ kind: 'tag', tag: { kind: 'pause', seconds: 1.5 } }]);
  });
  it('emits an unknown emotion as badtag', () => {
    expect(run(['<|ACT emotion=joy|>'])).toEqual([{ kind: 'badtag', raw: '<|ACT emotion=joy|>' }]);
  });
  it('gives up on an unterminated <| after 64 chars and emits it as text', () => {
    const long = '<|' + 'x'.repeat(70);
    expect(run([long])).toEqual([{ kind: 'text', text: long }]);
  });
  it('flush emits a pending short prefix as text', () => {
    expect(run(['嗯<|AC'])).toEqual([{ kind: 'text', text: '嗯' }, { kind: 'text', text: '<|AC' }]);
  });
});
```

`packages/brain/src/sentences.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SentenceSplitter } from './sentences';

const run = (chunks: string[]) => { const s = new SentenceSplitter(); const out = chunks.flatMap((c) => s.push(c)); return [...out, ...s.flush()]; };

describe('SentenceSplitter', () => {
  it('splits on Chinese terminal punctuation', () => {
    expect(run(['你回来啦！今天累不累？'])).toEqual(['你回来啦！', '今天累不累？']);
  });
  it('keeps trailing text until flush', () => {
    const s = new SentenceSplitter();
    expect(s.push('我在想')).toEqual([]);
    expect(s.flush()).toEqual(['我在想']);
  });
  it('splits the FIRST sentence on a comma after 6 chars for a fast first reaction', () => {
    expect(run(['你终于回来了，我等了好久。'])).toEqual(['你终于回来了，', '我等了好久。']);
  });
  it('does not comma-split later sentences', () => {
    expect(run(['好。那个，我想说，其实没什么。'])).toEqual(['好。', '那个，我想说，其实没什么。']);
  });
  it('does not comma-split before 6 chars', () => {
    expect(run(['嗯，好的。'])).toEqual(['嗯，好的。']);
  });
  it('treats ellipsis and newline as boundaries and drops empty pieces', () => {
    expect(run(['等等……\n\n好吧'])).toEqual(['等等……', '好吧']);
  });
  it('handles a boundary split across chunks', () => {
    expect(run(['今天天气真好', '！走吧'])).toEqual(['今天天气真好！', '走吧']);
  });
});
```

Run `pnpm install && pnpm test` → FAIL (modules missing).

- [ ] **Step 2: Implement**

`packages/brain/src/types.ts`:
```ts
export const EMOTIONS = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral'] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const isEmotion = (s: string): s is Emotion => (EMOTIONS as readonly string[]).includes(s);

export type Tag = { kind: 'act'; emotion: Emotion; motion?: string } | { kind: 'pause'; seconds: number };
export type ScanItem = { kind: 'text'; text: string } | { kind: 'tag'; tag: Tag } | { kind: 'badtag'; raw: string };

export interface SentenceEvent { turnId: string; seq: number; text: string; emotion: Emotion; motion?: string; pause?: number }
export type TurnState = 'idle' | 'thinking' | 'speaking';
export interface Usage { promptTokens: number; cacheHit: number; cacheMiss: number; completionTokens: number }
```

`packages/brain/src/tags.ts`:
```ts
import { isEmotion, type ScanItem, type Tag } from './types';

const OPEN = '<|', CLOSE = '|>', MAX_TAG = 64;

export function parseTag(raw: string): Tag | null {
  const body = raw.slice(OPEN.length, -CLOSE.length).trim();
  const pause = body.match(/^PAUSE\s+([0-9]*\.?[0-9]+)$/);
  if (pause) return { kind: 'pause', seconds: Number(pause[1]) };
  if (!body.startsWith('ACT')) return null;
  const attrs = Object.fromEntries([...body.slice(3).matchAll(/(\w+)=([\w-]+)/g)].map((m) => [m[1], m[2]]));
  if (!attrs.emotion || !isEmotion(attrs.emotion)) return null;
  return attrs.motion ? { kind: 'act', emotion: attrs.emotion, motion: attrs.motion } : { kind: 'act', emotion: attrs.emotion };
}

export class TagScanner {
  private buf = '';
  push(chunk: string): ScanItem[] {
    this.buf += chunk;
    const out: ScanItem[] = [];
    for (;;) {
      const start = this.buf.indexOf(OPEN);
      if (start < 0) { if (this.buf) out.push({ kind: 'text', text: this.buf }); this.buf = ''; break; }
      if (start > 0) { out.push({ kind: 'text', text: this.buf.slice(0, start) }); this.buf = this.buf.slice(start); }
      const end = this.buf.indexOf(CLOSE);
      if (end < 0) {
        if (this.buf.length > MAX_TAG) { out.push({ kind: 'text', text: this.buf }); this.buf = ''; }
        break; // wait for more
      }
      const raw = this.buf.slice(0, end + CLOSE.length);
      this.buf = this.buf.slice(end + CLOSE.length);
      const tag = parseTag(raw);
      out.push(tag ? { kind: 'tag', tag } : { kind: 'badtag', raw });
    }
    return out;
  }
  flush(): ScanItem[] { const rest = this.buf; this.buf = ''; return rest ? [{ kind: 'text', text: rest }] : []; }
}
```

`packages/brain/src/sentences.ts`:
```ts
const HARD = /[。！？!?]|…+|\n+/g;
const COMMA = /[，,]/;

export class SentenceSplitter {
  private buf = '';
  private emitted = 0;
  constructor(private readonly minFirstChars = 6) {}
  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    for (;;) {
      HARD.lastIndex = 0;
      const m = HARD.exec(this.buf);
      let cut = -1;
      if (m) cut = m.index + m[0].length;
      if (this.emitted === 0) {
        const c = this.buf.search(COMMA);
        if (c >= this.minFirstChars && (cut < 0 || c < cut)) cut = c + 1;
      }
      if (cut < 0) break;
      const piece = this.buf.slice(0, cut).replace(/\n+$/, '');
      this.buf = this.buf.slice(cut);
      if (piece.trim()) { out.push(piece); this.emitted++; }
    }
    return out;
  }
  flush(): string[] { const rest = this.buf.trim(); this.buf = ''; if (rest) { this.emitted++; return [rest]; } return []; }
}
```

`packages/brain/src/index.ts`: `export * from './types'; export * from './tags'; export * from './sentences';`

- [ ] **Step 3: Run tests + typecheck** → 13 new tests PASS, `pnpm typecheck` clean.
- [ ] **Step 4: Commit** `feat(brain): control-token scanner and sentence splitter`

---

### Task 2: `@ds/brain` — stream parser, sanitizer, slop linter

**Files:**
- Create: `src/stream-parser.ts` + test, `src/sanitize.ts` + test, `src/slop-lint.ts` + test; Modify: `src/index.ts`

**Interfaces:**
- Produces: `class StreamParser { constructor(turnId: string); push(chunk: string): SentenceEvent[]; flush(): SentenceEvent[]; readonly complianceMiss: boolean }` — current ACT persists until the next; leading text without ACT → `neutral` + `complianceMiss = true`; PAUSE attaches to the next sentence as `pause`; sentence text is **raw** (sanitizing happens in the consumer so the linter sees the raw reply too).
  `sanitizeForDisplay(text: string): string` — strips markdown (`**`, `*`, `#`, backticks, list markers at line start), removes `[…]`/`（旁白…）` stage directions, converts half-width `,.!?:;` to full-width when the surrounding run is CJK, collapses 3+ ellipsis dots to `……`, removes stray isolated digits injected at sentence starts (`^\d{1,3}\s`), and normalizes whitespace; never splits a grapheme (use `Intl.Segmenter('zh', {granularity:'grapheme'})`).
  `lintReply(reply: string, history: string[]): LintResult` where `LintResult = { violations: Array<{ rule: 'assistant-leak'|'closing-moral'|'ellipsis'|'rhetorical'|'narrates-user'|'markdown'|'question-streak'|'repetition'; detail: string }>; severity: 'none'|'strip'|'regenerate' }`; `regenerate` when any of assistant-leak / narrates-user / closing-moral fire; `strip` for markdown/ellipsis; `question-streak` needs the last reply in `history` to also end with `？`; `repetition` = 4-gram overlap > 20 % with the last 10 history replies.

- [ ] **Step 1: Failing tests**

`src/stream-parser.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { StreamParser } from './stream-parser';
const run = (chunks: string[]) => { const p = new StreamParser('t1'); const ev = chunks.flatMap((c) => p.push(c)); return { events: [...ev, ...p.flush()], miss: p.complianceMiss }; };

describe('StreamParser', () => {
  it('emits sentences carrying the current ACT and increasing seq', () => {
    const { events, miss } = run(['<|ACT emotion=happy motion=nod|>你回来啦！', '<|ACT emotion=curious|>今天做了什么？']);
    expect(miss).toBe(false);
    expect(events).toEqual([
      { turnId: 't1', seq: 0, text: '你回来啦！', emotion: 'happy', motion: 'nod' },
      { turnId: 't1', seq: 1, text: '今天做了什么？', emotion: 'curious' },
    ]);
  });
  it('defaults to neutral and flags a compliance miss when the reply has no leading ACT', () => {
    const { events, miss } = run(['嗯。']);
    expect(miss).toBe(true);
    expect(events[0]).toMatchObject({ emotion: 'neutral', text: '嗯。' });
  });
  it('attaches PAUSE to the following sentence', () => {
    const { events } = run(['<|ACT emotion=think|>让我想想。<|PAUSE 1|>好吧。']);
    expect(events[1]).toMatchObject({ text: '好吧。', pause: 1 });
  });
  it('ignores badtags and keeps text flowing', () => {
    const { events } = run(['<|ACT emotion=joy|>你好。']);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('你好。');
  });
});
```

`src/sanitize.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sanitizeForDisplay } from './sanitize';
describe('sanitizeForDisplay', () => {
  it('strips markdown emphasis and list markers', () => { expect(sanitizeForDisplay('**你好**\n- 第一\n- 第二')).toBe('你好\n第一\n第二'); });
  it('removes bracketed stage directions', () => { expect(sanitizeForDisplay('[微笑]你好呀（旁白：她笑了）')).toBe('你好呀'); });
  it('converts half-width punctuation inside CJK runs only', () => { expect(sanitizeForDisplay('你好,世界! Hello, world!')).toBe('你好，世界！ Hello, world!'); });
  it('collapses long ellipses', () => { expect(sanitizeForDisplay('等等......')).toBe('等等……'); });
  it('drops an injected leading number', () => { expect(sanitizeForDisplay('12 今天不错')).toBe('今天不错'); });
  it('keeps emoji clusters intact', () => { expect(sanitizeForDisplay('好耶👨‍👩‍👧')).toBe('好耶👨‍👩‍👧'); });
});
```

`src/slop-lint.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { lintReply } from './slop-lint';
describe('lintReply', () => {
  it('flags assistant-speak as regenerate', () => {
    const r = lintReply('作为AI，我很乐意帮您。有什么可以帮您的吗？', []);
    expect(r.severity).toBe('regenerate');
    expect(r.violations.map((v) => v.rule)).toContain('assistant-leak');
  });
  it('flags narrating the user', () => { expect(lintReply('你笑了笑，说：好啊。', []).violations.map((v) => v.rule)).toContain('narrates-user'); });
  it('flags a closing moral', () => { expect(lintReply('今天不错。总之，记住要开心。', []).violations.map((v) => v.rule)).toContain('closing-moral'); });
  it('flags two ellipses as strip', () => { const r = lintReply('嗯……好吧……', []); expect(r.severity).toBe('strip'); });
  it('flags a rhetorical template', () => { expect(lintReply('难道你不觉得吗？', []).violations.map((v) => v.rule)).toContain('rhetorical'); });
  it('flags a question streak using history', () => { expect(lintReply('那你呢？', ['今天怎么样？']).violations.map((v) => v.rule)).toContain('question-streak'); });
  it('flags 4-gram repetition against recent replies', () => { expect(lintReply('今天天气真的很好呢', ['今天天气真的很好呢', 'x', 'y']).violations.map((v) => v.rule)).toContain('repetition'); });
  it('passes a clean casual reply', () => { expect(lintReply('回来啦。今天累不累？', ['好。']).severity).toBe('none'); });
});
```

- [ ] **Step 2: Implement**

`src/stream-parser.ts`:
```ts
import { SentenceSplitter } from './sentences';
import { TagScanner } from './tags';
import type { Emotion, SentenceEvent } from './types';

export class StreamParser {
  private readonly tags = new TagScanner();
  private readonly sentences = new SentenceSplitter();
  private emotion: Emotion = 'neutral';
  private motion: string | undefined;
  private motionUsed = false;
  private pendingPause: number | undefined;
  private seq = 0;
  private sawAct = false;
  private sawText = false;
  public complianceMiss = false;
  constructor(private readonly turnId: string) {}

  push(chunk: string): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.push(chunk)) {
      if (item.kind === 'tag') {
        if (item.tag.kind === 'act') { this.emotion = item.tag.emotion; this.motion = item.tag.motion; this.motionUsed = false; this.sawAct = true; }
        else this.pendingPause = item.tag.seconds;
      } else if (item.kind === 'text') {
        if (!this.sawAct && !this.sawText && item.text.trim()) this.complianceMiss = true;
        this.sawText = true;
        for (const s of this.sentences.push(item.text)) out.push(this.emit(s));
      }
    }
    return out;
  }
  flush(): SentenceEvent[] {
    const out: SentenceEvent[] = [];
    for (const item of this.tags.flush()) if (item.kind === 'text') for (const s of this.sentences.push(item.text)) out.push(this.emit(s));
    for (const s of this.sentences.flush()) out.push(this.emit(s));
    return out;
  }
  private emit(text: string): SentenceEvent {
    const ev: SentenceEvent = { turnId: this.turnId, seq: this.seq++, text, emotion: this.emotion };
    if (this.motion && !this.motionUsed) { ev.motion = this.motion; this.motionUsed = true; }
    if (this.pendingPause !== undefined) { ev.pause = this.pendingPause; this.pendingPause = undefined; }
    return ev;
  }
}
```

`src/sanitize.ts`:
```ts
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const HALF_TO_FULL: Record<string, string> = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；' };

export function sanitizeForDisplay(input: string): string {
  let t = input.replace(/\r/g, '');
  t = t.replace(/```[\s\S]*?```/g, '').replace(/`([^`]*)`/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*•]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '');
  t = t.replace(/\[[^\]\n]{1,40}\]/g, '').replace(/[（(]旁白[^）)]*[）)]/g, '');
  t = t.replace(/\.{3,}|。{3,}/g, '……').replace(/…{3,}/g, '……');
  t = t.replace(/^\s*\d{1,3}\s+(?=\S)/, '');
  // half → full width when adjacent to CJK
  t = t.replace(/([\s\S])([,.!?:;])(?=([\s\S]|$))/g, (m, before: string, p: string, after: string) => {
    const cjkNear = CJK.test(before) || (after !== '' && CJK.test(after));
    return cjkNear ? before + HALF_TO_FULL[p] : m;
  });
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  return [...seg.segment(t)].map((s) => s.segment).join('');
}
```

`src/slop-lint.ts`:
```ts
import type { } from './types';
export type LintRule = 'assistant-leak' | 'closing-moral' | 'ellipsis' | 'rhetorical' | 'narrates-user' | 'markdown' | 'question-streak' | 'repetition';
export interface LintResult { violations: Array<{ rule: LintRule; detail: string }>; severity: 'none' | 'strip' | 'regenerate' }

const ASSISTANT_LEAK = [/作为(一个)?(AI|人工智能|语言模型)/, /有什么可以帮(您|你)/, /首先[，,].*其次/, /综上所述/, /希望这能帮到/, /如果(你|您)还有其他问题/, /值得注意的是/, /很乐意(帮|为)/];
const CLOSING_MORAL = [/(总之|无论如何|记住|让我们一起|最重要的是)/];
const RHETORICAL = [/难道.*吗[？?]/, /你觉得呢[？?]$/, /不是吗[？?]$/];
const NARRATES_USER = [/^你(笑了|点了点头|叹了口气|愣了|沉默)/m, /\{\{user\}\}/, /你(说|问)[：:]/];

function fourGrams(s: string): Set<string> { const g = new Set<string>(); const t = s.replace(/\s+/g, ''); for (let i = 0; i + 4 <= t.length; i++) g.add(t.slice(i, i + 4)); return g; }

export function lintReply(reply: string, history: string[]): LintResult {
  const v: LintResult['violations'] = [];
  for (const re of ASSISTANT_LEAK) if (re.test(reply)) { v.push({ rule: 'assistant-leak', detail: re.source }); break; }
  for (const re of NARRATES_USER) if (re.test(reply)) { v.push({ rule: 'narrates-user', detail: re.source }); break; }
  const last = reply.split(/(?<=[。！？!?])/).filter((s) => s.trim()).at(-1) ?? '';
  for (const re of CLOSING_MORAL) if (re.test(last)) { v.push({ rule: 'closing-moral', detail: last }); break; }
  if ((reply.match(/……/g) ?? []).length > 1) v.push({ rule: 'ellipsis', detail: 'more than one ……' });
  for (const re of RHETORICAL) if (re.test(reply)) { v.push({ rule: 'rhetorical', detail: re.source }); break; }
  if (/[*#`]|^\s*[-•]\s/m.test(reply)) v.push({ rule: 'markdown', detail: 'markup' });
  const prev = history.at(-1) ?? '';
  if (/[？?]\s*$/.test(reply) && /[？?]\s*$/.test(prev)) v.push({ rule: 'question-streak', detail: 'two question-ending replies in a row' });
  const mine = fourGrams(reply);
  if (mine.size >= 4) for (const h of history.slice(-10)) {
    const theirs = fourGrams(h); let hit = 0; for (const g of mine) if (theirs.has(g)) hit++;
    if (hit / mine.size > 0.2) { v.push({ rule: 'repetition', detail: `4-gram overlap ${(100 * hit / mine.size).toFixed(0)}%` }); break; }
  }
  const rules = new Set(v.map((x) => x.rule));
  const severity = rules.has('assistant-leak') || rules.has('narrates-user') || rules.has('closing-moral') || rules.has('repetition') ? 'regenerate' : v.length ? 'strip' : 'none';
  return { violations: v, severity };
}
```
Add exports to `index.ts`.

- [ ] **Step 3: Tests + typecheck** → all PASS (`Intl.Segmenter` exists in Node 24).
- [ ] **Step 4: Commit** `feat(brain): stream parser, display sanitizer, slop linter`

---

### Task 3: `@ds/brain` — persona card, prompt assembler, token estimate, trim plan

**Files:** Create `src/persona.ts` + test, `src/prompt.ts` + test; Modify `src/index.ts`. Create `characters/haru/persona.json` **from the owner's description** (the controller writes the Chinese content into the brief when dispatching; the schema below is fixed).

**Interfaces:**
- Produces: `CharacterCardSchema` (zod): `{ spec:'chara_card_v3', name, description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, tags: string[], creator_notes }`; `renderStaticSystem(card): string` (fixed order: hard rules → identity → personality → speaking style → control-grammar instructions with the 9 emotions and the character's `motionMap` keys → example exchanges); `estimateTokens(s: string): number` (CJK char ≈ 0.7 tok, other ≈ 0.25/char, rounded up);
  `type ChatMessage = { role:'system'|'user'|'assistant'; content: string }`;
  `assemblePrompt(input: { staticSystem: string; summary: string; history: ChatMessage[]; state: StatePreamble; userText: string }): ChatMessage[]`;
  `type StatePreamble = { localTime: string; weekday: string; mood: string; affection: number; energy: number; sinceLastChat: string; memories: string[] }` rendered as `【状态】…】` prefix;
  `planTrim(history: ChatMessage[], maxTokens = 24_000, dropTokens = 8_000): { keep: ChatMessage[]; drop: ChatMessage[] }` (drops oldest whole turns until ≥ dropTokens removed, never splits a user/assistant pair).

- [ ] **Step 1: Failing tests** — `persona.test.ts`: renders in fixed order (assert substring order of "硬性规则" < name < "说话方式" < "<|ACT" < "示例"), rejects a card without `first_mes`; `prompt.test.ts`: (a) system + pair #1 bytes identical between two consecutive assemblies with different `state`/`userText`; (b) state preamble appears only in the last message and contains `本地时间`; (c) `planTrim` on a 30-turn synthetic history with 1,200-token turns drops ≥ 8,000 tokens and keeps pairs aligned (first kept message is `user`); (d) `estimateTokens('你好世界')` ≈ 3, `estimateTokens('hello world')` ≈ 3.
- [ ] **Step 2: Implement** per the interfaces (the static block ends with the control-grammar paragraph: `每句话之前可以用 <|ACT emotion=happy|> 这样的标记表达情绪，emotion 只能是 happy/sad/angry/think/surprised/awkward/question/curious/neutral；回复的第一句必须以 ACT 标记开头；可用 motion：nod/shake/wave/think。不要用 markdown，不要替用户说话，不要总结升华。`) and the Chinese state preamble `【状态】本地时间 ${weekday} ${localTime}｜心情 ${mood}｜好感 ${affection}/100｜精力 ${energy}/100｜距离上次聊天 ${sinceLastChat}${memories.length ? '｜相关记忆：' + memories.join('；') : ''}】\n\n${userText}`.
- [ ] **Step 3: Tests + typecheck PASS.** **Step 4: Commit** `feat(brain): persona card schema, cache-stable prompt assembler, trim plan`

---

### Task 4: `@ds/brain` — DeepSeek SSE client + TurnRunner state machine

**Files:** Create `src/deepseek.ts` + test, `src/turn.ts` + test; Modify `src/index.ts`.

**Interfaces:**
- Produces: `interface ChatClient { stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamChunk> }` with `ChatRequest = { messages: ChatMessage[]; maxTokens?: number }`, `StreamChunk = { kind:'delta'; text: string } | { kind:'usage'; usage: Usage } | { kind:'done' }`;
  `class DeepSeekClient implements ChatClient { constructor(opts: { apiKey: string; baseUrl?: string; model?: string; fetch?: typeof fetch }) }` — POST `/chat/completions` with the Global-Constraints body, parses SSE (`data: {...}` lines, ignores `: keep-alive` comments, `[DONE]`), maps `usage.prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`; throws `DeepSeekError { status: number; code: 'auth'|'balance'|'rate'|'server'|'network' }` (401→auth, 402→balance, 429→rate, ≥500→server); retries rate/server/network with 1 s/2 s/4 s ± 30 % jitter, max 3, honouring `signal`; also `testKey(): Promise<{ ok: true } | { ok: false; code }>` (a 1-token non-stream call);
  `class TurnRunner { constructor(deps: { client: ChatClient; history: HistoryPort; persona: { staticSystem: string; motionKeys: string[] }; state(): StatePreamble; lint?: boolean; now?: () => number; idFactory?: () => string }); readonly state: TurnState; on(event, cb): () => void; send(text: string): Promise<void>; cancel(): void; sentenceShown(turnId, seq): void; turnShown(turnId): void }` events: `state {state, turnId}`, `sentence SentenceEvent`, `turnDone {turnId, usage, complianceMiss, lint: LintResult, ms, ttftMs}`, `error {turnId, code, message}`;
  `interface HistoryPort { window(): Promise<ChatMessage[]>; summary(): Promise<string>; append(role, content, meta?): Promise<void>; onTrimNeeded(plan): Promise<void> }`.
  Interruption semantics per Global Constraints: `send` while `speaking` → `cancel()` (abort fetch if still streaming), append the **shown-so-far** assistant text (tracked via `sentenceShown`) to history, then start the new turn; while `thinking` → abort, concatenate pending user texts with `\n`, restart. Lint policy: after the stream completes, `lintReply(full, lastReplies)`; if `regenerate` and this is the first attempt → re-run once with an appended system nudge line `（上一条回复不像你会说的话，换个说法，别用助手腔。）` in the LATEST user message (never the prefix); if still `regenerate` → keep and mark; sentences are emitted live from the first attempt only if no regenerate happens — to keep this simple and honest: **buffer the whole reply, lint, then emit sentences** (spec wants streaming; the cost is TTFT of a short reply ≈ 1 s — accepted as a Phase 2 ruling; Phase 3 revisits streaming-with-lint by linting the first sentence only).
- [ ] **Step 1: Failing tests** — `deepseek.test.ts` spins a local `node:http` server: (a) streams three deltas + usage and asserts the client yields them and the request body has `thinking.type === 'disabled'`, `stream_options.include_usage === true`, model `deepseek-v4-flash`; (b) 401 → `DeepSeekError code 'auth'` without retry; (c) first response 503 then 200 → succeeds after one retry (fake timers); (d) abort mid-stream rejects with `AbortError`. `turn.test.ts` with a `FakeClient` that yields scripted chunks under fake timers: (a) `send` → state `thinking` immediately, then `speaking` with sentences, then `idle`, history appended (user + assistant); (b) compliance miss flagged; (c) `send` during `speaking` after `sentenceShown(0)` → history gets only sentence 0's text, new turn starts; (d) lint `regenerate` triggers exactly one retry and the nudge appears only in the last user message; (e) client `rate` error after retries → `error` event with `code 'rate'`, state back to `idle`, nothing appended.
- [ ] **Step 2: Implement** per interfaces (SSE parse with a `TextDecoder` + line buffer; `for await (const chunk of res.body)`).
- [ ] **Step 3: Tests + typecheck PASS.** **Step 4: Commit** `feat(brain): DeepSeek SSE client with retries, TurnRunner state machine with lint-once policy`

---

### Task 5: `@ds/memory` — SQLite history + running summary

**Files:** Create `packages/memory/{package.json,tsconfig.json}`, `src/db.ts` + test, `src/history.ts` + test, `src/summary.ts` + test, `src/index.ts`.

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync` (`node:sqlite`; `PRAGMA journal_mode=WAL`; migrations table `meta(key, value)` with `schema_version`; tables `messages(id INTEGER PK, ts INTEGER, role TEXT, content TEXT, turn_id TEXT, kind TEXT DEFAULT 'chat', tokens INTEGER)`, `summary(id INTEGER PK CHECK(id=1), content TEXT, updated_ts INTEGER)`, `metrics(turn_id TEXT PK, ts, ttft_ms, total_ms, cache_hit, cache_miss, completion, compliance_miss INTEGER, lint TEXT)`);
  `class HistoryStore implements HistoryPort` + `list(opts: { limit?: number; before?: number }): Row[]`, `deleteTurn(turnId)`, `recordMetrics(m)`; `window()` returns messages after the last trim point within 24K est. tokens; `onTrimNeeded(plan)` deletes dropped rows only AFTER `summarize(dropped)` succeeded and stored the new summary (atomic in one transaction);
  `class RunningSummary { get(): string; set(s: string): void }`; `summarize` is injected (`(oldSummary, droppedMessages) => Promise<string>`) so tests use a fake and main injects the v4-flash call.
- [ ] **Step 1: Failing tests** on a temp file: migrations idempotent; append/list ordering; `window()` respects the token budget; trim path calls summarize with the dropped messages and removes them; `deleteTurn` removes both roles.
- [ ] **Step 2: Implement.** Keep `node:sqlite` import as `import { DatabaseSync } from 'node:sqlite'` (works in vitest under Node 24; Electron 43 verified).
- [ ] **Step 3: Tests PASS.** **Step 4: Commit** `feat(memory): sqlite history store, running summary, metrics`

---

### Task 6: main-process wiring — brain service, key store, chat + key windows, protocol channels

**Files:** Modify `packages/protocol/src/index.ts` (+ tests); Create `apps/desktop/src/main/{brain-service.ts,key-store.ts,chat-window.ts,key-window.ts,summarizer.ts}`, `apps/desktop/src/preload/{chat.ts,key.ts}`; Modify `apps/desktop/src/main/index.ts`, `apps/desktop/electron.vite.config.ts` (preload inputs `chat`, `key`; renderer inputs `chat.html`, `key.html`), `apps/desktop/package.json` (deps `@ds/brain`, `@ds/memory`).

**Interfaces:**
- New channels (all zod): renderer→main `user:text {text}`, `user:cancel {}`, `key:set {apiKey}`, `key:test {}`, `history:list {before?, limit?}`, `history:delete {turnId}`, `chat:close {}`; main→renderer `brain:state {state, turnId}`, `brain:sentence SentenceEvent`, `brain:turnDone {turnId, usage, ttftMs, totalMs, complianceMiss}`, `brain:error {turnId?, code, message}`, `hint:show {text, level:'info'|'warn'|'error', ttlMs}`, `key:status {present, lastTest?: {ok, code?}}`, `avatar:listening {on}`, `chat:opened {}`; invoke-style (handle/invoke) for `history:list` and `key:test` returning data.
- `KeyStore`: `get(): string|null`, `set(k)`, `clear()` using `safeStorage.encryptString` → `%APPDATA%/ds/key.bin`.
- `ChatWindow`: `frame:false, transparent:true, alwaysOnTop:true, focusable:true, skipTaskbar:true, resizable:false, show:false`, 380×64 initial, positioned above-left of the pet window (flip to the right/below when off the work area); `open()` focuses the input (`show()` then `focus()`); `close()` hides and returns focus to nothing; blur → close (light dismiss) unless a composition is in progress (renderer tells main via `chat:composing {on}` — add channel).
- `KeyWindow`: normal window 440×360, `backgroundMaterial:'mica'` (falls back silently), opened on first run or on `auth`/`balance` errors with the reason.
- `BrainService`: constructs `DeepSeekClient` from `KeyStore`, `HistoryStore` at `%APPDATA%/ds/ds.sqlite`, `TurnRunner` with `state()` returning a Phase-2 stub `{ mood:'平静', affection: 50, energy: 80, sinceLastChat: <computed from last message ts>, memories: [] }` and local time/weekday from `Intl.DateTimeFormat('zh-CN')`; forwards events to the pet window; routes `error` to `hint:show` (Chinese copy: auth → `API Key 无效，去设置里重新填一下`, balance → `DeepSeek 余额不足`, rate → `DeepSeek 有点忙，稍后再试`, server/network → `网络不太好，等一下再聊`) and opens `KeyWindow` for auth/balance; `sentenceShown`/`turnShown` come from the pet renderer's `playback:*` events (already exist).
- Tray: add `打开对话` (chat) and `设置 API Key` items.
- [ ] **Step 1: Failing tests** — protocol tests for every new channel's schema; `key-store.test.ts` with a fake `safeStorage` (encrypt = base64) round-trips and returns null when the file is missing.
- [ ] **Step 2: Implement.** Global hotkey `Ctrl+Shift+Space` → `ChatWindow.open()`; `avatar:tap` on `Head` or `Body` also opens it (single click; drag/tap separation from Phase 1 applies).
- [ ] **Step 3: `pnpm test`, typecheck, and `pnpm dev`** with `DEEPSEEK_API_KEY` in the environment used to pre-seed the key store when no key is stored (dev convenience): send `你好` from the (still unstyled) popover and confirm `brain:sentence` events reach the pet console. Screenshot the Electron console output to `docs/evidence/phase2/main-wiring.png`.
- [ ] **Step 4: Commit** `feat(desktop): brain service, key store, chat/key windows, protocol channels`

---

### Task 7: Design decision — bubble/popover visual world (impeccable new-work) → DESIGN.md + tokens.css

This task is **controller-led with the owner in the loop** (the impeccable ritual requires the user to pick a direction). The implementer subagent is NOT dispatched for this task.

- [ ] **Step 1:** Controller derives seven candidate visual systems from the character's world (Haru is a Live2D original character in a navy suit with a striped scarf — the audience's world: Japanese visual-novel dialogue boxes, VTuber stream overlays, Chinese IM chat UI (WeChat/QQ), tamagotchi LCD, Persona-style UI, Animal Crossing bubbles, Windows 11 Fluent flyouts) and runs `node C:\Users\jiami\.claude\skills\impeccable\scripts\concept-seed.mjs --scope direction --mode experience` from `apps/desktop`.
- [ ] **Step 2:** Presents the assigned direction + fused challengers on the decision page (`serve-question.mjs`) for the owner; falls back to AskUserQuestion if the page cannot open.
- [ ] **Step 3:** Writes the direction contract (THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM) at the top of `apps/desktop/src/renderer/shared/tokens.css` and `apps/desktop/DESIGN.md` (via `document.md` rules): palette (derived from Haru's dominant colours, one accent), MiSans stack, type ramp, radii, shadows, motion tokens — respecting addendum C5 bounds. Bundles `MiSans-Regular/Medium/Semibold` subset woff2 under `apps/desktop/src/renderer/shared/fonts/` (MiSans is free for commercial use; subset with `pyftsubset` or `glyphhanger` to GB2312 + ASCII + common symbols, ≤ 1.2 MB total).
- [ ] **Step 4:** Commit `design: bubble/popover visual world — DESIGN.md, tokens, MiSans`

---

### Task 8: Pet renderer — speech bubble, reveal cadence, mouth sync, thinking/listening poses

**Files:** Create `apps/desktop/src/renderer/pet/reveal.ts` + `reveal.test.ts`, `pet/bubble.ts`, `pet/speech.ts`, `apps/desktop/src/renderer/shared/hint.ts`; Modify `pet/main.ts`, `pet.html` (bubble + hint containers, tokens.css import).

**Interfaces:**
- Consumes: DESIGN.md tokens; `brain:state`, `brain:sentence`, `brain:turnDone`, `brain:error`, `hint:show`, `avatar:listening`; `Live2DStage.setEmotion/playMotion/mouth.start/stop/model.startMotion`.
- Produces: `class RevealPlan { constructor(text: string, opts?: { hanziMs?: 70; latinMs?: 35; commaMs?: 150; periodMs?: 300 }); steps(): Array<{ grapheme: string; delayMs: number; mouth: boolean }> }` (pure; tested: total duration for 20 hanzi + 1 comma + 1 period ≈ 20×70+150+300 ms; mouth false on punctuation steps; Latin faster);
  `class Bubble { show(anchor: DOMRect, opts): void; setText(text: string): void; complete(): void; hide(): void; pinned: boolean }` using Floating UI `computePosition` with `offset(12), flip(), shift({padding:16}), arrow()`; anchor = head bbox from `stage.model` (compute from the `Head` hit area's drawable vertices via a new `CompanionModel.hitAreaBounds(name): {x,y,w,h}` in view space → client px — add this method to `@ds/stage` in this task); linger 3 s unless hovered/pinned; max-width `min(28ch, 460px)`;
  `class SpeechController { constructor(stage, bubble, bridge); onState/onSentence/onTurnDone/onError }` — queues sentences; on `thinking`: `stage.setEmotion('think')` + `playMotion(config.motionMap.think)` + bubble shows `…` (three-dot breathing, no text); on each sentence: apply emotion (+ motion once), reveal via `RevealPlan` driving `bubble.setText` and `stage.mouth.start()/stop()` per step, honour `pause`; after all sentences of the turn shown → `playback:turnDone`; `sentenceShown` after each; click/Enter/Space → `complete()`; interruption (`brain:state thinking` for a new turnId) → drop queue, hide bubble; `avatar:listening {on:true}` → expression `curious` + freeze idle wandering (no-op in Phase 2 beyond expression) and mouth closed.
  `hint.ts`: a small bottom-centre toast in the pet window with its own surface (not the bubble), `showHint({text, level, ttlMs})`, max 1 visible, queue of 3.
- [ ] **Step 1:** Failing `reveal.test.ts` (4 tests as above). **Step 2:** Implement per DESIGN.md tokens; FPS: `stage.setFps(60)` while a bubble is visible/animating, back to 30 when hidden and not hovered. **Step 3:** Playwright: extend `tests/stage.spec.ts` with a test-hook `__stage.speak([{text:'你回来啦！', emotion:'happy'}, …])` that drives `SpeechController` without a bridge; assert the bubble element appears with the first grapheme within 100 ms of `speak()`, the text completes within the RevealPlan duration ± 20 %, and the mouth parameter (`__stage.mouth()` exposing `stage.mouth.getParameter()`) exceeds 0.3 at least once during reveal and returns to < 0.05 within 400 ms after completion. **Step 4:** Real desktop: `pnpm dev`, send three replies, screenshot bubble states (entering, mid-reveal, lingering) + a 300 % zoom crop of glyph edges → `docs/evidence/phase2/bubble-*.png`. **Step 5:** Commit `feat(pet): speech bubble with Chinese reveal cadence, mouth sync, thinking/listening poses, hint surface`

---

### Task 9: Chat popover (React) — composer, IME-safe send, history pane; key window

**Files:** Create `apps/desktop/src/renderer/chat.html`, `chat/main.tsx`, `chat/App.tsx`, `chat/Composer.tsx`, `chat/History.tsx`, `chat/bridge.ts`; `apps/desktop/src/renderer/key.html`, `key/main.tsx`, `key/App.tsx`; Modify `apps/desktop/package.json` (`react`, `react-dom` 19, `@types/react*`), `tsconfig.renderer.json` (`jsx: react-jsx`), `vite.browser.config.ts` (serve both pages).

**Interfaces:**
- Consumes: preload `window.dsChat` (`send(channel,payload)`, `on`, `invoke('history:list', …)`), tokens.css, DESIGN.md.
- Produces: Composer — `<textarea>` auto-grows 1→6 rows; `Enter` sends unless `isComposing` (track `compositionstart/end`, and ignore `keydown` with `e.isComposing || e.keyCode === 229`); `Shift+Enter` newline; `Esc` → `chat:close`; sends `chat:composing {on}` on composition boundaries; shows a thin "她在想…" state line bound to `brain:state`; History pane toggled by a chevron (`历史`): virtualized list of turns grouped by day (`今天 / 昨天 / 8月27日`), user right/assistant left, proactive/system rows visually distinct (`kind`), per-turn copy + delete (`history:delete`), empty state copy `还没聊过。说点什么吧。`. Key window: single input (masked, paste-friendly), `测试连接` (→ `key:test`, shows `可用 ✓` / the error reason), one-line disclosure `对话会发送到 DeepSeek（服务器位于中国）处理。`, `保存` (→ `key:set`), all copy in the product's Chinese voice; keyboard-only operable; focus trap.
- [ ] **Step 1:** Vitest + jsdom tests for `Composer` (add `jsdom` + `@testing-library/react`): Enter sends, Enter during composition does not, Shift+Enter inserts newline, auto-grow caps at 6 rows. **Step 2:** Implement to DESIGN.md. **Step 3:** Playwright on `chat.html?test=1` with a fake bridge: type via `page.keyboard.insertText` + IME simulation (`page.keyboard.press` sequence with `compositionstart` dispatched) verifies no send during composition; screenshot `docs/evidence/phase2/popover-*.png` (empty, typing, history open) and `key-window.png`. **Step 4:** Real desktop: hotkey opens ≤ 250 ms (measure with `performance.now()` logs), IME 拼音 input works, Esc closes, outside click closes and the click reaches the desktop. **Step 5:** Commit `feat(desktop): chat popover with IME-safe composer and history, API key window`

---

### Task 10: Persona content, first message, eval harness, end-to-end verification

**Files:** Create `characters/haru/persona.json` (content from the owner's description, written by the controller into the brief), `eval/fixtures/prompts.zh.json` (20 prompts: greetings, bland turns 嗯/哦, adversarial trait pressure ×5, sensitive ×3, flawed claims ×3, memory probes ×3, time-aware), `eval/judge.md` (rubric: in-character 0–2, assistant-leak yes/no, length ok, question discipline, nativeness), `eval/run.mjs` (Node script: for each prompt × 3 runs → `deepseek-v4-flash` via `@ds/brain`'s client with the real prompt assembler; lint every reply; judge with `deepseek-v4-pro` (thinking on) using `judge.md`; write `eval/out/<date>.json` + a markdown summary with pass rates vs the A-bar thresholds), `eval/README.md`; Modify `README.md` (Phase 2 usage), `apps/desktop/src/main/brain-service.ts` (load persona from `characters/haru/persona.json` via the character bundle; first run → `first_mes` shown as the first bubble).

- [ ] **Step 1:** Persona JSON validated by `CharacterCardSchema` (test in `persona.test.ts` loads the real file). **Step 2:** `eval/run.mjs --dry` runs against a fake client offline (fixture sanity, lint stats). **Step 3:** With `DEEPSEEK_API_KEY` set (owner provides): `node eval/run.mjs` → report; iterate the persona card + system rules until A1, A2, A4, A5, A6, A19 pass thresholds and in-character ≥ 90 %; commit the report. **Step 4:** Full desktop session: first run shows `first_mes`; 20 real turns; `metrics` table shows cache-hit ≥ 70 % after turn 3 (`SELECT`); screenshots: first message, a 3-bubble reply, history pane with the session, Task Manager CPU/RAM idle vs speaking → `docs/evidence/phase2/`. **Step 5:** Commit `feat: Haru persona, eval harness, phase 2 evidence` and tag `phase2-brain`.

---

## Self-review against the spec/addendum

- §3.1–3.6 brain: Tasks 1–4 (client params, prompt layout + byte-identical test, grammar, splitter, state machine incl. interruption, metrics). Lint-once policy adds a ruling: **buffer-then-emit** for Phase 2 (streaming sentences resume in Phase 3 with first-sentence lint) — recorded.
- §5 tier 1 + trimming: Task 5 (+ summarizer in Task 6). Tiers 2–3 are Phase 3.
- §7 input window / key storage / tray items: Tasks 6, 9. Settings window remains Phase 4 (key window is its seed). React yes, Tailwind no (ruling).
- §8 errors: Task 6 routing + Task 8 hint surface; malformed ACT → neutral (Task 2).
- §9 tests: unit (1–5, 8, 9), Playwright (8, 9), real-API gated (4 `testKey` smoke in Task 6 dev run, Task 10 eval), desktop screenshots (6, 8, 9, 10).
- Addendum A1–A10, A12–A23: A1/A2/A4/A5/A6/A7 via lint + eval; A3 lint + card rule; A8–A10 eval fixtures; A12 state preamble; A13/A16/A17/A18/A19 via persona card + judge; A20 first_mes; A21 card ≤ 700 tokens asserted in `persona.test.ts`; A22 Task 8; A23 Task 2. C1–C8, C10, C12–C15: Tasks 7–9 (+ detector run in Task 9 Step 3 per impeccable). X1 Tasks 3–4 + Task 10 cache check; X5 Task 9; X6 Task 6/8; X9 Task 9 key window; X12 Task 10.
- Placeholder scan: Task 3/10 persona content is supplied by the controller at dispatch (owner's description) — the schema and rules are fixed here; Task 7 is explicitly controller-led. No TBDs.
- Type consistency: `SentenceEvent` (Task 1 types) used by Tasks 2, 4, 6, 8; `ChatMessage`/`StatePreamble` (Task 3) used by 4, 5, 6; `HistoryPort` (Task 4) implemented by Task 5's `HistoryStore`; `LintResult` (Task 2) in Task 4's `turnDone`; channel names in Task 6 match Task 8/9 consumers; `CompanionModel.hitAreaBounds` added in Task 8 and used only there.
