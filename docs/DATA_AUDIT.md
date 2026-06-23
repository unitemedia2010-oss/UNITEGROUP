# Kiểm tra file dữ liệu nhân sự đã gửi

File được nhận diện:

```text
_Quản lý thông tin nhân sự (1).xlsx
Sheet: Danh sách nhân viên
Dòng tiêu đề: 7
Dữ liệu bắt đầu: 8
```

## Tổng quan dữ liệu

- 758 dòng có họ tên.
- 465 đang làm.
- 250 đã nghỉ.
- 40 bảo lưu.
- 3 dòng chưa xác định trạng thái.
- 9 phòng ban.
- 4 khu vực chính: Kỳ Tài, Khai Phá, Tiên Phong, Tinh Hoa.
- 12 mã chi nhánh được tách từ cột Team - Chi nhánh.
- 66 tên team sau khi chuẩn hóa chữ hoa/thường theo bản ghi gốc.

## Dòng cần rà soát

- 173 dòng thiếu mã nhân sự.
- 18 dòng thiếu cả email công việc và email cá nhân.
- 1 email không đúng định dạng.
- 4 dòng thiếu số điện thoại.
- 1 mã nhân sự bị trùng: `TVU1710`.
- Một số dòng kinh doanh thiếu Khu vực hoặc Team.
- File có một số tiêu đề `#REF!`; bộ import bỏ qua các cột này.

## Cách app xử lý

- Không loại bỏ dòng chỉ vì thiếu mã; app đánh dấu `needs_review` và giữ `source_row` để HR đối chiếu.
- Ưu tiên khớp hồ sơ theo mã nhân sự, sau đó theo email, cuối cùng theo file + số dòng.
- Cột chứa “Evo - DFC” được tách thành Team `Evo`, Chi nhánh `DFC`.
- Các giá trị chức danh như `QLCN`, `Nhân viên`, `Tổng giám đốc` không bị hiểu nhầm thành Team.
- CCCD, BHXH, mã số thuế, lương và ngân hàng được ghi vào bảng riêng `employee_private`.
- File nguồn không được đóng gói trong source để tránh rò rỉ dữ liệu cá nhân.
