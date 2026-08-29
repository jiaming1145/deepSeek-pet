/** Promisified port of the sample's LAppTextureManager.createTextureFromPngFile. */
export function loadTexture(
  gl: WebGL2RenderingContext,
  url: string,
  premultiply = true
): Promise<WebGLTexture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Must be set before `src`. Without it a cross-origin PNG taints the image and texImage2D
    // throws SecurityError - which, thrown from a DOM event handler, is NOT turned into a rejection
    // by the Promise executor: the promise would stay pending forever and CompanionModel.load would
    // never reach its failure cleanup.
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error(`texture load failed: ${url}`));
    img.onload = () => {
      let tex: WebGLTexture | null = null;
      try {
        tex = gl.createTexture();
        if (!tex) throw new Error('gl.createTexture returned null');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (premultiply) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);
        resolve(tex);
      } catch (e) {
        // Settle first: cleanup on a lost context can throw too, and a pending promise is the one
        // failure the caller cannot recover from.
        reject(new Error(`texture upload failed: ${url}`, { cause: e }));
        gl.bindTexture(gl.TEXTURE_2D, null);
        if (tex) gl.deleteTexture(tex);
      } finally {
        // UNPACK_PREMULTIPLY_ALPHA_WEBGL is global to the context and defaults to 0; leaving it set
        // would silently change every later upload, including the failure path's.
        if (premultiply) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      }
    };
    img.src = url;
  });
}
