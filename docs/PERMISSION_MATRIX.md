# Ma trận phân quyền

| Vai trò | Phạm vi dữ liệu | Quyền chính |
|---|---|---|
| SUPER_ADMIN | Toàn hệ thống | Cấu hình cao nhất, tạo mọi vai trò, quản lý tài khoản và dữ liệu |
| ADMIN | Toàn hệ thống trừ quyền cấp Super | Vận hành hệ thống, tạo cấp dưới, quản lý lịch và cổng HR |
| HR | Toàn công ty về nghiệp vụ HR | Hồ sơ nhân sự, import Excel, thông báo, case, file, phân công và báo cáo |
| AREA_MANAGER | Khu vực được gắn | Xem chi nhánh/team/nhân sự và lịch trong khu vực |
| BRANCH_MANAGER | Chi nhánh được gắn | Quản lý Leader và team trong chi nhánh |
| LEADER | Team được gắn | Quản lý lịch và nhân sự thuộc team |
| SALE/EMPLOYEE/TTS/NVPT | Bản thân | Đăng ký lịch, nhận thông báo, gửi yêu cầu và theo dõi hồ sơ của mình |

Quyền được kiểm tra ở cả frontend và Supabase RLS. Việc ẩn nút trên giao diện không được coi là lớp bảo mật.
