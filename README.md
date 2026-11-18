# IFC_Doc

Ứng dụng quản lý tài liệu trên trình duyệt, giao diện lấy cảm hứng từ Windows Explorer. File được lưu trên máy chủ riêng; PostgreSQL lưu metadata và tài khoản.

## Chức năng hiện có

- Đăng nhập bằng tài khoản có Role **Viewer**, **Editor** hoặc **Manager**; cookie phiên HttpOnly và giới hạn thử đăng nhập.
- Duyệt thư mục, tạo thư mục, tải lên nhiều file, tải xuống, tìm kiếm, sắp xếp, đổi tên, sao chép, cắt/dán, di chuyển và xóa.
- Nhật ký hoạt động lưu người thực hiện, thời gian, loại thao tác, mục bị tác động, chi tiết thay đổi và địa chỉ IP; có thể mở từ mục **Nhật ký hoạt động** trong thanh điều hướng.
- Chọn nhiều mục bằng cách kéo chuột tạo vùng chọn, giữ `Ctrl` để thêm/bỏ từng mục hoặc `Shift` để chọn một dải; hỗ trợ sao chép, cắt/dán và xóa nhiều mục.
- Menu chuột phải và phím tắt kiểu Windows Explorer: `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `F2`, `Delete`; nhấp đúp để mở thư mục hoặc xem trước/tải file.
- Xóa thư mục sẽ xóa cả nội dung bên trong; thao tác xóa không thể hoàn tác.
- Quản trị viên có thể tạo/vô hiệu hóa tài khoản, gán Role, phòng ban và chức vụ. Role mặc định là **Viewer**; **Editor** được xem, sửa và tạo Giải pháp/Thiết bị; **Manager** được xem, sửa, tạo và xóa. Quản trị viên hệ thống vẫn có quyền quản trị tài khoản và nhật ký.
- Mỗi tài khoản có một thư mục cá nhân riêng, tự tạo khi tạo tài khoản (và bổ sung tự động cho tài khoản hiện có khi khởi động). Chủ tài khoản có toàn quyền trên thư mục và nội dung bên trong; người khác không thấy nếu chưa được chia sẻ. Quản trị viên hệ thống có thể truy cập mọi thư mục.
- Tệp/thư mục mới mặc định cho phép mọi tài khoản xem và tải xuống. Khi cấp quyền cụ thể cho tài khoản, phòng ban hoặc chức vụ, quyền đó giới hạn quyền xem mặc định; quyền trên thư mục được kế thừa xuống mục con và quyền trùng được áp dụng theo mức cao nhất. Cấp quyền cho tài liệu danh mục cũng tắt chế độ công khai của tài liệu đó.
- Tra cứu danh mục theo hai nhánh độc lập **Giải pháp** và **Thiết bị**. Mỗi giải pháp liên kết được với tài liệu kỹ thuật, slide và thiết bị; mỗi thiết bị có tài liệu thiết kế, pháp lý/đo kiểm, catalog và danh sách giải pháp sử dụng.
- Editor và Manager quản lý thông tin Giải pháp/Thiết bị và các liên kết danh mục; chỉ Manager mới xóa. Tài liệu được tham chiếu từ kho IFC_Doc hiện có, không tạo bản sao; quyền xem/tải tài liệu tuân theo mặc định và ACL của kho.
- Từ trang chi tiết Giải pháp/Thiết bị, Editor và Manager có thể bấm vào tên nhóm tài liệu hoặc **Tải lên** để tải nhiều tệp và lưu trực tiếp vào đúng nhóm tài liệu.
- Giải pháp và Thiết bị hỗ trợ tải nhiều ảnh, chọn ảnh đại diện và tự chọn ảnh khác làm đại diện khi ảnh hiện tại bị xóa; ảnh đại diện hiển thị trong danh sách và sơ đồ liên kết. Mỗi lần tải tối đa 20 ảnh, giới hạn 15 MB/ảnh hoặc theo `MAX_FILE_SIZE_MB` nếu thấp hơn.
- Tên tệp có dấu tiếng Việt được giải mã đúng khi tải lên từ Explorer hoặc danh mục; tên ảnh được lưu và hiển thị đúng trong thư viện ảnh.
- Role được kiểm tra cả trên giao diện và API. Viewer chỉ xem ngoài thư mục cá nhân; Editor được tạo/sửa danh mục và thao tác tệp trong thư mục được cấp quyền sửa; Manager có thể xóa trong phạm vi được cấp quyền. Mọi tài khoản có toàn quyền với thư mục cá nhân của mình.
- Giao diện desktop mô phỏng Windows 11 trong trình duyệt, có Start/taskbar, cửa sổ Explorer, tìm kiếm toàn bộ IFC_Doc và ngăn chi tiết.
- Xem PDF trực tiếp; tài liệu Word, Excel, PowerPoint và OpenDocument được chuyển cục bộ sang PDF bằng LibreOffice để xem trong Explorer. Việc chuyển đổi diễn ra trên máy chủ của IFC_Doc, không gửi tài liệu tới dịch vụ xem trước bên ngoài.
- Giới hạn dung lượng file cấu hình bằng `MAX_FILE_SIZE_MB`.
- Chạy ứng dụng bằng PM2; PostgreSQL có thể chạy bằng Docker Compose. Dữ liệu file nằm trong `storage/`.

## Chạy lần đầu

1. Cài Node.js 20+, PM2, Docker Compose và LibreOffice Writer, Calc, Impress (cần cho xem trước tài liệu Office khi chạy ứng dụng trực tiếp bằng PM2). Trên Debian/Ubuntu: `sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress`. Nếu cài LibreOffice bằng Snap, ứng dụng tự đặt tệp chuyển đổi trong vùng dữ liệu Snap được cấp quyền; có thể chỉ định thư mục khác bằng `PREVIEW_TMP_DIR`.
2. Sao chép `.env.example` thành `.env`; đặt `JWT_SECRET` dài ít nhất 32 ký tự và mật khẩu quản trị riêng (từ 12 ký tự).
3. Khởi động PostgreSQL: `docker compose up -d db`. Đặt `DB_PASSWORD` trong `.env` trùng với mật khẩu PostgreSQL và giữ cổng host `5433`.
4. Cài dependencies: `npm install`.
5. Khởi động ứng dụng bằng PM2: `pm2 start ecosystem.config.js` rồi `pm2 save`.
6. Tạo tài khoản quản trị nếu chưa có: `node src/init-admin.js`.
7. Mở `http://localhost:6587` trong máy chủ hoặc `http://<IP-public>:6587` từ bên ngoài và đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Ứng dụng bind `0.0.0.0`; cần cho phép TCP 6587 trên firewall máy chủ và router/security group nếu có. Cổng mặc định là 6587; đặt `HOST_PORT` trong `.env` nếu muốn đổi cổng.

`ecosystem.config.js` nạp `.env` và chuyển địa chỉ PostgreSQL Compose (`db:5432`) sang cổng localhost (`127.0.0.1:5433`) cho tiến trình Node chạy ngoài Docker. Khi ứng dụng khởi động, bảng nhật ký hoạt động và chỉ mục được tự tạo nếu chưa có. Để tự khởi động PM2 sau khi máy khởi động lại, chạy `pm2 startup` và thực thi lệnh mà PM2 in ra, sau đó chạy lại `pm2 save`.

Đăng nhập qua HTTP public chỉ được bật tạm thời bằng `COOKIE_SECURE=false` trong `.env`; khi dùng HTTPS, xóa tùy chọn này hoặc đặt `COOKIE_SECURE=true` để cookie phiên chỉ được gửi qua kết nối mã hóa. HTTP không mã hóa mật khẩu hoặc cookie phiên và không an toàn khi dùng trên Internet.

Nếu muốn chạy toàn bộ không dùng Docker, cần cài PostgreSQL riêng và đặt `DATABASE_URL` trong `.env` trỏ tới database đó.

## Lưu ý triển khai

- Đặt sau HTTPS reverse proxy (Nginx/Caddy) trước khi đưa ra Internet; không mở trực tiếp PostgreSQL.
- PostgreSQL chỉ bind vào localhost port 5433; không mở cổng database ra Internet.
- Sao lưu đồng thời thư mục `storage/` và database.
- Tài khoản có thể xem/tải các mục chưa được phân quyền cụ thể; mục đã phân quyền chỉ hiển thị theo quyền trực tiếp hoặc quyền kế thừa phù hợp. Editor/Manager chỉ thao tác với tệp trong các thư mục họ được cấp quyền sửa; thao tác tại thư mục gốc dành cho quản trị viên hệ thống.
