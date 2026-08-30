/**
 * I-9: the `before-quit` sequence, kept pure so the ORDER can be unit-tested without Electron.
 *
 * `BrainService.dispose()` is asynchronous — `TurnRunner.cancel()` writes the `[中断]` row and
 * the metrics row in later microtasks — so the database must not be closed until it resolves.
 * Electron's `before-quit` cannot be awaited, but it CAN be prevented: the first one is prevented,
 * the drain runs, and the `quit()` at the end raises a second `before-quit` that is let through.
 * Any `before-quit` that arrives while the drain is still running (a second tray click, a second
 * Ctrl+C) is prevented too, so no path closes the db early. A dispose that never resolves is
 * bounded by `timeoutMs`: a stuck quit is worse than one lost interruption row.
 */
export interface QuitDeps {
  /** Synchronous teardown that must happen at once (hotkeys, screen listeners, save position). */
  teardownSync(): void;
  /** The barrier (`brain.dispose()`); resolves once the runner's writes have settled. */
  drain(): Promise<void>;
  /** Everything that must follow the drain and precede the db: destroy the windows, the tray. */
  teardownAfterDrain(): void;
  closeDb(): void;
  /** `app.quit()` — raises `before-quit` again, which the handler now lets through. */
  quit(): void;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export type QuitPhase = 'idle' | 'draining' | 'done';

export const DRAIN_TIMEOUT_MS = 3000;

export function createBeforeQuit(deps: QuitDeps): {
  handler: (event: { preventDefault(): void }) => void;
  readonly phase: QuitPhase;
} {
  let phase: QuitPhase = 'idle';
  const log = deps.log ?? ((line: string) => console.log(line));
  const timeoutMs = deps.timeoutMs ?? DRAIN_TIMEOUT_MS;

  const run = async (): Promise<void> => {
    try {
      let timer: NodeJS.Timeout | null = null;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const result = await Promise.race([deps.drain().then(() => 'drained' as const), timeout]);
      if (timer) clearTimeout(timer);
      if (result === 'timeout') log(`[quit] drain did not settle within ${timeoutMs} ms; closing anyway`);
    } catch (err) {
      log(`[quit] drain failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Each step isolated: a throwing `closeDb` (node:sqlite ERR_INVALID_STATE on a handle that is
    // already closed) used to leave `phase` at 'draining' — every later before-quit prevented, the
    // app unable to quit — and surface as an unhandled rejection from `void run()`.
    step('teardownAfterDrain', () => deps.teardownAfterDrain());
    step('closeDb', () => deps.closeDb());
    phase = 'done';
    deps.quit();
  };

  const step = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      log(`[quit] ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    handler: (event) => {
      if (phase === 'done') return;
      event.preventDefault();
      if (phase === 'draining') return;
      phase = 'draining';
      deps.teardownSync();
      void run();
    },
    get phase(): QuitPhase {
      return phase;
    },
  };
}
