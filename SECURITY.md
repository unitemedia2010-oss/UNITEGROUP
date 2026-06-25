# Bảo mật V27

Frontend chỉ chứa Project URL và Publishable Key. Hai giá trị này được thiết kế cho client khi RLS đã bật.

Secret key, service-role key và Database Password không nằm trong source. Edge Functions đọc `SUPABASE_SECRET_KEYS` hoặc `SUPABASE_SERVICE_ROLE_KEY` do Supabase hosted environment cấp mặc định.

Không commit `.env`, file Excel nhân sự, CSV export hoặc backup lên GitHub.

## V39 Python Worker

Không commit hoặc chia sẻ các file sau:

- `python-worker/.env`
- `python-worker/credentials.json`
- `python-worker/token.json`
- `python-worker/logs/`

`SUPABASE_SERVICE_ROLE_KEY` chỉ được đặt trên máy Media. Không đưa key này vào frontend, GitHub, Google Apps Script hoặc tài liệu nội bộ công khai.
