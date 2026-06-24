# Google Apps Script Bridge

1. Dán `Code.gs` vào project Apps Script đang dùng.
2. Bật hiển thị manifest và thay bằng `appsscript.json`.
3. Deploy phiên bản Web App mới, giữ URL `/exec` đang cấu hình cho Edge Function.
4. Không đưa `INTEGRATION_SECRET` vào source hoặc GitHub.

V32 không thay đổi nghiệp vụ Apps Script; các thay đổi tập trung ở frontend, database và `hr-import-employees`.
