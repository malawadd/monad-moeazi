param(
  [string]$ApiBaseUrl = 'https://moeazi-monad.kiyan.finance'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$apiUri = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$apiUri) -or $apiUri.Scheme -ne 'https') {
  throw 'Phone builds require an absolute HTTPS API base URL. Pass it with -ApiBaseUrl.'
}
$apiUrl = $ApiBaseUrl.TrimEnd('/')

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
  & '.\gradlew.bat' ':app:assembleRelease' '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a' "-PmoeaziApiBaseUrl=$apiUrl" '--max-workers=1'
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
$nativeCode = ($badging | Where-Object { $_ -match '^native-code:' }) -join ' '
if ($LASTEXITCODE -ne 0 -or $nativeCode -notmatch "'arm64-v8a'" -or $nativeCode -notmatch "'armeabi-v7a'") {
  throw "Built APK must contain both arm64-v8a and armeabi-v7a native libraries. Found: $nativeCode"
}
$packageLine = ($badging | Where-Object { $_ -match '^package:' } | Select-Object -First 1) -join ' '
$versionMatch = [regex]::Match($packageLine, "versionName='(?<version>[A-Za-z0-9][A-Za-z0-9._-]*)'")
if (-not $versionMatch.Success) { throw 'Could not read a safe versionName from the built APK.' }
$versionName = $versionMatch.Groups['version'].Value
$versionedApk = Join-Path (Split-Path -Parent $apk) "moeazi-monad-v$versionName-arm.apk"
$resourceValues = & $aapt dump --values resources $apk
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect packaged Android resources.' }
$assetStatementsLine = $resourceValues | Where-Object { $_ -match '^\s+\(string8\) ".*assetlinks\.json.*"$' } | Select-Object -First 1
$assetStatementsMatch = [regex]::Match($assetStatementsLine, '^\s+\(string8\) "(?<value>.*)"$')
if (-not $assetStatementsMatch.Success) { throw 'The APK is missing a readable asset_statements string resource.' }
$assetStatementsJson = $assetStatementsMatch.Groups['value'].Value.Replace('\"', '"')
try {
  $assetStatements = ConvertFrom-Json -InputObject $assetStatementsJson -ErrorAction Stop
} catch {
  throw "The packaged asset_statements resource is not valid JSON: $assetStatementsJson"
}
$expectedAssetLinksUrl = 'https://moeazi-monad.kiyan.finance/.well-known/assetlinks.json'
if (-not (@($assetStatements) | Where-Object { $_.include -eq $expectedAssetLinksUrl })) {
  throw "The packaged asset_statements resource must include $expectedAssetLinksUrl."
}
function Get-ApkSha256([string]$path) {
  $stream = [System.IO.File]::OpenRead($path)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '')
  } finally {
    $hasher.Dispose()
    $stream.Dispose()
  }
}
$apkHash = Get-ApkSha256 $apk
if (Test-Path -LiteralPath $versionedApk) {
  $existingVersionedHash = Get-ApkSha256 $versionedApk
  if ($existingVersionedHash -ne $apkHash) {
    throw "Refusing to overwrite $versionedApk with different bytes. Bump versionName before rebuilding."
  }
} else {
  Copy-Item -LiteralPath $apk -Destination $versionedApk
}
Write-Host "Phone-compatible internal APK: $apk"
Write-Host "Versioned phone APK: $versionedApk"
Write-Host "APK SHA-256: $apkHash"
Write-Host "API base URL: $apiUrl"
Write-Host "Verified asset_statements JSON: $assetStatementsJson"
Write-Host "This internal build uses this checkout's private local debug key. It is not a Play Store release."
