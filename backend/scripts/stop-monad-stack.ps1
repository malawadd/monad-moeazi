$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = 'moeazi-monad'
$envFile = '.env.agents.monad'
$statePath = Join-Path $root '.data/monad-stack.json'
. (Join-Path $PSScriptRoot 'monad-environment.ps1')

function Stop-RecordedApi($Record) {
  if (-not $Record -or -not $Record.pid -or -not $Record.startedAt) { return }
  $process = Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
  if (-not $process) { return }
  $details = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Record.pid)" -ErrorAction SilentlyContinue
  $apiEntry = Join-Path $root 'api-server/src/server.ts'
  $legacyNext = Join-Path $root 'node_modules/next/dist/bin/next'
  $started = $details.CreationDate.ToUniversalTime().ToString('o')
  $isLegacyNext = $details.CommandLine -like "*$legacyNext*"
  $entryMatches = if ($Record.command -like '*api-server/src/server.ts*') {
    $details -and $details.CommandLine -like "*$apiEntry*"
  } else {
    $details -and $isLegacyNext -and $details.CommandLine -eq [string]$Record.command
  }
  if (-not $details -or $details.Name -ne 'node.exe' -or
      -not $entryMatches -or (-not $isLegacyNext -and $started -ne [string]$Record.startedAt)) {
    throw 'The recorded API PID no longer identifies this Monad copy; no process was stopped.'
  }
  if ($isLegacyNext) {
    $listener = Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and [int]$listener.OwningProcess -ne [int]$Record.pid) {
      $child = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$listener.OwningProcess)" -ErrorAction SilentlyContinue
      if (-not $child -or $child.Name -ne 'node.exe' -or [int]$child.ParentProcessId -ne [int]$Record.pid -or
          $child.CommandLine -notlike "*$root*" -or $child.CommandLine -notmatch 'next|start-server') {
        throw 'The port 3102 listener is outside the recorded Next process tree; no process was stopped.'
      }
      Stop-Process -Id ([int]$child.ProcessId) -Force
    }
  }
  Stop-Process -Id $process.Id
}

if (Test-Path -LiteralPath $statePath) {
  $record = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($record.api) { Stop-RecordedApi $record.api }
  if ($record.frontend) { Stop-RecordedApi $record.frontend }
  Remove-Item -LiteralPath $statePath -Force
}
$consoleStop = Join-Path $PSScriptRoot 'stop-operator-console-lite.ps1'
& $consoleStop

$agentsEnvPath = Join-Path $root $envFile
if (Test-Path -LiteralPath $agentsEnvPath) {
  Push-Location $root
  try {
    $null = Import-MonadComposeEnvironment $root
    $dockerExit = Invoke-MonadCommand -Executable 'docker' -Arguments @('compose', '-p', $project, '--env-file', $envFile, '-f', 'docker-compose.agents.yml', 'down', '--remove-orphans')
    if ($dockerExit -ne 0) { throw "Isolated Docker project $project could not be stopped." }
  } finally { Pop-Location }
} else {
  Write-Host 'Monad Compose environment is absent; no Docker project was addressed.'
}
Write-Host 'Moeazi Monad services stopped. Local Convex, Timescale, and Redis volumes were preserved.'
