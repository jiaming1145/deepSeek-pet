$ErrorActionPreference = "Stop"
$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..\codex-prompts")).Path
$CodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$TargetDir = Join-Path $CodexRoot "prompts"
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Force (Join-Path $SourceDir "*.md") $TargetDir
Write-Output "Installed deprecated compatibility prompts to $TargetDir. Restart Codex or open a new session."
