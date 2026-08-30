import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryOpenError, openDb } from '@ds/memory';

const shown: Array<[string, string]> = [];
const quits: number[] = [];

vi.mock('electron', () => ({
  app: { quit: () => quits.push(Date.now()) },
  dialog: { showErrorBox: (title: string, content: string) => shown.push([title, content]) },
}));

const { FATAL_TITLE, fatal } = await import('./fatal');

const dirs: string[] = [];
afterEach(() => {
  shown.length = 0;
  quits.length = 0;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('fatal', () => {
  it('shows a blocking dialog titled 小春打不开了 and then quits', () => {
    fatal('无法打开数据库：C:\\nope\\ds.sqlite');
    expect(FATAL_TITLE).toBe('小春打不开了');
    expect(shown).toEqual([['小春打不开了', '无法打开数据库：C:\\nope\\ds.sqlite']]);
    expect(quits).toHaveLength(1);
  });

  it('passes the message through unchanged', () => {
    fatal('角色卡读不了：x');
    expect(shown[0][1]).toBe('角色卡读不了：x');
  });

  it('is fed a real MemoryOpenError when the database path cannot be opened', () => {
    // Opening a *directory* as a database file is the reproducible failure (contracts.md §8.7:
    // node:sqlite reports "unable to open database file"). This is the exact error index.ts hands
    // to fatal(), so the wiring is proven end to end rather than by reading the code.
    const dir = mkdtempSync(join(tmpdir(), 'ds-db-'));
    dirs.push(dir);
    let caught: unknown;
    try {
      openDb(dir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MemoryOpenError);
    fatal((caught as MemoryOpenError).message);
    expect(shown[0][0]).toBe(FATAL_TITLE);
    expect(shown[0][1]).toContain(dir);
    expect(quits).toHaveLength(1);
  });
});
