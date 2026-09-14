# مستودعات مديرية صحة دمشق — تشغيل البيئة الكاملة
$ErrorActionPreference = "Continue"
$env:PATH = "C:\Program Files\Git\bin;" + $env:PATH
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$apiEnv = @{
    DAMASCUS_DESKTOP      = "1"
    DAMASCUS_SCHEMA_PATH  = "$projectRoot\lib\db\desktop-schema.sql"
    DAMASCUS_DATA_DIR     = "$projectRoot\.damascus-data"
    PORT                  = "8080"
    NODE_ENV              = "development"
    PATH                  = $env:PATH
}
Write-Host "Starting API server on :8080 (PGlite desktop mode)..." -ForegroundColor Cyan
$apiProc = Start-Process -FilePath "node" `
    -ArgumentList "--enable-source-maps", ".\dist\index.mjs" `
    -WorkingDirectory "$projectRoot\artifacts\api-server" `
    -Environment $apiEnv `
    -WindowStyle Minimized -PassThru

$webEnv = @{
    PORT  = "22333"
    PATH  = $env:PATH
}
Write-Host "Starting web frontend on :22333 (Vite dev)..." -ForegroundColor Cyan
$webProc = Start-Process -FilePath "pnpm.cmd" `
    -ArgumentList "--filter", "@workspace/web", "run", "dev" `
    -WorkingDirectory $projectRoot `
    -Environment $webEnv `
    -WindowStyle Minimized -PassThru

Start-Sleep -Seconds 6
Write-Host ""
Write-Host "=== Environment Ready ===" -ForegroundColor Green
Write-Host "  Web:    http://localhost:22333" -ForegroundColor Green
Write-Host "  API:    http://localhost:8080/api/healthz" -ForegroundColor Green
Write-Host "  Login:  admin / Admin@1234" -ForegroundColor Yellow
Write-Host ""
Write-Host "API PID: $($apiProc.Id) | Web PID: $($webProc.Id)"
Write-Host "To stop both: run stop-dev.ps1" -ForegroundColor Cyan
