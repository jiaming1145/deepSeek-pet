// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Channels } from '@ds/protocol';
import type { Channel, Payload } from '@ds/protocol';
import { App } from './App';
import type { DsInvokeBridge } from './bridge';

// See Composer.test.tsx: vitest's `globals: false` leaves RTL's auto-cleanup unregistered.
afterEach(cleanup);

type Handler = (payload: never) => void;

/** Records nothing, answers every invoke with an empty history page, lets a test fire main→chat events. */
function fakeBridge(): DsInvokeBridge & { fire<C extends Channel>(channel: C, payload: Payload<C>): void } {
  const handlers = new Map<string, Set<Handler>>();
  return {
    send() {},
    on(channel, cb) {
      const set = handlers.get(channel) ?? new Set<Handler>();
      set.add(cb as Handler);
      handlers.set(channel, set);
      return () => {
        set.delete(cb as Handler);
      };
    },
    invoke() {
      return Promise.resolve({ rows: [], hasMore: false } as never);
    },
    fire(channel, payload) {
      for (const cb of handlers.get(channel) ?? []) cb(payload as never);
    },
  };
}

describe('App', () => {
  // Final review M-17: closeChat only hides the window, so a draft survives Escape. The re-open
  // must focus with the caret at the END; select-all belongs to restore() alone (contracts §2.3
  // amendment proposed in fix-renderer-report.md).
  it('chat:opened focuses the composer with the caret at the end of a retained draft, never selected (M-17)', () => {
    const bridge = fakeBridge();
    render(<App bridge={bridge} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '写到一半' } });
    ta.blur();
    ta.setSelectionRange(0, 0);
    act(() => bridge.fire(Channels.chatOpened, { focusComposer: true }));
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(4);
    expect(ta.selectionEnd).toBe(4);
  });
});
