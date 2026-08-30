import type { DatabaseSync } from 'node:sqlite';
import { PERSONA_MODES_IPC, type PersonaModeIpc } from '@ds/protocol';
import { getKv, setKv } from '@ds/memory';

export const KV_MODE = 'mode';
export type ModeReason = 'command' | 'restored' | 'tray';

const isMode = (s: string | null): s is PersonaModeIpc => s !== null && (PERSONA_MODES_IPC as readonly string[]).includes(s);

/** §9.3. Product state in kv (R3-12). A no-op set does NOT notify — no spurious cache reset. */
export class ModeStore {
  private readonly db: DatabaseSync;
  private mode: PersonaModeIpc;
  private readonly listeners = new Set<(mode: PersonaModeIpc, reason: ModeReason) => void>();

  constructor(db: DatabaseSync) {
    this.db = db;
    const stored = getKv(db, KV_MODE);
    this.mode = isMode(stored) ? stored : 'character';
  }
  /** Reads kv at construction; defaults to 'character'. */
  get(): PersonaModeIpc { return this.mode; }
  /** Writes kv, then notifies. A no-op set does NOT notify (no spurious cache reset). */
  set(mode: PersonaModeIpc, reason: ModeReason): void {
    if (mode === this.mode) return;
    setKv(this.db, KV_MODE, mode);
    this.mode = mode;
    for (const cb of this.listeners) cb(mode, reason);
  }
  onChange(cb: (mode: PersonaModeIpc, reason: ModeReason) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}
