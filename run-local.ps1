# Run Damascus Health Directorate locally on Windows PowerShell 5.1
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "C:\Program Files\Git\bin;" + $env:PATH
New-Item -ItemType Directory -Force -Path "$root\logs" | Out-Null

if (-not (Test-Path "$root\node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  Push-Location $root; & pnpm.cmd install --ignore-scripts; Pop-Location
}
if (-not (Test-Path "$root\artifacts\api-server\dist\index.mjs")) {
  Write-Host "Building API server..." -ForegroundColor Cyan
  Push-Location $root
  & pnpm.cmd --filter "@workspace/api-server" run build
  & pnpm.cmd --filter "@workspace/api-server" run build:seed
  Pop-Location
}

# API server (PGlite desktop mode) on :8080
$env:DAMASCUS_DESKTOP = "1"
$env:DAMASCUS_SCHEMA_PATH = "$root\lib\db\desktop-schema.sql"
$env:DAMASCUS_DATA_DIR = "$root\.damascus-data"
$env:NODE_ENV = "development"
$env:PORT = "8080"
$api = Start-Process -FilePath "node" -ArgumentList "--enable-source-maps","./dist/index.mjs" -WorkingDirectory "$root\artifacts\api-server" -RedirectStandardOutput "$root\logs\api.out.log" -RedirectStandardError "$root\logs\api.err.log" -WindowStyle Hidden -PassThru

# First boot only: seed default data (admin / Admin@1234)
if (-not (Test-Path "$root\.damascus-data\.seeded")) {
  Start-Sleep -Seconds 8
  $env:SEED_ADMIN_PASSWORD = "Admin@1234"
  Push-Location "$root\artifacts\api-server"; & node --enable-source-maps ./dist/seed.mjs; Pop-Location
  Remove-Item Env:\SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  New-Item -ItemType File -Force -Path "$root\.damascus-data\.seeded" | Out-Null
}

# Web dev server (Vite) on :22333, proxies /api -> 127.0.0.1:8080
$env:PORT = "22333"
Remove-Item Env:\DAMASCUS_DESKTOP -ErrorAction SilentlyContinue
$web = Start-Process -FilePath "pnpm.cmd" -ArgumentList "--filter","@workspace/web","run","dev" -WorkingDirectory $root -RedirectStandardOutput "$root\logs\web.out.log" -RedirectStandardError "$root\logs\web.err.log" -WindowStyle Hidden -PassThru

Start-Sleep -Seconds 10
Write-Host ""
Write-Host "=== Running ===" -ForegroundColor Green
Write-Host "  Web:   http://localhost:22333"
Write-Host "  API:   http://localhost:8080/api/healthz"
Write-Host "  Login: admin / Admin@1234"
Write-Host "API PID: $($api.Id) | Web PID: $($web.Id)"
Write-Host "Stop with: stop-local.ps1"
