import type { SimSnapshot } from '@ds/protocol';
import { WORK_MODE_DEFAULT } from './hover-ack';

/**
 * R3-35 / contract Amendment A3-1 — the pet renderer's copy of the two UI toggles.
 *
 * `HoverAckDeps.workMode()` is a getter read at tick time (§5.9), so the flag has to live in a
 * mutable box the machine can see; `SfxPlayer` owns its own mute state, so that half is a call.
 * Both arrive on every `sim:state` as `SimSnapshot.uiWorkMode` / `uiSfxMuted`, written by the tray
 * (Task 6) into kv and relayed by `SimService.setUiFlags` (Task 12/15). No channel is added: A3-1
 * put the two booleans on the snapshot precisely so §2's one edit stays Task 1's.
 */
export interface UiFlags {
  workMode: boolean;
  sfxMuted: boolean;
}

export interface UiFlagTargets {
  /** Null in the browser lane, where there is no bridge and therefore no SfxPlayer. */
  sfx: { setMuted(muted: boolean): void } | null;
}

/** The pre-first-`sim:state` state: §5.9's "opt-in, default off", and sound on. */
export function createUiFlags(): UiFlags {
  return { workMode: WORK_MODE_DEFAULT, sfxMuted: false };
}

/** Idempotent; called on every `sim:state`, which is at most 2 Hz (§2.3). */
export function applyUiFlags(
  snapshot: Pick<SimSnapshot, 'uiWorkMode' | 'uiSfxMuted'>,
  flags: UiFlags,
  targets: UiFlagTargets,
): void {
  flags.workMode = snapshot.uiWorkMode;
  flags.sfxMuted = snapshot.uiSfxMuted;
  targets.sfx?.setMuted(snapshot.uiSfxMuted);
}
