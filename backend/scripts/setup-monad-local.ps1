param([switch]$RotateSecrets)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'setup-monad-local.mjs'
Push-Location $root
try {
  $arguments = @()
  if ($RotateSecrets) { $arguments += '--rotate-secrets' }
  & $node $script @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Monad local configuration could not be created.' }
} finally { Pop-Location }
