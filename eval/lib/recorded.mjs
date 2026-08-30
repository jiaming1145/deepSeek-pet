// eval/lib/recorded.mjs — the offline client for --dry.
// It streams a recorded reply in seeded 1..7-character chunks, which is also the
// only chunk-safety exercise StreamParser gets outside its own unit tests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RecordedClient {
  #replies;
  #rand;
  constructor({ replies, seed }) {
    this.#replies = replies;
    this.#rand = mulberry32(seed);
  }
  has(promptId) {
    return typeof this.#replies[promptId] === 'string';
  }
  async *streamFor(promptId) {
    const text = this.#replies[promptId];
    if (typeof text !== 'string') throw new Error(`录制回复里没有 ${promptId}`);
    let i = 0;
    while (i < text.length) {
      const size = 1 + Math.floor(this.#rand() * 7);
      yield { kind: 'delta', text: text.slice(i, i + size) };
      i += size;
    }
    // No usage frame on purpose: cacheHitPct must report SKIP for a dry run.
    yield { kind: 'done' };
  }
}
