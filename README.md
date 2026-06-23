# Unite HR Portal V31 — Clean Production Source

Thư mục này chỉ giữ các file đang sử dụng cho phiên bản hiện tại. Các bản vá, preview, README cũ và migration legacy đã được loại bỏ.

## 1. Các trang đang chạy

- `index.html`: đăng nhập
- `portal.html`: cổng HR chính
- `admin.html`: lịch làm và duyệt lịch dành cho quản lý
- `employee.html`: đăng ký lịch dành cho nhân viên
- `change-password.html`: bắt buộc đổi mật khẩu lần đầu

## 2. Frontend cần đưa lên GitHub/Netlify

Giữ nguyên các mục:

```text
index.html
portal.html
admin.html
employee.html
change-password.html
css/
js/
icons/
manifest.webmanifest
netlify.toml
sw.js
```

Netlify:

```text
Build command: để trống
Publish directory: .
```

## 3. Supabase backend hiện tại

Các Edge Function đang dùng:

```text
admin-create-user
hr-create-employee
hr-import-employees
google-workspace-bridge
hr-bulk-create-users
```

Deploy đầy đủ:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-current.ps1
```

Project hiện tại:

```text
yoxpuohxstudwmtglito
```

## 4. SQL dành cho project mới hoàn toàn

Chỉ dùng thư mục `supabase/setup/` khi dựng lại một Supabase project trống. Chạy đúng thứ tự:

```text
01_fresh_database.sql
02_google_workspace_bridge.sql
03_hierarchy_and_smart_filter.sql
04_workforce_operations.sql
05_bootstrap_super_admin.sql
99_verify_current_database.sql
```

Project đang chạy hiện tại đã cài các phần này, không chạy lại nếu không có nhu cầu sửa database.

## 5. Google Apps Script

Hai file hiện hành:

```text
google-apps-script/Code.gs
google-apps-script/appsscript.json
```

Khi thay `Code.gs`:

```text
Apps Script → Deploy → Manage deployments → Edit → New version → Deploy
```

Giữ nguyên Web App URL `/exec` và các Script Properties đang cấu hình.

## 6. Quy tắc bảo mật

- Chỉ `Publishable Key` được nằm trong `js/config.js`.
- Không đưa Supabase Secret Key, Service Role Key, Database Password hoặc Integration Secret lên GitHub.
- Không đưa file Excel/CSV nhân sự vào source.
- Thông tin chi tiết xem `SECURITY.md`.

## 7. Sau khi cập nhật frontend

```powershell
git add .
git commit -m "Update Unite HR Portal V31"
git push
```

Sau khi Netlify deploy xong, dùng `Ctrl + Shift + R`. Nếu còn cache cũ, unregister Service Worker và clear site data.
