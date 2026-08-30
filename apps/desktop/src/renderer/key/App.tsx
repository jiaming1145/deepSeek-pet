import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Channels, ERROR_HINTS, InvokeChannels } from '@ds/protocol';
import type { ErrorCode } from '@ds/protocol';
import type { DsKeyBridge } from './bridge';

/** contracts.md 6.4 — one line, verbatim; Phase 2 ships no extra note link beside it. */
export const DISCLOSURE = '对话内容会发送到 DeepSeek（服务器在中国境内）处理，回复由 AI 生成。';

type KeySource = 'store' | 'dev-env' | 'none';

const HEADER: Record<KeySource, string> = {
  store: '已保存',
  'dev-env': '开发环境的临时 Key',
  none: '还没设置',
};

export interface KeyAppProps {
  bridge: DsKeyBridge;
  onRequestClose(): void;
}

export function App({ bridge, onRequestClose }: KeyAppProps): JSX.Element {
  const [present, setPresent] = useState(false);
  const [source, setSource] = useState<KeySource>('none');
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const off = bridge.on(Channels.keyStatus, (p) => {
      setPresent(p.present);
      setSource(p.source);
    });
    inputRef.current?.focus();
    return off;
  }, [bridge]);

  // ERROR_HINTS is the single error-code -> copy table (contracts.md 2.8). `empty` carries an
  // empty string on purpose, so fall back to the transport message in that one case.
  const fail = useCallback((code: ErrorCode, message: string) => {
    const hint = ERROR_HINTS[code].text;
    setNote({ tone: 'bad', text: hint.length > 0 ? hint : message });
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    try {
      const res = await bridge.invoke(InvokeChannels.keyTest, apiKey.length > 0 ? { apiKey } : {});
      if (res.ok) setNote({ tone: 'ok', text: '可用 ✓' });
      else fail(res.code, res.message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, bridge, fail]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const set = await bridge.invoke(InvokeChannels.keySet, { apiKey });
      if (!set.ok) {
        setNote({ tone: 'bad', text: set.message });
        return;
      }
      const res = await bridge.invoke(InvokeChannels.keyTest, {});
      if (!res.ok) {
        fail(res.code, res.message);
        return;
      }
      setNote({ tone: 'ok', text: '可用 ✓' });
      bridge.send(Channels.chatOpen, { source: 'key', focusComposer: true });
      onRequestClose();
    } finally {
      setBusy(false);
    }
  }, [apiKey, bridge, fail, onRequestClose]);

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      await bridge.invoke(InvokeChannels.keyClear, {});
      setApiKey('');
      setNote(null);
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        if (present) onRequestClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = rootRef.current;
      if (root === null) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'),
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    },
    [onRequestClose, present],
  );

  return (
    <div className="key" ref={rootRef} onKeyDown={onKeyDown}>
      <header className="key__head">
        <span className="plate">
          <span className="plate__text">API Key</span>
        </span>
        <span className="key__status" role="status">{HEADER[source]}</span>
      </header>

      <label className="key__label" htmlFor="api-key">DeepSeek API Key</label>
      <div className="key__field">
        <input
          id="api-key"
          ref={inputRef}
          className="key__input"
          type={reveal ? 'text' : 'password'}
          value={apiKey}
          placeholder="sk-…"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setApiKey(e.target.value)}
        />
        <button type="button" className="key__toggle" onClick={() => setReveal((v) => !v)}>
          {reveal ? '隐藏' : '显示'}
        </button>
      </div>

      <p className="key__disclosure">{DISCLOSURE}</p>
      {note !== null && (
        <p className={`key__note key__note--${note.tone}`} role="alert">{note.text}</p>
      )}

      <div className="key__actions">
        <button type="button" disabled={busy} onClick={() => void test()}>测试连接</button>
        <button type="button" disabled={busy || apiKey.length < 8} onClick={() => void save()}>保存</button>
        <button type="button" disabled={busy || !present} onClick={() => void clear()}>清除</button>
      </div>
    </div>
  );
}
