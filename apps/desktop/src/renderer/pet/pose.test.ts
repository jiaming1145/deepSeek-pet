import { describe, expect, it } from 'vitest';
import type { Emotion } from '@ds/protocol';
import { PoseTracker } from './pose';

function mount(): { pose: PoseTracker; applied: Emotion[] } {
  const applied: Emotion[] = [];
  const pose = new PoseTracker((e) => applied.push(e));
  return { pose, applied };
}

describe('PoseTracker (CX-10)', () => {
  it('listening on shows curious; listening off restores neutral', () => {
    const { pose, applied } = mount();
    pose.setListening(true);
    expect(applied).toEqual(['curious']);
    pose.setListening(false);
    expect(applied).toEqual(['curious', 'neutral']);
    expect(pose.pose).toBe('neutral');
  });

  it('listening off restores think while the brain is thinking', () => {
    const { pose, applied } = mount();
    pose.setBase('think');
    pose.setListening(true);
    pose.setListening(false);
    expect(applied).toEqual(['think', 'curious', 'think']);
  });

  it('listening off restores the current sentence emotion', () => {
    const { pose, applied } = mount();
    pose.setBase('think');
    pose.setBase('sad');
    pose.setListening(true);
    pose.setListening(false);
    expect(applied.at(-1)).toBe('sad');
  });

  it('a sentence arriving while listening shows through and is what off restores', () => {
    const { pose, applied } = mount();
    pose.setListening(true);
    pose.setBase('happy');
    expect(applied).toEqual(['curious', 'happy']);
    expect(pose.pose).toBe('curious');
    pose.setListening(false);
    expect(applied.at(-1)).toBe('happy');
  });

  it('a repeated edge applies nothing; idle after listening resolves to neutral', () => {
    const { pose, applied } = mount();
    pose.setListening(true);
    pose.setListening(true);
    expect(applied).toEqual(['curious']);
    pose.setListening(false);
    pose.setListening(false);
    pose.setBase('neutral');
    expect(applied).toEqual(['curious', 'neutral', 'neutral']);
  });
});
