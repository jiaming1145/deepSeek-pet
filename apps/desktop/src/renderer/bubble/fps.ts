/**
 * The one FPS policy in the app (contracts §5.8, D7). It lives here but belongs to the PET
 * renderer's module graph: `pet/main.ts` is its only caller and holds the only `stage.setFps` call
 * site. A copy may NOT be added to the bubble renderer — the bubble has no Live2D ticker.
 *
 * `moving` is true from the first `sim:windowMotion` of an episode until 500 ms after `phase: 'rest'`
 * (research §4); the producer is the drag-visual wiring in pet/main.ts.
 */
export function fpsFor(s: { hovering: boolean; speaking: boolean; moving: boolean }): 30 | 60 {
  return s.hovering || s.speaking || s.moving ? 60 : 30;
}
