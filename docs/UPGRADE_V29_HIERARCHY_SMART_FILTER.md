# Nâng cấp V29 — Thứ tự tổ chức, lọc an toàn và lọc thông minh

## Vì sao V28 có thể báo trùng mã sau khi sắp xếp Sheet?

V28 tạo Filter chỉ trong vùng dữ liệu nhìn thấy A:Q, còn các cột kỹ thuật `_employee_id`, `_sync_version` nằm ngoài vùng Filter. Khi HR sắp xếp A:Q, dữ liệu nhìn thấy có thể di chuyển nhưng ID kỹ thuật không đi cùng dòng. Lần đồng bộ kế tiếp có thể gửi mã nhân sự của người A vào UUID của người B và Supabase chặn bằng unique constraint.

V29 sửa bằng cách:

- Filter bao phủ toàn bộ A:AB, kể cả cột kỹ thuật ẩn.
- Thêm `_original_employee_code` để xác minh dòng và UUID còn khớp.
- Edge Function từ chối cập nhật nếu phát hiện dòng bị lệch.
- Kiểm tra mã trùng trước khi UPDATE và trả thông báo dễ hiểu.

## Mô hình dữ liệu thứ tự tổ chức

Supabase giữ các trường:

- `department_rank`
- `hierarchy_rank`
- `hierarchy_level`
- `hierarchy_label`
- `org_sort_key`
- `source_row_order`

Thứ tự mặc định:

1. Ban lãnh đạo
2. Quản lý phòng ban
3. Quản lý khu vực
4. Quản lý chi nhánh
5. Leader
6. Nhân sự chính thức
7. TTS / NVPT
8. Nhân viên / CTV

Trong cùng cấp, dữ liệu được xếp tiếp theo Khu vực → Chi nhánh → Team → thứ tự dòng gốc Excel → họ tên.

## Hai sheet sử dụng

### NHAN_SU_SYNC

- Dùng để chỉnh sửa và đồng bộ.
- Cột kỹ thuật bị ẩn nhưng luôn nằm trong Filter.
- Có thể lọc/sắp xếp an toàn.
- Chỉ giá trị ô được đồng bộ; trạng thái Filter/Sort không ghi vào Supabase.

### DANH_BA_TO_CHUC

- Dùng để xem, lọc và trình bày danh sách đẹp theo tuyến quản lý.
- Không dùng để chỉnh sửa dữ liệu.
- Được làm mới từ Supabase bằng menu `UNITE HR → Làm mới danh bạ tổ chức`.

## Lọc thông minh trên app

Nhập câu lệnh tiếng Việt, ví dụ:

- `nhân sự đang làm ở Kỳ Tài, team Bros, full time`
- `leader thuộc chi nhánh TSC`
- `nhân sự thiếu email`
- `nhân sự cần rà soát ở phòng HR`
- `ban lãnh đạo`

V29 dùng bộ phân tích quy tắc tại trình duyệt, không tốn phí AI. Sau này có thể thay bằng Edge Function dùng Gemini/OpenAI để hiểu câu phức tạp hơn, nhưng kết quả luôn phải trả về JSON bộ lọc, không cho AI chạy SQL trực tiếp.

## Thứ tự triển khai

1. Chạy `006_hierarchy_directory_and_smart_filter.sql` trong Supabase SQL Editor.
2. Deploy lại:
   - `google-workspace-bridge`
   - `hr-import-employees`
3. Thay `Code.gs` trong Apps Script và lưu.
4. Chạy `setupUniteHrWorkspace` một lần hoặc chọn `Làm mới nhân sự từ Supabase`.
5. Thay `portal.html`, `js/portal.js`, `css/app.css` trên GitHub.
6. Ctrl + Shift + R trên app.
7. Trước khi đồng bộ lại dòng đang lỗi, chọn `UNITE HR → Làm mới nhân sự từ Supabase`.
