$ErrorActionPreference = "Stop"
$ProjectRef = "yoxpuohxstudwmtglito"

Write-Host "UNITE HR PORTAL V27 - FRESH DEPLOY" -ForegroundColor Magenta
Write-Host "Project: $ProjectRef" -ForegroundColor DarkGray

Write-Host "1/5 - Dang nhap Supabase..." -ForegroundColor Cyan
npx.cmd supabase login

Write-Host "2/5 - Lien ket project moi..." -ForegroundColor Cyan
npx.cmd supabase link --project-ref $ProjectRef

Write-Host "3/5 - Day migration len database..." -ForegroundColor Cyan
npx.cmd supabase db push

Write-Host "4/5 - Deploy Edge Functions..." -ForegroundColor Cyan
npx.cmd supabase functions deploy admin-create-user --no-verify-jwt
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt

Write-Host "5/5 - Kiem tra Functions va hosted secrets..." -ForegroundColor Cyan
npx.cmd supabase functions list
npx.cmd supabase secrets list

Write-Host "Hoan tat backend. Tao Auth user dau tien va chay seed SUPER_ADMIN." -ForegroundColor Green
