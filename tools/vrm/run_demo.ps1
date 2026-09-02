# End-to-end proof of the VRM pipeline on a stock model (Seed-san, VRM Public License 1.0).
# Usage (Windows PowerShell 5.1):  powershell -ExecutionPolicy Bypass -File tools\vrm\run_demo.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
if (-not (Test-Path $blender)) { throw "Blender not found at $blender" }

$samples = Join-Path $here "vendor\samples"
New-Item -ItemType Directory -Force $samples | Out-Null
$seed = Join-Path $samples "Seed-san.vrm"
if (-not (Test-Path $seed)) {
  Write-Host "[demo] downloading Seed-san.vrm (VRM Public License 1.0, VirtualCast)"
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm" -OutFile $seed
}

# Blender prints Python DeprecationWarnings on stderr; run it through Start-Process so PowerShell 5.1
# does not turn that into a NativeCommandError under $ErrorActionPreference = "Stop".
function Run-Blender($label, $script, $scriptArgs) {
  Write-Host "[demo] $label"
  $log = Join-Path $here "out\$label.log"
  $err = Join-Path $here "out\$label.err.log"
  New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
  $quoted = @("--background", "--python", ('"' + (Join-Path $here $script) + '"'), "--") + ($scriptArgs | ForEach-Object { '"' + $_ + '"' })
  $p = Start-Process -FilePath $blender -ArgumentList $quoted -Wait -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError $err
  if ($p.ExitCode -ne 0) { Get-Content $log -Tail 40; Get-Content $err -Tail 20; throw "$label failed (exit $($p.ExitCode), see $log)" }
  Get-Content $log | Select-String -Pattern "^\[(install|verify|stock|build_vrm|render)\]" | Select-Object -Last 12
}

# 1. add-on
Run-Blender "install" "install_vrm_addon.py" @()

# 2. stock input (Mixamo-named GLB + face atlas + chain spec) from the sample VRM
Run-Blender "stock" "make_stock_input.py" @("--vrm", $seed, "--outdir", (Join-Path $here "out\stock"))

# 3. build the VRM
Run-Blender "build_glb" "build_vrm.py" @(
  "--input", (Join-Path $here "out\stock\stock_rigged.glb"),
  "--output", (Join-Path $here "out\build\stock_character.vrm"),
  "--chains", (Join-Path $here "out\stock\chains.json"),
  "--face-material", "^eye$",
  "--face-texture", (Join-Path $here "out\stock\face_atlas.png"),
  "--face-atlas", (Join-Path $here "out\stock\face_atlas.json"),
  "--auto-morphs", "--name", "StockTest", "--author", "pipeline-test")

# 4. re-import + renders (4 angles, head close-ups with expressions, posed chains)
$vrm = Join-Path $here "out\build\stock_character.vrm"
$renders = Join-Path $here "out\renders"
Run-Blender "render_neutral" "render_turnaround.py" @("--vrm", $vrm, "--outdir", $renders, "--prefix", "neutral")
Run-Blender "render_head" "render_turnaround.py" @("--vrm", $vrm, "--outdir", $renders, "--prefix", "head", "--angles", "0", "--focus", "head", "--size", "640x640")
Run-Blender "render_head_happy" "render_turnaround.py" @("--vrm", $vrm, "--outdir", $renders, "--prefix", "head", "--angles", "0", "--focus", "head", "--size", "640x640", "--expression", "happy")
Run-Blender "render_head_blink" "render_turnaround.py" @("--vrm", $vrm, "--outdir", $renders, "--prefix", "head", "--angles", "0", "--focus", "head", "--size", "640x640", "--expression", "blink")
Run-Blender "render_posed" "render_turnaround.py" @("--vrm", $vrm, "--outdir", $renders, "--prefix", "posed", "--pose-tail", "35", "--angles", "90,180")

# 5. manifest
python (Join-Path $here "vrm_manifest.py") $vrm
Write-Host "[demo] done. Renders in $renders"
