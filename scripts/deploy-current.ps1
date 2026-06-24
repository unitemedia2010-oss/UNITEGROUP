$ErrorActionPreference = "Stop"
$ProjectRef = "yoxpuohxstudwmtglito"

Write-Host "UNITE HR PORTAL V37 - MOBILE GRID & BRAND CLEANUP" -ForegroundColor Cyan
Write-Host "Project: $ProjectRef" -ForegroundColor DarkGray

npx.cmd supabase login
npx.cmd supabase link --project-ref $ProjectRef

Write-Host "Deploying hr-import-employees (database/import layer remains V33)..." -ForegroundColor Yellow
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt

Write-Host "Edge Function da deploy." -ForegroundColor Green
Write-Host "Trong SQL Editor: chay 06_data_standardization_v32.sql (neu chua chay), sau do 07_import_integrity_v33.sql." -ForegroundColor Cyan
Write-Host "Cuoi cung deploy frontend va bam Ctrl+Shift+R de xoa cache cu." -ForegroundColor Cyan

Write-Host "Frontend V37: deploy toan bo thu muc, bao gom css/v36.css, logo transparent va js/employee.js." -ForegroundColor Green
