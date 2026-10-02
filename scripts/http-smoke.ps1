$env:PORT = "8799"
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:DATA_DIR = Join-Path $root 'data'
$proc = Start-Process node -ArgumentList '--no-warnings', '--experimental-strip-types', 'src/server.ts' -PassThru -WindowStyle Hidden -WorkingDirectory (Join-Path $PSScriptRoot '..')
Start-Sleep -Seconds 2
try {
  Write-Host "HEALTH:"
  (Invoke-RestMethod http://localhost:8799/health | ConvertTo-Json -Compress)
  $body = Get-Content (Join-Path (Join-Path $root 'examples') 'd6-once.json') -Raw
  $r = Invoke-RestMethod -Method Post -Uri http://localhost:8799/rules -ContentType 'application/json' -Body $body
  $rid = $r.id
  $st = Invoke-RestMethod -Method Post -Uri http://localhost:8799/strategies -ContentType 'application/json' -Body (@{ ruleId = $rid } | ConvertTo-Json)
  Write-Host "STRATEGY: $($st.status) $($st.initialValue.fraction)"
  $sid = $st.id
  $dec = Invoke-RestMethod -Method Post -Uri http://localhost:8799/decide -ContentType 'application/json' -Body (@{ strategyId = $sid; roundsLeft = 1; values = @{ d1 = 5 } } | ConvertTo-Json -Depth 5)
  Write-Host "DECIDE d1=5 -> $($dec.chosen.action)"
  Write-Host "VERIFY:"
  (Invoke-RestMethod "http://localhost:8799/verify?ruleId=$rid" | ConvertTo-Json -Compress)
} finally {
  Stop-Process $proc.Id -Force
}
