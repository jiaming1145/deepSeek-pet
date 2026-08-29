import { describe, expect, it } from 'vitest';
import { shouldRender } from './ticker';

describe('shouldRender', () => {
  it('renders every frame at 60 fps', () => {
    expect(shouldRender(60, 0, 16.7)).toBe(true);
  });
  it('skips frames that arrive before the 30 fps interval elapsed', () => {
    expect(shouldRender(30, 1000, 1016.7)).toBe(false);
    expect(shouldRender(30, 1000, 1033.4)).toBe(true);
  });
});
