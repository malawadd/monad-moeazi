$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'start-agent-stack.ps1') -ProviderKeysOnly
if ($LASTEXITCODE -ne 0) { throw 'Provider worker reload failed.' }
