# مستودعات مديرية صحة دمشق — إعادة بذر البيانات (بعد إيقاف الخادم)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "C:\Program Files\Git\bin;" + $env:PATH
$env:DAMASCUS_DESKTOP = "1"
$env:DAMASCUS_SCHEMA_PATH = "$projectRoot\lib\db\desktop-schema.sql"
$env:DAMASCUS_DATA_DIR = "$projectRoot\.damascus-data"
Set-Location "$projectRoot\artifacts\api-server"
if (-not (Test-Path "dist\seed.mjs")) { pnpm.cmd run build | Out-Null }
node --enable-source-maps ./dist/seed.mjs
