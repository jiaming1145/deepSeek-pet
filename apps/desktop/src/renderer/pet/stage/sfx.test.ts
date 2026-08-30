// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SFX, SFX_MIN_INTERVAL_MS, SFX_VOLUME_DEFAULT, SfxPlayer, type SfxAudio } from './sfx';

const SFX_DIR = new URL('../../../../public/sfx/', import.meta.url);

/** Minimal Ogg walker: sample rate from the Vorbis identification header, duration from the last granule. */
function oggInfo(buf: Buffer): { rate: number; seconds: number; vorbis: boolean } {
  let offset = 0, granule = 0n, rate = 0, vorbis = false;
  while (offset + 27 <= buf.length && buf.toString('latin1', offset, offset + 4) === 'OggS') {
    const nsegs = buf[offset + 26];
    let body = 0;
    for (let i = 0; i < nsegs; i++) body += buf[offset + 27 + i];
    const g = buf.readBigInt64LE(offset + 6);
    if (g >= 0n) granule = g;
    const start = offset + 27 + nsegs;
    if (rate === 0 && buf[start] === 1 && buf.toString('latin1', start + 1, start + 7) === 'vorbis') {
      vorbis = true;
      rate = buf.readUInt32LE(start + 12);
    }
    offset = start + body;
  }
  return { rate, seconds: rate ? Number(granule) / rate : Infinity, vorbis };
}

describe('SFX assets (§5.12, X13) — self-made, bounded', () => {
  it('names the four files', () => {
    expect(SFX).toEqual({ tap: 'tap.ogg', annoyed: 'annoyed.ogg', land: 'land.ogg', proactive: 'notify.ogg' });
  });
  for (const [name, file] of Object.entries(SFX)) {
    it(`${name}: ${file} is Ogg Vorbis, <= 24 KB and <= 400 ms`, () => {
      const buf = readFileSync(fileURLToPath(new URL(file, SFX_DIR)));
      expect(buf.length).toBeLessThanOrEqual(24 * 1024);
      const info = oggInfo(buf);
      expect(info.vorbis).toBe(true);
      expect(info.seconds).toBeLessThanOrEqual(0.4);
      expect(info.seconds).toBeGreaterThan(0.02);
    });
  }
});

describe('SfxPlayer', () => {
  function fake() {
    const created: string[] = [];
    const plays: { url: string; volume: number }[] = [];
    let now = 0;
    const createAudio = (url: string): SfxAudio => {
      created.push(url);
      const a: SfxAudio = { volume: 1, currentTime: 0, play: () => { plays.push({ url, volume: a.volume }); return Promise.resolve(); } };
      return a;
    };
    const player = new SfxPlayer('/sfx', { createAudio, now: () => now });
    return { player, created, plays, tick: (ms: number) => { now += ms; } };
  }
  it('defaults: volume 0.35, unmuted, preloads the four clips from baseUrl', () => {
    expect(SFX_VOLUME_DEFAULT).toBe(0.35);
    const { player, created, plays } = fake();
    expect(created).toEqual(['/sfx/tap.ogg', '/sfx/annoyed.ogg', '/sfx/land.ogg', '/sfx/notify.ogg']);
    player.play('tap');
    expect(plays).toEqual([{ url: '/sfx/tap.ogg', volume: 0.35 }]);
  });
  it('applies volume * gain, clamped to [0, 1]', () => {
    const { player, plays, tick } = fake();
    player.setVolume(0.5);
    player.play('land', 0.5);
    tick(SFX_MIN_INTERVAL_MS);
    player.play('land', 9);
    expect(plays.map((p) => p.volume)).toEqual([0.25, 1]);
  });
  it('rate-limits to one play per SFX_MIN_INTERVAL_MS (120) so a tap burst is not a machine gun', () => {
    expect(SFX_MIN_INTERVAL_MS).toBe(120);
    const { player, plays, tick } = fake();
    player.play('tap'); tick(119); player.play('tap'); tick(1); player.play('tap');
    expect(plays.length).toBe(2);
  });
  it('muted plays nothing and does not consume the interval', () => {
    const { player, plays } = fake();
    player.setMuted(true);
    player.play('proactive');
    player.setMuted(false);
    player.play('proactive');
    expect(plays.length).toBe(1);
  });
  it('swallows a rejected play() promise (autoplay policy) instead of throwing', async () => {
    const createAudio = (): SfxAudio => ({ volume: 1, currentTime: 0, play: () => Promise.reject(new Error('NotAllowedError')) });
    const player = new SfxPlayer('/sfx/', { createAudio, now: () => 0 });
    expect(() => player.play('tap')).not.toThrow();
    await Promise.resolve();
  });
});
