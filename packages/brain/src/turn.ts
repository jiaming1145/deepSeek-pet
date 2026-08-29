import type { ErrorCode, LintResult } from '@ds/protocol';
import { CancelledError, DeepSeekError } from './deepseek.ts';
import type { ChatClient, ChatRequest } from './deepseek.ts';
import type { HistoryPort, MessageKind, MetricsPort, MetricsRecord } from './ports.ts';
import { LINT_NUDGE, assemblePrompt, planTrim } from './prompt.ts';
import type { AssembleInput, StatePreamble } from './prompt.ts';
import { sanitizeForDisplay } from './sanitize.ts';
import { isSensitive, lintSentence, lintTail } from './slop-lint.ts';
import type { LintContext } from './slop-lint.ts';
import { StreamParser } from './stream-parser.ts';
import type { ChatMessage, SentenceEvent, TurnState, Usage } from './types.ts';

// ---------------------------------------------------------------- public types

export interface TurnEvents {
  state: { state: TurnState; turnId: string };
  /** `text` is ALREADY sanitized — sanitizeForDisplay runs exactly once, here (A10). */
  sentence: SentenceEvent;
  turnDone: {
    turnId: string;
    usage: Usage | null;
    ttftMs: number | null;
    totalMs: number;
    complianceMiss: boolean;
    regenerated: boolean;
    lint: LintResult;
  };
  error: { turnId: string; code: ErrorCode; message: string };
}

export interface TurnRunnerDeps {
  client: ChatClient;
  history: HistoryPort;
  metrics?: MetricsPort;
  persona: {
    staticSystem: string;
    postHistoryInstructions: string;
    /** Declared by §3.11 and read by renderStaticSystem, not by this class. */
    motionKeys: string[];
    /** `offline` is BrainService's copy (§6.4); TurnRunner only ever speaks `empty` (§3.9.4). */
    cannedLines: { offline: string[]; empty: string[] };
  };
  state(): StatePreamble;
  lint?: boolean;
  now?: () => number;
  idFactory?: () => string;
  random?: () => number;
}

type Listener<K extends keyof TurnEvents> = (payload: TurnEvents[K]) => void;

type AttemptOutcome = 'ok' | 'regenerate' | 'abandoned';

type SentenceVerdict = 'accepted' | 'dropped' | 'regenerate';

const cleanLint = (): LintResult => ({ violations: [], severity: 'none' });

interface Turn {
  id: string;
  kind: MessageKind;
  /** The text this turn will commit — already the concatenation when it superseded a pending turn. */
  userText: string;
  startedAt: number;
  preamble: StatePreamble;
  ctx: LintContext;
  controller: AbortController;
  parser: StreamParser;
  /** The one-sentence lookahead: released only when the next sentence arrives or the stream ends. */
  pending: SentenceEvent | null;
  emitted: SentenceEvent[];
  shown: Set<number>;
  /** Every delta byte of the current attempt — the §3.9.4 empty-completion test. */
  rawStream: string;
  /** Raw text of the sentences that survived lintSentence — what lintTail reads. */
  rawKept: string;
  ttftMs: number | null;
  usage: Usage | null;
  regenerated: boolean;
  emptyRetried: boolean;
  lastLint: LintResult;
  commit: Promise<void> | null;
  committed: boolean;
  settled: boolean;
  acknowledged: boolean;
  base: { history: ChatMessage[]; summary: string; facts: string[] } | null;
}

// ---------------------------------------------------------------- the runner

export class TurnRunner {
  private readonly deps: TurnRunnerDeps;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly random: () => number;
  private readonly lintEnabled: boolean;
  private readonly listeners: { [K in keyof TurnEvents]: Set<Listener<K>> } = {
    state: new Set<Listener<'state'>>(),
    sentence: new Set<Listener<'sentence'>>(),
    turnDone: new Set<Listener<'turnDone'>>(),
    error: new Set<Listener<'error'>>(),
  };
  private current: Turn | null = null;
  private turnState: TurnState = 'idle';

  constructor(deps: TurnRunnerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? (() => globalThis.crypto.randomUUID());
    this.random = deps.random ?? Math.random;
    this.lintEnabled = deps.lint !== false;
  }

  get state(): TurnState {
    return this.turnState;
  }

  get turnId(): string | null {
    return this.current === null ? null : this.current.id;
  }

  on<K extends keyof TurnEvents>(event: K, cb: Listener<K>): () => void {
    const set = this.listeners[event] as Set<Listener<K>>;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  private emit<K extends keyof TurnEvents>(event: K, payload: TurnEvents[K]): void {
    const set = this.listeners[event] as Set<Listener<K>>;
    for (const cb of [...set]) cb(payload);
  }

  // -------------------------------------------------------------- public API

  /**
   * Resolves with the turnId as soon as the turn is admitted. The prompt build and the request are
   * detached: the build awaits history.onTrimNeeded, which in main is a non-streaming summarisation
   * call, and the chat composer must not wait for it.
   */
  send(text: string, kind: MessageKind = 'chat'): Promise<string> {
    const previous = this.current;
    let userText = text;
    if (previous !== null && !previous.settled) {
      previous.settled = true;
      previous.controller.abort();
      // Nothing was written for an uncommitted turn, so its text moves to the new turn instead.
      if (!previous.committed) userText = `${previous.userText}\n${text}`;
      this.detach(this.retire(previous, false, false));
    }

    const id = this.idFactory();
    const turn: Turn = {
      id,
      kind,
      userText,
      startedAt: this.now(),
      preamble: this.deps.state(),
      ctx: { recent: [], sensitiveTurn: false },
      controller: new AbortController(),
      parser: new StreamParser(id),
      pending: null,
      emitted: [],
      shown: new Set<number>(),
      rawStream: '',
      rawKept: '',
      ttftMs: null,
      usage: null,
      regenerated: false,
      emptyRetried: false,
      lastLint: cleanLint(),
      commit: null,
      committed: false,
      settled: false,
      acknowledged: false,
      base: null,
    };
    this.current = turn;
    this.setState('thinking', turn);
    this.detach(this.run(turn));
    return Promise.resolve(id);
  }

  cancel(): void {
    const turn = this.current;
    if (turn === null || turn.settled) return;
    turn.settled = true;
    turn.controller.abort();
    this.detach(this.retire(turn, true, true));
  }

  sentenceShown(turnId: string, seq: number): void {
    const turn = this.current;
    if (turn === null || turn.id !== turnId) return;
    turn.shown.add(seq);
  }

  turnShown(turnId: string): void {
    const turn = this.current;
    if (turn === null || turn.id !== turnId) return;
    turn.acknowledged = true;
    if (turn.settled) this.toIdle(turn);
  }

  // -------------------------------------------------------------- the turn body

  private abandoned(turn: Turn): boolean {
    return this.current !== turn || turn.settled;
  }

  private detach(work: Promise<void>): void {
    void work.catch((err: unknown) => {
      console.error('[turn] background failure', err);
    });
  }

  private async run(turn: Turn): Promise<void> {
    try {
      turn.ctx = {
        recent: await this.deps.history.recentAssistant(5),
        sensitiveTurn: isSensitive(turn.userText),
      };
      if (this.abandoned(turn)) return;

      let window = await this.deps.history.window();
      if (this.abandoned(turn)) return;
      const plan = planTrim(window);
      if (plan.drop.length > 0) {
        await this.deps.history.onTrimNeeded(plan);
        if (this.abandoned(turn)) return;
        window = await this.deps.history.window();
        if (this.abandoned(turn)) return;
      }
      const summary = await this.deps.history.summary();
      if (this.abandoned(turn)) return;
      const facts = await this.deps.history.facts();
      if (this.abandoned(turn)) return;

      turn.base = { history: window, summary, facts };
      await this.drive(turn);
    } catch (err) {
      await this.fail(turn, err);
    }
  }

  private assemble(turn: Turn, nudge: string | undefined): ChatMessage[] {
    const base = turn.base;
    const input: AssembleInput = {
      staticSystem: this.deps.persona.staticSystem,
      postHistoryInstructions: this.deps.persona.postHistoryInstructions,
      summary: base === null ? '' : base.summary,
      facts: base === null ? [] : base.facts,
      history: base === null ? [] : base.history,
      state: turn.preamble,
      userText: turn.userText,
    };
    if (nudge !== undefined) input.nudge = nudge;
    return assemblePrompt(input);
  }

  private async drive(turn: Turn): Promise<void> {
    let nudge: string | undefined;
    for (;;) {
      const outcome = await this.runAttempt(turn, this.assemble(turn, nudge));
      if (outcome === 'abandoned' || this.abandoned(turn)) return;

      if (outcome === 'regenerate') {
        turn.regenerated = true;
        nudge = LINT_NUDGE;
        this.resetAttempt(turn);
        continue;
      }

      if (this.isEmpty(turn)) {
        if (!turn.emptyRetried) {
          turn.emptyRetried = true;
          this.resetAttempt(turn);
          continue;
        }
        await this.settleEmpty(turn);
        return;
      }

      if (turn.pending !== null && this.lintEnabled) {
        const tail = lintTail(turn.rawKept, turn.ctx);
        turn.lastLint = tail;
        if (tail.severity !== 'none') {
          if (turn.emitted.length === 0 && !turn.regenerated) {
            turn.regenerated = true;
            nudge = LINT_NUDGE;
            this.resetAttempt(turn);
            continue;
          }
          turn.pending = null; // strip, never keep-and-mark (D6)
        }
      }

      await this.settleNormal(turn);
      return;
    }
  }

  private async runAttempt(turn: Turn, messages: ChatMessage[]): Promise<AttemptOutcome> {
    turn.controller = new AbortController();
    const request: ChatRequest = { messages };
    try {
      for await (const chunk of this.deps.client.stream(request, turn.controller.signal)) {
        if (this.abandoned(turn)) return 'abandoned';
        if (chunk.kind === 'usage') {
          turn.usage = chunk.usage;
          continue;
        }
        if (chunk.kind === 'done') continue;
        if (turn.ttftMs === null) turn.ttftMs = this.now() - turn.startedAt;
        turn.rawStream += chunk.text;
        for (const ev of turn.parser.push(chunk.text)) {
          if (this.consider(turn, ev) === 'regenerate') {
            turn.controller.abort();
            return 'regenerate';
          }
        }
      }
      if (this.abandoned(turn)) return 'abandoned';
      for (const ev of turn.parser.flush()) {
        if (this.consider(turn, ev) === 'regenerate') {
          turn.controller.abort();
          return 'regenerate';
        }
      }
      return 'ok';
    } catch (err) {
      if (err instanceof CancelledError) return 'abandoned';
      throw err;
    }
  }

  /** §3.11.2 steps 1-6, in order. */
  private consider(turn: Turn, ev: SentenceEvent): SentenceVerdict {
    const display = sanitizeForDisplay(ev.text);
    if (display === '') return 'dropped';

    const result = this.lintEnabled ? lintSentence(ev.text, turn.ctx) : cleanLint();
    turn.lastLint = result;

    if (
      result.severity === 'regenerate' &&
      turn.emitted.length === 0 &&
      turn.pending === null &&
      !turn.regenerated
    ) {
      return 'regenerate';
    }
    if (result.severity !== 'none') return 'dropped';

    if (turn.pending !== null) this.release(turn);
    turn.pending = { ...ev, text: display };
    turn.rawKept += ev.text;
    return 'accepted';
  }

  private release(turn: Turn): void {
    const ev = turn.pending;
    if (ev === null) return;
    turn.pending = null;
    if (turn.emitted.length === 0) {
      void this.commitUser(turn);
      this.setState('speaking', turn);
    }
    turn.emitted.push(ev);
    this.emit('sentence', ev);
  }

  private resetAttempt(turn: Turn): void {
    turn.parser = new StreamParser(turn.id);
    turn.pending = null;
    turn.rawStream = '';
    turn.rawKept = '';
    turn.ttftMs = null;
    turn.usage = null;
  }

  private isEmpty(turn: Turn): boolean {
    if (turn.rawStream === '') return true;
    return sanitizeForDisplay(turn.rawStream).trim() === '';
  }

  // -------------------------------------------------------------- terminal outcomes

  private async settleNormal(turn: Turn): Promise<void> {
    if (turn.pending !== null) this.release(turn);
    if (this.abandoned(turn)) return;
    turn.settled = true;
    await this.commitUser(turn);
    const text = turn.emitted.map((s) => s.text).join('');
    if (text !== '') {
      await this.deps.history.append('assistant', text, { turnId: turn.id, kind: turn.kind });
    }
    await this.finish(turn, null);
  }

  private async settleEmpty(turn: Turn): Promise<void> {
    const lines = this.deps.persona.cannedLines.empty;
    const index = Math.min(lines.length - 1, Math.max(0, Math.floor(this.random() * lines.length)));
    const text = lines[index];
    turn.settled = true;
    turn.lastLint = cleanLint();
    await this.commitUser(turn);
    const ev: SentenceEvent = { turnId: turn.id, seq: 0, text, emotion: 'awkward' };
    this.setState('speaking', turn);
    turn.emitted.push(ev);
    this.emit('sentence', ev);
    await this.deps.history.append('assistant', text, { turnId: turn.id, kind: 'system' });
    await this.finish(turn, 'empty');
  }

  /** cancel() and send()-while-busy share this path (§3.11.4). */
  private async retire(turn: Turn, commitUser: boolean, goIdle: boolean): Promise<void> {
    const totalMs = this.now() - turn.startedAt;
    this.emitTurnDone(turn, totalMs);
    if (goIdle) this.toIdle(turn);
    if (commitUser) await this.commitUser(turn);
    const shown = turn.emitted.filter((s) => turn.shown.has(s.seq)).sort((a, b) => a.seq - b.seq);
    if (shown.length > 0) {
      await this.deps.history.append('assistant', shown.map((s) => s.text).join(''), {
        turnId: turn.id,
        kind: turn.kind,
        interrupted: true,
      });
    }
    await this.record(turn, totalMs, null);
  }

  /** A DeepSeekError gets `error` + a MetricsRecord and NO turnDone (§3.11.5). */
  private async fail(turn: Turn, err: unknown): Promise<void> {
    if (err instanceof CancelledError) return;
    if (this.abandoned(turn)) return;
    turn.settled = true;
    const failure =
      err instanceof DeepSeekError
        ? err
        : new DeepSeekError('network', null, err instanceof Error ? err.message : String(err));
    await this.commitUser(turn);
    const totalMs = this.now() - turn.startedAt;
    this.emit('error', { turnId: turn.id, code: failure.code, message: failure.message });
    this.toIdle(turn);
    await this.record(turn, totalMs, failure.code);
  }

  private async finish(turn: Turn, errorCode: ErrorCode | null): Promise<void> {
    turn.settled = true;
    const totalMs = this.now() - turn.startedAt;
    this.emitTurnDone(turn, totalMs);
    if (turn.emitted.length === 0 || turn.acknowledged) this.toIdle(turn);
    await this.record(turn, totalMs, errorCode);
  }

  private emitTurnDone(turn: Turn, totalMs: number): void {
    this.emit('turnDone', {
      turnId: turn.id,
      usage: turn.usage,
      ttftMs: turn.ttftMs,
      totalMs,
      complianceMiss: turn.parser.complianceMiss,
      regenerated: turn.regenerated,
      lint: turn.lastLint,
    });
  }

  private commitUser(turn: Turn): Promise<void> {
    if (turn.commit === null) {
      turn.committed = true;
      turn.commit = this.deps.history.append('user', turn.userText, {
        turnId: turn.id,
        kind: turn.kind,
      });
    }
    return turn.commit;
  }

  private async record(turn: Turn, totalMs: number, errorCode: ErrorCode | null): Promise<void> {
    const port = this.deps.metrics;
    if (port === undefined) return;
    const usage = turn.usage;
    const entry: MetricsRecord = {
      turnId: turn.id,
      ts: this.now(),
      ttftMs: turn.ttftMs,
      totalMs,
      promptTokens: usage === null ? 0 : usage.promptTokens,
      cacheHit: usage === null ? 0 : usage.cacheHit,
      cacheMiss: usage === null ? 0 : usage.cacheMiss,
      completion: usage === null ? 0 : usage.completionTokens,
      complianceMiss: turn.parser.complianceMiss,
      regenerated: turn.regenerated,
      sensitive: turn.ctx.sensitiveTurn,
      lint: turn.lastLint,
      errorCode,
    };
    await port.record(entry);
  }

  private setState(state: TurnState, turn: Turn): void {
    this.turnState = state;
    this.emit('state', { state, turnId: turn.id });
  }

  private toIdle(turn: Turn): void {
    if (this.current !== turn) return;
    if (this.turnState === 'idle') return;
    this.setState('idle', turn);
  }
}
