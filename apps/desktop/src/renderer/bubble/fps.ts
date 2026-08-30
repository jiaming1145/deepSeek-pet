/**
 * The one FPS policy in the app (contracts.md §5.6, D7). It lives here but belongs to the PET
 * renderer's module graph: `pet/main.ts` is its only caller and holds the only `stage.setFps` call
 * site. A copy may NOT be added to the bubble renderer — the bubble has no Live2D ticker.
 */
export function fpsFor(s: { hovering: boolean; speaking: boolean }): 30 | 60 {
  return s.hovering || s.speaking ? 60 : 30;
}
