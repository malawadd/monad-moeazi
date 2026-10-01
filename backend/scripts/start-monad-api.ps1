$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root '.data'
$statePath = Join-Path $dataDir 'monad-stack.json'
$apiEntry = Join-Path $root 'api-server/src/server.ts'
$apiUrl = 'http://127.0.0.1:3102/health'

if (-not (Test-Path -LiteralPath $statePath)) { throw 'The Monad lifecycle record is missing; use npm run stack:start first.' }
if (-not (Test-Path -LiteralPath $apiEntry)) { throw 'The Hono API entrypoint is missing.' }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.api -and $state.api.pid) { throw 'The lifecycle record already has a managed API process.' }
if (Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 3102 is occupied; no process was started.'
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$node = (Get-Command node.exe -ErrorAction Stop).Source
$newProcess = Start-Process -FilePath $node -ArgumentList @('--import', 'tsx', $apiEntry) `
  -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $dataDir 'api.out.log') `
  -RedirectStandardError (Join-Path $dataDir 'api.err.log')
$ready = $false
$deadline = (Get-Date).AddSeconds(90)
do {
  try {
    $response = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  if (-not (Get-Process -Id $newProcess.Id -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if (-not $ready) {
  $tail = Get-Content -LiteralPath (Join-Path $dataDir 'api.err.log') -Tail 20 -ErrorAction SilentlyContinue
  throw "Hono did not become healthy after startup.`n$($tail -join "`n")"
}

$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($newProcess.Id)"
$state.api = @{
  pid = $newProcess.Id
  command = 'node --import tsx api-server/src/server.ts'
  startedAt = $processInfo.CreationDate.ToUniversalTime().ToString('o')
}
$temporaryPath = "$statePath.tmp"
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryPath
Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
Write-Host 'Hono started on port 3102; Convex and Compose services were not changed.'
