param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$consoleRoot = Join-Path $root 'operator-console-lite'
$serverPath = Join-Path $consoleRoot 'server.mjs'
$dataDir = Join-Path $root '.data'
$pidPath = Join-Path $dataDir 'operator-console-lite.json'
$appUrl = 'http://127.0.0.1:3102'
$consoleUrl = 'http://127.0.0.1:3104'

if (-not (Test-Path -LiteralPath $serverPath)) { throw 'The lightweight console is missing.' }
if (-not (Get-NetTCPConnection -LocalPort 3102 -State Listen -ErrorAction SilentlyContinue)) {
  throw 'Start the Moeazi Hono API on port 3102 first (npm run stack:start), then rerun this script.'
}

function Test-Console {
  try {
      $response = Invoke-WebRequest -Uri $consoleUrl -UseBasicParsing -TimeoutSec 3
      return $response.StatusCode -eq 200 -and
        $response.Content -match '<title>Moeazi.*</title>'
  } catch { return $false }
}

  $listener = Get-NetTCPConnection -LocalPort 3104 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  if (-not (Test-Console)) { throw 'Port 3104 is occupied by a different service.' }
  Write-Host "Moeazi lightweight console is already running at $consoleUrl."
} else {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  $localEnvPath = Join-Path $root '.env.local'
  if (-not (Test-Path -LiteralPath $localEnvPath)) { throw 'The local operator bridge configuration is missing.' }
  $bridgeLine = Get-Content -LiteralPath $localEnvPath | Where-Object { $_ -match '^OPERATOR_CONSOLE_BRIDGE_SECRET=(.*)$' } | Select-Object -First 1
  $bridgeMatch = [Regex]::Match([string]$bridgeLine, '^OPERATOR_CONSOLE_BRIDGE_SECRET=(.{40,})$')
  if (-not $bridgeMatch.Success) {
    throw 'The local operator bridge configuration is invalid.'
  }
  $bridgeSecret = $bridgeMatch.Groups[1].Value.Trim('"').Trim("'")
  $previousOrigin = $env:MOEAZI_APP_ORIGIN
  $previousPort = $env:MOEAZI_CONSOLE_PORT
  $previousBridge = $env:OPERATOR_CONSOLE_BRIDGE_SECRET
  try {
    $env:MOEAZI_APP_ORIGIN = $appUrl
    $env:MOEAZI_CONSOLE_PORT = '3104'
    $env:OPERATOR_CONSOLE_BRIDGE_SECRET = $bridgeSecret
    $process = Start-Process -FilePath $node -ArgumentList ('"' + $serverPath + '"') `
      -WorkingDirectory $consoleRoot -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $dataDir 'operator-console-lite.out.log') `
      -RedirectStandardError (Join-Path $dataDir 'operator-console-lite.err.log')
  } finally {
    if ($null -eq $previousOrigin) { Remove-Item Env:MOEAZI_APP_ORIGIN -ErrorAction SilentlyContinue }
    else { $env:MOEAZI_APP_ORIGIN = $previousOrigin }
      if ($null -eq $previousPort) { Remove-Item Env:MOEAZI_CONSOLE_PORT -ErrorAction SilentlyContinue }
      else { $env:MOEAZI_CONSOLE_PORT = $previousPort }
      if ($null -eq $previousBridge) { Remove-Item Env:OPERATOR_CONSOLE_BRIDGE_SECRET -ErrorAction SilentlyContinue }
      else { $env:OPERATOR_CONSOLE_BRIDGE_SECRET = $previousBridge }
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-Console) { $ready = $true; break }
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    $tail = Get-Content -LiteralPath (Join-Path $dataDir 'operator-console-lite.err.log') `
      -Tail 12 -ErrorAction SilentlyContinue
    throw "The lightweight console did not start on port 3104.`n$($tail -join "`n")"
  }
  @{ pid = $process.Id; serverPath = $serverPath; startedAt = $process.StartTime.ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $pidPath
  Write-Host "Moeazi lightweight console started at $consoleUrl."
}

if (-not $NoBrowser) { Start-Process $consoleUrl }
Write-Host "Sign in to Moeazi at $appUrl using the same 127.0.0.1 hostname if prompted."
