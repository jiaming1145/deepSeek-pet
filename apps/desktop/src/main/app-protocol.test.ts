import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Neither `net` nor `protocol` is touched by the pure resolver under test; mocking keeps the real
// electron package (which prints to stdout when required outside Electron) out of the run.
const electronApp = { isPackaged: false };
vi.mock('electron', () => ({ app: electronApp, net: {}, protocol: {} }));

const { allowedPetOrigins, devDebugEnabled, devRendererUrl, isAllowedPetUrl, PET_URL, rendererUrl, resolveRendererRequest } = await import('./app-protocol');

const root = `${sep}app${sep}out${sep}renderer`;

describe('resolveRendererRequest', () => {
  it('serves a file under the exact app://local origin', () => {
    expect(resolveRendererRequest(root, { url: 'app://local/pet.html' })).toEqual({
      ok: true,
      path: join(root, 'pet.html'),
    });
  });

  it('serves nested assets', () => {
    expect(resolveRendererRequest(root, { url: 'app://local/live2d/core.js' })).toEqual({
      ok: true,
      path: join(root, 'live2d', 'core.js'),
    });
  });

  it.each([
    ['a foreign host', 'app://other/pet.html'],
    ['a host differing only in case', 'app://LOCAL/pet.html'],
    ['an explicit port', 'app://local:1/pet.html'],
    ['embedded credentials', 'app://u:p@local/pet.html'],
    ['a foreign scheme', 'https://local/pet.html'],
  ])('rejects %s with 403', (_label, url) => {
    expect(resolveRendererRequest(root, { url })).toEqual({ ok: false, status: 403, body: 'forbidden' });
  });

  it('rejects malformed percent-encoding with 400 instead of throwing', () => {
    expect(resolveRendererRequest(root, { url: 'app://local/%E0%A4%A' })).toEqual({
      ok: false,
      status: 400,
      body: 'bad request',
    });
  });

  it('rejects an unparseable URL with 400', () => {
    expect(resolveRendererRequest(root, { url: 'not a url' })).toEqual({
      ok: false,
      status: 400,
      body: 'bad request',
    });
  });

  it('rejects traversal that survives URL normalisation', () => {
    // The URL parser collapses literal and %2e-encoded `..` before we ever see the path, so the
    // vector that reaches the containment check is an encoded *backslash* separator.
    expect(resolveRendererRequest(root, { url: 'app://local/..%5c..%5csecret.txt' })).toEqual({
      ok: false,
      status: 403,
      body: 'forbidden',
    });
    // …and these are neutralised into an ordinary in-root path rather than escaping.
    expect(resolveRendererRequest(root, { url: 'app://local/../../secret.txt' })).toEqual({
      ok: true,
      path: join(root, 'secret.txt'),
    });
    expect(resolveRendererRequest(root, { url: 'app://local/%2e%2e/%2e%2e/secret.txt' })).toEqual({
      ok: true,
      path: join(root, 'secret.txt'),
    });
  });

  it('rejects anything that is not a read', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect(resolveRendererRequest(root, { url: 'app://local/pet.html', method })).toEqual({
        ok: false,
        status: 405,
        body: 'method not allowed',
      });
    }
    expect(resolveRendererRequest(root, { url: 'app://local/pet.html', method: 'HEAD' }).ok).toBe(true);
    expect(resolveRendererRequest(root, { url: 'app://local/pet.html', method: 'get' }).ok).toBe(true);
  });
});

describe('isAllowedPetUrl', () => {
  it('accepts the production pet URL', () => {
    expect(isAllowedPetUrl(PET_URL, undefined)).toBe(true);
    expect(isAllowedPetUrl('app://local/other.html?debug=1', undefined)).toBe(true);
  });

  it('accepts the configured dev-server origin, and only that origin', () => {
    const dev = 'http://localhost:5173';
    expect(isAllowedPetUrl('http://localhost:5173/pet.html', dev)).toBe(true);
    expect(isAllowedPetUrl('http://localhost:5174/pet.html', dev)).toBe(false);
    expect(isAllowedPetUrl('https://localhost:5173/pet.html', dev)).toBe(false);
    expect(allowedPetOrigins(dev)).toEqual(['app://local', 'http://localhost:5173']);
  });

  it.each([
    'app://other/pet.html',
    'app://local:1/pet.html',
    'app://u:p@local/pet.html',
    'https://evil.example/pet.html',
    'file:///C:/Windows/System32/pet.html',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAllowedPetUrl(url, undefined)).toBe(false);
  });

  it('grants nothing extra when ELECTRON_RENDERER_URL is unparseable', () => {
    expect(allowedPetOrigins('::::')).toEqual(['app://local']);
  });
});

describe('M-9: dev hooks are gated on !app.isPackaged', () => {
  afterEach(() => {
    electronApp.isPackaged = false;
    delete process.env.ELECTRON_RENDERER_URL;
    delete process.env.DS_DEBUG;
  });

  it('honours ELECTRON_RENDERER_URL and DS_DEBUG in an unpackaged run', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    process.env.DS_DEBUG = '1';
    expect(devRendererUrl()).toBe('http://localhost:5173');
    expect(rendererUrl('bubble')).toBe('http://localhost:5173/bubble.html');
    expect(allowedPetOrigins()).toEqual(['app://local', 'http://localhost:5173']);
    expect(isAllowedPetUrl('http://localhost:5173/pet.html')).toBe(true);
    expect(devDebugEnabled()).toBe(true);
  });

  it('ignores both in a packaged build: the IPC trust origin stays app://local', () => {
    electronApp.isPackaged = true;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    process.env.DS_DEBUG = '1';
    expect(devRendererUrl()).toBeUndefined();
    expect(rendererUrl('pet')).toBe(PET_URL);
    expect(allowedPetOrigins()).toEqual(['app://local']);
    expect(isAllowedPetUrl('http://localhost:5173/pet.html')).toBe(false);
    expect(devDebugEnabled()).toBe(false);
  });

  it('treats an empty ELECTRON_RENDERER_URL as unset', () => {
    process.env.ELECTRON_RENDERER_URL = '';
    expect(devRendererUrl()).toBeUndefined();
    expect(rendererUrl('chat')).toBe('app://local/chat.html');
  });
});

describe('G2-1: the dev origin table — only an http(s) loopback URL without credentials is a key', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['plain', 'http://localhost:5173', 'http://localhost:5173'],
    ['upper-case host', 'http://LOCALHOST:5173', 'http://localhost:5173'],
    ['trailing slash', 'http://localhost:5173/', 'http://localhost:5173'],
    ['with a path', 'http://localhost:5173/pet.html', 'http://localhost:5173'],
    ['default port', 'http://localhost', 'http://localhost'],
    ['explicit default port', 'http://localhost:80', 'http://localhost'],
    ['https', 'https://localhost:5173', 'https://localhost:5173'],
    ['IPv4 loopback', 'http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['IPv6 loopback', 'http://[::1]:5173', 'http://[::1]:5173'],
  ])('accepts %s (%s)', (_label, devUrl, key) => {
    expect(allowedPetOrigins(devUrl)).toEqual(['app://local', key]);
    expect(isAllowedPetUrl(`${key}/pet.html`, devUrl)).toBe(true);
  });

  it.each([
    ['file: (would make every file: document trusted)', 'file:///a'],
    ['a remote host', 'http://evil.example:5173'],
    ['a loopback look-alike', 'http://localhost.evil:5173'],
    ['a non-loopback IP', 'http://10.0.0.1:5173'],
    ['userinfo', 'http://user:pw@localhost:5173'],
    ['a bare username', 'http://user@localhost:5173'],
    ['app://local.evil', 'app://local.evil'],
    ['a foreign scheme', 'ws://localhost:5173'],
    ['malformed', 'not a url'],
    ['a scheme-relative value', '//localhost:5173'],
  ])('rejects %s (%s) and grants nothing beyond app://local', (_label, devUrl) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(allowedPetOrigins(devUrl)).toEqual(['app://local']);
    expect(isAllowedPetUrl(devUrl, devUrl)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    // Once per value: the guard is consulted on every IPC event and must not spam the log.
    allowedPetOrigins(devUrl);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('app://local as the dev URL widens nothing (it is granted anyway, never as a dev key)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(allowedPetOrigins('app://local')).toEqual(['app://local']);
    expect(allowedPetOrigins('app://local/')).toEqual(['app://local']);
  });

  it('file:///a never authorises file:///b (or file:///a)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isAllowedPetUrl('file:///b', 'file:///a')).toBe(false);
    expect(isAllowedPetUrl('file:///a', 'file:///a')).toBe(false);
  });

  it('a port mismatch against an accepted dev origin is rejected', () => {
    expect(isAllowedPetUrl('http://localhost:5174/pet.html', 'http://localhost:5173')).toBe(false);
    expect(isAllowedPetUrl('http://localhost/pet.html', 'http://localhost:5173')).toBe(false);
  });

  it('a packaged build ignores even a valid loopback ELECTRON_RENDERER_URL', () => {
    electronApp.isPackaged = true;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    try {
      expect(allowedPetOrigins()).toEqual(['app://local']);
      expect(isAllowedPetUrl('http://localhost:5173/pet.html')).toBe(false);
    } finally {
      electronApp.isPackaged = false;
      delete process.env.ELECTRON_RENDERER_URL;
    }
  });
});
