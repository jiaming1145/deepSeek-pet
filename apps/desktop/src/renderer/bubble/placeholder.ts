// T6 placeholder. T7 deletes this file and replaces bubble.html's body with the real ADV band.
import { Channels, type Payload } from '@ds/protocol';

interface Bridge {
  send(channel: string, payload: unknown): void;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}
declare global {
  interface Window { dsBubble?: Bridge }
}

const box = document.getElementById('box') as HTMLDivElement;
const bridge = window.dsBubble;

// A hidden bubble measures 0x0 and `bubble:size` requires positive numbers, so clamp before send.
new ResizeObserver(() => {
  const r = box.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) bridge?.send(Channels.bubbleSize, { width: r.width, height: r.height });
}).observe(box);

bridge?.on(Channels.brainState, (p) => {
  const s = p as Payload<typeof Channels.brainState>;
  if (s.state === 'thinking') box.textContent = '…';
});

bridge?.on(Channels.brainSentence, (p) => {
  const ev = p as Payload<typeof Channels.brainSentence>;
  box.textContent = (box.textContent === '…' ? '' : box.textContent ?? '') + ev.text;
  bridge.send(Channels.playbackSentenceDone, { turnId: ev.turnId, seq: ev.seq });
});

bridge?.on(Channels.brainTurnDone, (p) => {
  bridge.send(Channels.playbackTurnDone, { turnId: (p as Payload<typeof Channels.brainTurnDone>).turnId });
});

bridge?.on(Channels.hintShow, (p) => {
  box.textContent = `[hint] ${(p as Payload<typeof Channels.hintShow>).text}`;
});
