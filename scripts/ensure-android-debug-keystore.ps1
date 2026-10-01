$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot' }
$keytool = Join-Path $javaHome 'bin/keytool.exe'
$keystorePath = Join-Path $repoRoot 'android/app/debug.keystore'

if (Test-Path -LiteralPath $keystorePath) { exit 0 }
if (-not (Test-Path -LiteralPath $keytool)) {
  throw "keytool was not found at $keytool. Install JDK 17 or configure JAVA_HOME."
}

& $keytool -genkeypair -keystore $keystorePath -storepass android `
  -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 `
  -validity 10000 `
  -dname 'CN=Moeazi Monad Local Debug, OU=Development, O=Moeazi Monad, L=Local, ST=Local, C=US' `
  -noprompt | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the local Android debug signing key.' }

Write-Host 'Generated a private Android debug signing key for this checkout.'
