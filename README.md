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
- Người dùng có Role **Manager** trở lên có thể quản lý danh mục phòng ban và chức vụ (thêm, sửa, xóa); chỉ xóa được mục chưa được tài khoản hoặc quyền truy cập sử dụng. Dữ liệu phòng ban/chức vụ đang có được chuyển vào các bảng danh mục khi ứng dụng khởi động.
- Lần khởi động đầu tiên sau khi cập nhật, hệ thống tạo sẵn Ban Giám Đốc (Giám Đốc/Phó Giám Đốc), Ban Kỹ thuật (Trưởng Ban/Phó Ban/Chuyên viên/Chuyên Gia), Kinh Doanh, Dự án và Kế toán (mỗi phòng gồm Trưởng Phòng/Phó Phòng/Chuyên viên/Chuyên Gia). Danh sách khởi tạo chỉ chạy một lần để các thay đổi sau đó không bị khôi phục ngoài ý muốn.
- Tài khoản mới được tạo với mật khẩu mặc định `123456` và bắt buộc đổi ngay lần đăng nhập đầu tiên; API cũng chặn truy cập chức năng khác cho tới khi đổi xong. Người dùng có thể tự đổi mật khẩu trong menu tài khoản; quản trị viên có thể đặt lại mật khẩu bất kỳ tài khoản nào về `123456`, yêu cầu đổi ở lần đăng nhập kế tiếp.
- Mỗi tài khoản có một thư mục cá nhân riêng, tự tạo khi tạo tài khoản (và bổ sung tự động cho tài khoản hiện có khi khởi động). Chủ tài khoản có toàn quyền trên thư mục và nội dung bên trong; người khác không thấy nếu chưa được chia sẻ. Quản trị viên hệ thống có thể truy cập mọi thư mục.
- Tệp/thư mục mới mặc định cho phép mọi tài khoản xem và tải xuống. Khi cấp quyền cụ thể cho tài khoản, phòng ban hoặc chức vụ, quyền đó giới hạn quyền xem mặc định; quyền trên thư mục được kế thừa xuống mục con và quyền trùng được áp dụng theo mức cao nhất. Cấp quyền cho tài liệu danh mục cũng tắt chế độ công khai của tài liệu đó.
- Tra cứu danh mục theo hai nhánh độc lập **Giải pháp** và **Thiết bị**. Mỗi giải pháp liên kết được với tài liệu kỹ thuật, slide và thiết bị; mỗi thiết bị có Datasheet (TLKT), hướng dẫn lắp đặt và sử dụng, tài liệu pháp lý/đo kiểm, catalog và danh sách giải pháp sử dụng.
- Editor và Manager quản lý thông tin Giải pháp/Thiết bị và các liên kết danh mục; chỉ Manager mới xóa. Tài liệu được tham chiếu từ kho IFC_Doc hiện có, không tạo bản sao; quyền xem/tải tài liệu tuân theo mặc định và ACL của kho.
- Từ trang chi tiết Giải pháp/Thiết bị, Editor và Manager có thể bấm vào tên nhóm tài liệu hoặc **Tải lên** để tải nhiều tệp và lưu trực tiếp vào đúng nhóm tài liệu.
- Nhóm **Hướng dẫn lắp đặt và sử dụng** của Thiết bị nhận video cùng tài liệu; bấm vào video để phát và tua ngay trên trình duyệt. Hỗ trợ xem MP4, M4V, WebM, OGV và OGG tùy codec trình duyệt; video tuân theo giới hạn `MAX_FILE_SIZE_MB`.
- Manager có thể đặt giới hạn phòng ban được xem cho từng nhóm tài liệu của Thiết bị ngay cạnh nút **Tải lên**. Khi đã chọn phòng ban, các user ngoài danh sách không thấy hoặc truy cập được file của nhóm đó qua catalog, tìm kiếm, xem trước hay tải xuống; quyền Xem/Sửa/Xóa của user trong phòng ban vẫn theo ACL file và Role Viewer/Editor/Manager. Không chọn phòng ban nào thì không giới hạn theo phòng ban.
- Giải pháp và Thiết bị hỗ trợ tải nhiều ảnh, chọn ảnh đại diện và tự chọn ảnh khác làm đại diện khi ảnh hiện tại bị xóa; ảnh đại diện hiển thị trong danh sách và sơ đồ liên kết. Mỗi lần tải tối đa 20 ảnh, giới hạn 15 MB/ảnh hoặc theo `MAX_FILE_SIZE_MB` nếu thấp hơn.
- Tên tệp có dấu tiếng Việt được giải mã đúng khi tải lên từ Explorer hoặc danh mục; tên ảnh được lưu và hiển thị đúng trong thư viện ảnh.
- Role được kiểm tra cả trên giao diện và API. Viewer chỉ xem ngoài thư mục cá nhân; Editor được tạo/sửa danh mục và thao tác tệp trong thư mục được cấp quyền sửa; Manager có thể xóa trong phạm vi được cấp quyền. Mọi tài khoản có toàn quyền với thư mục cá nhân của mình.
- Giao diện desktop mô phỏng Windows 11 trong trình duyệt, có Start/taskbar, cửa sổ Explorer, tìm kiếm toàn bộ IFC_Doc và ngăn chi tiết.
- Xem PDF trực tiếp; tài liệu Word, Excel, PowerPoint và OpenDocument được chuyển cục bộ sang PDF bằng LibreOffice để xem trong Explorer. Việc chuyển đổi diễn ra trên máy chủ của IFC_Doc, không gửi tài liệu tới dịch vụ xem trước bên ngoài.
- Xem video MP4, M4V, WebM, OGV và OGG trực tiếp trong trình duyệt với khả năng tua; video không được chuyển mã, vì vậy khả năng phát tùy thuộc codec trình duyệt.
- Giới hạn dung lượng file cấu hình bằng `MAX_FILE_SIZE_MB`.
- Chạy ứng dụng bằng PM2; PostgreSQL có thể chạy bằng Docker Compose. Dữ liệu file nằm trong `storage/`.

## Chạy lần đầu

1. Cài Node.js 20+, PM2, Docker Compose và LibreOffice Writer, Calc, Impress (cần cho xem trước tài liệu Office khi chạy ứng dụng trực tiếp bằng PM2). Trên Debian/Ubuntu: `sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress`. Nếu cài LibreOffice bằng Snap, ứng dụng tự đặt tệp chuyển đổi trong vùng dữ liệu Snap được cấp quyền; có thể chỉ định thư mục khác bằng `PREVIEW_TMP_DIR`.
2. Sao chép `.env.example` thành `.env`; đặt `JWT_SECRET` dài ít nhất 32 ký tự và mật khẩu quản trị riêng (từ 12 ký tự).
3. Khởi động PostgreSQL: `docker compose up -d db`. Đặt `DB_PASSWORD` trong `.env` trùng với mật khẩu PostgreSQL và giữ cổng host `5433`.
4. Cài dependencies: `npm install`.
5. Khởi động ứng dụng bằng PM2: `pm2 start ecosystem.config.js` rồi `pm2 save`.
6. Tạo tài khoản quản trị nếu chưa có: `node src/init-admin.js`.
7. Mở `http://localhost:6587` trong máy chủ hoặc `http://<IP-public>:6587` từ bên ngoài và đăng nhập bằng `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Ứng dụng bind `0.0.0.0`; cần cho phép TCP 6587 trên firewall máy chủ và router/security group nếu có. Cổng mặc định là 6587; đặt `HOST_PORT` trong `.env` nếu muốn đổi cổng. HTTP public không mã hóa thông tin đăng nhập; chỉ nên dùng tạm thời hoặc trên mạng tin cậy.

`ecosystem.config.js` nạp `.env` và chuyển địa chỉ PostgreSQL Compose (`db:5432`) sang cổng localhost (`127.0.0.1:5433`) cho tiến trình Node chạy ngoài Docker. Khi ứng dụng khởi động, bảng nhật ký hoạt động và chỉ mục được tự tạo nếu chưa có. Để tự khởi động PM2 sau khi máy khởi động lại, chạy `pm2 startup` và thực thi lệnh mà PM2 in ra, sau đó chạy lại `pm2 save`.

## Domain và HTTPS (Caddy)

Cấu hình mẫu tại `deploy/Caddyfile.example` để Caddy tự lấy và gia hạn chứng chỉ TLS miễn phí. App tiếp tục chạy trực tiếp bằng HTTP ở `http://<IP-public>:6587`; đồng thời Caddy phục vụ domain qua HTTPS và địa chỉ IP qua HTTP cổng 80.

1. Trỏ bản ghi DNS `A` của domain về IP public của máy chủ (và `AAAA` nếu máy chủ có IPv6). Mở TCP 80 và 443 trên firewall/security group; giữ cổng `HOST_PORT` mở nếu cần truy cập trực tiếp qua `http://<IP-public>:6587`.
2. Cài Caddy trên máy chủ theo hướng dẫn chính thức tại [caddyserver.com/docs/install](https://caddyserver.com/docs/install).
3. Sao chép `deploy/Caddyfile.example` thành `/etc/caddy/Caddyfile`, thay `example.com` bằng domain thật. Giữ cả hai site block: block domain bật HTTPS tự động, block `:80` giữ truy cập HTTP bằng IP. Cấu hình reverse proxy giả định ứng dụng PM2 đang lắng nghe `127.0.0.1:6587` trên cùng máy chủ.
4. Kiểm tra cấu hình và khởi động lại Caddy: `sudo caddy validate --config /etc/caddy/Caddyfile` rồi `sudo systemctl reload caddy`.
5. Truy cập `https://<domain>` và `http://<IP-public>`. Caddy cần DNS trỏ đúng máy chủ và có thể nhận kết nối từ Internet ở cổng 80/443 để cấp, gia hạn chứng chỉ.

`COOKIE_SECURE=auto` là mặc định khuyến nghị: cookie phiên tự bật cờ `Secure` khi request đi qua HTTPS và vẫn hoạt động qua HTTP local/IP. App chỉ tin các header HTTPS do reverse proxy cùng máy chủ (loopback) gửi. Có thể đặt `COOKIE_SECURE=true` để luôn bắt buộc HTTPS hoặc `COOKIE_SECURE=false` để tắt cờ này; không nên dùng `false` khi mở app qua Internet. HTTP không mã hóa mật khẩu hoặc cookie phiên và không an toàn khi dùng trên Internet.

Nếu muốn chạy toàn bộ không dùng Docker, cần cài PostgreSQL riêng và đặt `DATABASE_URL` trong `.env` trỏ tới database đó.

## Lưu ý triển khai

- Dùng domain với HTTPS trước khi đưa hệ thống ra Internet; không mở trực tiếp PostgreSQL.
- PostgreSQL chỉ bind vào localhost port 5433; không mở cổng database ra Internet.
- Sao lưu đồng thời thư mục `storage/` và database.
- Tài khoản có thể xem/tải các mục chưa được phân quyền cụ thể; mục đã phân quyền chỉ hiển thị theo quyền trực tiếp hoặc quyền kế thừa phù hợp. Editor/Manager chỉ thao tác với tệp trong các thư mục họ được cấp quyền sửa; thao tác tại thư mục gốc dành cho quản trị viên hệ thống.
