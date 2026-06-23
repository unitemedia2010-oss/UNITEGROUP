$ErrorActionPreference = "Stop"
$ProjectRef = "yoxpuohxstudwmtglito"

Write-Host "UNITE HR PORTAL V31 - DEPLOY CURRENT BACKEND" -ForegroundColor Cyan
Write-Host "Project: $ProjectRef" -ForegroundColor DarkGray

npx.cmd supabase login
npx.cmd supabase link --project-ref $ProjectRef

$functions = @(
  "admin-create-user",
  "hr-create-employee",
  "hr-import-employees",
  "google-workspace-bridge",
  "hr-bulk-create-users"
)

foreach ($functionName in $functions) {
  Write-Host "Deploying $functionName..." -ForegroundColor Yellow
  npx.cmd supabase functions deploy $functionName --no-verify-jwt
}

Write-Host "Backend V31 da deploy day du." -ForegroundColor Green
Write-Host "Tiep theo: push frontend len GitHub/Netlify va Ctrl+Shift+R." -ForegroundColor Cyan
