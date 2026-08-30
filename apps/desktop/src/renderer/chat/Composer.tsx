import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ErrorCode, TurnState } from '@ds/protocol';
import { CHAT_MAX_ROWS, CHAT_ROW_H } from '../shared/chat-metrics';

export type SendResult =
  | { ok: true; turnId: string }
  | { ok: false; code: ErrorCode; message: string };

/** `n` is a monotonic counter so a repeated turnId still re-fires the effect. */
export interface TurnDoneSignal {
  turnId: string;
  n: number;
}
/** CA-9: `brain:error.turnId` is optional on the wire; App.tsx normalises it to null once. */
export interface TurnErrorSignal {
  turnId: string | null;
  code: ErrorCode;
  message: string;
  n: number;
}

export interface ComposerProps {
  onSend(text: string): Promise<SendResult>;
  onCancel(): void;
  onClose(): void;
  onComposingChange(on: boolean): void;
  onCompleteSpeech(): void;
  onRowsChange(rows: number): void;
  onToggleHistory(): void;
  historyOpen: boolean;
  brainState: TurnState;
  turnDone: TurnDoneSignal | null;
  turnError: TurnErrorSignal | null;
  disabled?: boolean;
}

const STATE_LINE: Record<TurnState, string> = {
  idle: '',
  thinking: '她在想…',
  speaking: '她在说…',
};

export function Composer(props: ComposerProps): JSX.Element {
  const {
    onSend, onCancel, onClose, onComposingChange, onCompleteSpeech, onRowsChange,
    onToggleHistory, historyOpen, brainState, turnDone, turnError, disabled = false,
  } = props;

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const pendingRef = useRef<{ text: string; turnId: string } | null>(null);
  const restoreRef = useRef<string | null>(null);
  const [value, setValue] = useState('');
  const [rows, setRows] = useState(1);
  // Bumped by restore(). The focus/select effect keys on this counter rather than on `value`,
  // because a restore can put back the SAME string the user has already retyped: React then bails
  // out of the re-render, the effect never runs, the restored text is neither focused nor selected
  // (spec 8 / 6.2 rule 6), and restoreRef stays populated so the next keystroke fires a stale
  // setSelectionRange over freshly typed text.
  const [restoreTick, setRestoreTick] = useState(0);

  // Auto-grow: newline count, raised by wrapped-line overflow, capped at CHAT_MAX_ROWS.
  useLayoutEffect(() => {
    const el = inputRef.current;
    let next = value.length === 0 ? 1 : value.split('\n').length;
    if (el !== null) {
      // `rows` has to drop to 1 for the measurement too. `height: auto` on a textarea resolves to
      // whatever `rows` asks for, so measuring while rows is still the previous (larger) value
      // reports that height back as scrollHeight and the band can only ever grow — verified in the
      // real window: after one six-line message the composer stayed six rows tall forever, empty.
      const keepH = el.style.height;
      const keepRows = el.rows;
      el.rows = 1;
      el.style.height = 'auto';
      const measured = Math.ceil(el.scrollHeight / CHAT_ROW_H);
      el.rows = keepRows;
      el.style.height = keepH;
      if (measured > next) next = measured;
    }
    setRows(Math.max(1, Math.min(CHAT_MAX_ROWS, next)));
  }, [value]);

  useEffect(() => {
    onRowsChange(rows);
  }, [rows, onRowsChange]);

  // Runs after the restored text is committed, so the selection covers the real value.
  // `setValue` and `setRestoreTick` are dispatched together, so React commits both in one render
  // and the textarea already holds the restored text by the time this runs.
  useEffect(() => {
    if (restoreTick === 0) return;
    const text = restoreRef.current;
    restoreRef.current = null;
    if (text === null) return;
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(0, text.length);
  }, [restoreTick]);

  const restore = useCallback((text: string) => {
    restoreRef.current = text;
    setValue(text);
    setRestoreTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (turnDone === null) return;
    const pending = pendingRef.current;
    if (pending !== null && pending.turnId === turnDone.turnId) pendingRef.current = null;
  }, [turnDone]);

  useEffect(() => {
    if (turnError === null) return;
    const pending = pendingRef.current;
    if (pending === null) return;
    if (turnError.turnId !== null && turnError.turnId !== pending.turnId) return;
    pendingRef.current = null;
    restore(pending.text);
  }, [turnError, restore]);

  const submit = useCallback(
    async (text: string) => {
      setValue('');
      const res = await onSend(text);
      if (res.ok) {
        pendingRef.current = { text, turnId: res.turnId };
      } else {
        pendingRef.current = null;
        restore(text);
      }
    },
    [onSend, restore],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // R6: the IME guard runs before every other branch.
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || composingRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (brainState !== 'idle') {
          onCancel();
          return;
        }
        onClose();
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const text = value.trim();
      if (text.length === 0) {
        onCompleteSpeech();
        return;
      }
      void submit(text);
    },
    [brainState, onCancel, onClose, onCompleteSpeech, submit, value],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    onComposingChange(true);
  }, [onComposingChange]);

  const handleCompositionEnd = useCallback(() => {
    // Next macrotask, so the trailing keydown some IMEs deliver is still swallowed.
    window.setTimeout(() => {
      composingRef.current = false;
      onComposingChange(false);
    }, 0);
  }, [onComposingChange]);

  const busy = brainState !== 'idle';

  return (
    <section className="composer" data-state={brainState}>
      <span className="composer__rail" aria-hidden="true" />
      <div className="composer__meta">
        <span className="plate">
          <span className="plate__text">你</span>
        </span>
        <button type="button" className="chip" aria-expanded={historyOpen} onClick={onToggleHistory}>
          历史
          <span className="chip__chevron" aria-hidden="true">{historyOpen ? '▾' : '▸'}</span>
        </button>
        <span className="composer__state" role="status">{STATE_LINE[brainState]}</span>
      </div>
      <div className="composer__row">
        {/* CA-13 / 6.2 rule 8: the textarea is the initial focus target, not only after chat:opened. */}
        <textarea
          ref={inputRef}
          className="composer__input"
          aria-label="说点什么"
          placeholder="说点什么…"
          autoFocus
          rows={rows}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          // contracts.md 2.3's recovery rule: focus and blur of the textarea are the UNLATCH, and
          // blur sends {on:false} "unconditionally, whether or not a compositionend arrived".
          // Sending {on:true} on focus arms main's light-dismiss guard for the whole time the
          // composer holds focus, and the window `blur` in main fires before the renderer's
          // `{on:false}` can reach it — verified in the real app: a click on the desktop landed
          // (foreground became Progman) but the chat never dismissed. Only compositionstart arms
          // the guard, which is the "composer focused AND an IME session open" state 2.3 names.
          //
          // R9 side effect, recorded rather than papered over: main also derives `avatar:listening`
          // from this channel (6.6, 250 ms falling-edge debounce). With the polarity corrected,
          // `{on:true}` is produced by `compositionstart` only, so the listening pose now means
          // "an IME session is open", not "the composer has focus" — typing Latin text or pasting
          // never raises it. contracts.md 6.6 carries the same narrowing as a fix-round-1
          // amendment; re-pinning the producer (composer focus plus keystroke activity, derived in
          // main) is a T6/controller change and deliberately out of T8's ownership.
          onFocus={() => onComposingChange(false)}
          onBlur={() => onComposingChange(false)}
        />
        <button
          type="button"
          className="composer__action"
          onClick={() => {
            if (busy) {
              onCancel();
              return;
            }
            const text = value.trim();
            if (text.length === 0) {
              onCompleteSpeech();
              return;
            }
            void submit(text);
          }}
        >
          {busy ? '停' : '发送'}
        </button>
      </div>
    </section>
  );
}
