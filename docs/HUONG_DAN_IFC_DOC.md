# IFC_Doc — Giới thiệu, hướng dẫn sử dụng và triển khai

Tài liệu được biên soạn theo mã nguồn nhánh mặc định của repository. IFC_Doc là ứng dụng web quản lý tài liệu với giao diện lấy cảm hứng từ Windows Explorer. Nội dung tệp lưu trên máy chủ trong thư mục storage; PostgreSQL lưu tài khoản, cấu trúc thư mục, metadata, quyền, danh mục và nhật ký.

## 1. Giới thiệu

### Chức năng chính

- Quản lý thư mục và tài liệu: tạo thư mục, tải lên nhiều tệp, tải xuống, tìm kiếm, sắp xếp, đổi tên, sao chép, cắt/dán, di chuyển và xóa.
- Chọn nhiều mục bằng kéo chuột, Ctrl hoặc Shift; hỗ trợ menu chuột phải và phím tắt Ctrl+C, Ctrl+X, Ctrl+V, F2, Delete.
- Mỗi người dùng có thư mục cá nhân riêng, tạo tự động khi lập tài khoản. Chủ tài khoản có toàn quyền trong đó; quản trị viên hệ thống có thể truy cập mọi thư mục.
- Phân quyền theo tài khoản, phòng ban hoặc chức vụ. Quyền từ thư mục được kế thừa xuống các mục con; các quyền trùng được lấy theo mức cao nhất.
- Tra cứu danh mục **Giải pháp** và **Thiết bị**. Giải pháp liên kết với tài liệu kỹ thuật, trình bày và thiết bị; thiết bị có model, nhà sản xuất, tài liệu thiết kế, pháp lý/đo kiểm, catalog, ảnh và giải pháp liên quan.
- Tài liệu danh mục tham chiếu tệp có sẵn trong IFC_Doc; không tạo bản sao. Editor/Manager có thể liên kết hoặc tải tệp trực tiếp vào đúng nhóm.
- Xem PDF trên trình duyệt. Word, Excel, PowerPoint và OpenDocument được chuyển cục bộ sang PDF bằng LibreOffice; tài liệu không gửi tới dịch vụ xem trước bên ngoài.
- Quản trị tài khoản, vai trò, phòng ban, chức vụ và trạng thái hoạt động. Ghi nhật ký thao tác gồm người dùng, thời gian, nội dung và IP.

### Vai trò và quyền

| Vai trò | Quyền |
|---|---|
| Viewer | Xem/tải tệp được cấp quyền; có toàn quyền trong thư mục cá nhân. |
| Editor | Viewer; tạo/sửa danh mục và nội dung tại thư mục được cấp quyền sửa. Không xóa dữ liệu chung. |
| Manager | Editor; xóa trong phạm vi được cấp quyền. |
| Quản trị viên hệ thống | Quản trị tài khoản, xem nhật ký và truy cập toàn bộ kho. |

Thư mục/tệp chưa có phân quyền cụ thể mặc định cho phép xem và tải xuống. Khi có ACL, quyền xem được giới hạn theo ACL. Chỉ quản trị viên hệ thống được tạo hoặc di chuyển mục ở thư mục gốc. Thao tác xóa thư mục xóa cả nội dung bên trong và không thể hoàn tác.

### Thành phần kỹ thuật

- Node.js 20+ và Express; giao diện HTML/CSS/JavaScript tĩnh.
- PostgreSQL lưu metadata, tài khoản, ACL, danh mục và nhật ký.
- Thư mục storage lưu dữ liệu tệp; mặc định giới hạn 100 MB/tệp, cấu hình qua MAX_FILE_SIZE_MB.
- PM2 hoặc Docker Compose; Caddy hoặc Nginx có thể làm reverse proxy HTTPS.
- LibreOffice Writer, Calc và Impress cần thiết nếu muốn xem trước tài liệu Office khi app chạy trực tiếp bằng PM2.

## 2. Hướng dẫn sử dụng

### Đăng nhập và điều hướng

1. Mở địa chỉ IFC_Doc do quản trị viên cung cấp và đăng nhập bằng tài khoản cá nhân.
2. Dùng **Tất cả tệp** hoặc cây thư mục để duyệt kho; dùng **Tra cứu Giải pháp**, **Tra cứu Thiết bị** cho danh mục.
3. Chọn thư mục để xem nội dung. Bấm đúp vào thư mục để mở; bấm đúp vào tệp để xem trước hoặc tải xuống.
4. Bấm biểu tượng tài khoản để đăng xuất. Phiên đăng nhập hết hạn sau 8 giờ.

### Tạo thư mục, tải lên và thao tác tệp

1. Mở thư mục đích, chọn **Mới → Thư mục mới**, nhập tên và xác nhận.
2. Chọn **Tải lên** để chọn một hoặc nhiều tệp. Tệp mới xuất hiện trong danh sách.
3. Dùng ô tìm kiếm toàn kho; kết quả chỉ gồm các mục được phép xem. Sắp xếp theo tên, ngày sửa đổi hoặc kích thước.
4. Chọn mục rồi dùng thanh công cụ hoặc menu chuột phải. Ctrl+C/Ctrl+X sao chép/cắt, Ctrl+V dán, F2 đổi tên, Delete xóa.
5. Chọn nhiều mục bằng Ctrl/Shift hoặc kéo vùng chọn. Tải xuống từ menu thao tác hoặc nút tải xuống trong cửa sổ xem trước.

Để tạo/sửa nội dung chung, người dùng cần vai trò Editor trở lên và quyền sửa trên thư mục. Tệp vượt giới hạn kích thước sẽ bị từ chối. Xóa thư mục sẽ xóa toàn bộ nội dung con; không có chức năng hoàn tác.

### Phân quyền

1. Chọn thư mục/tệp và mở **Quyền truy cập**.
2. Chọn đối tượng: tài khoản, phòng ban hoặc chức vụ.
3. Cấp mức **Xem**, **Sửa** hoặc **Quản lý quyền**.
4. Quyền thư mục được kế thừa xuống nội dung bên trong. Có thể thu hồi quyền trực tiếp; quyền được kế thừa từ thư mục cha vẫn có thể còn hiệu lực.

Quản lý ACL cần quyền **Quản lý quyền** tại mục đó. Hãy xem xét quyền kế thừa trước khi thu hồi để tránh người dùng mất quyền truy cập.

### Danh mục Giải pháp và Thiết bị

- Mở danh mục tương ứng, tìm kiếm và chọn mục để xem chi tiết.
- Editor/Manager có thể thêm hoặc sửa thông tin. Với thiết bị, các trường gồm tên, model, nhà sản xuất và mô tả.
- Trong Giải pháp, liên kết nhóm tài liệu kỹ thuật/trình bày và thiết bị liên quan.
- Trong Thiết bị, liên kết Datasheet (TLKT), hướng dẫn lắp đặt và sử dụng, tài liệu pháp lý/đo kiểm, catalog; tải tối đa 20 ảnh mỗi lần, chọn ảnh đại diện.
- Manager có thể bấm **Phân quyền** cạnh nút **Tải lên** trong từng nhóm tài liệu Thiết bị để chọn nhiều phòng ban được xem. User ngoài các phòng ban được chọn không thể xem/tải file qua catalog hoặc các chức năng kho; quyền sửa/xóa của user được phép xem vẫn theo ACL file và Role. Bỏ chọn toàn bộ phòng ban sẽ bỏ giới hạn theo phòng ban.
- Người dùng Role Manager trở lên có mục **Phòng ban / chức vụ** để thêm, sửa và xóa danh mục. Mục đang được tài khoản hoặc quyền truy cập sử dụng không thể xóa; đổi tên sẽ cập nhật các tài khoản và quyền liên quan.
- Hệ thống khởi tạo một lần các phòng ban Ban Giám Đốc, Ban Kỹ thuật, Kinh Doanh, Dự án, Kế toán cùng chức vụ tương ứng; chức vụ chọn trong hồ sơ tài khoản được lọc theo phòng ban.
- Có thể liên kết tệp trong kho hoặc tải tệp mới trực tiếp vào nhóm tài liệu. Manager mới được xóa mục, ảnh hoặc liên kết.

### Quản trị tài khoản và nhật ký

Quản trị viên mở **Quản lý tài khoản** để tạo/sửa người dùng, đặt mật khẩu, gán vai trò/phòng ban/chức vụ và bật/tắt tài khoản. Mật khẩu tài khoản tối thiểu 12 ký tự. Thư mục cá nhân được tạo tự động. Không thể tự vô hiệu hóa tài khoản đang dùng hoặc vô hiệu hóa quản trị viên hoạt động cuối cùng.

Mở **Nhật ký hoạt động** để xem thao tác đã ghi, làm mới hoặc tải thêm. Nên cấp tài khoản riêng cho từng người dùng để nhật ký phản ánh đúng người thực hiện.

## 3. Triển khai Linux với PostgreSQL cài riêng

Ví dụ dưới đây dùng Debian/Ubuntu, thư mục /opt/ifc-doc, user dịch vụ ifcdoc, PostgreSQL cùng máy và Node lắng nghe cổng 6587. Với distro khác, thay lệnh cài đặt tương ứng.

### Yêu cầu

- Node.js 20+, npm, Git, PostgreSQL, PM2.
- LibreOffice Writer/Calc/Impress nếu cần xem trước Office.
- DNS và domain nếu triển khai HTTPS công khai.
- Firewall chỉ mở SSH và cổng web 80/443; không mở PostgreSQL ra Internet.

Cài PostgreSQL, Git và LibreOffice:

~~~bash
sudo apt update
sudo apt install -y git postgresql postgresql-contrib libreoffice-writer libreoffice-calc libreoffice-impress
node --version
npm --version
~~~

Cài Node.js 20+ từ nguồn quản trị gói phù hợp. Tạo user chạy dịch vụ (không chạy ứng dụng bằng root):

~~~bash
sudo adduser --system --group --home /opt/ifc-doc ifcdoc
sudo mkdir -p /opt/ifc-doc
sudo chown -R ifcdoc:ifcdoc /opt/ifc-doc
sudo -iu ifcdoc
npm install -g pm2
~~~

### Tạo PostgreSQL role và database

~~~bash
sudo -u postgres psql
~~~

Trong psql, thay mật khẩu mẫu bằng chuỗi riêng, mạnh:

~~~sql
CREATE ROLE docvault LOGIN PASSWORD 'THAY_BANG_MAT_KHAU_DAI_NGAU_NHIEN';
CREATE DATABASE docvault OWNER docvault ENCODING 'UTF8';
\q
~~~

Kiểm tra kết nối:

~~~bash
psql 'postgres://docvault:MAT_KHAU@127.0.0.1:5432/docvault' -c 'SELECT version();'
~~~

Nếu database ở máy khác, chỉ cho phép IP app server kết nối; cấu hình listen_addresses, pg_hba.conf, firewall và TLS phù hợp. Không mở cổng 5432 công khai.

### Tải mã nguồn và cấu hình môi trường

~~~bash
cd /opt/ifc-doc
git clone https://github.com/longct0810/docvault-online.git .
npm ci --omit=dev
cp .env.example .env
openssl rand -base64 48
~~~

Dán một giá trị ngẫu nhiên vào JWT_SECRET rồi sửa .env:

~~~dotenv
PORT=6587
COOKIE_SECURE=auto
DATABASE_URL=postgres://docvault:MAT_KHAU_POSTGRES@127.0.0.1:5432/docvault
JWT_SECRET=CHUOI_NGAU_NHIEN_DAI_IT_NHAT_32_KY_TU
ADMIN_USERNAME=admin
ADMIN_PASSWORD=MAT_KHAU_QUAN_TRI_TU_12_KY_TU_TRO_LEN
MAX_FILE_SIZE_MB=100
STORAGE_DIR=/opt/ifc-doc/storage
~~~

Thay mật khẩu và bí mật bằng giá trị thật. Không commit .env vào Git:

~~~bash
chmod 600 .env
mkdir -p /opt/ifc-doc/storage
~~~

### Restore database từ file dump đi kèm

Repository có dump định dạng PostgreSQL custom tại **deploy/IFC_Doc_database_20261118.dump**. Restore dump này vào database mới/rỗng sau khi clone project. Không chạy lệnh với database đang có dữ liệu cần giữ.

~~~bash
cd /opt/ifc-doc
sudo -u postgres pg_restore \
  --no-owner \
  --no-privileges \
  --role=docvault \
  --exit-on-error \
  --dbname=docvault \
  /opt/ifc-doc/deploy/IFC_Doc_database_20261118.dump
~~~

Nếu gặp lỗi thiếu extension hoặc role, xem thông báo cụ thể và cài extension/tạo role mà dump yêu cầu trước khi chạy lại. Không thêm `--clean` khi chưa chủ động xác nhận muốn xóa đối tượng hiện có. Lệnh này nạp cấu trúc và dữ liệu trong dump; ứng dụng sẽ tiếp tục chạy bước khởi tạo/cập nhật schema khi khởi động.

DATABASE_URL phải trỏ tới PostgreSQL độc lập. DB_PASSWORD chỉ cần khi dùng PostgreSQL trong Docker Compose. Với PM2, ecosystem.config.js lấy PORT làm cổng app (mặc định 3000); HOST_PORT chủ yếu dành cho Docker Compose. Vì vậy ví dụ này đặt PORT=6587.

### Khởi tạo tài khoản quản trị và chạy PM2

Sau khi restore dump, chạy ứng dụng sẽ tự khởi tạo/cập nhật schema cần thiết. Tạo hoặc đồng bộ tài khoản quản trị từ cấu hình .env:

~~~bash
node src/init-admin.js
~~~

Chạy lệnh này sẽ đặt lại mật khẩu admin có tên trùng ADMIN_USERNAME. Sau đó khởi chạy app:

~~~bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs IFC_Doc
pm2 save
pm2 startup
~~~

PM2 sẽ in lệnh cần chạy với sudo để bật khởi động cùng Linux. Thực thi lệnh đó, sau đó chạy lại pm2 save với user ifcdoc. Kiểm tra app:

~~~bash
curl -I http://127.0.0.1:6587
~~~

App bind 0.0.0.0; nên cấu hình firewall chặn truy cập Internet trực tiếp vào cổng app và chỉ cho proxy nội bộ truy cập.

### Cấu hình HTTPS bằng Caddy

Trỏ DNS A (và AAAA nếu có) về máy chủ, mở TCP 80/443, rồi cài Caddy theo tài liệu chính thức của distro. Ví dụ /etc/caddy/Caddyfile:

~~~caddy
docs.example.com {
    reverse_proxy 127.0.0.1:6587
}
~~~

Thay domain, kiểm tra và nạp lại:

~~~bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
~~~

Truy cập https://docs.example.com. Caddy tự lấy và gia hạn TLS khi DNS đúng và máy chủ nhận được kết nối ở cổng 80/443. COOKIE_SECURE=auto bật Secure cho cookie qua HTTPS. Cấu hình app hiện chỉ tin header HTTPS từ proxy loopback cùng máy.

### Thay thế: Nginx

Có thể dùng Nginx nếu đã có chứng chỉ TLS và quy trình vận hành. Chỉnh domain và đường dẫn chứng chỉ:

~~~nginx
server {
    listen 443 ssl;
    server_name docs.example.com;
    ssl_certificate /etc/letsencrypt/live/docs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docs.example.com/privkey.pem;
    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:6587;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
~~~

client_max_body_size phải bằng hoặc lớn hơn MAX_FILE_SIZE_MB. Cần cấu hình thêm server cổng 80 để chuyển hướng HTTPS và thực hiện gia hạn chứng chỉ. App hiện chỉ tin proxy loopback; nếu Nginx chạy trên máy khác, cần điều chỉnh cấu hình trust proxy trong ứng dụng trước khi dùng COOKIE_SECURE=auto.

## 4. Triển khai Docker Compose

Repository cũng có Docker Compose để chạy ứng dụng cùng PostgreSQL 16. Dùng phương án này thay cho cài PostgreSQL riêng, không cấu hình cả hai cách cùng sử dụng một database.

1. Tạo .env. Đặt DB_PASSWORD mạnh và DATABASE_URL dạng postgres://docvault:MAT_KHAU@db:5432/docvault, hai mật khẩu phải khớp.
2. Đặt HOST_PORT=6587 nếu muốn app phục vụ qua loopback cổng 6587. Compose chỉ bind app tại 127.0.0.1; database cũng bind host loopback cổng 5433.
3. Khởi động:

~~~bash
docker compose up -d --build
docker compose logs -f app
~~~

4. Tạo admin trong container:

~~~bash
docker compose exec app node src/init-admin.js
~~~

5. Cấu hình Caddy/Nginx reverse proxy đến 127.0.0.1:6587.

Compose dùng volume ./storage để lưu tệp và named volume postgres_data cho database. Nếu chạy Node bằng PM2 nhưng PostgreSQL bằng Compose, ecosystem.config.js tự chuyển DATABASE_URL host db:5432 thành 127.0.0.1:5433.

## 5. Cập nhật và sao lưu

### Cập nhật

Sao lưu trước khi cập nhật. Với PM2:

~~~bash
cd /opt/ifc-doc
git pull --ff-only
npm ci --omit=dev
pm2 restart IFC_Doc
pm2 logs IFC_Doc --lines 100
~~~

Schema tương thích được cập nhật khi app khởi động. Với Docker Compose, chạy docker compose up -d --build. Không xóa storage hoặc volume PostgreSQL khi cập nhật.

### Sao lưu và khôi phục

Để có bản sao nhất quán, tạm ngưng ghi dữ liệu trong lúc sao lưu. Lưu database và storage cùng mốc thời gian, ngoài thư mục project:

~~~bash
sudo -u postgres pg_dump -Fc -d docvault > /backup/docvault-$(date +%F).dump
tar -czf /backup/ifc-doc-storage-$(date +%F).tar.gz -C /opt/ifc-doc storage
~~~

Database chứa ánh xạ metadata đến tên file nội bộ; chỉ sao lưu một trong hai phần sẽ không phục hồi đầy đủ.

Khôi phục vào database rỗng và thư mục storage đúng đường dẫn:

~~~bash
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=docvault -d docvault /backup/docvault-YYYY-MM-DD.dump
~~~

Đặt đúng owner/quyền cho storage, kiểm tra DATABASE_URL, khởi động app rồi xác nhận đăng nhập, mở và tải tệp.

## 6. Xử lý lỗi thường gặp

| Lỗi | Kiểm tra |
|---|---|
| App không khởi động | pm2 logs IFC_Doc; Node 20+, JWT_SECRET >= 32 ký tự, DATABASE_URL và trạng thái PostgreSQL. |
| Không kết nối DB | Thử psql với cùng DATABASE_URL; kiểm tra user, mật khẩu, tên DB, listen_addresses và pg_hba.conf. |
| Không đăng nhập được | Kiểm tra tài khoản còn hoạt động; chạy node src/init-admin.js để đặt lại admin theo .env. |
| Upload bị từ chối do dung lượng | Tăng MAX_FILE_SIZE_MB và giới hạn body ở reverse proxy; khởi động lại app. |
| Office không xem trước được | Cài LibreOffice Writer/Calc/Impress; kiểm tra user dịch vụ chạy được libreoffice --version và xem log PM2. |
| Tệp thiếu sau khôi phục | Khôi phục database và storage cùng mốc backup; kiểm tra quyền đọc/ghi của user dịch vụ. |
| Cookie không duy trì qua HTTPS | Dùng HTTPS qua proxy cùng máy, giữ COOKIE_SECURE=auto và kiểm tra chuyển tiếp scheme. |

## 7. Lưu ý an toàn

- Dùng HTTPS trước khi công khai. HTTP không mã hóa mật khẩu và cookie phiên.
- Không mở PostgreSQL ra Internet; giới hạn quyền kết nối theo IP.
- Chạy ứng dụng bằng user riêng, không phải root; bảo vệ .env và thư mục storage.
- Đổi toàn bộ mật khẩu mẫu, giữ JWT_SECRET ngẫu nhiên và không commit bí mật.
- Sao lưu database cùng storage và kiểm tra khôi phục định kỳ.
- Cân nhắc kỹ trước khi cấp Manager rộng rãi vì xóa không thể hoàn tác.

## 8. Tham chiếu mã nguồn

Repository: https://github.com/longct0810/docvault-online

- .env.example — biến môi trường
- src/db.js — khởi tạo database/schema
- src/init-admin.js — tạo hoặc đặt lại tài khoản quản trị
- ecosystem.config.js — cấu hình PM2
- deploy/Caddyfile.example — reverse proxy Caddy
- Dockerfile, docker-compose.yml — cách chạy bằng Docker
