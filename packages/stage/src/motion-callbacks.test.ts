import { describe, expect, it } from 'vitest';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { CubismMotionManager } from '@framework/motion/cubismmotionmanager';
import { MotionFinishTracker } from './motion-callbacks';

/**
 * The real CubismMotionManager is used here (it needs no Cubism Core), so the handle semantics under
 * test are the Framework's own. Only the motion is a stub: ACubismMotion is abstract and every
 * concrete subclass parses a motion3.json.
 */
class StubMotion extends ACubismMotion {
  doUpdateParameters(): void {}
}

function finish(manager: CubismMotionManager, handle: unknown): void {
  manager.getCubismMotionQueueEntry(handle).setIsFinished(true);
}

describe('MotionFinishTracker', () => {
  it('keeps one callback per playback when the same motion is restarted mid-fade', () => {
    const manager = new CubismMotionManager();
    const motion = new StubMotion(); // ONE shared preloaded motion, played twice
    const tracker = new MotionFinishTracker();
    const fired: string[] = [];

    const first = manager.startMotionPriority(motion, false, 2);
    tracker.track(first, () => fired.push('first'));
    // Force-restart before the first entry finished: it is still in the queue, fading out.
    const second = manager.startMotionPriority(motion, false, 3);
    tracker.track(second, () => fired.push('second'));

    expect(first).not.toBe(second);
    expect(manager.getCubismMotionQueueEntries().length).toBe(2);

    tracker.flush(manager);
    expect(fired).toEqual([]);

    finish(manager, first);
    tracker.flush(manager);
    expect(fired).toEqual(['first']);

    tracker.flush(manager); // exactly once, even when re-polled
    expect(fired).toEqual(['first']);

    finish(manager, second);
    tracker.flush(manager);
    expect(fired).toEqual(['first', 'second']);
    expect(tracker.pending).toBe(0);
  });

  it('does not lose a pending callback when the restart carries none', () => {
    const manager = new CubismMotionManager();
    const motion = new StubMotion();
    const tracker = new MotionFinishTracker();
    const fired: string[] = [];

    const first = manager.startMotionPriority(motion, false, 2);
    tracker.track(first, () => fired.push('first'));
    const second = manager.startMotionPriority(motion, false, 3); // no callback for this playback

    finish(manager, first);
    tracker.flush(manager);
    expect(fired).toEqual(['first']);

    finish(manager, second);
    tracker.flush(manager);
    expect(fired).toEqual(['first']); // the second playback had none; nothing fires twice
  });

  it('removes an entry before running it, so a re-entrant callback cannot double-fire', () => {
    const manager = new CubismMotionManager();
    const tracker = new MotionFinishTracker();
    let calls = 0;

    const handle = manager.startMotionPriority(new StubMotion(), false, 2);
    tracker.track(handle, () => {
      calls++;
      tracker.flush(manager); // re-entrant: the entry must already be gone
    });

    finish(manager, handle);
    tracker.flush(manager);
    expect(calls).toBe(1);
  });

  it('reports an unknown handle as finished and clear() drops pending callbacks', () => {
    const manager = new CubismMotionManager();
    const tracker = new MotionFinishTracker();
    const fired: string[] = [];

    const handle = manager.startMotionPriority(new StubMotion(), false, 2);
    tracker.track(handle, () => fired.push('kept'));
    expect(tracker.pending).toBe(1);
    // A handle the manager never saw reads as finished (cubismmotionqueuemanager.ts:129).
    expect(manager.isFinishedByHandle({} as never)).toBe(true);

    tracker.clear();
    expect(tracker.pending).toBe(0);
    finish(manager, handle);
    tracker.flush(manager);
    expect(fired).toEqual([]);
  });
});

describe('MotionFinishTracker — clear() during flush', () => {
  it('stops the rest of the batch once a callback clears the tracker', () => {
    const manager = new CubismMotionManager();
    const tracker = new MotionFinishTracker();
    const fired: string[] = [];
    const a = manager.startMotionPriority(new StubMotion(), false, 2);
    const b = manager.startMotionPriority(new StubMotion(), false, 2);
    tracker.track(a, () => {
      fired.push('a');
      tracker.clear();
    });
    tracker.track(b, () => fired.push('b'));
    finish(manager, a);
    finish(manager, b);
    tracker.flush(manager);
    expect(fired).toEqual(['a']);
    expect(tracker.pending).toBe(0);
  });
});
