/**
 * Opaque queue-entry identity returned by CubismMotionQueueManager.startMotion.
 *
 * `CubismMotionQueueEntryHandle` is declared `any` in the Framework
 * (`vendor/CubismWebFramework/src/motion/cubismmotionqueuemanager.ts:315`) and is in fact the
 * CubismMotionQueueEntry itself (`cubismmotionqueueentry.ts:30`), unique per playback.
 */
export type MotionHandle = unknown;

/** The one method of CubismMotionQueueManager the tracker needs (`cubismmotionqueuemanager.ts:129`). */
export interface MotionCompletionSource {
  isFinishedByHandle(handle: MotionHandle): boolean;
}

/**
 * Associates a "motion finished" callback with the *queue entry* that is playing it.
 *
 * The Framework's own hook, `ACubismMotion.setFinishedMotionHandler`, lives on the shared preloaded
 * motion object (`acubismmotion.ts:351`), so force-restarting the same motion while the previous
 * entry fades out overwrites the first playback's callback - it is lost, the survivor can fire for
 * both entries, and a restart passing no callback erases a pending one. Keying by handle removes
 * that coupling entirely: each playback owns its own entry, and completion is read back with
 * `isFinishedByHandle`.
 *
 * `flush` is deliberately called *outside* CubismMotionManager.updateMotion so a callback cannot
 * re-enter the manager (or dispose the model) mid-traversal.
 */
export class MotionFinishTracker {
  private entries: { handle: MotionHandle; onFinished: () => void }[] = [];

  /** Remembers `onFinished` for one playback. Callers with no callback simply do not call this. */
  track(handle: MotionHandle, onFinished: () => void): void {
    this.entries.push({ handle, onFinished });
  }

  /** Number of playbacks still waiting to finish. */
  get pending(): number {
    return this.entries.length;
  }

  /**
   * Invokes the callbacks whose entries have finished, each exactly once.
   *
   * Entries are removed from the pending set *before* any callback runs, so a callback that starts
   * another motion, disposes the model or calls flush() again cannot see or re-run them.
   */
  flush(source: MotionCompletionSource): void {
    if (this.entries.length === 0) return;
    const finished: (() => void)[] = [];
    const still: { handle: MotionHandle; onFinished: () => void }[] = [];
    for (const entry of this.entries) {
      if (source.isFinishedByHandle(entry.handle)) finished.push(entry.onFinished);
      else still.push(entry);
    }
    if (finished.length === 0) return;
    this.entries = still;
    for (const onFinished of finished) onFinished();
  }

  /** Drops every pending callback without running it (disposal: nothing should fire after release). */
  clear(): void {
    this.entries = [];
  }
}
