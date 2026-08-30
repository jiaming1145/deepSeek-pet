/**
 * §10.2 — Win32 SHQueryUserNotificationState through koffi. No timer of its own: §10.3 gives the
 * process exactly ONE sensing interval, owned by ActivitySensor, which calls `poll()` every
 * DND_EVERY_N_TICKS. Polled, never event-driven: Windows sends no notification when a fullscreen
 * app starts or stops (§10.2 caveat 2).
 */
export const QUNS = {
  NOT_PRESENT: 1,            // screensaver, LOCKED, or an inactive fast-user-switching session
  BUSY: 2,                   // a fullscreen app OR presentation settings
  RUNNING_D3D_FULL_SCREEN: 3,
  PRESENTATION_MODE: 4,
  ACCEPTS_NOTIFICATIONS: 5,  // the ONLY value on which a notification-like surface may appear
  QUIET_TIME: 6,             // documented as the first hour after a NEW user's first logon.
                             // It is NOT Focus Assist. Treated as DND anyway: it is quiet time.
  APP: 7,
} as const;

/** DND := state !== ACCEPTS_NOTIFICATIONS. Microsoft's own guidance, and the honest bound. */
export function isDnd(state: number): boolean {
  return state !== QUNS.ACCEPTS_NOTIFICATIONS;
}

/** Returns the raw QUNS value, or null when the call failed (HRESULT !== S_OK) or koffi is absent. */
export type NotificationQuery = () => number | null;

let query: NotificationQuery | null | undefined;
/** Lazy, exactly like foreground.ts: a missing native binary degrades to "unknown" (=> DND on). */
export function loadNotificationQuery(): NotificationQuery | null {
  if (query !== undefined) return query;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    const shell32 = koffi.load('shell32.dll');
    /** HRESULT SHQueryUserNotificationState(QUERY_USER_NOTIFICATION_STATE *pquns) */
    const SHQueryUserNotificationState =
      shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int* pquns)') as
        (out: number[]) => number;
    query = () => {
      const out = [0];
      const hr = SHQueryUserNotificationState(out);
      return hr === 0 ? out[0] : null;
    };
  } catch (err) {
    console.warn('[notification-state] koffi unavailable, DND treated as on:', err);
    query = null;
  }
  return query;
}

export interface NotificationState {
  /** Last polled verdict: true/false, or null while unknown (never polled, or the query failed). */
  readonly dnd: boolean | null;
  /** One query. Called by ActivitySensor at 0.2 Hz; a failure leaves `dnd` null (=> DND on). */
  poll(): void;
  /** Edge-triggered on the EFFECTIVE value (null reports as `true`). */
  onChange(cb: (dnd: boolean) => void): () => void;
}

export function createNotificationState(q: NotificationQuery | null): NotificationState {
  let dnd: boolean | null = null;
  let lastEffective: boolean | null = null;
  const subs = new Set<(dnd: boolean) => void>();
  return {
    get dnd() { return dnd; },
    poll() {
      let state: number | null = null;
      if (q !== null) {
        try { state = q(); } catch { state = null; }
      }
      dnd = state === null ? null : isDnd(state);
      const effective = dnd ?? true;   // §10.5 rung 3: unknown is DND on, conservatively
      if (effective !== lastEffective) {
        lastEffective = effective;
        // FIX ROUND 1, finding 1: `poll()` runs on ActivitySensor's SINGLE sensing timer (§10.3), so
        // a throwing DND listener must not abort the rest of that tick's sample or reach the pump.
        for (const cb of subs) {
          try { cb(effective); } catch (err) { console.warn('[notification-state] onChange listener threw:', err); }
        }
      }
    },
    onChange(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
  };
}
