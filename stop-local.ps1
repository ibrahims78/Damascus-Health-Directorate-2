# Stop Damascus Health Directorate local servers (API :8080 + Web :22333)
foreach ($port in @(8080, 22333)) {
  $ids = netstat -ano | Select-String ":$port\s.*LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique
  foreach ($id in $ids) {
    if ($id -match '^\d+$') {
      Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped PID $id on port $port" -ForegroundColor Yellow
    }
  }
}
Write-Host "Stopped." -ForegroundColor Green
