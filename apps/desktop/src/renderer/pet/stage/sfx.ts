/**
 * X13's audio half (contracts §5.12). Assets are self-made by scripts/make-sfx.mjs and live at
 * apps/desktop/public/sfx/. Mute/volume are kv `ui_sfx_muted` / `ui_sfx_volume`, pushed in by the
 * owner of the tray wiring; this class holds no persistence.
 */
export const SFX = {
  tap: 'tap.ogg', annoyed: 'annoyed.ogg', land: 'land.ogg', proactive: 'notify.ogg',
} as const;
export type SfxName = keyof typeof SFX;
export const SFX_VOLUME_DEFAULT = 0.35;
export const SFX_MIN_INTERVAL_MS = 120;      // rate-limit so a tap burst is not a machine gun

/** The slice of HTMLAudioElement the player uses — injectable so unit tests need no DOM audio. */
export interface SfxAudio {
  volume: number;
  currentTime: number;
  play(): Promise<void> | void;
}
export interface SfxPlayerOptions {
  createAudio?: (url: string) => SfxAudio;
  now?: () => number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class SfxPlayer {
  private readonly clips = new Map<SfxName, SfxAudio>();
  private readonly now: () => number;
  private muted = false;
  private volume = SFX_VOLUME_DEFAULT;
  private lastPlayAt = -Infinity;

  constructor(baseUrl: string, opts: SfxPlayerOptions = {}) {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const createAudio = opts.createAudio ?? ((url: string) => new Audio(url));
    this.now = opts.now ?? (() => performance.now());
    // Preload eagerly: four clips <= 24 KB each, and the first tap must not wait on a fetch.
    for (const name of Object.keys(SFX) as SfxName[]) this.clips.set(name, createAudio(base + SFX[name]));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** 0..1, clamped. */
  setVolume(v: number): void {
    this.volume = clamp01(v);
  }

  play(name: SfxName, gain = 1): void {
    if (this.muted || this.volume <= 0) return;
    const t = this.now();
    if (t - this.lastPlayAt < SFX_MIN_INTERVAL_MS) return;
    const clip = this.clips.get(name);
    if (!clip) return;
    clip.volume = clamp01(this.volume * gain);
    clip.currentTime = 0;
    const p = clip.play();
    // Chromium's autoplay policy may reject before the first user gesture; an SFX is never worth an error.
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    this.lastPlayAt = t;
  }
}
