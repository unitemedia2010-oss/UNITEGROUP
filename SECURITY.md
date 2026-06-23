# Bảo mật V27

Frontend chỉ chứa Project URL và Publishable Key. Hai giá trị này được thiết kế cho client khi RLS đã bật.

Secret key, service-role key và Database Password không nằm trong source. Edge Functions đọc `SUPABASE_SECRET_KEYS` hoặc `SUPABASE_SERVICE_ROLE_KEY` do Supabase hosted environment cấp mặc định.

Không commit `.env`, file Excel nhân sự, CSV export hoặc backup lên GitHub.
