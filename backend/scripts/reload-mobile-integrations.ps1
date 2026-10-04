param([switch]$Build)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'monad-environment.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.env.agents.monad'))) {
  & (Join-Path $PSScriptRoot 'setup-monad-local.ps1')
}

# Parse into process variables, not command strings or diagnostic output. This
# preserves literal credential characters instead of expanding dotenv '$' text.
$envValues = Import-MonadComposeEnvironment $taskRoot
foreach ($taskName in @('WORKER_SHARED_SECRET', 'CONVEX_SITE_URL', 'ARBITRUM_RPC_URL')) {
  if (-not [Environment]::GetEnvironmentVariable($taskName, 'Process')) {
    throw "Missing configuration: $taskName"
  }
}
$taskArguments = @('compose', '-p', 'moeazi-monad', '--env-file', '.env.agents.monad', '-f', 'docker-compose.agents.yml', 'up', '-d', '--no-deps')
if ($Build) { $taskArguments += '--build' }
$taskArguments += 'execution-sidecar'
Push-Location $taskRoot
try {
  $dockerExit = Invoke-MonadCommand -Executable 'docker' -Arguments $taskArguments
  if ($dockerExit -ne 0) { throw 'Mobile integration service could not be reloaded.' }
} finally { Pop-Location }
Write-Host 'Reloaded execution-sidecar only. No AI workers or provider probes were started.'
