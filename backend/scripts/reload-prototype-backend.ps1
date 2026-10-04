param([switch]$Build, [switch]$GatewayOnly, [switch]$ApiOnly)

$ErrorActionPreference = 'Stop'
if ($GatewayOnly -and $ApiOnly) { throw 'Choose one service scope.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'monad-environment.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.env.agents.monad'))) {
  & (Join-Path $PSScriptRoot 'setup-monad-local.ps1')
}

# Use one PowerShell process for env loading and Compose. Never echo secret values.
$envValues = Import-MonadComposeEnvironment $taskRoot
foreach ($taskName in @('WORKER_SHARED_SECRET', 'CONVEX_WORKER_URL', 'MASTER_KEY')) {
  if (-not [Environment]::GetEnvironmentVariable($taskName, 'Process')) {
    throw "Missing configuration: $taskName"
  }
}
$taskArguments = @('compose', '-p', 'moeazi-monad', '--env-file', '.env.agents.monad', '-f', 'docker-compose.agents.yml',
  'up', '-d', '--no-deps')
if ($Build) { $taskArguments += '--build' }
$taskServices = if ($GatewayOnly) { @('execution-gateway') }
  elseif ($ApiOnly) { @('api') } else { @('api', 'worker', 'execution-gateway') }
$taskArguments += $taskServices
Push-Location $taskRoot
try {
  $dockerExit = Invoke-MonadCommand -Executable 'docker' -Arguments $taskArguments
  if ($dockerExit -ne 0) { throw 'Prototype backend reload failed.' }
} finally { Pop-Location }
if ($GatewayOnly) { Write-Host 'Reloaded only execution gateway; other services were preserved.' }
elseif ($ApiOnly) { Write-Host 'Reloaded only agent API; other services were preserved.' }
else { Write-Host 'Reloaded API, agent worker, and execution gateway; other services were preserved.' }
