// @vitest-environment jsdom
// tsconfig.ui.json (T0's) includes src/renderer/chat but not src/renderer/test-setup.ts, so
// jest-dom's `declare module 'vitest'` augmentation never reaches the strict UI type program.
// Importing it here is what makes `toBeInTheDocument` exist for tsc; at runtime the setup file
// has already applied it and a second import is a no-op.
import '@testing-library/jest-dom/vitest';
import type { HistoryRow } from '@ds/protocol';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { History } from './History';

// See Composer.test.tsx: vitest's `globals: false` leaves RTL's auto-cleanup unregistered.
afterEach(cleanup);

const CLOCK = new Date(2026, 7, 29, 10, 0, 0).getTime();

function row(over: Partial<HistoryRow> & Pick<HistoryRow, 'id' | 'ts'>): HistoryRow {
  return {
    role: 'assistant',
    content: '嗯。',
    turnId: `t-${over.id}`,
    kind: 'chat',
    interrupted: false,
    ...over,
  };
}

const ROWS: HistoryRow[] = [
  row({ id: 1, ts: new Date(2026, 7, 27, 12, 0, 0).getTime(), role: 'user', content: '前天说的那个事' }),
  row({ id: 2, ts: new Date(2026, 7, 28, 20, 0, 0).getTime(), content: '记得。' }),
  row({ id: 3, ts: new Date(2026, 7, 29, 9, 0, 0).getTime(), content: '今天怎么样', role: 'user' }),
];

function mount(rows: HistoryRow[], remove = vi.fn(async () => {})) {
  const list = vi.fn(async () => ({ rows, nextBefore: null }));
  const view = render(<History open list={list} remove={remove} now={() => CLOCK} />);
  return { list, remove, view };
}

describe('History', () => {
  it('groups rows by 今天 / 昨天 / 8月27日 against the injected clock', async () => {
    mount(ROWS);
    await waitFor(() => expect(screen.getByText('今天')).toBeInTheDocument());
    expect(screen.getByText('昨天')).toBeInTheDocument();
    expect(screen.getByText('8月27日')).toBeInTheDocument();
  });

  it('renders a system row in the system style with no bubble', async () => {
    mount([row({ id: 9, ts: CLOCK, kind: 'system', content: '还没填 API Key', turnId: null })]);
    await waitFor(() => expect(screen.getByTestId('msg-9')).toBeInTheDocument());
    const el = screen.getByTestId('msg-9');
    expect(el.className).toContain('msg--system');
    expect(el.className).not.toContain('msg--bubble');
    expect(within(el).queryByText('删除')).toBeNull();
  });

  it('marks an interrupted assistant row with [中断], outside the hover-only actions', async () => {
    mount([row({ id: 5, ts: CLOCK, interrupted: true, content: '我刚想说' })]);
    await waitFor(() => expect(screen.getByText('[中断]')).toBeInTheDocument());
    // CA-11: the marker is row content, not a per-turn action. If it lived in .msg__acts it
    // would render at opacity 0 and history-interrupted.png would photograph nothing.
    expect(screen.getByText('[中断]').closest('.msg__marks')).not.toBeNull();
    expect(screen.getByText('[中断]').closest('.msg__acts')).toBeNull();
  });

  it('labels a proactive row with 主动', async () => {
    mount([row({ id: 6, ts: CLOCK, kind: 'proactive', content: '你还在吗' })]);
    await waitFor(() => expect(screen.getByText('主动')).toBeInTheDocument());
  });

  it('deletes both rows of a turn and calls remove with the turnId', async () => {
    const remove = vi.fn(async () => {});
    mount(
      [
        row({ id: 7, ts: CLOCK, role: 'user', content: '在吗', turnId: 't-x' }),
        row({ id: 8, ts: CLOCK, content: '在。', turnId: 't-x' }),
      ],
      remove,
    );
    await waitFor(() => expect(screen.getByTestId('msg-7')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('msg-7')).getByText('删除'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('t-x'));
    expect(screen.queryByTestId('msg-7')).toBeNull();
    expect(screen.queryByTestId('msg-8')).toBeNull();
  });

  it('shows the empty-state copy when there is nothing to read', async () => {
    mount([]);
    await waitFor(() => expect(screen.getByText('还没聊过。说点什么吧。')).toBeInTheDocument());
  });

  // Fix round 1, finding 2 (a). 6.3 orders rows newest-at-the-bottom, so the pane must open on the
  // newest row. It used to open at scrollTop 0 — the oldest row — with the newest one clipped off
  // the bottom edge (visible in docs/evidence/phase2/chat-history-light.png).
  it('opens parked on the newest row rather than scrolled to the oldest, every time it opens', async () => {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => 1000 });
    try {
      const list = vi.fn(async () => ({ rows: ROWS, nextBefore: null }));
      const remove = vi.fn(async () => {});
      const view = render(<History open list={list} remove={remove} now={() => CLOCK} />);
      await waitFor(() => expect(screen.getByTestId('msg-3')).toBeInTheDocument());
      expect(screen.getByRole('log').scrollTop).toBe(1000);
      // 历史 is a toggle: closing unmounts the pane, so the second open gets a fresh div at
      // scrollTop 0 and has to be parked again.
      view.rerender(<History open={false} list={list} remove={remove} now={() => CLOCK} />);
      expect(screen.queryByRole('log')).toBeNull();
      view.rerender(<History open list={list} remove={remove} now={() => CLOCK} />);
      expect(screen.getByRole('log').scrollTop).toBe(1000);
    } finally {
      if (desc === undefined) delete (Element.prototype as { scrollHeight?: unknown }).scrollHeight;
      else Object.defineProperty(Element.prototype, 'scrollHeight', desc);
    }
  });

  // Fix round 1, finding 2 (b). The sentinel is the first child of the scroll container, so at
  // scrollTop 0 it is permanently intersecting: the observer fired, loaded, re-attached, fired
  // again, and pulled the whole store in one burst. jsdom keeps scrollTop at 0 (no layout), which
  // is exactly the state the gate has to refuse to observe in.
  it('does not pull page after page the moment the pane opens', async () => {
    const observed: Element[] = [];
    class FakeIO {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(el: Element): void {
        observed.push(el);
        this.cb(
          [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    const holder = globalThis as { IntersectionObserver?: unknown };
    const prev = holder.IntersectionObserver;
    holder.IntersectionObserver = FakeIO;
    try {
      const list = vi.fn(async (opts: { before?: number; limit?: number }) => ({
        rows: opts.before === undefined ? ROWS : [],
        nextBefore: opts.before === undefined ? 100 : null,
      }));
      render(<History open list={list} remove={vi.fn(async () => {})} now={() => CLOCK} />);
      await waitFor(() => expect(screen.getByTestId('msg-3')).toBeInTheDocument());
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(list).toHaveBeenCalledTimes(1);
      expect(observed).toHaveLength(0);
    } finally {
      holder.IntersectionObserver = prev;
    }
  });
});
