# 🚀 Hướng Dẫn Deploy VPS (Docker)

## Yêu cầu VPS

- **OS**: Ubuntu 22.04+ / Debian 12+ / CentOS 9
- **RAM**: tối thiểu 1 GB (khuyến nghị 2 GB)
- **Docker**: Docker Engine 24+ & Docker Compose v2+
- **Node.js**: KHÔNG cần cài — Docker multi-stage build dùng Node 22 bên trong

---

## Bước 1: Cài Docker (nếu chưa có)

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Đăng xuất & đăng nhập lại để group có hiệu lực
```

---

## Bước 2: Clone repo & cấu hình

```bash
git clone https://github.com/duogxaolin/conduonghuongthien.git cdkt
cd cdkt
```

### Tạo file `.env` (tự sinh mật khẩu mạnh + secret keys)

```bash
cat > .env << EOF
# ─── MySQL ───────────────────────────────────────
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
MYSQL_DATABASE=cdkt_admin
MYSQL_USER=cdkt_user
MYSQL_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
MYSQL_EXTERNAL_PORT=33069

# ─── App ─────────────────────────────────────────
PORT=54432
NODE_ENV=production

# JWT & Encryption (auto-generated)
JWT_SECRET=$(openssl rand -base64 48)
CHATBOT_ENCRYPTION_SECRET=$(openssl rand -base64 32)

# Analytics
ANALYTICS_HMAC_SECRET=$(openssl rand -base64 48)
ANALYTICS_COLLECTION_ENABLED=true
NUXT_ANALYTICS_COLLECTION_ENABLED=true

# Tài khoản quản trị đầu tiên — CHỈ dùng khi tạo tài khoản lần đầu.
# Seed là insert-only nên các lần chạy sau KHÔNG ghi đè mật khẩu đã đổi.
# KHÔNG được chứa chuỗi "admin" (tên đăng nhập). Dùng lệnh sinh dưới đây thay vì
# tự đặt: build sẽ dừng ngay nếu mật khẩu không đạt chính sách.
ADMIN_PASSWORD=$(openssl rand -base64 18)
ADMIN_EMAIL=admin@conduonghuongthien.com.vn

# (Tùy chọn) AI Chatbot — bỏ comment để bật
# AI_API_KEY=sk-xxxx
# AI_BASE_URL=https://api.openai.com/v1
# AI_MODEL=gpt-4o-mini
EOF

echo "✅ .env đã tạo xong."
echo "MySQL root: $(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)"
echo "Mật khẩu admin lần đầu: $(grep ADMIN_PASSWORD .env | cut -d= -f2)"
```

### Tuỳ chọn tài nguyên & độ bền (thêm vào `.env` nếu cần)

```env
# Giới hạn RAM container. MySQL tự dò giới hạn này (cgroup) để tính buffer pool,
# nên đặt đúng sẽ tránh bị OOM-kill trên VPS nhỏ.
MYSQL_MEM_LIMIT=1g
APP_MEM_LIMIT=1g

# strict = full ACID (chậm hơn, không mất giao dịch khi máy chủ mất điện)
# mặc định (fast) = có thể mất ~1 giây giao dịch cuối nếu HOST sập
MYSQL_DURABILITY=fast
```

> ⚠️ **Bắt buộc**: `docker compose` sẽ **báo lỗi và dừng** nếu thiếu `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `JWT_SECRET`, `CHATBOT_ENCRYPTION_SECRET` hoặc `ANALYTICS_HMAC_SECRET`. Đây là chủ đích — để không bao giờ chạy production bằng khóa mặc định công khai.

> Lưu lại mật khẩu — cần khi kết nối DB từ bên ngoài (`localhost:33069`).

---

## Bước 2b: Tự chủ webfont (khuyến nghị, làm 1 lần)

Mặc định trang tải font Inter từ `fonts.googleapis.com`. Với cổng thông tin của
Bộ Công an, điều đó có nghĩa là IP của mọi người truy cập đều đi qua một bên thứ
ba, và chữ sẽ vỡ bố cục khi mạng chặn hoặc chậm tới CDN đó.

Chạy **một lần trên máy có Internet** (trước khi build):

```bash
node scripts/fetch-fonts.mjs
```

Script tải các tệp `.woff2` về `public/assets/fonts/` và sinh `inter.css`.
`nuxt.config.ts` tự phát hiện tệp này lúc build và **ngừng phát ra thẻ `<link>`
tới Google** — không cần sửa cấu hình. Muốn quay lại CDN thì xóa thư mục
`public/assets/fonts/` rồi build lại.

> Nếu bỏ qua bước này, trang vẫn chạy bình thường bằng CDN.

---

## Bước 3: Build & Chạy

```bash
docker compose build --no-cache
docker compose up -d
```

Chờ ~60-90s (MySQL healthy + app start). Kiểm tra:

```bash
docker logs cdkt_app -f
```

Khi thấy `Listening on http://0.0.0.0:54432` → app sẵn sàng.

---

## Bước 4: Database

### Cách A: Để app tự khởi tạo (khuyến nghị cho cài mới)

**Không cần làm gì.** App tự chạy `init.ts` (tạo/hội tụ 27 bảng) + `seed.ts` (tài khoản, vai trò, trang hệ thống) mỗi lần khởi động. Cả hai **idempotent**: chạy lại không ghi đè mật khẩu, phân quyền hay cấu hình bạn đã sửa.

### Cách B: Import dump có sẵn dữ liệu mẫu

```bash
# Chờ MySQL healthy
docker compose ps mysql

# Dump có guard chống chạy nhầm — phải bật cờ mới thực thi
docker exec -i cdkt_mysql mysql -u root -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" \
  --init-command="SET @CDKT_ALLOW_DESTRUCTIVE_RESTORE=1" \
  "$(grep MYSQL_DATABASE .env | cut -d= -f2)" < migrations/full_dump.sql

docker restart cdkt_app
```

> ⚠️ Dump chứa lệnh `DROP TABLE` cho **toàn bộ** bảng — chỉ dùng cho cài mới hoặc khi cố ý ghi đè. Không có cờ `CDKT_ALLOW_DESTRUCTIVE_RESTORE=1`, script sẽ tự dừng.

### Cách C: Khôi phục từ bản sao lưu của bạn

```bash
docker exec -i cdkt_mysql mysql -u root -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" \
  "$(grep MYSQL_DATABASE .env | cut -d= -f2)" < backup.sql
docker restart cdkt_app
```

---

## Bước 4b: Nâng cấp từ image cũ (chỉ làm 1 lần)

Image mới chạy bằng user không đặc quyền (`node`). Volume upload tạo bởi image cũ vẫn thuộc `root`, cần chuyển quyền một lần — nếu bỏ qua, **tải ảnh lên sẽ lỗi**:

```bash
docker compose run --rm --user root app chown -R node:node /app/public/uploads
docker compose up -d
```

Cài mới hoàn toàn thì bỏ qua bước này.

---

## Bước 5: Reverse Proxy (HTTPS)

### Dùng Caddy (đơn giản nhất)

```bash
sudo apt install caddy
```

File `/etc/caddy/Caddyfile`:
```
yourdomain.com {
    reverse_proxy localhost:54432
}
```

```bash
sudo systemctl reload caddy
```

### Dùng Nginx

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:54432;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 20M;
    }
}
```

SSL: `sudo certbot --nginx -d yourdomain.com`

---

## Tài khoản Admin

| Thông tin | Giá trị |
|-----------|---------|
| URL | `https://domain/admin` |
| Username | `admin` |
| Password | Giá trị `ADMIN_PASSWORD` trong `.env` — **bắt buộc**, seed sẽ dừng nếu để trống hoặc quá yếu (tối thiểu 12 ký tự, đủ 3/4 nhóm) |

> ⚡ **Đổi mật khẩu ngay sau lần đăng nhập đầu tiên.** Hash của mật khẩu mặc định từng nằm trong file dump được commit lên GitHub, nên phải coi mật khẩu mặc định là **đã lộ công khai**.

---

## Bảo trì định kỳ (BẮT BUỘC)

Tác vụ dọn dữ liệu analytics **không tự chạy**. Không đặt cron thì bảng `analytics_page_view_events` phình vô hạn cho tới khi đầy đĩa.

```bash
# Thêm vào crontab của host (chạy 3h sáng mỗi ngày)
0 3 * * * cd /path/to/cdkt && docker compose exec -T app npm run analytics:maintenance >> /var/log/cdkt-analytics.log 2>&1
```

Chạy thủ công để kiểm tra:

```bash
docker compose exec app npm run analytics:maintenance
```

---

## Kiểm tra sức khỏe hệ thống

```bash
# Trạng thái healthcheck của container
docker inspect --format '{{.State.Health.Status}}' cdkt_app

# Chạy bộ kiểm thử (trên máy dev, không cần cài thêm gói)
npm test

# Đối chiếu schema.ts với init.ts (phát hiện lệch schema)
npm run db:drift
```

---

## Cập nhật code

```bash
cd cdkt
git pull origin main
docker compose build --no-cache
docker compose up -d
```

> Database **không bị mất** khi update — volume `mysql_data` persist giữa các lần rebuild.
> Chỉ mất khi chạy `docker compose down -v` hoặc `docker volume rm`.

---

## Backup & Restore

### Sao lưu tự động (BẮT BUỘC)

`scripts/backup-db.sh` dump CSDL, nén, **kiểm chứng** rồi xoay vòng. Kiểm chứng là
phần quan trọng nhất: một bản dump đứt giữa chừng trông y hệt bản tốt cho tới ngày
anh cần dùng. Script kiểm dấu `Dump completed` ở cuối tệp, đếm số bảng, đo dung
lượng SQL sau giải nén — thiếu bất kỳ điều kiện nào thì **xoá bản hỏng** và thoát
với mã lỗi khác 0 để cron báo về.

```bash
# Chạy thử một lần
./scripts/backup-db.sh

# Thêm vào crontab của host — 2h sáng mỗi ngày
0 2 * * * cd /path/to/CDKT && ./scripts/backup-db.sh >> /var/log/cdkt-backup.log 2>&1
```

Tuỳ chọn trong `.env`: `BACKUP_DIR` (mặc định `./backups`), `BACKUP_KEEP_DAYS`
(mặc định 14).

### Kiểm chứng khôi phục (nên làm hàng tháng)

Bản sao lưu chưa từng được khôi phục chỉ là một giả thuyết. Script dưới đây nạp
dump vào một CSDL tạm trong cùng container, đếm bảng và bản ghi, rồi **xoá CSDL
tạm** — không đụng tới dữ liệu đang chạy.

```bash
./scripts/verify-restore.sh backups/cdkt-cdkt_admin-20260726T020000Z-1234.sql.gz
```

### Khôi phục thật (khi có sự cố)

```bash
gzip -dc backups/<tệp>.sql.gz | \
  docker exec -i -e MYSQL_PWD="$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)" \
  cdkt_mysql mysql -u root --default-character-set=utf8mb4 cdkt_admin
```

---

## Chuyển máy chủ

```bash
# ─── Máy cũ ─────────────────────────────────────
docker exec cdkt_mysql mysqldump -u root -p$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2) cdkt_admin > backup.sql
docker cp cdkt_app:/app/public/uploads ./uploads_backup
scp backup.sql uploads_backup .env root@ip-may-moi:/path/to/cdkt/

# ─── Máy mới (sau khi clone + docker compose up) ─
docker exec -i cdkt_mysql mysql -u root -p$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2) cdkt_admin < backup.sql
docker cp uploads_backup/. cdkt_app:/app/public/uploads/
docker restart cdkt_app
```

---

## Troubleshooting

| Vấn đề | Giải pháp |
|--------|-----------|
| `Access denied` khi start | Xóa volume cũ: `docker compose down && docker volume rm conduonghuongthien_mysql_data && docker compose up -d` |
| App không start | `docker logs cdkt_app` — kiểm tra lỗi |
| MySQL refuse connection | Chờ healthy: `docker exec cdkt_mysql mysqladmin ping -u root -p<PW>` |
| Upload ảnh lỗi | Kiểm tra volume: `docker volume inspect conduonghuongthien_uploads_data` |
| Port conflict | Đổi `PORT=` trong `.env` rồi `docker compose up -d` |
| Docker build dùng cache cũ | `docker compose build --no-cache` |
| `Unknown column` errors | `docker restart cdkt_app` — `init.ts` tự thêm cột còn thiếu |
| Upload ảnh lỗi sau khi nâng cấp | Chuyển quyền volume: xem **Bước 4b** |
| App từ chối khởi động, log báo thiếu secret | Bổ sung secret còn thiếu vào `.env` (xem Bước 2) |
| Build dừng: `ADMIN_PASSWORD ... không đạt chính sách mật khẩu` | Đặt lại `ADMIN_PASSWORD` trong `.env`: `openssl rand -base64 18`. Thường gặp nhất là mật khẩu chứa chuỗi `admin` (ví dụ `Admin@...`) — bị chặn vì đó là tên đăng nhập. Kiểm tra riêng bằng `npm run check:admin-password` |
| Git "dubious ownership" | `git config --global --add safe.directory /path/to/repo` |
