import { net, protocol } from 'electron';
import { join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';
const ORIGIN = `${APP_SCHEME}://local`;
export const PET_URL = `${ORIGIN}/pet.html`;

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

/** Serves `dir` (out/renderer) over app://local. Must run after `app.whenReady()`. */
export function serveRenderer(dir: string): void {
  const root = resolve(dir);
  protocol.handle(APP_SCHEME, (request) => {
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const target = normalize(join(root, relative));
    // `..` in the URL must not escape the renderer directory.
    if (target !== root && !target.startsWith(root + sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString()).catch(() => new Response('not found', { status: 404 }));
  });
}
