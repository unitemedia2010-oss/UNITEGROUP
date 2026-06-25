# Unite HR Portal V40

V40 tiếp tục kiến trúc Python Worker của V39 và bổ sung:

- Quét Google Drive đầy đủ hơn với Shared Drive, thư mục được chia sẻ và shortcut.
- Chẩn đoán số file Drive theo MIME type.
- Tự gắn kết quả tên gần đúng vào nhân sự phù hợp nhất nhưng giữ trạng thái `Cần kiểm tra`.
- Lệnh quét cưỡng bức để áp dụng thuật toán mới cho file đã xử lý.
- Cột `Hồ sơ Drive` ngay trong bảng nhân sự.
- Giữ chuột kéo ngang bảng và cuộn tiếp trang khi đã chạm đầu/cuối bảng.
- Supabase vẫn chỉ lưu metadata và Drive URL, không lưu file ảnh.

Triển khai theo tài liệu:

`docs/UPGRADE_V40_DRIVE_LINKS_AND_GRID.md`
