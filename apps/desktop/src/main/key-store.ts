import { app, safeStorage as electronSafeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type KeySource = 'store' | 'dev-env' | 'none';

/** The slice of Electron's safeStorage this file uses, so the unit test can supply a fake. */
export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface KeyStoreOptions {
  file?: string;
  safeStorage?: SafeStoragePort;
  isPackaged?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * D5 and contracts.md §8.5 deviation 6: the dev app key is DS_DEV_DEEPSEEK_KEY, never
 * DEEPSEEK_API_KEY. DEEPSEEK_API_KEY stays reserved for the gated tests and the eval harness, so a
 * developer running the app can never silently bypass the first-run flow that same variable is
 * meant to let them test (X9). DS_FAKE_BRAIN is a third, unrelated variable (§6.7).
 */
export const DEV_KEY_ENV = 'DS_DEV_DEEPSEEK_KEY';
export const MIN_KEY_LENGTH = 8;
export const SAFE_STORAGE_UNAVAILABLE = '这台机器上没法安全保存 Key，先检查一下登录凭据服务。';

export class KeyStore {
  private readonly file: string;
  private readonly safeStorage: SafeStoragePort;
  private readonly devKey: string | null;
  private readonly listeners = new Set<(s: { present: boolean; source: KeySource }) => void>();

  constructor(opts: KeyStoreOptions = {}) {
    // Every `??` below short-circuits when the option is supplied, so the unit test never touches
    // the real Electron module.
    this.file = opts.file ?? join(app.getPath('userData'), 'key.bin'); // %APPDATA%\ds\key.bin
    this.safeStorage = opts.safeStorage ?? electronSafeStorage;
    const isPackaged = opts.isPackaged ?? app.isPackaged;
    const env = opts.env ?? process.env;
    const raw = env[DEV_KEY_ENV];
    // Held in memory for this run only: never encrypted to key.bin, never reported by hasStored().
    this.devKey = !isPackaged && typeof raw === 'string' && raw.length >= MIN_KEY_LENGTH ? raw : null;
  }

  hasStored(): boolean {
    return existsSync(this.file);
  }

  get(): string | null {
    if (this.hasStored()) {
      try {
        return this.safeStorage.decryptString(readFileSync(this.file));
      } catch (err) {
        // A key.bin written by another OS user, or before a credential reset, cannot be decrypted.
        // Fall through to the dev key rather than bricking the run; the key window can rewrite it.
        console.error('[key] decrypt failed, ignoring key.bin', err);
        return this.devKey;
      }
    }
    return this.devKey;
  }

  source(): KeySource {
    if (this.hasStored()) return 'store';
    return this.devKey ? 'dev-env' : 'none';
  }

  set(apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error(SAFE_STORAGE_UNAVAILABLE);
    mkdirSync(dirname(this.file), { recursive: true });
    // Never a plaintext fallback: a key on disk in the clear is worse than no key at all.
    writeFileSync(this.file, this.safeStorage.encryptString(apiKey), { mode: 0o600 });
    this.emit();
  }

  clear(): void {
    if (existsSync(this.file)) unlinkSync(this.file);
    this.emit();
  }

  /** `key:status`'s upstream producer (R9): BrainService subscribes and pushes to key + chat. */
  onChange(cb: (s: { present: boolean; source: KeySource }) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const s = { present: this.get() !== null, source: this.source() };
    for (const cb of this.listeners) cb(s);
  }
}
