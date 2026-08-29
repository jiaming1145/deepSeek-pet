/** Promisified port of the sample's LAppTextureManager.createTextureFromPngFile. */
export function loadTexture(
  gl: WebGL2RenderingContext,
  url: string,
  premultiply = true
): Promise<WebGLTexture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error(`texture load failed: ${url}`));
    img.onload = () => {
      const tex = gl.createTexture();
      if (!tex) return reject(new Error('gl.createTexture failed'));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (premultiply) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
      resolve(tex);
    };
    img.src = url;
  });
}
