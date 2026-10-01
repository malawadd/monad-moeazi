$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $root '.data/operator-console-lite.json'
$serverPath = Join-Path $root 'operator-console-lite/server.mjs'

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host 'No script-managed lightweight console is recorded.'
  exit 0
}
$record = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
$process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
if (-not $process) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host 'The recorded console process is no longer running.'
  exit 0
}
$details = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$record.pid)"
$matchesPath = $details -and $details.CommandLine -like "*$serverPath*"
$recordStart = ([datetime]$record.startedAt).ToUniversalTime()
$actualStart = $process.StartTime.ToUniversalTime()
$matchesStart = [Math]::Abs(($recordStart - $actualStart).TotalMilliseconds) -lt 1000
if (-not $matchesPath -or -not $matchesStart -or [string]$record.serverPath -ne $serverPath) {
  throw 'The recorded PID no longer identifies this console; no process was stopped.'
}
Stop-Process -Id $process.Id
Remove-Item -LiteralPath $pidPath -Force
Write-Host 'Stopped the lightweight console. Moeazi and its backend remain running.'
