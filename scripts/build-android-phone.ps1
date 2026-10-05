$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$propertiesPath = Join-Path $repoRoot 'android/local.properties'
$properties = @{}
if (Test-Path -LiteralPath $propertiesPath) {
  foreach ($line in Get-Content -LiteralPath $propertiesPath) {
    if ($line -match '^([^#!\s][^=]*)=(.*)$') {
      $properties[$Matches[1].Trim()] = $Matches[2].Trim()
    }
  }
}

# Gradle prefers local.properties over environment variables. Match that order here.
$apiUrl = if ($properties['moeazi.apiBaseUrl']) { $properties['moeazi.apiBaseUrl'] } else { $env:MOEAZI_API_BASE_URL }
if (-not $apiUrl -or $apiUrl -notmatch '^https://[^/]+') {
  throw 'Phone builds require a phone-reachable HTTPS moeazi.apiBaseUrl in android/local.properties or MOEAZI_API_BASE_URL.'
}

$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot' }
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'C:\AndroidSdk' }
if (-not (Test-Path -LiteralPath $javaHome) -or -not (Test-Path -LiteralPath $sdkRoot)) {
  throw 'JDK 17 and the Android SDK are required. Configure JAVA_HOME and ANDROID_HOME.'
}
$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:Path = "$javaHome\bin;$sdkRoot\platform-tools;$env:Path"

& (Join-Path $PSScriptRoot 'ensure-android-debug-keystore.ps1')

$shortDrive = @('R', 'Z', 'Y', 'X') | Where-Object { -not (Test-Path "${_}:\") } | Select-Object -First 1
if (-not $shortDrive) { throw 'No free temporary drive letter is available for the Android native build.' }
& subst "${shortDrive}:" $repoRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not create a short path for the Android native build.' }
$env:MOEAZI_NATIVE_STAGING_DIR = "${shortDrive}:\android\app\.cxx"
Push-Location (Join-Path $repoRoot 'android')
try {
  # Gradle/Metro stay on the real path; only CMake's staging path is shortened.
  # Do not inherit the x86_64-only override used by the emulator launcher.
  & '.\gradlew.bat' assembleRelease '-PreactNativeArchitectures=arm64-v8a' '--max-workers=1'
  if ($LASTEXITCODE -ne 0) { throw 'The phone APK build failed.' }
} finally {
  Pop-Location
  & subst "${shortDrive}:" /D | Out-Null
}

$apk = Join-Path $repoRoot 'android/app/build/outputs/apk/release/app-release.apk'
$aapt = Join-Path $sdkRoot 'build-tools/36.0.0/aapt.exe'
if (-not (Test-Path -LiteralPath $apk) -or -not (Test-Path -LiteralPath $aapt)) {
  throw 'Release APK or Android aapt was not found after the build.'
}
$badging = & $aapt dump badging $apk
if ($LASTEXITCODE -ne 0 -or -not ($badging -match "native-code:.*'arm64-v8a'")) {
  throw 'Built APK does not contain arm64-v8a native libraries.'
}
Write-Host "Phone-compatible internal APK: $apk"
Write-Host 'This internal build uses this checkout’s private local debug key. It is not a Play Store release.'
