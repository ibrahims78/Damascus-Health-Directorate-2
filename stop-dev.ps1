# مستودعات مديرية صحة دمشق — إيقاف البيئة (API + Web)
$ports = @(8080, 22333)
foreach ($port in $ports) {
    $pids = netstat -ano | Select-String ":$port.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
    foreach ($pid in $pids) {
        if ($pid -and $pid -match '^\d+$') {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped PID $pid on port $port" -ForegroundColor Yellow
        }
    }
}
Write-Host "Environment stopped." -ForegroundColor Green
