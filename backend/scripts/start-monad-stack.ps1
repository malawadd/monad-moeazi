param([switch]$Build)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'monad-environment.ps1')
$project = 'moeazi-monad'
$envFile = '.env.agents.monad'
$localEnvPath = Join-Path $root '.env.local'
$convexEnvPath = Join-Path $root '.env.convex.monad'
$agentsEnvPath = Join-Path $root $envFile
$dataDir = Join-Path $root '.data'
$statePath = Join-Path $dataDir 'monad-stack.json'
$compose = @('compose', '-p', $project, '--env-file', $envFile, '-f', 'docker-compose.agents.yml')

function Read-Env([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -ErrorAction Stop) {
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $value = $Matches[2]
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2).Replace('\n', "`n").Replace('\"', '"')
    } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$Matches[1]] = $value
  }
  return $values
}

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $text = [IO.File]::ReadAllText($Path)
  $line = "$Name=$Value"
  $pattern = "(?m)^$([Regex]::Escape($Name))=.*$"
  if ([Regex]::IsMatch($text, $pattern)) { $text = [Regex]::Replace($text, $pattern, $line) }
  else { $text = $text.TrimEnd("`r", "`n") + "`n$line`n" }
  [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
}

function Test-Http([string]$Url) {
  try { $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4; return $true }
  catch {
    $status = $_.Exception.Response.StatusCode.value__
    return $status -in @(401, 403)
  }
}

function Wait-Http([string]$Url, [int]$Seconds, [string]$Name) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (Test-Http $Url) { return }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "$Name did not become healthy at $Url within $Seconds seconds. Inspect docker compose -p $project logs or .data logs."
}

function Start-MobileApi {
  $listener = Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  $escapedRoot = [Regex]::Escape($root)
  if ($listener) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$listener.OwningProcess)"
    $state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
    $isHono = $process.Name -eq 'node.exe' -and $process.CommandLine -match $escapedRoot -and
      $process.CommandLine -match 'api-server[\\/]src[\\/]server\.ts'
    if ($isHono) {
      if ($state.api -and [int]$state.api.pid -eq [int]$listener.OwningProcess) {
        return [int]$listener.OwningProcess
      }
      Stop-Process -Id ([int]$listener.OwningProcess) -Force
      $deadline = (Get-Date).AddSeconds(20)
      do {
        Start-Sleep -Milliseconds 250
        $listener = Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      } while ($listener -and (Get-Date) -lt $deadline)
      if ($listener) { throw 'The verified target Hono process did not release port 3102 for its configuration reload.' }
    }
    elseif ($state.frontend -and [int]$state.frontend.pid -gt 0) {
      $legacy = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$state.frontend.pid)" -ErrorAction SilentlyContinue
      $legacyNext = Join-Path $root 'node_modules/next/dist/bin/next'
      $isRecordedNext = $legacy -and $legacy.Name -eq 'node.exe' -and
        $legacy.CommandLine -eq [string]$state.frontend.command -and
        $legacy.CommandLine -like "*$legacyNext*" -and $legacy.CommandLine -match $escapedRoot
      $listenerIsRecordedTree = [int]$listener.OwningProcess -eq [int]$legacy.ProcessId -or
        ($process -and $process.Name -eq 'node.exe' -and [int]$process.ParentProcessId -eq [int]$legacy.ProcessId -and
          $process.CommandLine -match $escapedRoot -and $process.CommandLine -match 'next|start-server')
      if ($isRecordedNext -and $listenerIsRecordedTree) {
        Stop-Process -Id ([int]$listener.OwningProcess) -Force -ErrorAction SilentlyContinue
        if ([int]$listener.OwningProcess -ne [int]$legacy.ProcessId) {
          Stop-Process -Id ([int]$legacy.ProcessId) -Force -ErrorAction SilentlyContinue
        }
        $deadline = (Get-Date).AddSeconds(20)
        do {
          Start-Sleep -Milliseconds 250
          $listener = Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        } while ($listener -and (Get-Date) -lt $deadline)
        if ($listener) { throw 'The recorded Next process tree did not release port 3102.' }
      } else {
        throw "Port 3102 is occupied by process $($listener.OwningProcess), outside the recorded Next process tree. No process was stopped."
      }
    } else {
      throw "Port 3102 is occupied by process $($listener.OwningProcess), outside this copy. No process was stopped."
    }
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $apiEntry = Join-Path $root 'api-server/src/server.ts'
  if (-not (Test-Path -LiteralPath $apiEntry)) { throw 'The Hono API entrypoint is missing.' }
  $process = Start-Process -FilePath $node -ArgumentList @('--import', 'tsx', $apiEntry) `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $dataDir 'api.out.log') `
    -RedirectStandardError (Join-Path $dataDir 'api.err.log')
  $deadline = (Get-Date).AddSeconds(90)
  do {
    if (Test-Http 'http://127.0.0.1:3102/health') { return $process.Id }
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
      $tail = Get-Content (Join-Path $dataDir 'api.err.log') -Tail 30 -ErrorAction SilentlyContinue
      throw "The Hono API exited during startup.`n$($tail -join "`n")"
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw 'The Hono API did not open port 3102 within 90 seconds.'
}

$baseEnvMissing = -not (Test-Path -LiteralPath $agentsEnvPath) -or
  -not (Test-Path -LiteralPath $convexEnvPath) -or -not (Test-Path -LiteralPath $localEnvPath)
if ($baseEnvMissing) {
  & (Join-Path $PSScriptRoot 'setup-monad-local.ps1')
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$reconcileScript = Join-Path $PSScriptRoot 'reconcile-monad-operator-config.mjs'
& $node $reconcileScript
if ($LASTEXITCODE -ne 0) { throw 'Monad local operator configuration could not be reconciled.' }
if (-not (Test-Path -LiteralPath $localEnvPath)) { throw 'The isolated local environment was not created.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules/tsx/dist/loader.mjs'))) {
  throw 'Backend npm dependencies are missing. From backend/, run npm ci.'
}
$web = Read-Env $localEnvPath
foreach ($name in @('WORKER_SHARED_SECRET', 'CONVEX_SELF_HOSTED_URL', 'NEXT_PUBLIC_CONVEX_URL')) {
  if (-not $web[$name]) { throw "Missing local web setting $name; rerun scripts/setup-monad-local.ps1." }
}
if (-not $web.NEXT_PUBLIC_MAGIC_API_KEY) {
  Write-Warning 'Magic sign-in is not configured. Set NEXT_PUBLIC_MAGIC_API_KEY in ignored .env.local and rerun setup.'
}
$agentValues = Import-MonadComposeEnvironment $root

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$convexTemp = Join-Path $dataDir 'convex-tmp'
New-Item -ItemType Directory -Path $convexTemp -Force | Out-Null
Push-Location $root
try {
  $dockerInfo = Invoke-MonadCommand -Executable 'docker' -Arguments @('info') -CaptureOutput
  if ($dockerInfo.ExitCode -ne 0) { throw 'Docker Desktop is unavailable. Start Docker Desktop, then retry.' }
  $composeArgs = $compose
  $upArgs = @('up', '-d')
  if ($Build) { $upArgs += '--build' }
  $upArgs += '--remove-orphans'
  $upResult = Invoke-MonadCommand -Executable 'docker' -Arguments @($composeArgs + $upArgs)
  if ($upResult -ne 0) { throw "The isolated Compose project $project failed to start." }

  Wait-Http 'http://127.0.0.1:3310/version' 120 'Local Convex'
  $web = Read-Env $localEnvPath
  foreach ($name in $agentValues.Keys) {
    if (-not $web.ContainsKey($name)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  }
  foreach ($name in $web.Keys) {
    [Environment]::SetEnvironmentVariable($name, [string]$web[$name], 'Process')
  }
  $adminKey = $web.CONVEX_SELF_HOSTED_ADMIN_KEY
  if (-not $adminKey) {
    $adminResult = Invoke-MonadCommand -Executable 'docker' -Arguments @($composeArgs + @('exec', '-T', 'convex', './generate_admin_key.sh')) -CaptureOutput
    if ($adminResult.ExitCode -ne 0) { throw 'Convex could not generate the local self-hosted admin key.' }
    $adminKey = [string]($adminResult.Output | Where-Object { $_ -notmatch '^WARNING: daemon is not using the default seccomp profile$' } | Select-Object -Last 1)
    if (-not $adminKey -or $adminKey.Contains("`n")) { throw 'Convex did not return a valid self-hosted admin key.' }
    Set-EnvValue $localEnvPath 'CONVEX_SELF_HOSTED_ADMIN_KEY' $adminKey
  }
  $env:CONVEX_SELF_HOSTED_URL = [string]$web.CONVEX_SELF_HOSTED_URL
  $env:CONVEX_SELF_HOSTED_ADMIN_KEY = [string]$adminKey
  $env:CONVEX_TMPDIR = $convexTemp
  Remove-Item Env:CONVEX_DEPLOYMENT -ErrorAction SilentlyContinue
  Remove-Item Env:CONVEX_URL -ErrorAction SilentlyContinue

  $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
  $convexValues = Read-Env $convexEnvPath
  foreach ($name in $convexValues.Keys) {
    $envSet = Invoke-MonadCommand -Executable $npx -Arguments @('convex', 'env', 'set', $name, [string]$convexValues[$name]) -CaptureOutput
    if ($envSet.ExitCode -ne 0) { throw "Could not set isolated Convex environment variable $name." }
  }
  $deployResult = Invoke-MonadCommand -Executable $npx -Arguments @('convex', 'dev', '--once')
  if ($deployResult -ne 0) { throw 'Convex deployment failed. Review the CLI output above.' }

  $apiPid = Start-MobileApi

  & (Join-Path $PSScriptRoot 'open-operator-console-lite.ps1') -NoBrowser
  $record = @{
    api = @{ pid = $apiPid; command = 'node --import tsx api-server/src/server.ts'; startedAt = (Get-CimInstance Win32_Process -Filter "ProcessId=$apiPid").CreationDate.ToUniversalTime().ToString('o') }
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    composeProject = $project
  }
  $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath
  Write-Host 'Moeazi Monad local stack is ready:'
  Write-Host '  Hono mobile API: http://127.0.0.1:3102'
  Write-Host '  Operator console: http://127.0.0.1:3104'
  Write-Host '  Convex: http://127.0.0.1:3310 (site actions :3311), dashboard :6891'
  Write-Host '  Agent API: http://127.0.0.1:9100/health; gateway :9200; sidecar :9300'
  Write-Host '  Timescale: 127.0.0.1:15432; Redis: 127.0.0.1:16379; Temporal UI :18233'
} finally {
  Remove-Item Env:CONVEX_SELF_HOSTED_ADMIN_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:CONVEX_TMPDIR -ErrorAction SilentlyContinue
  Pop-Location
}
