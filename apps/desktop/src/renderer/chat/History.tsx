import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { HistoryRow } from '@ds/protocol';

export interface HistoryProps {
  list(opts: { before?: number; limit?: number }): Promise<{ rows: HistoryRow[]; nextBefore: number | null }>;
  remove(turnId: string): Promise<void>;
  open: boolean;
  /**
   * CX-9: bumps whenever a turn completes (App passes `turnDone.n`). While the pane is open a change
   * refetches the newest page so the row that just landed in the store is read in; the pane also
   * refetches on every closed->open edge. Rows merge by id, so the older pages already read stay.
   */
  refresh?: number;
  now?: () => number;
}

export const HISTORY_PAGE = 50;

const DAY_MS = 86_400_000;
const DAY_FMT = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number, now: number): string {
  const diff = Math.round((dayStart(now) - dayStart(ts)) / DAY_MS);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return DAY_FMT.format(new Date(ts));
}

export function History(props: HistoryProps): JSX.Element {
  const { list, remove, open, refresh = 0, now = () => Date.now() } = props;
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  // The top sentinel is only a paging trigger once the pane is scrolled away from it. At
  // scrollTop 0 it is permanently intersecting, so observing it there loads page after page in
  // one burst and 6.3's 50-row paging throttles nothing.
  const [pagingArmed, setPagingArmed] = useState(false);
  const parkedRef = useRef(false);
  const anchorRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (before?: number) => {
      setLoading(true);
      // An older page is prepended above the sentinel. Remember the height first so the layout
      // effect below can hold the reader's place instead of letting the offset slide.
      if (before !== undefined) anchorRef.current = paneRef.current?.scrollHeight ?? null;
      try {
        const page = await list(before === undefined ? { limit: HISTORY_PAGE } : { before, limit: HISTORY_PAGE });
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          const merged = prev.concat(page.rows.filter((r) => !seen.has(r.id)));
          merged.sort((a, b) => a.id - b.id);
          return merged;
        });
        // Only the FIRST read sets the paging cursor; a refresh of the newest page must not reset
        // the cursor past pages the reader has already scrolled up through.
        if (before !== undefined || !loadedRef.current) setNextBefore(page.nextBefore);
        // A newest page landing means the newest row may have changed: park on it again.
        if (before === undefined) parkedRef.current = false;
        loadedRef.current = true;
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    },
    [list],
  );

  // CX-9: every closed->open edge and every completed turn while open re-reads the newest page.
  useEffect(() => {
    if (!open) return;
    void loadPage();
  }, [open, refresh, loadPage]);

  // 6.3 orders rows newest-at-the-bottom, so the pane opens on the newest row, not the oldest one.
  // Parking also moves the top sentinel out of view, which is what keeps the paging effect below
  // from firing the moment the pane opens.
  useLayoutEffect(() => {
    if (!open) {
      // Closing unmounts the pane; reopening builds a fresh div at scrollTop 0, so the park has to
      // run again or the second open lands on the oldest row.
      parkedRef.current = false;
      setPagingArmed(false);
      return;
    }
    if (!loaded || parkedRef.current) return;
    const el = paneRef.current;
    if (el === null) return;
    parkedRef.current = true;
    el.scrollTop = el.scrollHeight;
    setPagingArmed(el.scrollTop > 0);
    // `rows` is a dependency because a refreshed newest page clears the park (see loadPage) and
    // the new bottom row only exists once those rows have rendered.
  }, [open, loaded, rows]);

  // Hold the reader's place when an older page lands above them.
  useLayoutEffect(() => {
    const before = anchorRef.current;
    if (before === null) return;
    anchorRef.current = null;
    const el = paneRef.current;
    if (el === null) return;
    el.scrollTop += el.scrollHeight - before;
  }, [rows]);

  const onScroll = useCallback(() => {
    const el = paneRef.current;
    setPagingArmed(el !== null && el.scrollTop > 0);
  }, []);

  // Paging: the top sentinel scrolls into view -> fetch the previous page. No virtualization (6.3).
  useEffect(() => {
    if (!open || nextBefore === null || loading || !pagingArmed) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const el = sentinelRef.current;
    if (el === null) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadPage(nextBefore);
    });
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [open, nextBefore, loading, pagingArmed, loadPage]);

  const onDelete = useCallback(
    async (turnId: string) => {
      setRows((prev) => prev.filter((r) => r.turnId !== turnId));
      await remove(turnId);
    },
    [remove],
  );

  if (!open) return <></>;

  const clock = now();
  const items: JSX.Element[] = [];
  let lastLabel = '';
  for (const r of rows) {
    const label = dayLabel(r.ts, clock);
    if (label !== lastLabel) {
      lastLabel = label;
      items.push(
        <h2 className="history__day" key={`day-${r.id}`}>{label}</h2>,
      );
    }
    const turnId = r.turnId;
    const bubble = r.kind !== 'system';
    items.push(
      <article
        key={r.id}
        data-testid={`msg-${r.id}`}
        className={`msg msg--${r.role} msg--${r.kind}${bubble ? ' msg--bubble' : ''}`}
      >
        <p className="msg__body">{r.content}</p>
        <div className="msg__meta">
          {/* CA-11: markers are row content and stay visible; only the two actions hide until hover. */}
          <span className="msg__marks">
            {r.kind === 'proactive' && <span className="chip chip--proactive">主动</span>}
            {r.interrupted && <span className="chip chip--interrupted">[中断]</span>}
          </span>
          <span className="msg__acts">
            <button
              type="button"
              className="msg__act"
              onClick={() => {
                void navigator.clipboard?.writeText(r.content);
              }}
            >
              复制
            </button>
            {turnId !== null && (
              <button
                type="button"
                className="msg__act"
                onClick={() => {
                  void onDelete(turnId);
                }}
              >
                删除
              </button>
            )}
          </span>
        </div>
      </article>,
    );
  }

  return (
    <div className="history" role="log" aria-label="聊天记录" ref={paneRef} onScroll={onScroll}>
      <div className="history__sentinel" ref={sentinelRef} />
      {items}
      {loaded && rows.length === 0 && <p className="history__empty">还没聊过。说点什么吧。</p>}
    </div>
  );
}
