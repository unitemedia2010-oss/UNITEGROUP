$ErrorActionPreference = "Stop"

Write-Host "UNITE HR V28 - GOOGLE WORKSPACE BRIDGE" -ForegroundColor Magenta
Write-Host "Project: yoxpuohxstudwmtglito" -ForegroundColor Cyan
Write-Host ""

$webAppUrl = Read-Host "Dan Apps Script Web app URL (ket thuc bang /exec)"
if (-not $webAppUrl -or -not $webAppUrl.Contains("/exec")) {
  throw "Web app URL chua hop le. URL can ket thuc bang /exec."
}

$sharedSecret = Read-Host "Dan INTEGRATION_SECRET tu Apps Script"
if (-not $sharedSecret -or $sharedSecret.Length -lt 20) {
  throw "INTEGRATION_SECRET chua hop le."
}

npx.cmd supabase login
npx.cmd supabase link --project-ref yoxpuohxstudwmtglito
npx.cmd supabase secrets set GOOGLE_APPS_SCRIPT_URL="$webAppUrl" GOOGLE_WORKSPACE_SHARED_SECRET="$sharedSecret"
npx.cmd supabase functions deploy google-workspace-bridge --no-verify-jwt

Write-Host ""
Write-Host "Hoan tat. Hay vao Apps Script > UNITE HR > Kiem tra ket noi." -ForegroundColor Green
