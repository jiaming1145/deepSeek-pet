// T6 placeholder. T8 deletes this file and replaces key.html with the React root.
import { Channels, ERROR_HINTS, InvokeChannels, type ErrorCode, type Payload } from '@ds/protocol';

interface Bridge {
  send(channel: string, payload: unknown): void;
  on(channel: string, cb: (payload: unknown) => void): () => void;
  invoke(channel: string, payload: unknown): Promise<unknown>;
}
declare global {
  interface Window { dsKey?: Bridge }
}

type TestRes = { ok: true } | { ok: false; code: ErrorCode; message: string };

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const input = el('k') as HTMLInputElement;
const msg = el('msg');
const bridge = window.dsKey;

el('save').addEventListener('click', () => {
  void bridge?.invoke(InvokeChannels.keySet, { apiKey: input.value }).then(async (r) => {
    const set = r as { ok: boolean; message?: string };
    if (!set.ok) { msg.textContent = set.message ?? '保存失败'; return; }
    const t = (await bridge.invoke(InvokeChannels.keyTest, {})) as TestRes;
    msg.textContent = t.ok ? '可用 ✓' : ERROR_HINTS[t.code].text;
    if (t.ok) bridge.send(Channels.chatOpen, { source: 'key', focusComposer: true });
  });
});

el('test').addEventListener('click', () => {
  void bridge?.invoke(InvokeChannels.keyTest, { apiKey: input.value }).then((r) => {
    const t = r as TestRes;
    msg.textContent = t.ok ? '可用 ✓' : ERROR_HINTS[t.code].text;
  });
});

el('clear').addEventListener('click', () => {
  void bridge?.invoke(InvokeChannels.keyClear, {}).then(() => { input.value = ''; msg.textContent = '已清除'; });
});

bridge?.on(Channels.keyStatus, (p) => {
  const s = p as Payload<typeof Channels.keyStatus>;
  el('status').textContent =
    s.source === 'store' ? '已保存' : s.source === 'dev-env' ? '开发环境的临时 Key' : '还没设置';
});
