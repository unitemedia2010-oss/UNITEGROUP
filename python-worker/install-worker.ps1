$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host "[1/4] Tao Python virtual environment..." -ForegroundColor Cyan
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  py -3 -m venv .venv
}

Write-Host "[2/4] Cai thu vien..." -ForegroundColor Cyan
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Da tao .env. Hay dien SUPABASE_SERVICE_ROLE_KEY truoc khi chay worker." -ForegroundColor Yellow
}

Write-Host "[3/4] Kiem tra Google OAuth..." -ForegroundColor Cyan
if (-not (Test-Path "credentials.json")) {
  Write-Host "Chua co credentials.json. Tai OAuth Desktop credentials tu Google Cloud va dat vao: $Root\credentials.json" -ForegroundColor Yellow
} else {
  & .\.venv\Scripts\python.exe worker.py authorize
}

Write-Host "[4/4] Hoan tat cai dat." -ForegroundColor Green
Write-Host "Sau khi dien .env va co token.json, chay register-worker-task.ps1 bang PowerShell." -ForegroundColor White
