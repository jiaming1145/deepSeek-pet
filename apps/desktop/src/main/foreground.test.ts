import { describe, expect, it } from 'vitest';
import { shouldHideForForeground } from './foreground';

const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('shouldHideForForeground', () => {
  it('hides when a foreign window exactly covers the display', () => {
    expect(shouldHideForForeground(display, display, 1n, 2n, [])).toBe(true);
  });
  it('does not hide for our own window', () => {
    expect(shouldHideForForeground(display, display, 2n, 2n, [])).toBe(false);
  });
  it('does not hide for the shell/desktop window', () => {
    expect(shouldHideForForeground(display, display, 1n, 3n, [3n])).toBe(false);
  });
  it('does not hide for a maximized window (has borders / taskbar)', () => {
    expect(shouldHideForForeground({ x: -8, y: -8, width: 1936, height: 1048 }, display, 1n, 2n, [])).toBe(false);
  });
  it('does not hide when nothing is foreground', () => {
    expect(shouldHideForForeground(null, display, 1n, 0n, [])).toBe(false);
  });
});
