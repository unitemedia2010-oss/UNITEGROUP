$TaskName = "Unite HR Document Worker"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Da go task $TaskName" -ForegroundColor Green
} else {
  Write-Host "Khong tim thay task $TaskName" -ForegroundColor Yellow
}
