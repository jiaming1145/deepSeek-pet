export class ViewTransform {
  constructor(private readonly w: number, private readonly h: number) {}
  /** device (canvas) pixels → Cubism view space: x in [-ratio, ratio] (or ±2 for landscape), y up. */
  toView(deviceX: number, deviceY: number): { x: number; y: number } {
    // _deviceToScreen: the sample scales by screenW/width (landscape) or screenH/height (portrait); with screenW = 2·ratio and screenH = 2 both reduce to 2/height, then translate by -w/2,-h/2
    const s = 2 / this.h;
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
