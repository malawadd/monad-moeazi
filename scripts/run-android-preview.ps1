param([switch]$Rebuild)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot' }
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'C:\AndroidSdk' }
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
$emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
$apk = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'

if (-not (Test-Path -LiteralPath $javaHome)) {
  throw "JDK 17 was not found at $javaHome. Reinstall Microsoft OpenJDK 17."
}
if (-not (Test-Path -LiteralPath $adb) -or -not (Test-Path -LiteralPath $emulator)) {
  throw "Android SDK was not found at $sdkRoot."
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:Path = "$sdkRoot\platform-tools;$sdkRoot\emulator;$javaHome\bin;$env:Path"

Write-Host 'Preparing Android emulator...'
# Use the current SDK consistently; do not disrupt an already-connected device.
& $adb start-server | Out-Null

$connected = (& $adb devices) -match '\sdevice$'
if (-not $connected) {
  Start-Process -FilePath $emulator -ArgumentList @(
    '-avd', 'Moeazi_API_36',
    '-gpu', 'host',
    '-memory', '4096',
    '-netdelay', 'none',
    '-netspeed', 'full'
  ) | Out-Null
}

$bootDeadline = (Get-Date).AddMinutes(3)
do {
  $connected = (& $adb devices) -match '\sdevice$'
  if ($connected) {
    $booted = (& $adb shell getprop sys.boot_completed 2>$null).Trim()
    if ($booted -eq '1') { break }
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $bootDeadline)

if ($booted -ne '1') {
  throw 'The Moeazi emulator did not finish booting within three minutes.'
}

$metroReady = Get-NetTCPConnection -LocalPort 8082 -State Listen -ErrorAction SilentlyContinue
if (-not $metroReady) {
  Write-Host 'Starting the React Native development server...'
  $npm = (Get-Command npm.cmd).Source
  $localDataDir = Join-Path $repoRoot '.data'
  New-Item -ItemType Directory -Path $localDataDir -Force | Out-Null
  Start-Process -FilePath $npm -ArgumentList @('start') `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput (Join-Path $localDataDir 'metro.out.log') `
    -RedirectStandardError (Join-Path $localDataDir 'metro.err.log') `
    -WindowStyle Hidden | Out-Null

  $metroDeadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Seconds 1
    $metroReady = Get-NetTCPConnection -LocalPort 8082 -State Listen -ErrorAction SilentlyContinue
  } while (-not $metroReady -and (Get-Date) -lt $metroDeadline)
}

if (-not $metroReady) {
  throw 'The React Native development server did not start on port 8082.'
}

$buildNeeded = $Rebuild -or -not (Test-Path -LiteralPath $apk)
if ($buildNeeded) {
  & (Join-Path $PSScriptRoot 'ensure-android-debug-keystore.ps1')
  Write-Host 'Building Moeazi for the emulator...'
  Push-Location (Join-Path $repoRoot 'android')
  try {
    & '.\gradlew.bat' assembleDebug '-PreactNativeArchitectures=x86_64'
    if ($LASTEXITCODE -ne 0) { throw 'The Android build failed.' }
  } finally {
    Pop-Location
  }
}

Write-Host 'Opening Moeazi...'
& $adb reverse tcp:8082 tcp:8082 | Out-Null
$installed = (& $adb shell pm path com.moeazi.monad.mobile) -match '^package:'
if ($buildNeeded -or -not $installed) {
  & $adb install -r $apk
  if ($LASTEXITCODE -ne 0) { throw 'The APK could not be installed.' }
}
& $adb shell am start -n 'com.moeazi.monad.mobile/com.moeazi.mobile.MainActivity' | Out-Null

Write-Host 'Moeazi is running. Close the emulator window when you are finished.'
