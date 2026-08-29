export class ViewTransform {
  private readonly ratio: number;
  constructor(private readonly w: number, private readonly h: number) {
    this.ratio = w / h;
  }
  /** device (canvas) pixels → Cubism view space: x in [-ratio, ratio] (or [-1,1] for landscape), y up. */
  toView(deviceX: number, deviceY: number): { x: number; y: number } {
    // _deviceToScreen: scale by 2/max(w,h) in x, -2/max(w,h) in y, then translate by -w/2,-h/2
    const s = 2 / (this.w > this.h ? this.w : this.h);
    const sx = (deviceX - this.w * 0.5) * s;
    const sy = (this.h * 0.5 - deviceY) * s;
    // _viewMatrix with ViewScale=1 and screen rect (-ratio..ratio, -1..1) is identity in this setup
    return { x: sx, y: sy };
  }
  /** gaze target for CubismLook: both axes normalised to [-1, 1] relative to the canvas, clamped. */
  toGaze(deviceX: number, deviceY: number): { x: number; y: number } {
    const nx = (deviceX / this.w) * 2 - 1;
    const ny = -((deviceY / this.h) * 2 - 1);
    return { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };
  }
}
