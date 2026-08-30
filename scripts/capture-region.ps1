# DPI-aware composited screen capture of one rectangle, used for Phase 2 desktop evidence.
# The rectangle arrives as DIP bounds + scaleFactor from Electron (BrowserWindow.getBounds() and
# screen.getDisplayMatching().scaleFactor), because Electron speaks DIP and GDI speaks pixels.
#
# DEVIATION from the Task 10 brief's literal, on the controller's instruction (Task 7 finding):
# on this machine System.Drawing's Graphics.CopyFromScreen returns bare wallpaper wherever a
# layered (transparent, always-on-top) window sits - which is every window this task photographs.
# The capture is therefore a raw GDI BitBlt with SRCCOPY | CAPTUREBLT (0x00CC0020 | 0x40000000);
# CAPTUREBLT is the flag that makes layered windows composite into the destination DC.
# SetProcessDPIAware() still runs first: the display is 150 %, and without it every rectangle
# lands 1.5x off.
param(
  [Parameter(Mandatory = $true)][string]$BoundsFile,
  [Parameter(Mandatory = $true)][string]$Out
)

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Ds -Name Gdi -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
[DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
[DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int w, int h, IntPtr hdcSrc, int xSrc, int ySrc, int rop);
'@
[void][Ds.Gdi]::SetProcessDPIAware()

# The desktop window DC spans the whole VIRTUAL screen, whose origin is the primary monitor's
# top-left - so a monitor placed left of or above the primary has NEGATIVE screen coordinates, and
# the source offsets BitBlt takes are measured from SM_XVIRTUALSCREEN / SM_YVIRTUALSCREEN.
# Clamping a negative x/y to 0 (what this script used to do) silently captured the wrong screen
# area on exactly that layout - the mixed-DPI case bubble-place.test.ts H models - and produced a
# plausible-looking PNG of the wrong thing. Out-of-range now throws instead.
$VX = [Ds.Gdi]::GetSystemMetrics(76)   # SM_XVIRTUALSCREEN
$VY = [Ds.Gdi]::GetSystemMetrics(77)   # SM_YVIRTUALSCREEN
$VW = [Ds.Gdi]::GetSystemMetrics(78)   # SM_CXVIRTUALSCREEN
$VH = [Ds.Gdi]::GetSystemMetrics(79)   # SM_CYVIRTUALSCREEN

$b = Get-Content -Raw -Path $BoundsFile | ConvertFrom-Json
$pad = if ($null -eq $b.pad) { 24 } else { [int]$b.pad }
$sf = [double]$b.scaleFactor
$x = [int][Math]::Round(($b.x - $pad) * $sf)
$y = [int][Math]::Round(($b.y - $pad) * $sf)
$w = [int][Math]::Round(($b.width + 2 * $pad) * $sf)
$h = [int][Math]::Round(($b.height + 2 * $pad) * $sf)
if ($w -lt 1 -or $h -lt 1) { throw "capture-region: empty rect ($w x $h)" }
if ($x -lt $VX -or $y -lt $VY -or ($x + $w) -gt ($VX + $VW) -or ($y + $h) -gt ($VY + $VH)) {
  throw "capture-region: rect ${w}x${h} at ${x},${y} leaves the virtual screen (${VW}x${VH} at ${VX},${VY})"
}
# BitBlt's source offsets are relative to the DC's own origin, i.e. the virtual screen's top-left.
$sx = $x - $VX
$sy = $y - $VY

$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

# SRCCOPY (0x00CC0020) | CAPTUREBLT (0x40000000). CAPTUREBLT is what includes layered windows.
$rop = 0x40CC0020
$bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dest = $g.GetHdc()
$desktop = [Ds.Gdi]::GetDesktopWindow()
$src = [Ds.Gdi]::GetWindowDC($desktop)
try {
  if (-not [Ds.Gdi]::BitBlt($dest, 0, 0, $w, $h, $src, $sx, $sy, $rop)) { throw 'capture-region: BitBlt failed' }
} finally {
  [void][Ds.Gdi]::ReleaseDC($desktop, $src)
  $g.ReleaseHdc($dest)
}
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "captured ${w}x${h} at ${x},${y} (dc offset ${sx},${sy}) -> $Out"
