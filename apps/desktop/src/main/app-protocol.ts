import { app, net, protocol } from 'electron';
import { join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';
const APP_HOST = 'local';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const PET_URL = `${APP_ORIGIN}/pet.html`;

/**
 * M-9: the ONE place `ELECTRON_RENDERER_URL` is read. It is a dev hook — electron-vite sets it for
 * `pnpm dev` — and it widens the IPC trust origin (`allowedPetOrigins`) to whatever it names, so a
 * packaged build must never honour it: an environment variable is not a trusted input there. Same
 * gate shape as `useFakeBrain` and the D5 dev key. Gated per call rather than cached at module
 * load so the value cannot be captured before `app` is meaningful; the env cannot change under a
 * running process, so every call agrees.
 */
export function devRendererUrl(): string | undefined {
  if (app.isPackaged) return undefined;
  return process.env.ELECTRON_RENDERER_URL || undefined;
}

/** M-9: `DS_DEBUG=1` opens the pet's debug panel; a dev hook, so unpackaged only. */
export function devDebugEnabled(): boolean {
  return !app.isPackaged && process.env.DS_DEBUG === '1';
}

/**
 * The URL for one renderer page: electron-vite's dev server while `pnpm dev` is running, the
 * app:// scheme in a built app. One helper so the four windows cannot drift apart.
 *
 * `resolveRendererRequest` needs no change for the three new pages: bubble.html, chat.html and
 * key.html are ordinary paths under the same root and the same authority as pet.html.
 */
export function rendererUrl(page: 'pet' | 'bubble' | 'chat' | 'key'): string {
  const dev = devRendererUrl();
  return dev ? `${dev}/${page}.html` : `${APP_ORIGIN}/${page}.html`;
}

/**
 * Declares the scheme. Must run before `app.whenReady()`.
 *
 * The built renderer cannot be loaded with `loadFile`: `fetch()` is disabled on `file://` in
 * Chromium, and pet.html asks for absolute paths (`/live2d/...`, `/characters/<id>/...`) which
 * under file:// would resolve against the drive root. A standard, fetch-capable scheme keeps those
 * URLs working unchanged, so dev (http://localhost) and the built app behave identically.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/**
 * `URL.origin` is useless here: `app:` is not a *special* scheme to the WHATWG parser, so
 * `new URL('app://local/pet.html').origin` is the string `"null"` — the same value an attacker's
 * `app://evil/` produces. Chromium treats `app:` as standard because of
 * `registerSchemesAsPrivileged`, but the main process parses with Node's URL, so the origin is
 * rebuilt by hand. Credentials make the URL untrusted outright rather than contributing to a key.
 */
function originKey(url: URL): string | null {
  if (url.username !== '' || url.password !== '') return null;
  return `${url.protocol}//${url.hostname}${url.port === '' ? '' : `:${url.port}`}`;
}

/** The exact origins the pet document is allowed to have: production `app://local`, plus dev. */
export function allowedPetOrigins(devUrl = devRendererUrl()): string[] {
  const origins = [APP_ORIGIN];
  if (devUrl) {
    try {
      const key = originKey(new URL(devUrl));
      if (key) origins.push(key);
    } catch {
      /* an unparseable ELECTRON_RENDERER_URL simply grants nothing */
    }
  }
  return origins;
}

/**
 * Whether `url` may be the pet's top-level document. Used both to reject IPC from a navigated-away
 * page and to deny the navigation in the first place.
 */
export function isAllowedPetUrl(url: string, devUrl = devRendererUrl()): boolean {
  try {
    const key = originKey(new URL(url));
    return key !== null && allowedPetOrigins(devUrl).includes(key);
  } catch {
    return false;
  }
}

export type RendererResolution = { ok: true; path: string } | { ok: false; status: number; body: string };

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Decides what `app://…` request maps to which file on disk — the whole security policy of the
 * scheme, kept pure so every rejection arm is testable without Electron.
 *
 * The authority has to be checked, not just the path: `protocol.handle` is registered for the
 * *scheme*, so `app://anything/pet.html` reaches this handler and would otherwise be served as
 * privileged, secure, same-origin-with-nothing content under an attacker-chosen origin — which
 * defeats the point of pinning the renderer to a single origin.
 */
export function resolveRendererRequest(root: string, request: { url: string; method?: string }): RendererResolution {
  const method = (request.method ?? 'GET').toUpperCase();
  if (!READ_METHODS.has(method)) return { ok: false, status: 405, body: 'method not allowed' };

  let url: URL;
  let relative: string;
  try {
    url = new URL(request.url);
    // Malformed percent-encoding (`%E0%A4%A`) throws URIError here rather than in the caller.
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return { ok: false, status: 400, body: 'bad request' };
  }

  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST || url.port !== ''
    || url.username !== '' || url.password !== '') {
    return { ok: false, status: 403, body: 'forbidden' };
  }

  const target = normalize(join(root, relative));
  // `..` in the URL must not escape the renderer directory.
  if (target !== root && !target.startsWith(root + sep)) return { ok: false, status: 403, body: 'forbidden' };
  return { ok: true, path: target };
}

/** Serves `dir` (out/renderer) over app://local. Must run after `app.whenReady()`. */
export function serveRenderer(dir: string): void {
  const root = resolve(dir);
  protocol.handle(APP_SCHEME, (request) => {
    const resolved = resolveRendererRequest(root, request);
    if (!resolved.ok) return new Response(resolved.body, { status: resolved.status });
    return net.fetch(pathToFileURL(resolved.path).toString()).catch(() => new Response('not found', { status: 404 }));
  });
}
