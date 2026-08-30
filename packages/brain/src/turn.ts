import type { ErrorCode, LintResult, LintRule } from '@ds/protocol';
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
  /**
   * GC-3: a history append failed. The turn's other outcomes (turnDone/error/idle) are unaffected
   * — the reply WAS spoken — but the row is missing, and nobody may report it as persisted. Main
   * turns this into a warning and a `storage` hint; it is never a §3.11.5 `error`.
   */
  persistFailed: { turnId: string; label: string; message: string };
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

/** The tail rules whose violation lives in the final (pending, unpainted) sentence itself (I-3). */
const LAST_SENTENCE_RULES: ReadonlySet<LintRule> = new Set<LintRule>(['closing-moral', 'question-streak']);

/**
 * GC-3: the lifecycle of one history append as the state machine sees it. `pending` means the
 * write is queued or in flight; only `durable` means the row exists. A superseding send() carries
 * the previous turn's text forward when its user row is `none` or `failed` — never when it is
 * `durable`, and for `pending` only after the write has settled one way or the other.
 */
export type CommitState = 'none' | 'pending' | 'durable' | 'failed';

interface Turn {
  id: string;
  kind: MessageKind;
  /** The kind of this turn's assistant row(s): `kind`, or `'system'` for the §3.9.4 canned line (GC-2). */
  assistantKind: MessageKind;
  /** The MetricsRecord error code a normal or retired finish carries: `'empty'` for the canned line. */
  outcome: ErrorCode | null;
  /** The text this turn will commit — already the concatenation when it superseded a pending turn. */
  userText: string;
  startedAt: number;
  /** Stamped at the top of every runAttempt: ttftMs is dispatch-relative (M-6, §3.11.2). */
  dispatchedAt: number;
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
  /** True once any sentence of the current attempt reached consider() — gates the A23 strip (M-1). */
  consideredAny: boolean;
  /** One warning per turn for motions outside persona.motionKeys (M-25). */
  motionWarned: boolean;
  lastLint: LintResult;
  /** The user row's settled-or-not promise (never rejects); `userCommit` carries the verdict. */
  commit: Promise<void> | null;
  userCommit: CommitState;
  /**
   * GC-3: the turn this one superseded while its user row was still `pending`. run() waits for
   * that write and prepends the text only if it failed — never duplicating a durable row.
   */
  inherit: Turn | null;
  /**
   * The stream ended normally and turnDone/metrics are out — but the turn is NOT settled until
   * the bubble has revealed it (turnShown): a send()/cancel() before that still retires it and
   * history gets only the shown prefix, interrupted (CX-1 / R2).
   */
  streamFinished: boolean;
  /** turnDone was emitted (by finish() or retire()) — exactly once per turn. */
  reported: boolean;
  /** Terminal for send()/cancel()/fail(): nothing left to retire — history is final for this turn. */
  settled: boolean;
  /** Abandoned by cancel() or a superseding send() — the only reason the turn body stops early (G-4). */
  interrupted: boolean;
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
    persistFailed: new Set<Listener<'persistFailed'>>(),
  };
  private current: Turn | null = null;
  private turnState: TurnState = 'idle';
  /**
   * The write barrier (G-5): every history append goes through this chain, in the order it was
   * requested, and a new turn awaits it before reading its history window. The barrier itself
   * never rejects (I-8 / G-4); the per-operation promise enqueue() hands back DOES (GC-3), so the
   * state machine can tell a durable row from a failed one.
   */
  private writes: Promise<void> = Promise.resolve();

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
    let inherit: Turn | null = null;
    if (previous !== null && !previous.settled) {
      previous.settled = true;
      previous.interrupted = true;
      previous.controller.abort();
      // GC-3: a turn whose user row never landed (none / failed) hands its text to the new turn; a
      // row still in flight is awaited by run() and carried only if it fails.
      if (previous.userCommit === 'none' || previous.userCommit === 'failed') {
        userText = `${previous.userText}\n${text}`;
      } else if (previous.userCommit === 'pending') {
        inherit = previous;
      }
      this.detach(this.retire(previous, false, false));
    }

    const id = this.idFactory();
    const turn: Turn = {
      id,
      kind,
      assistantKind: kind,
      outcome: null,
      userText,
      startedAt: this.now(),
      dispatchedAt: 0,
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
      consideredAny: false,
      motionWarned: false,
      lastLint: cleanLint(),
      commit: null,
      userCommit: 'none',
      inherit,
      streamFinished: false,
      reported: false,
      settled: false,
      interrupted: false,
      acknowledged: false,
      base: null,
    };
    this.current = turn;
    this.setState('thinking', turn);
    this.detach(this.run(turn));
    return Promise.resolve(id);
  }

  /**
   * Resolves after retire()'s writes (user row, interrupted assistant row, metrics) have settled;
   * never rejects; resolves immediately when idle. The synchronous side effects (state -> idle,
   * turnDone) happen before it returns, exactly as before.
   */
  cancel(): Promise<void> {
    const turn = this.current;
    if (turn === null || turn.settled) return Promise.resolve();
    turn.settled = true;
    turn.interrupted = true;
    turn.controller.abort();
    const work = this.retire(turn, true, true);
    this.detach(work);
    return work.catch(() => undefined);
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
    if (turn.streamFinished && !turn.settled) {
      // CX-1: the bubble has revealed everything — only now is the full reply a truthful row.
      turn.settled = true;
      this.detach(this.commitAssistant(turn));
      this.toIdle(turn);
      return;
    }
    if (turn.settled) this.toIdle(turn);
  }

  // -------------------------------------------------------------- the turn body

  private abandoned(turn: Turn): boolean {
    return this.current !== turn || turn.interrupted;
  }

  /**
   * G-5 / GC-3: one ordered chain for every history append. Two promises per operation: the
   * returned OPERATION promise keeps the rejection (the caller decides what a lost row means);
   * the barrier the chain continues on is the caught one, so the next write is never blocked by
   * a failed one. Every failure is warned about and emitted as `persistFailed` exactly once, here.
   */
  private enqueue(turn: Turn, label: string, work: () => Promise<void>): Promise<void> {
    const op = this.writes.then(work);
    this.writes = op.catch((err: unknown) => {
      console.warn(`[turn] history write failed (${label})`, err);
      this.emit('persistFailed', {
        turnId: turn.id,
        label,
        message: err instanceof Error ? err.message : String(err),
      });
    });
    return op;
  }

  private detach(work: Promise<void>): void {
    void work.catch((err: unknown) => {
      console.error('[turn] background failure', err);
    });
  }

  private async run(turn: Turn): Promise<void> {
    try {
      // G-5: a superseding turn must not overtake the previous turn's appends.
      await this.writes;
      if (this.abandoned(turn)) return;
      // GC-3: the superseded turn's user row was in flight at send(); it has settled by now.
      const inherit = turn.inherit;
      if (inherit !== null) {
        turn.inherit = null;
        await inherit.commit;
        if (this.abandoned(turn)) return;
        if (inherit.userCommit === 'failed') turn.userText = `${inherit.userText}\n${turn.userText}`;
      }
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
          // I-3: only a last-sentence rule may delete the pending sentence — it is the offender.
          // Reply-scope rules (ellipsis, ellipsis-rate, affect-rate, emoji-rate, opener-repeat,
          // repetition) describe text that is already painted; their verdict stays in lastLint/metrics.
          // `ellipsis` (more than one …… in the reply) strips only when the pending sentence carries
          // one itself: removing it then repairs the violation, so it is an offender.
          const pendingText = turn.pending.text;
          const offender = tail.violations.some(
            (v) => LAST_SENTENCE_RULES.has(v.rule) || (v.rule === 'ellipsis' && pendingText.includes('……')),
          );
          if (offender) turn.pending = null; // strip, never keep-and-mark (D6)
        }
      }

      await this.settleNormal(turn);
      return;
    }
  }

  private async runAttempt(turn: Turn, messages: ChatMessage[]): Promise<AttemptOutcome> {
    turn.controller = new AbortController();
    turn.dispatchedAt = this.now();
    const request: ChatRequest = { messages };
    try {
      for await (const chunk of this.deps.client.stream(request, turn.controller.signal)) {
        if (this.abandoned(turn)) return 'abandoned';
        if (chunk.kind === 'usage') {
          turn.usage = chunk.usage;
          continue;
        }
        if (chunk.kind === 'done') continue;
        if (turn.ttftMs === null) turn.ttftMs = this.now() - turn.dispatchedAt;
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
    const display = sanitizeForDisplay(ev.text, { leadingNumber: !turn.consideredAny });
    turn.consideredAny = true;
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
    const next: SentenceEvent = { ...ev, text: display };
    // M-25: a motion the persona does not declare never reaches the stage; the emotion stays.
    if (next.motion !== undefined && !this.deps.persona.motionKeys.includes(next.motion)) {
      if (!turn.motionWarned) {
        turn.motionWarned = true;
        console.warn(`[turn] dropped unknown motion "${next.motion}" (turn ${turn.id})`);
      }
      delete next.motion;
    }
    turn.pending = next;
    turn.rawKept += ev.text;
    return 'accepted';
  }

  private release(turn: Turn): void {
    const ev = turn.pending;
    if (ev === null) return;
    turn.pending = null;
    if (turn.emitted.length === 0) {
      void this.commitUser(turn); // never rejects (GC-3); its verdict lives in turn.userCommit
      this.setState('speaking', turn);
    }
    turn.emitted.push(ev);
    this.emit('sentence', ev);
  }

  private resetAttempt(turn: Turn): void {
    turn.parser = new StreamParser(turn.id);
    turn.pending = null;
    turn.consideredAny = false;
    turn.rawStream = '';
    turn.rawKept = '';
    turn.ttftMs = null;
    turn.usage = null;
  }

  /** I-2: emptiness is a parser fact (no non-whitespace text outside tags); the sanitizer is the fallback. */
  private isEmpty(turn: Turn): boolean {
    if (!turn.parser.hasText) return true;
    return sanitizeForDisplay(turn.rawStream).trim() === '';
  }

  // -------------------------------------------------------------- terminal outcomes

  private async settleNormal(turn: Turn): Promise<void> {
    if (turn.pending !== null) this.release(turn);
    await this.settleFinished(turn);
  }

  /**
   * The shared end of a normal reply and of the canned line (GC-2): the stream is finished,
   * turnDone + metrics go out once, and the assistant row is written only when playback is
   * acknowledged — by turnShown(), or here when nothing is left to show.
   */
  private async settleFinished(turn: Turn): Promise<void> {
    if (this.abandoned(turn)) return;
    turn.streamFinished = true;
    const writes = [this.commitUser(turn)];
    // CX-1: the full assistant row is written only once playback is acknowledged. When turnShown
    // already arrived (or there is nothing to show) the turn settles here; otherwise turnShown()
    // writes the row, and a send()/cancel() before it retires the turn with the shown prefix.
    const settleNow = turn.emitted.length === 0 || turn.acknowledged;
    if (settleNow) {
      turn.settled = true;
      writes.push(this.commitAssistant(turn));
    }
    await Promise.all(writes);
    // A send()/cancel() during the writes retired this turn only if it was NOT settled above;
    // retire() then already emitted turnDone + metrics. A settled turn superseded meanwhile
    // (current !== turn, not interrupted) still owes its terminal report (§3.11) — finish()
    // is safe there: toIdle() no-ops for a non-current turn.
    if (turn.reported) return;
    await this.finish(turn);
  }

  /**
   * The normal (un-flagged) assistant row: the whole emitted reply. Enqueued synchronously (G-5).
   * Never rejects: the failure is warned about and emitted as `persistFailed` by enqueue (GC-3).
   */
  private commitAssistant(turn: Turn): Promise<void> {
    const text = turn.emitted.map((s) => s.text).join('');
    if (text === '') return Promise.resolve();
    const label = turn.assistantKind === 'system' ? 'canned line' : 'assistant row';
    return this.enqueue(turn, label, () =>
      this.deps.history.append('assistant', text, { turnId: turn.id, kind: turn.assistantKind })).catch(noop);
  }

  /**
   * §3.9.4: the canned line. GC-2: it is a reply like any other — emitted while the turn is still
   * unsettled, reported at once, and its `kind:'system'` row written by turnShown(); a send(),
   * cancel() or bubble crash before that retires it and persists only what was acknowledged.
   */
  private async settleEmpty(turn: Turn): Promise<void> {
    const lines = this.deps.persona.cannedLines.empty;
    const index = Math.min(lines.length - 1, Math.max(0, Math.floor(this.random() * lines.length)));
    const text = lines[index];
    turn.lastLint = cleanLint();
    turn.assistantKind = 'system';
    turn.outcome = 'empty';
    turn.pending = { turnId: turn.id, seq: 0, text, emotion: 'awkward' };
    this.release(turn);
    await this.settleFinished(turn);
  }

  /**
   * The ordered "what the user actually saw" write, shared by retire() and fail() (R2 / G-6):
   * the sentences whose sentenceShown arrived, in seq order, as one interrupted assistant row.
   * Enqueued synchronously so a superseding turn's barrier already covers it.
   */
  private persistShown(turn: Turn): Promise<void> {
    const shown = turn.emitted.filter((s) => turn.shown.has(s.seq)).sort((a, b) => a.seq - b.seq);
    if (shown.length === 0) return Promise.resolve();
    const text = shown.map((s) => s.text).join('');
    return this.enqueue(turn, 'interrupted assistant row', () =>
      this.deps.history.append('assistant', text, {
        turnId: turn.id, kind: turn.assistantKind, interrupted: true,
      })).catch(noop);
  }

  /** cancel() and send()-while-busy share this path (§3.11.4). */
  private async retire(turn: Turn, commitUser: boolean, goIdle: boolean): Promise<void> {
    const totalMs = this.now() - turn.startedAt;
    // A stream-finished turn already reported (turnDone + metrics): retiring it during playback
    // only rewrites history to the shown prefix (CX-1) — never a second turnDone.
    const report = !turn.reported;
    turn.reported = true;
    if (report) this.emitTurnDone(turn, totalMs);
    if (goIdle) this.toIdle(turn);
    // Both writes are enqueued before the first await, so they precede anything a new turn does.
    const writes: Promise<void>[] = [];
    if (commitUser) writes.push(this.commitUser(turn));
    writes.push(this.persistShown(turn));
    await Promise.all(writes);
    if (report) await this.record(turn, totalMs, turn.outcome);
  }

  /** A DeepSeekError gets `error` + a MetricsRecord and NO turnDone (§3.11.5). */
  private async fail(turn: Turn, err: unknown): Promise<void> {
    if (err instanceof CancelledError) return;
    // A turn that already reported (turnDone out, e.g. a listener threw inside finish()) is a
    // completed turn, never an error: no `error` event, no second MetricsRecord.
    if (turn.settled || turn.reported || this.abandoned(turn)) return;
    turn.settled = true;
    const failure =
      err instanceof DeepSeekError
        ? err
        : new DeepSeekError('network', null, err instanceof Error ? err.message : String(err));
    // G-6: what the user already saw is persisted once, as interrupted, before the error goes out.
    await Promise.all([this.commitUser(turn), this.persistShown(turn)]);
    const totalMs = this.now() - turn.startedAt;
    this.emit('error', { turnId: turn.id, code: failure.code, message: failure.message });
    this.toIdle(turn);
    await this.record(turn, totalMs, failure.code);
  }

  private async finish(turn: Turn): Promise<void> {
    const totalMs = this.now() - turn.startedAt;
    turn.reported = true;
    this.emitTurnDone(turn, totalMs);
    if (turn.emitted.length === 0 || turn.acknowledged) this.toIdle(turn);
    await this.record(turn, totalMs, turn.outcome);
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

  /**
   * The user row, enqueued once. The returned promise never rejects — it resolves when the write
   * has SETTLED — and `turn.userCommit` says how (GC-3).
   */
  private commitUser(turn: Turn): Promise<void> {
    if (turn.commit === null) {
      turn.userCommit = 'pending';
      const op = this.enqueue(turn, 'user row', () =>
        this.deps.history.append('user', turn.userText, { turnId: turn.id, kind: turn.kind }));
      turn.commit = op.then(
        () => { turn.userCommit = 'durable'; },
        () => { turn.userCommit = 'failed'; },
      );
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
    try {
      await port.record(entry);
    } catch (err) {
      console.warn('[turn] metrics write failed', err);
    }
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

const noop = (): void => {};
