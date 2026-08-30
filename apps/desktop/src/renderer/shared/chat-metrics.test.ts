import { describe, expect, it } from 'vitest';
import {
  CHAT_BASE_H, CHAT_GAP, CHAT_HISTORY_H, CHAT_MAX_H, CHAT_MAX_ROWS, CHAT_ROW_H, CHAT_WIDTH,
} from './chat-metrics';

describe('chat metrics', () => {
  it('matches the main-process window constants (contracts.md 6.1)', () => {
    expect(CHAT_WIDTH).toBe(360);
    expect(CHAT_ROW_H).toBe(22);
    expect(CHAT_BASE_H).toBe(48);
    expect(CHAT_MAX_ROWS).toBe(6);
    expect(CHAT_HISTORY_H).toBe(420);
    expect(CHAT_GAP).toBe(12);
  });

  it('derives the six-row maximum height as 158', () => {
    expect(CHAT_MAX_H).toBe(CHAT_BASE_H + CHAT_ROW_H * (CHAT_MAX_ROWS - 1));
    expect(CHAT_MAX_H).toBe(158);
  });
});
