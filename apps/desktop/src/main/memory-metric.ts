/**
 * §11.1 (R3-14): the binding metric is the sum of PROCESS_MEMORY_COUNTERS_EX2.PrivateWorkingSetSize
 * over the Electron process tree — what Task Manager shows. PrivateUsage (commit) is reported
 * alongside and NEVER added. PIDs come from `app.getAppMetrics()` (the caller's job: SimService /
 * index.ts), so no process can be missed by a name filter.
 */

export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
export const PROCESS_VM_READ = 0x0010;

/** PROCESS_MEMORY_COUNTERS_EX2, field for field (psapi.h). Filled by koffi through `_Out_`. */
export interface PmcEx2 {
  cb: number; PageFaultCount: number;
  PeakWorkingSetSize: number; WorkingSetSize: number;
  QuotaPeakPagedPoolUsage: number; QuotaPagedPoolUsage: number;
  QuotaPeakNonPagedPoolUsage: number; QuotaNonPagedPoolUsage: number;
  PagefileUsage: number; PeakPagefileUsage: number;
  PrivateUsage: number; PrivateWorkingSetSize: number; SharedCommitUsage: number;
}

export interface TreeMemory {
  /** THE number the 250 MB bar is measured against. Sum over main + every child. */
  privateWorkingSetMb: number;
  /** Reported alongside. NEVER added to the number above (R3-14). */
  privateCommitMb: number;
  /** Processes actually sampled; a pid that had exited is skipped and therefore missing here. */
  processes: number;
  /** Set when the EX2 counters were unavailable and the numbers came from process.memoryUsage(). */
  degraded?: true;
}

/** The slice of psapi/kernel32 the sampler calls — injectable so the arithmetic is testable off Windows. */
export interface MemoryApi {
  OpenProcess(access: number, inherit: boolean, pid: number): unknown;
  GetProcessMemoryInfo(handle: unknown, out: PmcEx2, cb: number): boolean;
  CloseHandle(handle: unknown): boolean;
  /** koffi.sizeof('DS_PMC_EX2') */
  sizeofPmc: number;
}

let api: MemoryApi | null | undefined;
function loadApi(): MemoryApi | null {
  if (api !== undefined) return api;
  try {
    // Same lazy-require discipline as foreground.ts: koffi is external in electron.vite.config.ts,
    // and a missing/incompatible binary degrades to `degraded: true` instead of taking main down.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi');
    // Namespaced (DS_) so it can never collide with another koffi user; koffi.struct throws on a duplicate.
    koffi.struct('DS_PMC_EX2', {
      cb: 'uint32', PageFaultCount: 'uint32',
      PeakWorkingSetSize: 'size_t', WorkingSetSize: 'size_t',
      QuotaPeakPagedPoolUsage: 'size_t', QuotaPagedPoolUsage: 'size_t',
      QuotaPeakNonPagedPoolUsage: 'size_t', QuotaNonPagedPoolUsage: 'size_t',
      PagefileUsage: 'size_t', PeakPagefileUsage: 'size_t',
      PrivateUsage: 'size_t', PrivateWorkingSetSize: 'size_t', SharedCommitUsage: 'size_t',
    });
    const psapi = koffi.load('psapi.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const GetProcessMemoryInfo =
      psapi.func('bool __stdcall GetProcessMemoryInfo(void* hProcess, _Out_ DS_PMC_EX2* c, uint32 cb)');
    // `GetProcessMemoryInfo` takes a HANDLE, and `app.getAppMetrics()` gives PIDs — so the handle has
    // to be opened and closed per sample, or the sampler leaks one handle per process per second.
    const OpenProcess =
      kernel32.func('void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
    const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
    api = {
      OpenProcess: (access, inherit, pid) => OpenProcess(access, inherit, pid) as unknown,
      GetProcessMemoryInfo: (h, out, cb) => Boolean(GetProcessMemoryInfo(h, out, cb)),
      CloseHandle: (h) => Boolean(CloseHandle(h)),
      sizeofPmc: koffi.sizeof('DS_PMC_EX2'),
    };
  } catch (err) {
    console.warn('[memory] koffi/psapi unavailable, memory metric degraded:', err);
    api = null;
  }
  return api;
}

const toMb = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10;

function emptyPmc(cb: number): PmcEx2 {
  return {
    cb, PageFaultCount: 0, PeakWorkingSetSize: 0, WorkingSetSize: 0,
    QuotaPeakPagedPoolUsage: 0, QuotaPagedPoolUsage: 0, QuotaPeakNonPagedPoolUsage: 0, QuotaNonPagedPoolUsage: 0,
    PagefileUsage: 0, PeakPagefileUsage: 0, PrivateUsage: 0, PrivateWorkingSetSize: 0, SharedCommitUsage: 0,
  };
}

/**
 * The fallback is a DIFFERENT quantity (this process's RSS, not the tree's private working set)
 * and says so with `degraded: true` rather than silently reporting it as the bar's number.
 */
function degradedSample(processes: number): TreeMemory {
  const m = process.memoryUsage();
  return {
    privateWorkingSetMb: toMb(m.rss),
    privateCommitMb: toMb(m.heapTotal + m.external + m.arrayBuffers),
    processes,
    degraded: true,
  };
}

/**
 * Per PID: OpenProcess(QUERY_LIMITED | VM_READ) → GetProcessMemoryInfo → CloseHandle in a `finally`.
 * A null handle (the process exited between getAppMetrics() and here) is skipped; `processes`
 * therefore counts what was sampled, so a dropped renderer is visible as processes < pids.length.
 * A `false` from GetProcessMemoryInfo (a Windows build without EX2) → degraded fallback.
 */
export function sampleTreeMemory(pids: readonly number[], memoryApi: MemoryApi | null = loadApi()): TreeMemory {
  if (!memoryApi) return degradedSample(pids.length);
  let privateWorkingSet = 0;
  let privateUsage = 0;
  let processes = 0;
  for (const pid of pids) {
    const handle = memoryApi.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, pid);
    if (handle === null || handle === undefined || handle === 0) continue; // exited: skip, do not close
    try {
      const out = emptyPmc(memoryApi.sizeofPmc);
      if (!memoryApi.GetProcessMemoryInfo(handle, out, memoryApi.sizeofPmc)) return degradedSample(pids.length);
      privateWorkingSet += Number(out.PrivateWorkingSetSize);
      privateUsage += Number(out.PrivateUsage);
      processes += 1;
    } finally {
      memoryApi.CloseHandle(handle);
    }
  }
  return { privateWorkingSetMb: toMb(privateWorkingSet), privateCommitMb: toMb(privateUsage), processes };
}
