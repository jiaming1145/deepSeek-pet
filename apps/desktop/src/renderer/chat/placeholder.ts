// T6 placeholder composer. T8 deletes this file and replaces chat.html with the React root.
import { Channels, InvokeChannels, type Payload } from '@ds/protocol';

interface Bridge {
  send(channel: string, payload: unknown): void;
  on(channel: string, cb: (payload: unknown) => void): () => void;
  invoke(channel: string, payload: unknown): Promise<unknown>;
}
declare global {
  interface Window { dsChat?: Bridge }
}

const ta = document.getElementById('ta') as HTMLTextAreaElement;
const bridge = window.dsChat;

ta.addEventListener('compositionstart', () => bridge?.send(Channels.chatComposing, { on: true }));
// The falling edge is deferred one macrotask: some IMEs deliver a trailing keydown after
// compositionend, and it must still be swallowed (contracts.md §6.2 rule 1).
ta.addEventListener('compositionend', () => setTimeout(() => bridge?.send(Channels.chatComposing, { on: false }), 0));
// §2.3's producer row also names focus/blur of the textarea, and its recovery box makes blur the
// unlatch: a swallowed `compositionend` would leave the chat undismissable by click-away all run.
ta.addEventListener('focus', () => bridge?.send(Channels.chatComposing, { on: false }));
ta.addEventListener('blur', () => bridge?.send(Channels.chatComposing, { on: false }));

ta.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return; // IME first, always
  if (e.key === 'Escape') { bridge?.send(Channels.chatClose, {}); return; }
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  const text = ta.value.trim();
  if (!text) { bridge?.send(Channels.speechComplete, {}); return; }
  ta.value = '';
  void bridge?.invoke(InvokeChannels.userText, { text }).then((r) => console.log('[chat] user:text ->', r));
});

bridge?.on(Channels.chatOpened, (p) => {
  if ((p as Payload<typeof Channels.chatOpened>).focusComposer) ta.focus();
});
bridge?.on(Channels.brainError, (p) => console.error('[chat] brain:error', p));
