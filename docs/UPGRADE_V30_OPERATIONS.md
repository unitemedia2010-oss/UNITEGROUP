# Nâng cấp Unite HR Portal V30 – Workforce Operations

## Phạm vi V30

1. Cây tổ chức tương tác, màu riêng cho từng cụm và popup thành viên.
2. Hồ sơ nhân sự có thể chỉnh sửa theo quyền; nhân viên có thể báo thông tin sai.
3. Lịch làm/chấm công mở ngay trong tab Cổng HR bằng iframe cùng domain.
4. Import Excel có bảng so sánh mới/thay đổi/không đổi và chỉ đồng bộ dòng được chọn.
5. Nút đồng bộ Supabase → Google Sheet ngay trong app.
6. Thêm nhân sự mới và tự tạo tài khoản khi có email.
7. Mật khẩu tạm mặc định `12345678`, bắt buộc đổi ở lần đăng nhập đầu tiên.
8. Dashboard có biểu đồ nhân sự, tình hình làm/nghỉ hôm nay và tiến độ đăng ký lịch tuần.
9. Tối ưu mobile cho dashboard, cây tổ chức, form và lịch nhúng.

## Bước 1 – Chạy SQL

Chạy toàn bộ file:

`supabase/migrations/007_workforce_operations_v30.sql`

Sau đó chạy:

`supabase/verification/verify_v30.sql`

Kết quả cần có:

- `profiles.must_change_password`
- `profiles.password_changed_at`
- bảng `employee_correction_requests`
- function `can_edit_employee_record`
- function `complete_first_password_change`

## Bước 2 – Cập nhật Apps Script

Thay toàn bộ `Code.gs` bằng file V30.

Do V30 thêm action Web App `replace_employee_sheet`, cần **Deploy → Manage deployments → Edit → New version → Deploy**. Giữ nguyên Web App URL cũ nếu Google cho phép.

## Bước 3 – Deploy Edge Functions

Chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-v30.ps1
```

Hoặc thủ công:

```powershell
npx.cmd supabase link --project-ref yoxpuohxstudwmtglito
npx.cmd supabase functions deploy admin-create-user --no-verify-jwt
npx.cmd supabase functions deploy hr-create-employee --no-verify-jwt
npx.cmd supabase functions deploy hr-import-employees --no-verify-jwt
npx.cmd supabase functions deploy google-workspace-bridge --no-verify-jwt
```

## Bước 4 – Đẩy frontend

Thay source GitHub bằng V30, commit và push:

```powershell
git add .
git commit -m "Upgrade Unite HR Portal V30 workforce operations"
git push
```

Netlify cần dùng `X-Frame-Options = SAMEORIGIN` để trang lịch có thể hiển thị trong iframe cùng domain. File `netlify.toml` V30 đã cấu hình sẵn.

## Bước 5 – Xóa cache

Sau khi Netlify deploy:

- mở cửa sổ ẩn danh, hoặc
- nhấn `Ctrl + Shift + R`.

Các file phải có `?v=30`.

## Kiểm thử bắt buộc

### Tổ chức
- Nhấp khu vực, chi nhánh, Team.
- Popup hiển thị đúng thành viên trong phạm vi.
- Màu: Tinh Hoa đỏ, Kỳ Tài vàng, Tiên Phong xanh dương, Bức Phá xanh lá, Khai Phá đỏ đô.

### Hồ sơ
- HR/Admin sửa hồ sơ và lưu.
- Quản lý khu vực/chi nhánh chỉ sửa được nhân sự trong phạm vi.
- Nhân viên mở “Hồ sơ của tôi” và gửi yêu cầu sửa.
- HR nhận hồ sơ loại `profile_update` trong Trung tâm yêu cầu.

### Lịch
- Nhấn “Lịch làm & chấm công”; không chuyển trang.
- Admin/Leader thấy giao diện duyệt lịch.
- Sale/Nhân viên thấy giao diện đăng ký lịch.

### Import
- Phân tích Excel.
- Kiểm tra trạng thái Nhân sự mới / Có thay đổi / Không thay đổi / Cần rà soát.
- Chỉ đồng bộ các dòng được chọn.
- Nút Supabase → Sheet cập nhật tab `NHAN_SU_SYNC`.

### Tài khoản mới
- Tạo nhân sự có email.
- Auth user và profile được tạo.
- Đăng nhập bằng `12345678`.
- Hệ thống bắt buộc đổi mật khẩu trước khi vào Portal.

## Lưu ý bảo mật

Mật khẩu chung `12345678` chỉ là mật khẩu tạm. V30 đặt `must_change_password=true` và chặn truy cập Portal cho đến khi người dùng đổi mật khẩu. Không dùng mật khẩu này cho SUPER_ADMIN hoặc tài khoản vận hành chính.
