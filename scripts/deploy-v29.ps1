$ErrorActionPreference = "Stop"
$ProjectRef = "yoxpuohxstudwmtglito"

Write-Host "UNITE HR PORTAL V29 - DEPLOY" -ForegroundColor Magenta
Write-Host "Project: $ProjectRef" -ForegroundColor Gray

npx.cmd supabase login
npx.cmd supabase link --project-ref $ProjectRef

Write-Host "Deploy google-workspace-bridge..." -ForegroundColor Cyan
npx.cmd supabase functions deploy google-workspace-bridge --no-verify-jwt

Write-Host "Deploy hr-import-employees..." -ForegroundColor Cyan
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt

Write-Host "Hoan tat Edge Functions V29. Nho chay migration 006 tren SQL Editor va cap nhat Code.gs." -ForegroundColor Green
