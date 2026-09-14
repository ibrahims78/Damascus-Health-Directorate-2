# build-android-apk.ps1 â€” build the offline Android APKs (normal + protected)
# Requires: Android Studio (or JDK 21 + Android SDK) on the machine.
# Run from the project root on a machine WITH the Android toolchain:
#   powershell -ExecutionPolicy Bypass -File release-artifacts/v4.0.1/android/build-android-apk.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Protected APK (license-gated web bundle + android platform key)
$env:DAMASCUS_RELEASE_VERSION = 'v4.0.1'
node scripts/build-protected-web.mjs android
$env:CAPACITOR_WEB_DIR = 'artifacts/web/dist/protected-android/public'
npx.cmd cap sync android
$env:RELEASE_KEYSTORE_PATH = Join-Path $root 'release-artifacts\v4.0.1\release-secrets\android\android-release.keystore'
# STEP (one time): generate the keystore on the build machine with keytool:
#   keytool -genkeypair -v -keystore release-artifacts/v4.0.1/release-secrets/android/android-release.keystore -alias dme -keyalg RSA -keysize 2048 -validity 10000
$env:RELEASE_KEYSTORE_PASSWORD = <read from your secret store>
$env:RELEASE_KEY_ALIAS = 'dme'
Push-Location (Join-Path $root 'android')
./gradlew assembleRelease --no-daemon
Pop-Location
Write-Output 'APK: android/app/build/outputs/apk/release/app-release.apk'

# Normal offline APK (no license gate): rebuild the plain offline web first
$env:VITE_OFFLINE_MODE = '1'; $env:VITE_PROTECTED_BUILD = '0'; $env:VITE_OUTPUT_DIR = 'dist/android-offline/public'
pnpm --filter @workspace/web exec vite build --config vite.config.ts
$env:CAPACITOR_WEB_DIR = 'artifacts/web/dist/android-offline/public'
npx.cmd cap sync android
Push-Location (Join-Path $root 'android')
./gradlew assembleRelease --no-daemon
Pop-Location
Write-Output 'normal offline APK rebuilt as well'
