$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$version = '4.0.1'
$rel = Join-Path $root "release-artifacts\v$version"
$template = Join-Path $rel 'scripts\main-template.cjs'

function Rebuild-ElectronVariant {
  param([string]$Variant, [string]$WebSrc, [string]$ApiSrc)

  Write-Output "=== re-assembling electron variant: $Variant ==="
  $zipPath = Join-Path $rel "windows\Damascus-Emergency-Inventory-v$version-Windows-$Variant.zip"
  if (-not (Test-Path $zipPath)) { throw "zip not found: $zipPath" }

  $work = Join-Path $env:TEMP ("dme-rebuild-" + $Variant)
  if (Test-Path $work) { Remove-Item $work -Recurse -Force }
  New-Item -ItemType Directory -Path $work -Force | Out-Null

  $ex = Join-Path $work 'extract'
  Expand-Archive -Path $zipPath -DestinationPath $ex -Force
  $appDir = Get-ChildItem $ex -Directory | Select-Object -First 1
  if ($null -eq $appDir) { throw "could not find extracted application directory" }

  $stage = Join-Path $work 'asar-stage'
  New-Item -ItemType Directory -Path (Join-Path $stage 'electron') -Force | Out-Null
  Copy-Item $template (Join-Path $stage 'electron\main.cjs') -Force
  $preloadSrc = Join-Path $root 'release-artifacts\v3\electron\preload.cjs'
  if (Test-Path $preloadSrc) { Copy-Item $preloadSrc (Join-Path $stage 'electron\preload.cjs') -Force }
  $pkgJson = '{"name":"damascus-emergency-inventory-desktop","productName":"Damascus Emergency Inventory","version":"4.0.1","main":"electron/main.cjs"}'
  [System.IO.File]::WriteAllText((Join-Path $stage 'package.json'), $pkgJson, $utf8)

  New-Item -ItemType Directory -Path (Join-Path $stage 'app') -Force | Out-Null
  Copy-Item $WebSrc (Join-Path $stage 'app\web') -Recurse -Force
  New-Item -ItemType Directory -Path (Join-Path $stage 'app\api') -Force | Out-Null
  Copy-Item (Join-Path $ApiSrc '*') (Join-Path $stage 'app\api') -Recurse -Force
  New-Item -ItemType Directory -Path (Join-Path $stage 'app\schema') -Force | Out-Null
  Copy-Item (Join-Path $root 'lib\db\desktop-schema.sql') (Join-Path $stage 'app\schema\desktop-schema.sql') -Force
  $keySrc = Join-Path $root 'release-artifacts\v4.0.1\license-public-keys\windows.b64'
  if (Test-Path $keySrc) {
    Copy-Item $keySrc (Join-Path $stage 'app\license-public-key.b64') -Force
  }

  $newAsar = Join-Path $work 'app.asar'
  Push-Location (Join-Path $root 'artifacts\web')
  try {
    $packCmd = 'pnpm dlx @electron/asar pack "' + $stage + '" "' + $newAsar + '" >nul 2>&1'
    cmd /c $packCmd
  } finally {
    Pop-Location
  }
  if (-not (Test-Path $newAsar)) { throw "asar pack failed for $Variant" }

  $resources = Join-Path $appDir.FullName 'resources'
  New-Item -ItemType Directory -Path $resources -Force | Out-Null
  Copy-Item $newAsar (Join-Path $resources 'app.asar') -Force
  Remove-Item $zipPath -Force
  Compress-Archive -Path $appDir.FullName -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output ("rebuilt zip: {0} ({1:N1} MB)" -f $zipPath, ((Get-Item $zipPath).Length/1MB))
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Rebuild-ElectronVariant -Variant 'Offline' -WebSrc (Join-Path $root 'artifacts\web\dist\public') -ApiSrc (Join-Path $root 'artifacts\api-server\dist')
Rebuild-ElectronVariant -Variant 'Protected' -WebSrc (Join-Path $root 'artifacts\web\dist\protected-windows\public') -ApiSrc (Join-Path $root 'artifacts\api-server\dist\protected')

$sums = Get-ChildItem (Join-Path $rel 'windows') -Filter '*.zip' | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  "$hash  $($_.Name)"
}
[System.IO.File]::WriteAllLines((Join-Path $rel 'windows\SHA256SUMS'), $sums, $utf8)
Write-Output 'SHA256SUMS regenerated'