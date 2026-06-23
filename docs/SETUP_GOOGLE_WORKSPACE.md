# Thiết lập Google Sheets + Drive cho Unite HR Portal V28

## Tài nguyên đã gắn sẵn

- Google Sheet ID: `1pZopMrsmC2jmTP6gFmW1U9bpOYIOVf4ojll0-Ul7yCI`
- Apps Script Project ID: `18hcglwdKge81RhF3TMDCAAgqEPqlBVqcleb-o0AyAOGBc6ffG7LXI5ym`
- Supabase Project Ref: `yoxpuohxstudwmtglito`
- Edge Function: `google-workspace-bridge`

## Kiến trúc

```text
Unite HR App
   ↓ JWT người dùng
Supabase Edge Function google-workspace-bridge
   ↓ shared secret phía server
Google Apps Script Web App
   ├─ Google Drive: lưu file
   └─ Google Sheets: bảng vận hành HR
```

Supabase vẫn là dữ liệu gốc. Sheet chỉ là bảng vận hành/đối soát. Drive chỉ lưu file vật lý.

## 1. Cập nhật Apps Script

Mở project Apps Script đã cung cấp.

### Cách thủ công an toàn

1. Sao lưu code cũ nếu có.
2. Tạo/đổi file `Code.gs` bằng nội dung trong `google-apps-script/Code.gs`.
3. Mở **Project Settings** và bật hiển thị file manifest.
4. Thay `appsscript.json` bằng file trong thư mục `google-apps-script`.
5. Nhấn Save.

### Cách dùng clasp

Mở PowerShell tại `google-apps-script`:

```powershell
npx.cmd @google/clasp login
npx.cmd @google/clasp pull
```

Sao lưu code vừa pull, sau đó chép `Code.gs`, `appsscript.json`, `.clasp.json` của V28 vào thư mục và chạy:

```powershell
npx.cmd @google/clasp push
```

## 2. Chạy thiết lập lần đầu

Trong Apps Script:

1. Chọn function `setupUniteHrWorkspace`.
2. Nhấn **Run**.
3. Chấp nhận quyền Google Sheets, Drive và External Request.
4. Quay lại Google Sheet và tải lại trang.

Menu mới sẽ xuất hiện:

```text
UNITE HR
├─ 1. Thiết lập Workspace
├─ Làm mới nhân sự từ Supabase
├─ Đồng bộ các dòng đang chọn
├─ Đồng bộ tất cả dòng đã sửa
├─ Cấu hình email HR xem file
├─ Xem cấu hình
└─ Kiểm tra kết nối
```

Script sẽ tự tạo:

```text
Google Drive / UNITE_HR_DATA
├─ 01_HO_SO_NHAN_SU
├─ 02_YEU_CAU_HR
├─ 03_HOP_DONG
├─ 04_BIEN_BAN
├─ 05_BAO_CAO
└─ 99_ARCHIVE
```

Và tạo ba tab mới, không xóa tab dữ liệu đang có:

```text
NHAN_SU_SYNC
CAU_HINH
SYNC_LOG
```

## 3. Cấu hình người được xem file

Trong Google Sheet:

```text
UNITE HR → Cấu hình email HR xem file
```

Nhập email Google hoặc Google Group, cách nhau bằng dấu phẩy, ví dụ:

```text
hr@unitegroup.vn, unitemedia2010@gmail.com
```

File mới tải lên sẽ để Restricted và cấp quyền Viewer cho các email này cùng người tải file nếu email đó dùng được với Google Drive.

## 4. Deploy Apps Script Web App

Trong Apps Script:

1. **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Nhấn Deploy và cấp quyền.
6. Sao chép URL kết thúc bằng `/exec`.

Endpoint được để `Anyone`, nhưng mọi POST đều phải có `INTEGRATION_SECRET`. Secret chỉ nằm trong Apps Script Properties và Supabase Edge Function, không nằm trong frontend.

## 5. Lấy Integration Secret

Trong Google Sheet:

```text
UNITE HR → Xem cấu hình
```

Sao chép giá trị `INTEGRATION_SECRET`. Không đưa giá trị này vào GitHub hay JavaScript frontend.

## 6. Chạy migration V28

Trong Supabase SQL Editor, chạy toàn bộ:

```text
supabase/migrations/005_google_workspace_bridge.sql
```

Sau đó chạy:

```text
supabase/verification/verify_v28_workspace.sql
```

Kết quả phải có:

- `employees.sync_version`
- `employees.sheet_synced_at`
- các cột `external_*` trong `hr_case_attachments`
- bảng `workspace_sync_logs`

## 7. Cấu hình và deploy Edge Function

Mở PowerShell tại thư mục project:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-google-workspace-bridge.ps1
```

Script sẽ hỏi:

1. Apps Script Web app URL.
2. `INTEGRATION_SECRET`.

Sau đó tự đặt Supabase secrets và deploy function.

## 8. Kiểm tra kết nối

Quay lại Google Sheet:

```text
UNITE HR → Kiểm tra kết nối
```

Kết quả đúng:

```json
{
  "ok": true,
  "service": "google-workspace-bridge"
}
```

Sau đó chọn:

```text
UNITE HR → Làm mới nhân sự từ Supabase
```

Tab `NHAN_SU_SYNC` sẽ nhận dữ liệu nhân sự.

## 9. Quy trình chỉnh dữ liệu trên Sheet

1. HR sửa dữ liệu trên `NHAN_SU_SYNC`.
2. Cột kỹ thuật tự chuyển sang `CHANGED`.
3. HR chọn các dòng cần cập nhật.
4. Chọn **Đồng bộ các dòng đang chọn**.
5. Nếu dữ liệu Supabase đã được người khác sửa trước, dòng sẽ báo `CONFLICT`; HR cần làm mới Sheet trước khi chỉnh lại.

Không chỉnh trực tiếp các cột kỹ thuật ẩn `_employee_id`, `_sync_version`, `_updated_at`, `_sync_status`, `_sync_error`.

## 10. Kiểm tra upload file Drive từ app

1. Đưa source V28 lên hosting hoặc chạy Live Server.
2. Đăng nhập.
3. Tạo Yêu cầu HR và đính kèm file nhỏ hơn 8 MB.
4. Kiểm tra Drive:

```text
UNITE_HR_DATA/02_YEU_CAU_HR/<NĂM>/<MÃ HỒ SƠ>
```

5. Kiểm tra bảng `hr_case_attachments` có:

```text
storage_provider = google_drive
external_file_id = ...
external_url = ...
```

## Giới hạn giai đoạn 1

- File Apps Script giới hạn 8 MB vì truyền base64 qua Web App.
- Link Drive chỉ mở được với người đã được cấp quyền Google.
- Supabase là nguồn dữ liệu chuẩn; Sheet không tự động đồng bộ mỗi ô theo thời gian thực.
- Nên dùng menu đồng bộ theo lô 50–75 dòng.
