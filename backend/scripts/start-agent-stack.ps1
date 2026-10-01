param(
  [switch]$Build,
  [switch]$InfrastructureOnly,
  [switch]$ProviderKeysOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $PSScriptRoot 'monad-environment.ps1'
. $helper
$envFile = '.env.agents.monad'
$project = 'moeazi-monad'
$compose = @('compose', '-p', $project, '--env-file', $envFile, '-f', 'docker-compose.agents.yml')

if (-not (Test-Path -LiteralPath (Join-Path $root $envFile))) {
  & (Join-Path $PSScriptRoot 'setup-monad-local.ps1')
}

$values = Import-MonadComposeEnvironment $root
foreach ($name in @('WORKER_SHARED_SECRET', 'CONVEX_WORKER_URL', 'CONVEX_INSTANCE_SECRET', 'TIMESCALE_PASSWORD')) {
  if (-not $values[$name]) { throw "Missing local Monad setting: $name. Run scripts/setup-monad-local.ps1." }
}

$services = @()
if ($InfrastructureOnly) { $services = @('timescaledb', 'redis', 'temporal', 'convex', 'convex-dashboard') }

Push-Location $root
try {
  if ($ProviderKeysOnly) {
    $dockerExit = Invoke-MonadCommand -Executable 'docker' -Arguments @($compose + @('up', '-d', '--no-deps', '--force-recreate', '--scale', 'worker=2', 'api', 'worker', 'evaluation-worker'))
    if ($dockerExit -ne 0) { throw 'Provider worker reload failed.' }
  } else {
    $arguments = @('up', '-d')
    if ($Build -or -not $InfrastructureOnly) { $arguments += '--build' }
    if ($services.Count -gt 0) { $arguments += $services }
    $arguments += '--remove-orphans'
    $dockerExit = Invoke-MonadCommand -Executable 'docker' -Arguments @($compose + $arguments)
    if ($dockerExit -ne 0) { throw "Docker Compose failed with exit code $dockerExit." }
  }
  $dockerExit = Invoke-MonadCommand -Executable 'docker' -Arguments @($compose + @('ps'))
  if ($dockerExit -ne 0) { throw 'Could not read the isolated Compose project status.' }
} finally { Pop-Location }
