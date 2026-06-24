# Database Setup — V33 Clean Sequence

Chỉ dùng chuỗi này khi dựng một Supabase project mới hoàn toàn:

1. `01_fresh_database.sql`
2. `02_google_workspace_bridge.sql`
3. `03_hierarchy_and_smart_filter.sql`
4. `04_workforce_operations.sql`
5. `06_data_standardization_v32.sql`
6. `07_import_integrity_v33.sql`
7. Tạo Auth user đầu tiên
8. Sửa email trong `05_bootstrap_super_admin.sql` rồi chạy
9. `99_verify_current_database.sql`

Project đang chạy V32 chỉ cần:

1. Backup database.
2. Chạy `07_import_integrity_v33.sql`.
3. Deploy lại Edge Function `hr-import-employees`.
4. Deploy frontend V34 và xóa cache trình duyệt.
5. Chạy `99_verify_current_database.sql`.

Không chạy lại toàn bộ chuỗi 01–04 trên database đang có dữ liệu nếu chưa backup.
