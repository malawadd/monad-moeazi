param([switch]$BuildAgents)

$ErrorActionPreference = 'Stop'
$arguments = @{}
if ($BuildAgents) { $arguments.Build = $true }
& (Join-Path $PSScriptRoot 'start-monad-stack.ps1') @arguments
