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
[DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int w, int h, IntPtr hdcSrc, int xSrc, int ySrc, int rop);
'@
[void][Ds.Gdi]::SetProcessDPIAware()

$b = Get-Content -Raw -Path $BoundsFile | ConvertFrom-Json
$pad = if ($null -eq $b.pad) { 24 } else { [int]$b.pad }
$sf = [double]$b.scaleFactor
$x = [int][Math]::Round(($b.x - $pad) * $sf)
$y = [int][Math]::Round(($b.y - $pad) * $sf)
$w = [int][Math]::Round(($b.width + 2 * $pad) * $sf)
$h = [int][Math]::Round(($b.height + 2 * $pad) * $sf)
if ($x -lt 0) { $x = 0 }
if ($y -lt 0) { $y = 0 }
if ($w -lt 1 -or $h -lt 1) { throw "capture-region: empty rect ($w x $h)" }

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
  if (-not [Ds.Gdi]::BitBlt($dest, 0, 0, $w, $h, $src, $x, $y, $rop)) { throw 'capture-region: BitBlt failed' }
} finally {
  [void][Ds.Gdi]::ReleaseDC($desktop, $src)
  $g.ReleaseHdc($dest)
}
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "captured ${w}x${h} at ${x},${y} -> $Out"
