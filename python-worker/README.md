# Unite HR Document Worker V40

Python Worker chạy trên máy Media. Google Drive lưu file thật; Supabase chỉ lưu metadata, liên kết và trạng thái kiểm tra.

## Nâng cấp chính

- Hỗ trợ thư mục Google Drive được chia sẻ, Shared Drive và shortcut thư mục/file.
- Có lệnh `diagnose` để kiểm tra API thật sự thấy bao nhiêu file.
- Kết quả tên gần đúng được gắn tạm vào nhân sự tốt nhất và đánh dấu `pending`.
- Có `--force` để quét lại file cũ sau khi thay thuật toán.
- OAuth dùng `127.0.0.1` và cổng tự chọn (`GOOGLE_OAUTH_PORT=0`).

## Lệnh thường dùng

```powershell
# Kiểm tra Drive API thấy bao nhiêu file và loại file nào
.\.venv\Scripts\python.exe worker.py diagnose --source portrait

# Quét file mới / vừa sửa
.\.venv\Scripts\python.exe worker.py scan-now --source portrait

# Quét lại toàn bộ file để áp dụng thuật toán V40
.\.venv\Scripts\python.exe worker.py scan-now --source portrait --force

# Chạy worker chờ job từ HR Portal
.\.venv\Scripts\python.exe worker.py daemon
```

Có thể dùng file tiện ích:

- `diagnose-drive.cmd`
- `force-rescan-all.cmd`
- `run-worker-console.cmd`

## Biến môi trường mới

```env
GOOGLE_OAUTH_HOST=127.0.0.1
GOOGLE_OAUTH_PORT=0
AUTO_ATTACH_SUGGESTED=true
```

`AUTO_ATTACH_SUGGESTED=true` không biến kết quả gần đúng thành đã xác minh. Worker chỉ điền `employee_id` và giữ `verification_status=pending` để HR rà soát.
