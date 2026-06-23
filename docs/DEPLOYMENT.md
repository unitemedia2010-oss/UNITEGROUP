# Hướng dẫn triển khai V27

## 1. Kiểm tra trước khi chạy SQL

- Sao lưu database Supabase.
- Đảm bảo tài khoản hiện tại trong `profiles` có `role_type = SUPER_ADMIN` và `status = active`.
- Không xóa các migration cũ nếu hệ thống lịch đang có dữ liệu.

## 2. Nâng cấp database

### Project đang dùng V23–V25

Chạy toàn bộ:

```text
supabase/migrations/004_hr_portal.sql
```

### Project mới

Chạy đúng thứ tự:

```text
001_setup.sql
002_weekly_flexible_leave.sql
003_area_scope_and_export_fix.sql
004_hr_portal.sql
```

Migration 004 tạo cây tổ chức, hồ sơ nhân sự, thông báo, yêu cầu HR, file đính kèm, audit log, import batch và RLS.

## 3. Deploy Edge Functions trên Windows

Cách tự động:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-functions.ps1
```

Hoặc chạy thủ công:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref yoxpuohxstudwmtglito
npx.cmd supabase functions deploy admin-create-user --no-verify-jwt
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt
```

Sau khi deploy, máy cá nhân có thể tắt.

## 4. Đưa frontend lên GitHub/Netlify

```powershell
git init
git add .
git commit -m "Deploy Unite HR Portal V27"
git branch -M main
git remote add origin https://github.com/TEN_GITHUB/unite-hr-portal.git
git push -u origin main
```

Netlify:

```text
Build command: để trống
Publish directory: .
```

## 5. Nhập dữ liệu nhân sự

1. Đăng nhập bằng HR/Admin/Super Admin.
2. Mở `Cổng HR → Nhập dữ liệu Excel`.
3. Chọn file `_Quản lý thông tin nhân sự (1).xlsx`.
4. Kiểm tra bảng thống kê và danh sách cảnh báo.
5. Nhấn nhập dữ liệu. App gửi từng lô nhỏ để tránh timeout.
6. Sau khi nhập, nhấn `Liên kết tài khoản theo email` để nối Auth Profile với hồ sơ nhân sự đã có.

Không tải file Excel lên GitHub.

## 6. Cấu hình tổ chức và tài khoản

Khi tạo tài khoản, chọn đúng:

```text
Vai trò → Phòng ban → Khu vực → Chi nhánh → Team
```

- AREA_MANAGER: bắt buộc Khu vực.
- BRANCH_MANAGER: bắt buộc Khu vực + Chi nhánh.
- LEADER: bắt buộc Khu vực + Chi nhánh + Team.
- SALE/Nhân viên: gắn đúng tuyến quản lý để RLS lọc dữ liệu.

## 7. Kiểm thử bắt buộc

- Nhân viên chỉ thấy bản thân, thông báo được gửi và case của mình.
- Leader chỉ thấy đúng team.
- Quản lý chi nhánh thấy các team trong chi nhánh.
- Quản lý khu vực thấy các chi nhánh trong khu vực.
- HR thấy hồ sơ nghiệp vụ toàn công ty nhưng không có quyền hạ tầng SUPER_ADMIN.
- File case chỉ mở được bởi người có quyền vào case.
- Thông báo yêu cầu xác nhận ghi nhận `read_at` và `acknowledged_at`.

Xem thêm `docs/TEST_CHECKLIST.md`.

## 8. Bật nhắc thông báo chưa đọc theo giờ — tùy chọn

Sau khi migration 004 chạy thành công, có thể chạy:

```text
supabase/optional/notification-reminders.sql
```

Job gọi `remind_unread_announcements()` mỗi giờ, tạo nhắc lại cho thông báo quan trọng chưa đọc. Đây là nhắc trong app; email/push nền cần cấu hình nhà cung cấp riêng.
