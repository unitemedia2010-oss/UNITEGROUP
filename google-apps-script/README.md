# Google Apps Script — V37 Employee Documents Bridge

1. Dán `Code.gs` vào project Apps Script hiện tại.
2. Bật manifest và thay `appsscript.json` bằng file đi kèm.
3. Chạy `setupUniteHrWorkspace` một lần để tạo thư mục CCCD, chân dung và ảnh trích từ DOCX.
4. Chấp nhận quyền Google Drive + Google Docs mới.
5. Deploy phiên bản Web App mới, giữ nguyên URL `/exec`.
6. Không đưa `INTEGRATION_SECRET` vào source hoặc GitHub.

V37 hỗ trợ:

- Quét file ảnh theo thư mục.
- Đọc text và ảnh nhúng từ Google Docs.
- Giải nén `.docx`, đọc `word/document.xml` và trích ảnh trong `word/media/`.
- Tạo file ảnh trích xuất có tên ổn định để quét lại không sinh bản trùng.
