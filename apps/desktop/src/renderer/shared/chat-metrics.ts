/**
 * Composer geometry, shared by the chat renderer and the main-process window sizer.
 * Single home for contracts.md 6.1's numbers so the two lanes cannot drift.
 */
export const CHAT_WIDTH = 360;
export const CHAT_ROW_H = 22; // one composer line == --lh-body
export const CHAT_BASE_H = 48; // 1 line + chrome (C-9: spec wins, 360x48)
export const CHAT_MAX_ROWS = 6;
export const CHAT_MAX_H = CHAT_BASE_H + CHAT_ROW_H * (CHAT_MAX_ROWS - 1); // 158
export const CHAT_HISTORY_H = 420; // additional height while the history pane is open
export const CHAT_GAP = 12; // same gap constant as the bubble
