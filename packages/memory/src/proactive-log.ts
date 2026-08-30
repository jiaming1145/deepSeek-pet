import type { DatabaseSync } from 'node:sqlite';
import type { ProactiveBucket } from '@ds/protocol';

/** §3.10.3: a reservation older than this at startup is voided (R3-7 "older than 5 min at startup is void"). */
export const PROACTIVE_RESERVATION_STALE_MS = 300_000;
/** bar §0: "Templates never repeat verbatim within 30 days". */
export const PROACTIVE_NO_REPEAT_MS = 30 * 86_400_000;

export type ProactiveOutcome = 'displayed' | 'discarded' | 'suppressed' | 'failed' | 'void';

export interface ProactiveLogRow {
  id: string; templateId: string; bucket: ProactiveBucket;
  reservedAt: number; generatedAt: number | null; displayedAt: number | null; answeredAt: number | null;
  outcome: ProactiveOutcome | null; turnId: string | null; localDate: string;
}

export interface ProactiveReservation {
  id: string; templateId: string; bucket: ProactiveBucket; reservedAt: number; localDate: string;
}

/** MUST be a type alias (StatementSync.all() is Record<string, SQLOutputValue>[]; see history.ts). */
type Raw = {
  id: string; template_id: string; bucket: string; reserved_at: number; generated_at: number | null;
  displayed_at: number | null; answered_at: number | null; outcome: string | null; turn_id: string | null; local_date: string;
};

const toRow = (r: Raw): ProactiveLogRow => ({
  id: r.id, templateId: r.template_id, bucket: r.bucket as ProactiveBucket, reservedAt: r.reserved_at,
  generatedAt: r.generated_at, displayedAt: r.displayed_at, answeredAt: r.answered_at,
  outcome: r.outcome as ProactiveOutcome | null, turnId: r.turn_id, localDate: r.local_date,
});

/**
 * The R3-7 ledger over the §8.1 `proactive_log` table. Every method is synchronous (DatabaseSync);
 * the ProactiveController (Task 14) is the only writer. Caps count DISPLAYED rows only.
 */
export class ProactiveLogStore {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  /** Written at reservation (§3.10.3 "the reservation is written at generation start" — before the breakpoint wait). */
  reserve(r: ProactiveReservation): void {
    this.db.prepare(
      'INSERT INTO proactive_log (id, template_id, bucket, reserved_at, local_date) VALUES (?, ?, ?, ?, ?)',
    ).run(r.id, r.templateId, r.bucket, r.reservedAt, r.localDate);
  }
  markGenerated(id: string, at: number): void {
    this.db.prepare('UPDATE proactive_log SET generated_at = ? WHERE id = ?').run(at, id);
  }
  /** playback:sentenceDone seq 0 — the moment the caps are charged (R3-7 "displayed"). */
  markDisplayed(id: string, at: number, turnId: string | null): void {
    this.db.prepare("UPDATE proactive_log SET displayed_at = ?, turn_id = ?, outcome = 'displayed' WHERE id = ?").run(at, turnId, id);
  }
  markAnswered(id: string, at: number): void {
    this.db.prepare('UPDATE proactive_log SET answered_at = ? WHERE id = ?').run(at, id);
  }
  setOutcome(id: string, outcome: ProactiveOutcome): void {
    this.db.prepare('UPDATE proactive_log SET outcome = ? WHERE id = ?').run(outcome, id);
  }
  get(id: string): ProactiveLogRow | null {
    const r = this.db.prepare('SELECT * FROM proactive_log WHERE id = ?').get(id) as Raw | undefined;
    return r === undefined ? null : toRow(r);
  }

  // ---- the three exact counting queries (§3.10.6) ----
  displayedToday(localDate: string): number {
    const r = this.db.prepare('SELECT count(*) AS n FROM proactive_log WHERE local_date = ?1 AND displayed_at IS NOT NULL').get(localDate) as { n: number };
    return r.n;
  }
  unansweredToday(localDate: string): number {
    const r = this.db.prepare(
      "SELECT count(*) AS n FROM proactive_log\n WHERE local_date = ?1 AND displayed_at IS NOT NULL AND answered_at IS NULL AND outcome = 'displayed'",
    ).get(localDate) as { n: number };
    return r.n;
  }
  /** 30-day template no-repeat; `sinceWall` = now - PROACTIVE_NO_REPEAT_MS. */
  templateDisplayedSince(templateId: string, sinceWall: number): boolean {
    const r = this.db.prepare(
      'SELECT 1 AS one FROM proactive_log\n WHERE template_id = ?1 AND displayed_at IS NOT NULL AND displayed_at > ?2 LIMIT 1',
    ).get(templateId, sinceWall) as { one: number } | undefined;
    return r !== undefined;
  }
  /** For §4.8 nearDuplicate: the ids displayed in the window, oldest first (text is looked up from PROACTIVE_TEMPLATES by id). */
  displayedTemplateIdsSince(sinceWall: number): string[] {
    const rows = this.db.prepare(
      'SELECT template_id FROM proactive_log WHERE displayed_at IS NOT NULL AND displayed_at > ? ORDER BY displayed_at ASC',
    ).all(sinceWall) as Array<{ template_id: string }>;
    return rows.map((r) => r.template_id);
  }

  // ---- startup recovery (§3.10.3) ----
  /** Voids every in-flight reservation older than PROACTIVE_RESERVATION_STALE_MS. Returns the count voided. */
  voidStale(nowWall: number): number {
    const r = this.db.prepare(
      "UPDATE proactive_log SET outcome = 'void' WHERE displayed_at IS NULL AND outcome IS NULL AND reserved_at <= ?",
    ).run(nowWall - PROACTIVE_RESERVATION_STALE_MS);
    return Number(r.changes);
  }
  /** The one fresh in-flight reservation, if any, to resume as `gate.intent`. */
  liveIntent(nowWall: number): ProactiveLogRow | null {
    const r = this.db.prepare(
      'SELECT * FROM proactive_log WHERE displayed_at IS NULL AND outcome IS NULL AND reserved_at > ? ORDER BY reserved_at DESC LIMIT 1',
    ).get(nowWall - PROACTIVE_RESERVATION_STALE_MS) as Raw | undefined;
    return r === undefined ? null : toRow(r);
  }
}
