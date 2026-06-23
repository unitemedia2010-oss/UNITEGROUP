$ErrorActionPreference = "Stop"
$ProjectRef = "yoxpuohxstudwmtglito"

Write-Host "1/3 - Dang nhap Supabase..." -ForegroundColor Cyan
npx.cmd supabase login

Write-Host "2/3 - Lien ket project $ProjectRef..." -ForegroundColor Cyan
npx.cmd supabase link --project-ref $ProjectRef

Write-Host "3/3 - Deploy Edge Functions..." -ForegroundColor Cyan
npx.cmd supabase functions deploy admin-create-user --no-verify-jwt
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt

Write-Host "Hoan tat. May tinh khong can mo 24/24 sau khi deploy." -ForegroundColor Green
