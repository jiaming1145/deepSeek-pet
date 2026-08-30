import { app, ipcMain, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  Channels, ERROR_HINTS, InvokeChannels,
  type ErrorCode, type SentenceEvent,
} from '@ds/protocol';
import {
  DeepSeekClient, TurnRunner, renderStaticSystem, sanitizeForDisplay,
  type ChatClient, type CharacterBundle, type StatePreamble,
} from '@ds/brain';
import { KV_FIRST_RUN_DONE, getKv, setKv } from '@ds/memory';
import type { HistoryStore } from '@ds/memory';
import { BUBBLE_MAX, type Rect } from './bubble-place';
import {
  BUBBLE_HIDE_DELAY_MS, BUBBLE_LINGER_MS,
  placeBubbleWindow, repositionBubble, setBubbleClickThrough,
} from './bubble-window';
import { resizeChat, setChatComposing } from './chat-window';
import { createFakeClient, useFakeBrain } from './fake-client';
import { humanizeGap } from './humanize';
import { handleInvoke } from './invoke';
import { onFromAny, sendTo } from './ipc';
import type { KeyStore } from './key-store';
import type { KeyWindowReason } from './key-window';
import { boundedDetail, redactSecrets } from './redact';

/** Mirrors the renderer's HINT_DEFAULT_TTL_MS (contracts.md §5.5); `hint:show` requires a ttl. */
export const HINT_TTL_MS = 6000;
/**
 * GC-3 / A-38: a history append failed (disk full, a closed handle). The reply was spoken, so the
 * turn's outcome stands, but the user must know the line was not remembered. The copy is §2.8's
 * `storage` row; kept under this name for the callers that read it.
 */
export const STORAGE_HINT_TEXT: string = ERROR_HINTS.storage.text;
/** §6.6: a pause between characters must not flicker the listening pose. */
const LISTENING_OFF_DEBOUNCE_MS = 250;
/** §6.6's first message uses a turnId no TurnRunner ever issues; its playback echoes are dropped. */
const FIRST_MES_TURN_ID = 'first-mes';

const TIME_FMT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const WEEKDAY_FMT = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });

/** Every send channel this service registers, so `dispose()` can unregister exactly those. */
const OWNED_SEND_CHANNELS = [
  Channels.userCancel, Channels.chatClose, Channels.chatComposing, Channels.chatResize,
  Channels.speechComplete, Channels.playbackSentenceDone, Channels.playbackTurnDone,
  Channels.speechMouth, Channels.bubbleSize, Channels.bubbleHover,
] as const;

export interface BrainServiceDeps {
  pet: BrowserWindow;
  /** Replaceable (CX-6 / CX-7): index.ts recreates a window whose renderer cannot be brought back. */
  bubble: BrowserWindow;
  chat: BrowserWindow;
  key: BrowserWindow;
  store: HistoryStore;
  keyStore: KeyStore;
  bundle: CharacterBundle;
  /** The raw handle, for the `kv` table only (§4.1's getKv/setKv). §4.3 exposes no kv accessor. */
  db: DatabaseSync;
  /** index.ts owns show/hide because bubble visibility must lose to VisibilityState (§5.4 rule 5). */
  setBubbleVisible(on: boolean): void;
  openKeyWindow(reason: KeyWindowReason): void;
  /**
   * GC-5: the probe for a LITERAL `key:test` (an unsaved key typed into the key window). Defaults
   * to a real DeepSeekClient; tests inject a fake so no key:test can reach the network.
   */
  probeClient?(apiKey: string): ChatClient;
}

/** GC-5: a key is never compared or logged as itself — the first 16 hex chars of its sha-256. */
function keyFingerprint(apiKey: string | null): string | null {
  return apiKey === null ? null : createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

interface KeyTestInFlight {
  controller: AbortController;
  settled: Promise<void>;
}

export class BrainService {
  private readonly deps: BrainServiceDeps;
  private readonly staticSystem: string;
  private client: ChatClient | null = null;
  private runner: TurnRunner | null = null;
  private offRunner: Array<() => void> = [];
  private offKey: (() => void) | null = null;
  private lastTest: { ok: boolean; code?: ErrorCode; at: number } | null = null;
  /**
   * GC-5: bumped by every rebuildClient() (key change) and by dispose(). A key:test result is
   * applied to the broadcast `lastTest` only when the generation it started in is still current
   * AND the key it tested is the key stored now (by fingerprint) — a literal test of an unsaved
   * key, or a test that outlived a rotation, is returned to its caller and nothing else.
   */
  private keyGen = 0;
  /** GC-6: every in-flight key:test; rebuildClient() and dispose() abort them, dispose() drains them. */
  private readonly keyTests = new Set<KeyTestInFlight>();
  private listeningTimer: NodeJS.Timeout | null = null;
  private bubbleTimer: NodeJS.Timeout | null = null;
  /** The last `bubble:hover` value: pointer inside the bubble/hint DOM (§5.4 rule 4, §5.2's box). */
  private bubblePinned = false;
  /** CX-6: the retire started by bubbleCrashed(); dispose() awaits it before the db closes. */
  private retiring: Promise<void> | null = null;
  /** True while a window-level hide is owed for this turn but has not happened yet. */
  private hideOwed = false;
  private emittedThisTurn = 0;
  /** I-9: set once by `dispose()`; every delayed callback checks it before touching a window or the db. */
  private disposed = false;
  /** I-9: the bubble `did-finish-load` callback, stored so `dispose()` can take it off again. */
  private onBubbleLoaded: (() => void) | null = null;
  /** G-9: the greeting was broadcast and awaits the bubble's `playback:turnDone` to be persisted. */
  private firstMesPending = false;
  /**
   * CX-6 / CX-7: the IPC allow-lists are held as live arrays, not literals — `onFromAny` and
   * `handleInvoke` look the sender up at event time, so `replaceBubble`/`replaceKey` can swap a
   * recreated window in without re-registering every channel.
   */
  private readonly bubbleWins: BrowserWindow[] = [];
  private readonly keyWins: BrowserWindow[] = [];

  constructor(deps: BrainServiceDeps) {
    this.deps = deps;
    // Built once and cached: byte stability of this string IS the prefix-cache contract (X1).
    // The third parameter defaults to 'character'; P3's 'plain' mode is a Phase 3 tray toggle.
    this.staticSystem = renderStaticSystem(deps.bundle.card, Object.keys(deps.bundle.motionMap));
  }

  start(): void {
    const { pet, chat, store, keyStore } = this.deps;
    const bubble = this.bubbleWins;
    const key = this.keyWins;
    bubble.push(this.deps.bubble);
    key.push(this.deps.key);

    this.offKey = keyStore.onChange(() => this.rebuildClient());
    this.rebuildClient();

    // ---- invoke handlers: window-scoped, exactly per contracts.md §2.7 -------------------
    handleInvoke(InvokeChannels.userText, [chat], async ({ text }) => {
      if (!this.runner) {
        this.reportError({ code: 'no-key', message: ERROR_HINTS['no-key'].text });
        return { ok: false as const, code: 'no-key' as const, message: ERROR_HINTS['no-key'].text };
      }
      try {
        const turnId = await this.runner.send(text, 'chat');
        return { ok: true as const, turnId };
      } catch (err) {
        // §3.11.5 delivers real failures through the `error` event, so a throw here is an
        // unexpected one. The composer restores its text on `{ok:false}` (§6.2 rule 6); a bare
        // invoke rejection would leave the user's sentence lost.
        const message = err instanceof Error ? err.message : String(err);
        console.error('[brain] user:text failed', err);
        return { ok: false as const, code: 'server' as const, message };
      }
    });

    handleInvoke(InvokeChannels.keySet, key, async ({ apiKey }) => {
      try {
        keyStore.set(apiKey);
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
      }
    });

    handleInvoke(InvokeChannels.keyTest, key, async ({ apiKey }) => {
      // With an apiKey: test that literal key. Without: test the stored one (contracts.md §2.4).
      const literal = apiKey ? apiKey : null;
      const probe: ChatClient | null = literal !== null ? this.makeProbe(literal) : this.client;
      if (!probe) {
        if (this.disposed) return { ok: false as const, code: 'no-key' as const, message: ERROR_HINTS['no-key'].text };
        this.lastTest = { ok: false, code: 'no-key', at: Date.now() };
        this.refreshKeyStatus();
        return { ok: false as const, code: 'no-key' as const, message: ERROR_HINTS['no-key'].text };
      }
      // GC-5 / GC-6: stamp the generation and the tested key's fingerprint BEFORE the await; track
      // the controller so a key change or dispose() can abort it, and the promise so dispose() drains it.
      const gen = this.keyGen;
      const tested = keyFingerprint(literal ?? keyStore.get());
      const controller = new AbortController();
      const run = probe.testKey(controller.signal);
      const entry: KeyTestInFlight = { controller, settled: run.then(() => undefined, () => undefined) };
      this.keyTests.add(entry);
      let res: Awaited<typeof run>;
      try {
        res = await run;
      } catch (err) {
        res = { ok: false, code: 'network', message: err instanceof Error ? err.message : String(err) };
      } finally {
        this.keyTests.delete(entry);
      }
      if (this.disposed || gen !== this.keyGen) return res; // stale: the caller gets its answer, the status does not
      if (tested !== keyFingerprint(keyStore.get())) return res; // an unsaved literal key never describes the stored one
      this.lastTest = res.ok ? { ok: true, at: Date.now() } : { ok: false, code: res.code, at: Date.now() };
      this.refreshKeyStatus();
      return res;
    });

    handleInvoke(InvokeChannels.keyClear, key, async () => {
      keyStore.clear();
      return { ok: true as const };
    });

    handleInvoke(InvokeChannels.historyList, [chat], async ({ before, limit }) => {
      const rows = store.list({ before, limit });
      // Rows come back newest-first, so the smallest id is the last one; null once the page is
      // short, which is also the empty case.
      const nextBefore = rows.length < limit ? null : rows[rows.length - 1].id;
      return { rows, nextBefore };
    });

    handleInvoke(InvokeChannels.historyDelete, [chat], async ({ turnId }) => ({
      ok: true as const,
      deleted: store.deleteTurn(turnId),
    }));

    // ---- send channels: one `onFromAny` per producing window (§2.5 + §2.7) ---------------
    onFromAny([chat], Channels.userCancel, () => this.runner?.cancel());
    onFromAny([chat], Channels.chatClose, () => {
      if (!chat.isDestroyed()) chat.hide();
    });
    onFromAny([chat], Channels.chatComposing, ({ on }) => {
      setChatComposing(on);
      this.setListening(on);
    });
    onFromAny([chat], Channels.chatResize, ({ rows, historyOpen }) => {
      resizeChat(chat, pet, rows, historyOpen);
      // A grown composer covers more of the band's column, so the band has to step clear again.
      this.reposition();
    });
    // The composer takes the band's own anchor rect (§6.1), so the band has to move out of its way
    // for as long as the composer is up. `show`/`hide` on the chat window is the one place that
    // catches EVERY path into and out of that state - the band click, the hotkey, the tray item,
    // Escape, the blur light-dismiss and VisibilityState - without widening openChat/closeChat.
    chat.on('show', this.onChatVisibilityChanged);
    chat.on('hide', this.onChatVisibilityChanged);
    // Two relays, because the mouth lives in the pet window while the reveal lives in the bubble.
    onFromAny([chat], Channels.speechComplete, (p) => sendTo(this.deps.bubble, Channels.speechComplete, p));
    onFromAny(bubble, Channels.speechMouth, (p) => sendTo(pet, Channels.speechMouth, p));

    onFromAny(bubble, Channels.playbackSentenceDone, ({ turnId, seq }) => {
      if (turnId === FIRST_MES_TURN_ID) return;
      this.runner?.sentenceShown(turnId, seq);
    });
    onFromAny(bubble, Channels.playbackTurnDone, ({ turnId }) => {
      if (turnId === FIRST_MES_TURN_ID) void this.commitFirstMessage();
      else this.runner?.turnShown(turnId);
      this.scheduleBubbleHide(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    });

    onFromAny(bubble, Channels.bubbleSize, (size) => {
      const placement = placeBubbleWindow(this.deps.bubble, pet, size, this.composerRect());
      sendTo(this.deps.bubble, Channels.bubblePlace, {
        // The renderer lays out inside the maxima and reports what it actually needs (§5.4 rule 2).
        maxWidth: BUBBLE_MAX.width,
        maxHeight: BUBBLE_MAX.height,
        side: placement.side,
        arrowOffset: placement.arrowOffset,
      });
    });
    // One channel, two effects (contracts.md §5.4 rule 4 as extended by §5.2's box): it flips the
    // window's click-through AND gates main's window-level hide timer. Without the second effect the
    // WINDOW disappears BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS after `playback:turnDone` even while
    // the pointer rests on a band the renderer is still holding up — so §5.2's "pinned defers the
    // turn-level auto-hide" and "pointerleave re-arms a full LINGER_MS" would be true in jsdom and
    // false end to end, and T7's hover acceptance would be unprovable in the Electron lane.
    onFromAny(bubble, Channels.bubbleHover, ({ inside }) => {
      setBubbleClickThrough(this.deps.bubble, !inside);
      this.bubblePinned = inside;
      if (inside) {
        // Defer, do not forget: clear the timer but leave the debt, so the leave can re-arm it.
        this.clearBubbleTimer();
        return;
      }
      // pointerleave re-arms a FULL delay, and only when this turn already asked for a hide.
      if (this.hideOwed) this.scheduleBubbleHide(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
    });

    // ---- first message (§6.6) ------------------------------------------------------------
    if (this.deps.bubble.webContents.isLoading()) {
      this.onBubbleLoaded = () => {
        this.onBubbleLoaded = null;
        if (!this.disposed) this.maybeFirstMessage();
      };
      this.deps.bubble.webContents.once('did-finish-load', this.onBubbleLoaded);
    } else {
      this.maybeFirstMessage();
    }
  }

  /** The live client, rebuilt on every key change. The summarizer closure reads it through this. */
  currentClient(): ChatClient | null {
    return this.client;
  }

  private makeProbe(apiKey: string): ChatClient {
    return this.deps.probeClient ? this.deps.probeClient(apiKey) : new DeepSeekClient({ apiKey });
  }

  /** GC-5 / GC-6: no key:test result started before this call may describe the key stored from now on. */
  private invalidateKeyTests(): void {
    this.keyGen += 1;
    for (const t of this.keyTests) t.controller.abort();
  }

  /**
   * Bound once so `dispose()` can take it off the chat window again — the same discipline
   * OWNED_SEND_CHANNELS applies to the ipcMain listeners.
   */
  private readonly onChatVisibilityChanged = (): void => this.reposition();

  /**
   * The VISIBLE composer's rect, which the band must not share pixels with, or null when the
   * composer is not on screen — in which case the band takes its own anchor rect back.
   */
  private composerRect(): Rect | null {
    const { chat } = this.deps;
    return chat.isDestroyed() || !chat.isVisible() ? null : chat.getBounds();
  }

  /**
   * §5.4 rule 3: re-place the bubble at its current size — pet drag, drag end, display change.
   * `force` (M-10) places a HIDDEN window too: every show path calls it first, so a pet drag that
   * happened while the band was down is applied before `showInactive()` instead of one
   * `bubble:size` round-trip later, when the band had already flashed at its stale bounds.
   */
  reposition(force = false): void {
    const { bubble, pet } = this.deps;
    if (bubble.isDestroyed() || pet.isDestroyed()) return;
    if (!force && !bubble.isVisible()) return;
    const placement = repositionBubble(bubble, pet, this.composerRect());
    sendTo(bubble, Channels.bubblePlace, {
      maxWidth: BUBBLE_MAX.width,
      maxHeight: BUBBLE_MAX.height,
      side: placement.side,
      arrowOffset: placement.arrowOffset,
    });
  }

  /** `key:status`'s only producer (R9): KeyStore changes, key:test results, key-window open. */
  refreshKeyStatus(): void {
    const { keyStore, key, chat } = this.deps;
    const payload = {
      present: keyStore.get() !== null,
      source: keyStore.source(),
      lastTest: this.lastTest,
    };
    sendTo(key, Channels.keyStatus, payload);
    sendTo(chat, Channels.keyStatus, payload);
  }

  /**
   * M-8: the bubble WINDOW was hidden by index.ts (a VisibilityState verdict, or the owed hide
   * itself). A hide under the pointer delivers no pointerleave, so the hover pin and the
   * non-click-through state would otherwise survive into the next show: no auto-hide, and a
   * transparent band eating clicks. The pin is dropped, click-through restored, and a hide that
   * the pin was deferring is re-armed — the pointer is, for every purpose, gone.
   */
  bubbleHidden(): void {
    setBubbleClickThrough(this.deps.bubble, true);
    if (!this.bubblePinned) return;
    this.bubblePinned = false;
    if (this.hideOwed && !this.disposed) this.scheduleBubbleHide(BUBBLE_LINGER_MS + BUBBLE_HIDE_DELAY_MS);
  }

  /**
   * CX-6: the bubble renderer is gone. Called from the window's `render-process-gone` BEFORE the
   * page is reloaded. Whatever was playing can never report `playback:sentenceDone` /
   * `playback:turnDone` again, so the runner would sit in `speaking` forever and the pet with it:
   * the turn is retired as interrupted (turnDone + idle emitted, the shown prefix persisted as
   * `[中断]`), every bubble-side state is reset — pin, timers, the owed hide, the pending greeting —
   * and the window is taken down; the reload's `bubble:size` handshake re-places it and the next
   * turn shows it again.
   */
  bubbleCrashed(): void {
    if (this.disposed) return;
    console.warn('[brain] bubble renderer lost mid-turn; retiring the turn as interrupted');
    const runner = this.runner;
    if (runner) {
      const turnId = runner.turnId;
      // Not awaited here: the retire's writes (shown prefix as [中断], metrics) are awaited by
      // dispose() on quit through `retiring` (I-9) — a second `cancel()` on the already-settled
      // turn resolves at once and would not cover them.
      this.retiring = runner.cancel();
      // CX-1: a turn whose stream already finished but whose reveal the bubble never acknowledged
      // is retired by that cancel() exactly like a mid-stream one — history keeps only the shown
      // prefix. A turn that was already acknowledged and settled just needs the idle transition.
      if (turnId !== null && runner.state !== 'idle') runner.turnShown(turnId);
    }
    this.firstMesPending = false;
    this.bubblePinned = false;
    this.cancelBubbleHide();
    this.emittedThisTurn = 0;
    this.deps.setBubbleVisible(false); // -> index.ts hides it and calls bubbleHidden() (click-through)
  }

  /** CX-6: a recreated bubble window takes the old one's place in every send and allow-list. */
  replaceBubble(win: BrowserWindow): void {
    this.deps.bubble = win;
    this.bubbleWins.splice(0, this.bubbleWins.length, win);
  }

  /** CX-7: same for the key window, recreated on the next open after its renderer died. */
  replaceKey(win: BrowserWindow): void {
    this.deps.key = win;
    this.keyWins.splice(0, this.keyWins.length, win);
  }

  /**
   * I-9: a shutdown BARRIER, not a fire-and-forget. `before-quit` awaits it before `db.close()`,
   * because `TurnRunner.cancel()` retires the turn asynchronously — the `[中断]` assistant row and
   * the metrics row are written in later microtasks, and a closed handle under them threw
   * ERR_INVALID_STATE into a swallowed `detach()`. Idempotent; the second call resolves at once.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const { bubble, chat } = this.deps;
    if (this.onBubbleLoaded && !bubble.isDestroyed()) {
      bubble.webContents.removeListener('did-finish-load', this.onBubbleLoaded);
    }
    this.onBubbleLoaded = null;
    this.offKey?.();
    this.offKey = null;
    if (this.listeningTimer) clearTimeout(this.listeningTimer);
    this.listeningTimer = null;
    this.clearBubbleTimer();
    for (const channel of Object.values(InvokeChannels)) ipcMain.removeHandler(channel);
    for (const channel of OWNED_SEND_CHANNELS) ipcMain.removeAllListeners(channel);
    if (!chat.isDestroyed()) {
      chat.removeListener('show', this.onChatVisibilityChanged);
      chat.removeListener('hide', this.onChatVisibilityChanged);
    }
    // The runner's listeners stay attached through the cancel so the windows still get the
    // turnDone/idle the retire emits. `TurnRunner.cancel(): Promise<void>` (BRAIN lane) resolves
    // after retire's writes settle; awaiting a `void` from an older turn.ts is harmless.
    // GC-6: in-flight key tests are aborted and their settlement is part of the bounded drain, so
    // none of them can run its continuation against a closing window.
    this.invalidateKeyTests();
    await this.runner?.cancel();
    await this.retiring;
    this.retiring = null;
    await Promise.all([...this.keyTests].map((t) => t.settled));
    // G2-2: a summarisation the retire (or an earlier turn) started is still on the wire; its
    // commit must land before index.ts closes the db, or be fenced by `HistoryStore.close()`.
    await this.deps.store.trimSettled();
    for (const off of this.offRunner) off();
    this.offRunner = [];
    this.runner = null;
  }

  // ---------------------------------------------------------------------------------------

  private rebuildClient(): void {
    // §2.3's pinned rule (M-7): `lastTest` describes the key stored NOW; a key change invalidates it —
    // and (GC-5) so is every test still in flight: aborted, and its result kept off the status.
    this.lastTest = null;
    this.invalidateKeyTests();
    // A22: no turn in flight survives a key change — it is cancelled first.
    void this.runner?.cancel();
    for (const off of this.offRunner) off();
    this.offRunner = [];
    this.runner = null;

    // §6.7: this is the single construction site for a ChatClient, and key rotation runs through
    // it, so the DS_FAKE_BRAIN choice is made here rather than once at startup in index.ts.
    if (useFakeBrain(app.isPackaged, process.env)) {
      this.client = createFakeClient();
      console.log('[brain] DS_FAKE_BRAIN=1 -> echo brain (no network, no key)');
    } else {
      const apiKey = this.deps.keyStore.get();
      this.client = apiKey ? new DeepSeekClient({ apiKey }) : null;
    }

    if (this.client) {
      const runner = new TurnRunner({
        client: this.client,
        history: this.deps.store,
        // A25 / §3.11.2: the metrics row is written by TurnRunner through this port — it is the
        // only place that knows `sensitive` and `errorCode`. BrainService must not fabricate them.
        metrics: this.deps.store,
        persona: {
          staticSystem: this.staticSystem,
          postHistoryInstructions: this.deps.bundle.card.post_history_instructions,
          motionKeys: Object.keys(this.deps.bundle.motionMap),
          cannedLines: this.deps.bundle.cannedLines,
        },
        state: () => this.state(),
      });
      this.attachRunner(runner);
      this.runner = runner;
    }
    this.refreshKeyStatus();
  }

  private attachRunner(runner: TurnRunner): void {
    const { pet, chat } = this.deps;
    // Read at event time, not captured: the bubble window can be recreated under us (CX-6).
    const bubble = (): BrowserWindow => this.deps.bubble;

    this.offRunner.push(
      runner.on('state', (p) => {
        sendTo(pet, Channels.brainState, p);
        sendTo(bubble(), Channels.brainState, p);
        sendTo(chat, Channels.brainState, p);
        if (p.state === 'thinking') {
          this.emittedThisTurn = 0;
          this.cancelBubbleHide();
          this.showBubble();
        }
        // A turn where every sentence was stripped (§3.11.2 step 4) emits no sentence, so no
        // `playback:turnDone` will ever come back and §5.4's only hide trigger would never fire.
        // G-7: gated on no hide already being owed — an error before the first sentence has just
        // armed its hint for HINT_TTL_MS, and this fallback used to replace that timer with a
        // 400 ms one, so the hint vanished almost at once.
        if (p.state === 'idle' && this.emittedThisTurn === 0 && !this.hideOwed) {
          this.scheduleBubbleHide(BUBBLE_HIDE_DELAY_MS);
        }
      }),
    );

    this.offRunner.push(
      runner.on('sentence', (ev) => {
        this.emittedThisTurn++;
        console.log('[brain] sentence seq=%d emotion=%s %s', ev.seq, ev.emotion, ev.text);
        sendTo(pet, Channels.brainSentence, ev);
        sendTo(bubble(), Channels.brainSentence, ev);
      }),
    );

    this.offRunner.push(
      runner.on('turnDone', (p) => {
        console.log('[brain] turnDone turn=%s totalMs=%d regenerated=%s', p.turnId, p.totalMs, p.regenerated);
        sendTo(pet, Channels.brainTurnDone, p);
        sendTo(bubble(), Channels.brainTurnDone, p);
        sendTo(chat, Channels.brainTurnDone, p);
      }),
    );

    this.offRunner.push(runner.on('error', (p) => this.reportError(p)));
    this.offRunner.push(runner.on('persistFailed', (p) => this.reportPersistFailed(runner, p)));
  }

  /**
   * GC-3 / A-38: the row is missing and nothing may claim otherwise — the log gets the label plus
   * a bounded, redacted detail, the chat window gets `brain:error {code:'storage'}` (its message
   * is the hint copy, never the upstream error), and the bubble gets the storage hint. The bubble
   * is NOT sent the error: its `brain:error` handler drops the reveal in flight, and A-26/A-38
   * keep turnDone / idle unaffected by a failed write. During a turn the playback still owns the
   * window-level hide (the hint rides along); when idle the hint owns it, as reportError's.
   */
  private reportPersistFailed(runner: TurnRunner, p: { turnId: string; label: string; message: string }): void {
    if (this.disposed) return;
    console.warn('[brain] history write failed (%s) turn=%s detail=%s', p.label, p.turnId, boundedDetail(p.message));
    const { bubble, chat } = this.deps;
    const hint = ERROR_HINTS.storage;
    sendTo(chat, Channels.brainError, { turnId: p.turnId, code: 'storage', message: hint.text });
    if (runner.state === 'idle') {
      this.cancelBubbleHide();
      this.showBubble();
    }
    sendTo(bubble, Channels.hintShow, { text: hint.text, level: hint.level, ttlMs: HINT_TTL_MS });
    if (runner.state === 'idle') this.scheduleBubbleHide(HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS);
  }

  private reportError(p: { turnId?: string; code: ErrorCode; message: string }): void {
    const { bubble, chat } = this.deps;
    // G-3: `message` originates upstream. Never raw: keys redacted before IPC, and the log gets
    // the code plus a bounded, redacted detail — not the body.
    const message = redactSecrets(p.message);
    const payload = p.turnId
      ? { turnId: p.turnId, code: p.code, message }
      : { code: p.code, message };
    console.error('[brain] error code=%s detail=%s', p.code, boundedDetail(p.message));
    sendTo(bubble, Channels.brainError, payload);
    sendTo(chat, Channels.brainError, payload);

    const hint = ERROR_HINTS[p.code];
    // §2.8: `empty` carries text '' on purpose — §3.9.4 speaks a canned line instead, so no hint.
    if (hint.text) {
      // The hint surface is a separate layer (C10): an app error never speaks in her voice.
      this.cancelBubbleHide();
      this.showBubble();
      sendTo(bubble, Channels.hintShow, { text: hint.text, level: hint.level, ttlMs: HINT_TTL_MS });
      this.scheduleBubbleHide(HINT_TTL_MS + BUBBLE_HIDE_DELAY_MS);
    }
    if (hint.opensKeyWindow) this.deps.openKeyWindow(p.code);
  }

  private state(): StatePreamble {
    const now = new Date();
    const last = this.deps.store.lastMessageTs();
    return {
      localTime: TIME_FMT.format(now),
      weekday: WEEKDAY_FMT.format(now),
      // Constants in Phase 2; @ds/sim replaces them in Phase 3 without touching this signature.
      // They never reach the prompt as numbers — prompt.ts turns them into phrases (C-5).
      mood: 0.1,
      energy: 70,
      affection: 50,
      sinceLastChat: humanizeGap(last === null ? 0 : now.getTime() - last),
    };
  }

  /** R9's pinned producer: `avatar:listening` is derived by main from `chat:composing`. */
  private setListening(on: boolean): void {
    if (this.listeningTimer) {
      clearTimeout(this.listeningTimer);
      this.listeningTimer = null;
    }
    if (on) {
      sendTo(this.deps.pet, Channels.avatarListening, { on: true });
      return;
    }
    this.listeningTimer = setTimeout(() => {
      this.listeningTimer = null;
      if (this.disposed) return;
      sendTo(this.deps.pet, Channels.avatarListening, { on: false });
    }, LISTENING_OFF_DEBOUNCE_MS);
  }

  /** M-10: every show goes through here — placed at the current pet position FIRST, then shown. */
  private showBubble(): void {
    this.reposition(true);
    this.deps.setBubbleVisible(true);
  }

  /** Clears only the pending timer. The hide stays *owed* — used while the pointer pins the bubble. */
  private clearBubbleTimer(): void {
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
  }

  /** Clears the timer AND the debt: a new turn started, or the window is already on its way down. */
  private cancelBubbleHide(): void {
    this.clearBubbleTimer();
    this.hideOwed = false;
  }

  private scheduleBubbleHide(ms: number): void {
    this.clearBubbleTimer();
    this.hideOwed = true;
    // Pinned right now: arm nothing. `bubble:hover {inside:false}` re-arms the full delay.
    if (this.bubblePinned) return;
    this.bubbleTimer = setTimeout(() => {
      this.bubbleTimer = null;
      if (this.disposed) return;
      // The pointer can arrive between arming and firing; re-check, and let the leave re-arm.
      if (this.bubblePinned) return;
      this.hideOwed = false;
      this.deps.setBubbleVisible(false);
    }, ms);
  }

  private maybeFirstMessage(): void {
    const { db, pet, bubble, chat, store, bundle } = this.deps;
    if (getKv(db, KV_FIRST_RUN_DONE) === '1') return;
    const text = sanitizeForDisplay(bundle.card.first_mes);
    if (!text) return;

    const turnId = FIRST_MES_TURN_ID;
    const sentence: SentenceEvent = { turnId, seq: 0, text, emotion: 'happy' };
    const done = {
      turnId,
      usage: null,
      ttftMs: null,
      totalMs: 0,
      complianceMiss: false,
      regenerated: false,
      lint: { violations: [], severity: 'none' as const },
    };

    this.cancelBubbleHide();
    this.showBubble();
    // NO `brain:state` is sent for 'first-mes' — not `thinking`, and above all not a trailing
    // `idle` (contracts.md §6.6's pinned first-run broadcast set). §5.2 gives the bubble's
    // `onState({state:'idle'})` the meaning "drop the queue and finish the turn", and by the time
    // such an `idle` arrived `SpeechController` would already have run `beginTurn('first-mes')`
    // from the sentence below — so the trailing `idle` would cancel the reveal timer at grapheme
    // 0 and `first_mes` would never paint. (§5.2's "an `idle` for a turnId the controller never
    // saw is ignored" does not save it: the controller HAS seen 'first-mes'.) The pet loses
    // nothing — `brain:sentence` carries the emotion and §5.7's `brainSentence` handler sets the
    // pose; `fpsState.speaking` stays false for this one synthetic turn because §5.6 drives it
    // from `brain:state`, which does not exist here. The window comes back down on the bubble's
    // own `playback:turnDone` (§5.4 hide trigger 2), which the handler above turns into a
    // `scheduleBubbleHide` while dropping the 'first-mes' id before any `TurnRunner` sees it.
    // `brain:sentence` is not in MAIN_TO_CHAT — the chat window never receives sentences (§2.5).
    for (const win of [pet, bubble]) sendTo(win, Channels.brainSentence, sentence);
    for (const win of [pet, bubble, chat]) sendTo(win, Channels.brainTurnDone, done);
    // G-9: persisted by `commitFirstMessage` once the bubble reports the reveal finished — a quit
    // before then must greet again next run, and a failed write must not mark the run done.
    this.firstMesPending = true;
  }

  /**
   * G-9: the greeting's history row and the first-run marker, in that order, as one handled
   * operation. The user saw it, so it belongs in history — as `system`, not as a chat turn (R10.3).
   * No marker if the append fails; the rejection is logged, never left unhandled.
   */
  private async commitFirstMessage(): Promise<void> {
    if (!this.firstMesPending) return;
    this.firstMesPending = false;
    const { db, store, bundle } = this.deps;
    const text = sanitizeForDisplay(bundle.card.first_mes);
    try {
      await store.append('assistant', text, { turnId: FIRST_MES_TURN_ID, kind: 'system' });
      if (this.disposed) return; // the db is closing under us; the greeting simply plays again
      setKv(db, KV_FIRST_RUN_DONE, '1');
    } catch (err) {
      console.error('[brain] first message could not be persisted; it will play again', err);
    }
  }
}
