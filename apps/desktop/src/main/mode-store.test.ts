import { DatabaseSync } from 'node:sqlite';
import { getKv, migrate, setKv } from '@ds/memory';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KV_MODE, ModeStore } from './mode-store';

let db: DatabaseSync;
beforeEach(() => { db = new DatabaseSync(':memory:'); migrate(db); });

describe('ModeStore (§9.3)', () => {
  it('KV_MODE is "mode" and the default is character', () => {
    expect(KV_MODE).toBe('mode');
    expect(new ModeStore(db).get()).toBe('character');
  });
  it('reads kv at construction, tolerating garbage', () => {
    setKv(db, KV_MODE, 'plain');
    expect(new ModeStore(db).get()).toBe('plain');
    setKv(db, KV_MODE, 'nonsense');
    expect(new ModeStore(db).get()).toBe('character');
  });
  it('set writes kv then notifies with the reason; a no-op set does NOT notify', () => {
    const store = new ModeStore(db);
    const cb = vi.fn();
    const off = store.onChange(cb);
    store.set('plain', 'command');
    expect(getKv(db, KV_MODE)).toBe('plain');
    expect(cb).toHaveBeenCalledWith('plain', 'command');
    store.set('plain', 'tray');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    store.set('character', 'restored');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe('character');
  });
  it('set(get(), "restored") — the startup broadcast — does not notify because nothing changed', () => {
    const store = new ModeStore(db);
    const cb = vi.fn();
    store.onChange(cb);
    store.set(store.get(), 'restored');
    expect(cb).not.toHaveBeenCalled();
  });
});
