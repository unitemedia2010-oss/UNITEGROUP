$ErrorActionPreference = "Stop"
$ProjectRef = "yoxpuohxstudwmtglito"

Write-Host "UNITE HR PORTAL V30 - OPERATIONS DEPLOY" -ForegroundColor Magenta
Write-Host "Project: $ProjectRef" -ForegroundColor Gray

npx.cmd supabase login
npx.cmd supabase link --project-ref $ProjectRef

Write-Host "Deploy admin-create-user..." -ForegroundColor Cyan
npx.cmd supabase functions deploy admin-create-user --no-verify-jwt
Write-Host "Deploy hr-create-employee..." -ForegroundColor Cyan
npx.cmd supabase functions deploy hr-create-employee --no-verify-jwt
Write-Host "Deploy hr-import-employees..." -ForegroundColor Cyan
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt
Write-Host "Deploy google-workspace-bridge..." -ForegroundColor Cyan
npx.cmd supabase functions deploy google-workspace-bridge --no-verify-jwt

Write-Host "Hoan tat V30. Nho chay migration 007 va cap nhat Code.gs truoc khi test." -ForegroundColor Green
