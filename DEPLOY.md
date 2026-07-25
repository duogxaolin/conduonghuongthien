# 🚀 Hướng Dẫn Deploy VPS (Docker)

## Yêu cầu VPS

- **OS**: Ubuntu 22.04+ / Debian 12+ / CentOS 9
- **RAM**: tối thiểu 1 GB (khuyến nghị 2 GB)
- **Docker**: Docker Engine 24+ & Docker Compose v2+
- **Port**: 3000 (app) — hoặc dùng reverse proxy (Nginx/Caddy) để map 80/443

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

### Tạo file `.env` (production)

```bash
cat > .env << 'EOF'
# ─── MySQL ───────────────────────────────────────
MYSQL_ROOT_PASSWORD=ThayDoiMatKhauRoot123!
MYSQL_DATABASE=cdkt_admin
MYSQL_USER=cdkt_user
MYSQL_PASSWORD=ThayDoiMatKhauUser456!
MYSQL_EXTERNAL_PORT=33069

# ─── App ─────────────────────────────────────────
PORT=54432
NODE_ENV=production

# DB_HOST & DB_PORT: kết nối nội bộ Docker network
# DB_HOST=mysql (tên service), DB_PORT=3306 (port trong container, KHÔNG đổi)
# Biến này KHÔNG cần khai báo — docker-compose.yml đã set cứng đúng giá trị.

# JWT Secret (tạo random: openssl rand -base64 48)
JWT_SECRET=thay-bang-chuoi-random-dai-64-ky-tu

# Chatbot encryption (tạo: openssl rand -base64 32)
CHATBOT_ENCRYPTION_SECRET=thay-bang-chuoi-random-base64-32-byte

# Analytics
ANALYTICS_COLLECTION_ENABLED=true
NUXT_ANALYTICS_COLLECTION_ENABLED=true

# (Tùy chọn) AI Chatbot
# AI_API_KEY=sk-xxxx
# AI_BASE_URL=https://api.openai.com/v1
# AI_MODEL=gpt-4o-mini
EOF
```

> ⚠️ **QUAN TRỌNG**: Đổi tất cả mật khẩu & secret key trước khi deploy production!

---

## Bước 3: Build & Chạy

`docker-compose.yml` đã tự đọc biến từ `.env` — không cần sửa gì thêm.

```bash
# Build app (Nuxt production build)
npm install
npx nuxi build

# Khởi động Docker
docker compose up --build -d

# Kiểm tra logs
docker logs cdkt_app -f
```

Khi thấy `Listening on http://0.0.0.0:54432` → app đã sẵn sàng.

App tự động chạy `init.ts` (tạo bảng) + `seed.ts` (tạo data mặc định) mỗi lần start.

---

## Bước 4 (Tùy chọn): Import SQL Migration thủ công

Nếu muốn import schema + data đầy đủ (thay vì dùng auto-init/seed):

```bash
# Chờ MySQL healthy
docker exec cdkt_mysql mysqladmin ping -u root -p$MYSQL_ROOT_PASSWORD --wait=30

# Import schema
docker exec -i cdkt_mysql mysql -u root -p$MYSQL_ROOT_PASSWORD cdkt_admin < migrations/001_full_schema.sql

# Import seed data
docker exec -i cdkt_mysql mysql -u root -p$MYSQL_ROOT_PASSWORD cdkt_admin < migrations/002_seed_data.sql
```

---

## Bước 5: Reverse Proxy (HTTPS)

### Dùng Caddy (đơn giản nhất)

```bash
sudo apt install caddy
```

File `/etc/caddy/Caddyfile`:
```
conduonghuongthien.com.vn {
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
    server_name conduonghuongthien.com.vn;

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

Cài SSL: `sudo certbot --nginx -d conduonghuongthien.com.vn`

---

## Tài khoản Admin mặc định

| Thông tin | Giá trị |
|-----------|---------|
| URL | `https://domain/admin` |
| Username | `admin` |
| Password | `Admin@123456` |

> ⚡ Đổi mật khẩu ngay sau lần đăng nhập đầu tiên!

---

## Cập nhật code

```bash
cd cdkt
git pull origin main
npm install
npx nuxi build
docker compose up --build -d
```

---

## Backup Database

```bash
# Backup
docker exec cdkt_mysql mysqldump -u root -p$MYSQL_ROOT_PASSWORD cdkt_admin > backup_$(date +%Y%m%d).sql

# Restore
docker exec -i cdkt_mysql mysql -u root -p$MYSQL_ROOT_PASSWORD cdkt_admin < backup_20260725.sql
```

---

## Troubleshooting

| Vấn đề | Giải pháp |
|--------|-----------|
| App không start | `docker logs cdkt_app` — kiểm tra lỗi kết nối DB |
| MySQL refuse connection | Kiểm tra healthcheck: `docker inspect cdkt_mysql` |
| Upload ảnh lỗi | Volume mount: `docker volume inspect cdkt_uploads_data` |
| Port conflict | Đổi port mapping: `"8080:3000"` trong compose |
