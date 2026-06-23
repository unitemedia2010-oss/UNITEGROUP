# Database Setup — Current Clean Sequence

Chỉ dùng khi dựng một Supabase project mới hoàn toàn.

Thứ tự chạy:

1. `01_fresh_database.sql`
2. `02_google_workspace_bridge.sql`
3. `03_hierarchy_and_smart_filter.sql`
4. `04_workforce_operations.sql`
5. Tạo Auth user đầu tiên
6. Sửa email trong `05_bootstrap_super_admin.sql` rồi chạy
7. `99_verify_current_database.sql`

Không dùng các file fix/legacy của V26 trên project mới.
