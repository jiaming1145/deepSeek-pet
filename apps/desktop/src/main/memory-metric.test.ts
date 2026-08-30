import { describe, expect, it, vi } from 'vitest';
import {
  PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ, sampleTreeMemory, type MemoryApi, type PmcEx2,
} from './memory-metric';

const MB = 1024 * 1024;

function pmc(privateWs: number, privateUsage: number): PmcEx2 {
  return {
    cb: 0, PageFaultCount: 0, PeakWorkingSetSize: 0, WorkingSetSize: 0,
    QuotaPeakPagedPoolUsage: 0, QuotaPagedPoolUsage: 0, QuotaPeakNonPagedPoolUsage: 0, QuotaNonPagedPoolUsage: 0,
    PagefileUsage: 0, PeakPagefileUsage: 0, PrivateUsage: privateUsage, PrivateWorkingSetSize: privateWs, SharedCommitUsage: 0,
  };
}

/** A fake psapi/kernel32: `table` maps pid → counters; a missing pid is an exited process. */
function fakeApi(table: Record<number, PmcEx2>, opts: { infoFails?: boolean } = {}) {
  const calls: string[] = [];
  const api: MemoryApi = {
    sizeofPmc: 80,
    OpenProcess: vi.fn((access: number, inherit: boolean, pid: number) => {
      calls.push(`open:${pid}`);
      expect(access).toBe(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ);
      expect(inherit).toBe(false);
      return pid in table ? { pid } : null;
    }),
    GetProcessMemoryInfo: vi.fn((h: unknown, out: PmcEx2, cb: number) => {
      const { pid } = h as { pid: number };
      calls.push(`info:${pid}`);
      expect(cb).toBe(80);
      if (opts.infoFails) return false;
      Object.assign(out, table[pid]);
      return true;
    }),
    CloseHandle: vi.fn((h: unknown) => { calls.push(`close:${(h as { pid: number }).pid}`); return true; }),
  };
  return { api, calls };
}

describe('sampleTreeMemory — §11.1 binding metric', () => {
  it('sums PrivateWorkingSetSize over every pid, reports PrivateUsage alongside and NEVER adds it', () => {
    const { api } = fakeApi({ 10: pmc(100 * MB, 150 * MB), 11: pmc(60 * MB, 90 * MB), 12: pmc(40.5 * MB, 50 * MB) });
    const s = sampleTreeMemory([10, 11, 12], api);
    expect(s).toEqual({ privateWorkingSetMb: 200.5, privateCommitMb: 290, processes: 3 });
    expect(s.degraded).toBeUndefined();
  });

  it('passes the exact access mask and closes every handle in a finally, even when GetProcessMemoryInfo throws', () => {
    const { api, calls } = fakeApi({ 10: pmc(1, 1) });
    // The replacement implementation must record the call itself — `mockImplementationOnce`
    // replaces the body that would otherwise push `info:<pid>`, and the ordering assertion below
    // is the point of the test: the throw happens BETWEEN the info call and the CloseHandle.
    (api.GetProcessMemoryInfo as ReturnType<typeof vi.fn>).mockImplementationOnce((h: unknown) => {
      calls.push(`info:${(h as { pid: number }).pid}`);
      throw new Error('boom');
    });
    expect(() => sampleTreeMemory([10], api)).toThrow('boom');
    expect(calls).toEqual(['open:10', 'info:10', 'close:10']);
  });

  it('skips a pid that already exited (null handle), counts only sampled processes, never calls CloseHandle for it', () => {
    const { api, calls } = fakeApi({ 10: pmc(10 * MB, 10 * MB), 12: pmc(20 * MB, 20 * MB) });
    const s = sampleTreeMemory([10, 11, 12], api);
    expect(s.processes).toBe(2);
    expect(s.privateWorkingSetMb).toBe(30);
    expect(calls.filter((c) => c.startsWith('close:'))).toEqual(['close:10', 'close:12']);
    expect(calls).not.toContain('close:11');
  });

  it('falls back to process.memoryUsage()-derived numbers with degraded:true when the EX2 call returns false (old Windows)', () => {
    const { api, calls } = fakeApi({ 10: pmc(1, 1) }, { infoFails: true });
    const s = sampleTreeMemory([10], api);
    expect(s.degraded).toBe(true);
    expect(s.processes).toBe(1);
    expect(s.privateWorkingSetMb).toBeGreaterThan(0);
    expect(calls).toEqual(['open:10', 'info:10', 'close:10']);
  });

  it('falls back with degraded:true when koffi/psapi is unavailable (api === null)', () => {
    const s = sampleTreeMemory([process.pid], null);
    expect(s.degraded).toBe(true);
    expect(s.processes).toBe(1);
    expect(s.privateCommitMb).toBeGreaterThan(0);
  });

  it('pins the Win32 access constants', () => {
    expect(PROCESS_QUERY_LIMITED_INFORMATION).toBe(0x1000);
    expect(PROCESS_VM_READ).toBe(0x0010);
  });
});
