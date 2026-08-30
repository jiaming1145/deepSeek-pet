/**
 * The ONE home for every motion / touch / drag / fling / landing / walk number main and the pet
 * renderer both need (contracts §5.13) — the discipline chat-metrics.ts established. main/window-
 * motion.ts and pet/stage/touch.ts re-export from here and re-declare nothing. The only permitted
 * duplicate is @ds/sim's SIM_DEFAULTS mirror of the three TAP/ANNOY values, pinned by an equality
 * test in packages/sim/src/state.test.ts (it may not import from apps/desktop, §1.2).
 */

// ---- §5.5 body lane, motion timing ------------------------------------------------------------
export const MOTION_FADE_TOUCH_S = 0.12;     // bar §0: "Tap motions fade-in <= 120 ms"
export const MOTION_FADE_LLM_S = 0.25;       // research §8: Unreal's montage default
export const MOTION_FADE_IDLE_S = 1.00;      // bar §0: "idle->idle 1 s"
export const MOTION_MIN_PLAY_MS = 800;       // research §8: LLM motion min play
export const MOTION_GROUP_COOLDOWN_MS = 1_500;
export const TOUCH_PREEMPT_MAX_MS = 250;     // R3-3's "<= 250 ms" motion boundary
export const TOUCH_EXPR_MS = 1_400;

// ---- §5.11 D6 touch ---------------------------------------------------------------------------
export const TAP_BURST_COUNT = 7;          // ">= 7 taps in 1 s"
export const TAP_BURST_WINDOW_MS = 1_000;
export const ANNOY_COOLDOWN_MS = 4_000;    // suppresses NORMAL tap reactions; the annoyed one plays
export const TAP_SLOP_DIP = 4;             // Phase 1's TAP_SLOP_PX, promoted to a shared constant

// ---- §7.4 drag — the spring/damper (R3-5) -------------------------------------------------------
export const DRAG_STIFFNESS = 180;          // R3-5: "stiffness 180 N/m-equivalent"
export const DRAG_DAMPING_RATIO = 0.85;     // R3-5
export const DRAG_MASS = 1;
/** c = 2 * zeta * sqrt(k * m) = 2 * 0.85 * sqrt(180) = 22.808 */
export const DRAG_DAMPING = 2 * DRAG_DAMPING_RATIO * Math.sqrt(DRAG_STIFFNESS * DRAG_MASS);
export const DRAG_MAX_LAG_DIP = 24;         // R3-5: "max pointer lag 24 DIP"

// ---- §7.5 release velocity, fling, gravity, bounce, landing ------------------------------------
export const FLING_SAMPLES = 4;             // D8: "release velocity from the last 4 samples"
export const FLING_EMA_ALPHA = 0.5;         // research §4: Shimeji's dx = (dx + delta) / 2
export const FLING_VELOCITY_CAP = 2400;     // R3-5: "velocity cap 2400 DIP/s" == LandingSchema.impulse max
export const GRAVITY_DIP_S2 = 1800;         // R3-5
export const BOUNCE_RESTITUTION = 0.35;     // R3-5: "edge bounce with restitution 0.35"
export const BOUNCE_DECAY = 0.8;            // per bounce, on top of the restitution
export const REST_SPEED_DIP_S = 40;         // R3-5: "decaying to rest under 40 DIP/s"
export const AIR_DRAG_X = 1.28;             // vx *= exp(-1.28 * dt)   (research §4)
export const AIR_DRAG_Y = 0.35;             // gentle; gravity dominates
export const LANDING_MIN_IMPULSE = 120;     // below this no `sim:landing` is emitted

// ---- §7.6 walkTo (D14, R3-5) -------------------------------------------------------------------
export const WALK_SPEED_DIP_S = 120;        // R3-5: "walkTo (120 DIP/s)"
export const WALK_MIN_DISTANCE_DIP = 48;    // below this -> 'alreadyAtDestination'
export const WALK_MAX_MS = 12_000;          // hard budget; then 'unreachable' + settle
export const WALK_COOLDOWN_MS = 5_000;      // research §8: at most one walkTo per 5 s
