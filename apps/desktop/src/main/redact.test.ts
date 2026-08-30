import { describe, expect, it } from 'vitest';
import { DETAIL_MAX_CHARS, REDACTED, boundedDetail, redactSecrets } from './redact';

const KEY = `sk-${'Zz9'.repeat(12)}`; // 36 chars after the prefix

describe('G-3: redact', () => {
  it('redactSecrets replaces every DeepSeek-shaped key and nothing else', () => {
    expect(redactSecrets(`Bearer ${KEY} and again ${KEY}.`)).toBe(`Bearer ${REDACTED} and again ${REDACTED}.`);
    expect(redactSecrets('sk-short and 余额不足')).toBe('sk-short and 余额不足');
  });

  it('boundedDetail redacts, collapses whitespace and cuts at DETAIL_MAX_CHARS', () => {
    const long = `${KEY}\n\n  ${'x'.repeat(1000)}`;
    const out = boundedDetail(long);
    expect(out.startsWith(`${REDACTED} x`)).toBe(true);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('\n');
    expect(out.length).toBe(DETAIL_MAX_CHARS + 1); // + the ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(boundedDetail('short')).toBe('short');
  });
});
