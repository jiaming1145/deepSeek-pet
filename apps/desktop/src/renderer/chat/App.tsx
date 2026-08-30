import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Channels, ERROR_HINTS, InvokeChannels } from '@ds/protocol';
import type { TurnState } from '@ds/protocol';
import { Composer } from './Composer';
import type { SendResult, TurnDoneSignal, TurnErrorSignal } from './Composer';
import { History, HISTORY_PAGE } from './History';
import type { DsInvokeBridge } from './bridge';

export interface AppProps {
  bridge: DsInvokeBridge;
}

function focusComposer(): void {
  const el = document.querySelector<HTMLTextAreaElement>('.composer__input');
  if (el === null) return;
  el.focus();
  el.select();
}

export function App({ bridge }: AppProps): JSX.Element {
  const [brainState, setBrainState] = useState<TurnState>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [turnDone, setTurnDone] = useState<TurnDoneSignal | null>(null);
  const [turnError, setTurnError] = useState<TurnErrorSignal | null>(null);
  const [keyPresent, setKeyPresent] = useState(true);
  const seqRef = useRef(0);
  const rowsRef = useRef(1);
  const historyOpenRef = useRef(false);

  useEffect(() => {
    const offs = [
      bridge.on(Channels.brainState, (p) => setBrainState(p.state)),
      bridge.on(Channels.brainTurnDone, (p) => setTurnDone({ turnId: p.turnId, n: ++seqRef.current })),
      bridge.on(Channels.brainError, (p) =>
        setTurnError({ turnId: p.turnId ?? null, code: p.code, message: p.message, n: ++seqRef.current }),
      ),
      bridge.on(Channels.chatOpened, (p) => {
        if (p.focusComposer) focusComposer();
      }),
      bridge.on(Channels.keyStatus, (p) => setKeyPresent(p.present)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [bridge]);

  const sendSize = useCallback(
    (rows: number, open: boolean) => {
      bridge.send(Channels.chatResize, { rows, historyOpen: open });
    },
    [bridge],
  );

  const onRowsChange = useCallback(
    (rows: number) => {
      rowsRef.current = rows;
      sendSize(rows, historyOpenRef.current);
    },
    [sendSize],
  );

  const onToggleHistory = useCallback(() => {
    const next = !historyOpenRef.current;
    historyOpenRef.current = next;
    setHistoryOpen(next);
    sendSize(rowsRef.current, next);
  }, [sendSize]);

  const onSend = useCallback(
    (text: string): Promise<SendResult> => bridge.invoke(InvokeChannels.userText, { text }),
    [bridge],
  );
  const onCancel = useCallback(() => bridge.send(Channels.userCancel, {}), [bridge]);
  const onClose = useCallback(() => bridge.send(Channels.chatClose, {}), [bridge]);
  const onComposingChange = useCallback(
    (on: boolean) => bridge.send(Channels.chatComposing, { on }),
    [bridge],
  );
  const onCompleteSpeech = useCallback(() => bridge.send(Channels.speechComplete, {}), [bridge]);

  const list = useCallback(
    (opts: { before?: number; limit?: number }) =>
      bridge.invoke(InvokeChannels.historyList, { before: opts.before, limit: opts.limit ?? HISTORY_PAGE }),
    [bridge],
  );
  const remove = useCallback(
    async (turnId: string) => {
      await bridge.invoke(InvokeChannels.historyDelete, { turnId });
    },
    [bridge],
  );

  return (
    <div className="app" data-history={historyOpen ? 'open' : 'closed'}>
      <History open={historyOpen} list={list} remove={remove} />
      {!keyPresent && <p className="app__nokey">{ERROR_HINTS['no-key'].text}</p>}
      <Composer
        onSend={onSend}
        onCancel={onCancel}
        onClose={onClose}
        onComposingChange={onComposingChange}
        onCompleteSpeech={onCompleteSpeech}
        onRowsChange={onRowsChange}
        onToggleHistory={onToggleHistory}
        historyOpen={historyOpen}
        brainState={brainState}
        turnDone={turnDone}
        turnError={turnError}
      />
    </div>
  );
}
