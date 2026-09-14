# build-android-apk.ps1 — build the Damascus Health Directorate APKs (offline + protected)
# Requires: Node.js/pnpm, JDK 21, Android SDK, and the Capacitor Android toolchain.
#
# The signing material must remain outside Git. Set these variables before running:
#   $env:DAMASCUS_RELEASE_SECRETS_DIR = 'D:\secure\release-secrets'
#   $env:RELEASE_KEYSTORE_PASSWORD = '<from your secret store>'
# Optional:
#   $env:RELEASE_KEY_PASSWORD = '<from your secret store>'
#
# Run from the project root:
#   powershell -ExecutionPolicy Bypass -File release-artifacts/v4.0.3/android/build-android-apk.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$releaseDir = Join-Path $root 'release-artifacts\v4.0.3'
$androidReleaseDir = Join-Path $releaseDir 'android'
$secretsRoot = $env:DAMASCUS_RELEASE_SECRETS_DIR

if ([string]::IsNullOrWhiteSpace($secretsRoot)) {
  throw 'Set DAMASCUS_RELEASE_SECRETS_DIR to the external release-secrets directory.'
}
if ([string]::IsNullOrWhiteSpace($env:RELEASE_KEYSTORE_PASSWORD)) {
  throw 'Set RELEASE_KEYSTORE_PASSWORD through a secret store; never commit it.'
}

$keystorePath = Join-Path $secretsRoot 'android\android-release.keystore'
if (-not (Test-Path $keystorePath)) {
  throw "Android release keystore not found: $keystorePath"
}

$env:DAMASCUS_RELEASE_VERSION = 'v4.0.3'
$env:RELEASE_KEYSTORE_PATH = $keystorePath
$env:RELEASE_KEY_ALIAS = if ([string]::IsNullOrWhiteSpace($env:RELEASE_KEY_ALIAS)) { 'dme' } else { $env:RELEASE_KEY_ALIAS }

function Build-Apk {
  param(
    [Parameter(Mandatory = $true)][string]$Variant,
    [Parameter(Mandatory = $true)][string]$WebDirectory,
    [Parameter(Mandatory = $true)][string]$OutputName
  )

  $env:CAPACITOR_WEB_DIR = $WebDirectory
  pnpm exec cap sync android
  Push-Location (Join-Path $root 'android')
  try {
    .\gradlew assembleRelease --no-daemon
  } finally {
    Pop-Location
  }

  $builtApk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path $builtApk)) {
    throw "Gradle did not produce the $Variant APK."
  }
  Copy-Item $builtApk (Join-Path $androidReleaseDir $OutputName) -Force
  Write-Output "$Variant APK: $(Join-Path $androidReleaseDir $OutputName)"
}

# Protected APK: offline license gate with the Android release public key.
node scripts/build-protected-web.mjs android
Build-Apk `
  -Variant 'protected' `
  -WebDirectory (Join-Path $root 'artifacts\web\dist\protected-android\public') `
  -OutputName 'Damascus-Health-Directorate-v4.0.3-Android-Protected.apk'

# Normal offline APK: the same web app without the license gate.
$env:VITE_OFFLINE_MODE = '1'
$env:VITE_PROTECTED_BUILD = '0'
$env:VITE_OUTPUT_DIR = 'dist/android-offline/public'
pnpm --filter @workspace/web exec vite build --config vite.config.ts
Build-Apk `
  -Variant 'normal offline' `
  -WebDirectory (Join-Path $root 'artifacts\web\dist\android-offline\public') `
  -OutputName 'Damascus-Health-Directorate-v4.0.3-Android-Offline.apk'

Get-ChildItem $androidReleaseDir -Filter '*.apk' |
  Sort-Object Name |
  ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
    "$hash  $($_.Name)"
  } |
  Set-Content -Path (Join-Path $androidReleaseDir 'SHA256SUMS') -Encoding utf8

Write-Output 'SHA256SUMS regenerated'