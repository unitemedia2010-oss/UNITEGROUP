$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$PrincipalCheck = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
if (-not $PrincipalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Hay mo Windows PowerShell bang Run as administrator roi chay lai script nay."
}

$PythonW = Join-Path $Root ".venv\Scripts\pythonw.exe"
$Worker = Join-Path $Root "worker.py"
$TaskName = "Unite HR Document Worker"

if (-not (Test-Path $PythonW)) { throw "Chua cai worker. Hay chay install-worker.ps1 truoc." }
if (-not (Test-Path (Join-Path $Root ".env"))) { throw "Thieu file .env." }
if (-not (Test-Path (Join-Path $Root "token.json"))) { throw "Thieu token.json. Hay chay: .\.venv\Scripts\python.exe worker.py authorize" }

$Action = New-ScheduledTaskAction -Execute $PythonW -Argument ('"{0}" daemon' -f $Worker) -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Da dang ky va khoi dong: $TaskName" -ForegroundColor Green
Write-Host "Worker se tu chay khi dang nhap Windows, quet theo gio va nhan yeu cau tu HR Portal." -ForegroundColor White
