import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// `import type` is erased before the module graph is built, so it does not pull in electron.
import type { SafeStoragePort } from './key-store';

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
}));

const { DEV_KEY_ENV, KeyStore, SAFE_STORAGE_UNAVAILABLE } = await import('./key-store');

const fakeSafe = (available = true): SafeStoragePort => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
});

const dirs: string[] = [];
const tmpFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-key-'));
  dirs.push(dir);
  return join(dir, 'key.bin');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('KeyStore', () => {
  it('stores a key and reads it back', () => {
    const file = tmpFile();
    const store = new KeyStore({ file, safeStorage: fakeSafe(), isPackaged: false, env: {} });
    store.set('sk-abcdef123456');
    expect(store.get()).toBe('sk-abcdef123456');
    expect(store.hasStored()).toBe(true);
    expect(store.source()).toBe('store');
  });

  it('returns null when nothing is stored and no dev key is set', () => {
    const store = new KeyStore({ file: tmpFile(), safeStorage: fakeSafe(), isPackaged: false, env: {} });
    expect(store.get()).toBeNull();
    expect(store.hasStored()).toBe(false);
    expect(store.source()).toBe('none');
  });

  it('uses DS_DEV_DEEPSEEK_KEY in an unpackaged run without ever writing it (D5)', () => {
    const file = tmpFile();
    const store = new KeyStore({
      file, safeStorage: fakeSafe(), isPackaged: false,
      env: { [DEV_KEY_ENV]: 'dev-key-123456' },
    });
    expect(store.get()).toBe('dev-key-123456');
    expect(store.source()).toBe('dev-env');
    expect(store.hasStored()).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('ignores the dev key in a packaged build (D5)', () => {
    const store = new KeyStore({
      file: tmpFile(), safeStorage: fakeSafe(), isPackaged: true,
      env: { [DEV_KEY_ENV]: 'dev-key-123456' },
    });
    expect(store.get()).toBeNull();
    expect(store.source()).toBe('none');
  });

  it('ignores a dev key shorter than eight characters', () => {
    const store = new KeyStore({
      file: tmpFile(), safeStorage: fakeSafe(), isPackaged: false,
      env: { [DEV_KEY_ENV]: 'short' },
    });
    expect(store.get()).toBeNull();
  });

  it('never falls back to plaintext when safeStorage is unavailable', () => {
    const file = tmpFile();
    const store = new KeyStore({ file, safeStorage: fakeSafe(false), isPackaged: false, env: {} });
    expect(() => store.set('sk-abcdef123456')).toThrow(SAFE_STORAGE_UNAVAILABLE);
    expect(existsSync(file)).toBe(false);
  });

  it('clear removes the stored key', () => {
    const file = tmpFile();
    const store = new KeyStore({ file, safeStorage: fakeSafe(), isPackaged: false, env: {} });
    store.set('sk-abcdef123456');
    store.clear();
    expect(existsSync(file)).toBe(false);
    expect(store.get()).toBeNull();
    expect(store.source()).toBe('none');
  });

  it('notifies onChange on set and on clear, and stops after unsubscribe', () => {
    const store = new KeyStore({ file: tmpFile(), safeStorage: fakeSafe(), isPackaged: false, env: {} });
    const seen: Array<{ present: boolean; source: string }> = [];
    const off = store.onChange((s) => seen.push(s));
    store.set('sk-abcdef123456');
    store.clear();
    off();
    store.set('sk-abcdef123456');
    expect(seen).toEqual([
      { present: true, source: 'store' },
      { present: false, source: 'none' },
    ]);
  });
});
