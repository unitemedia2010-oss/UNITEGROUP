# Thiết lập Unite HR Portal V27 — Project mới

## Project đã cấu hình
- Project Ref: `yoxpuohxstudwmtglito`
- Project URL: `https://yoxpuohxstudwmtglito.supabase.co`
- Frontend dùng Publishable Key.
- Secret key không được hard-code; Edge Functions dùng hosted secrets của Supabase.

## Cách dễ nhất bằng SQL Editor
1. Chạy toàn bộ `supabase/fresh-install/001_unite_hr_portal_v27_fresh.sql` trên project mới.
2. Chạy `supabase/verification/verify_v27.sql`.
3. Trong Authentication > Users, tạo `unitemedia2010@gmail.com`, bật Auto Confirm.
4. Chạy `supabase/seed/001_bootstrap_super_admin.sql`.
5. Chạy `scripts/deploy-functions.ps1` hoặc deploy hai function thủ công.
6. Mở app bằng Live Server để kiểm thử rồi mới đưa lên GitHub/Netlify.

## Cách bằng CLI
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-v27-fresh.ps1
```

## Không làm
- Không chạy file `fix-v26-*` trên project mới.
- Không đưa secret key/DB password vào `js/config.js`.
- Không upload file Excel nhân sự lên GitHub; chọn file trực tiếp trong màn hình Import.
