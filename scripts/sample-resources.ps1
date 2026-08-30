# Samples the whole Electron process tree over a window of seconds and appends one row to a
# markdown table. CPU comes from TotalProcessorTime deltas (plain .NET) rather than performance
# counters, whose names are localized on a Chinese Windows install.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Label,
  [int]$Seconds = 10,
  [string]$PathLike = '*'
)

function Get-ElectronSample {
  param([string]$Like)
  $ps = Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -like $Like } catch { $false } }
  if ($null -eq $ps) { throw 'sample-resources: no electron process matched' }
  $cpu = 0.0
  $ws = 0.0
  $n = 0
  foreach ($p in $ps) { $cpu += $p.TotalProcessorTime.TotalSeconds; $ws += $p.WorkingSet64; $n += 1 }
  return @{ cpu = $cpu; ws = $ws; count = $n }
}

$a = Get-ElectronSample -Like $PathLike
Start-Sleep -Seconds $Seconds
$b = Get-ElectronSample -Like $PathLike

$cores = [Environment]::ProcessorCount
$pct = [Math]::Round((($b.cpu - $a.cpu) / $Seconds / $cores) * 100, 2)
$mb = [Math]::Round(($b.ws / 1MB), 1)

$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
if (-not (Test-Path $Out)) {
  Set-Content -Path $Out -Encoding utf8 -Value @'
# Phase 2 — resource samples (whole Electron process tree)

Bar (addendum section 0): <= 4 % CPU and <= 250 MB at 30 Hz idle; <= 0.5 % CPU while hidden.
CPU is the summed TotalProcessorTime delta / window / logical cores, so 100 % means one full core.

| label | processes | window (s) | CPU % | working set (MB) |
|---|---|---|---|---|
'@
}
Add-Content -Path $Out -Encoding utf8 -Value ("| {0} | {1} | {2} | {3} | {4} |" -f $Label, $b.count, $Seconds, $pct, $mb)
Write-Output ("{0}: cpu={1}% ws={2}MB procs={3}" -f $Label, $pct, $mb, $b.count)
