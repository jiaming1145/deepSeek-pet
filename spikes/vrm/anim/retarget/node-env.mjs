// Minimal browser shims so three's loaders (GLTFLoader, FBXLoader) run under Node.
// Import this before any three loader in Node-side tools and tests.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const g = globalThis;
if (!g.window) g.window = dom.window;
if (!g.document) g.document = dom.window.document;
if (!g.self) g.self = g;
if (!g.navigator) g.navigator = dom.window.navigator;
if (!g.HTMLImageElement) g.HTMLImageElement = dom.window.HTMLImageElement;
if (!g.HTMLCanvasElement) g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
if (!g.Image) g.Image = dom.window.Image;
if (!g.URL.createObjectURL) {
  g.URL.createObjectURL = () => 'blob:node-shim';
  g.URL.revokeObjectURL = () => {};
}
// three's ImageBitmapLoader path is chosen when createImageBitmap exists; force the Image path off too:
// textures are irrelevant for animation parsing, so make image decoding a no-op that never rejects.
g.createImageBitmap = undefined;
export { dom };
