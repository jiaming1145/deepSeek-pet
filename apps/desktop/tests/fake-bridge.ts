import type { Page } from '@playwright/test';

export type Sent = { channel: string; payload: unknown; t: number };

declare global {
  interface Window {
    __fake: { sent(): Sent[]; clear(): void; emit(channel: string, payload: unknown): void };
    __bubble: {
      ready: boolean;
      speak(events: unknown[]): Promise<void>;
      complete(): void;
      hint(h: { text: string; level: string; ttlMs: number }): void;
      text(): string;
      visible(): boolean;
    };
  }
}

/**
 * Installs a fake preload bridge before any module script runs (contracts.md §2.6, §8.4 A65). The
 * page's real handlers register against it, so `__fake.emit` exercises production code paths and
 * `__fake.sent()` is the exact IPC the renderer would have produced.
 */
export async function installFakeBridge(
  page: Page,
  globalName: 'ds' | 'dsBubble' | 'dsChat' | 'dsKey',
): Promise<void> {
  await page.addInitScript((name: string) => {
    const handlers: Record<string, Array<(p: unknown) => void>> = {};
    const sent: Array<{ channel: string; payload: unknown; t: number }> = [];
    const w = window as unknown as Record<string, unknown>;
    w[name] = {
      send(channel: string, payload: unknown) {
        sent.push({ channel, payload, t: performance.now() });
      },
      on(channel: string, cb: (p: unknown) => void) {
        (handlers[channel] ||= []).push(cb);
        return () => {
          handlers[channel] = (handlers[channel] || []).filter((f) => f !== cb);
        };
      },
    };
    w.__fake = {
      sent: () => sent,
      clear: () => {
        sent.length = 0;
      },
      emit: (channel: string, payload: unknown) => {
        for (const cb of handlers[channel] || []) cb(payload);
      },
    };
  }, globalName);
}
