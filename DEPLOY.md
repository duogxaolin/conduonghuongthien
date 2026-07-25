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

# (Tùy chọn) AI Chatbot — bỏ comment để bật
# AI_API_KEY=sk-xxxx
# AI_BASE_URL=https://api.openai.com/v1
# AI_MODEL=gpt-4o-mini
EOF

echo "✅ .env đã tạo xong. Mật khẩu MySQL root:"
grep MYSQL_ROOT_PASSWORD .env
```

> Lưu lại mật khẩu — cần khi kết nối DB từ bên ngoài (`localhost:33069`).

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

## Bước 4: Import Database

### Cách A: Import full dump (khuyến nghị — có sẵn data mẫu)

```bash
# Chờ MySQL sẵn sàng
sleep 30

# Import full dump (schema + data)
docker exec -i cdkt_mysql mysql -u root -p$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2) cdkt_admin < migrations/full_dump.sql

# Restart app để nhận DB mới
docker restart cdkt_app
```

### Cách B: Để app tự tạo (DB trống, chỉ có seed mặc định)

Không cần làm gì — app tự chạy `init.ts` + `seed.ts` khi start.

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
docker compose build --no-cache
docker compose up -d
```

> Database **không bị mất** khi update — volume `mysql_data` persist giữa các lần rebuild.
> Chỉ mất khi chạy `docker compose down -v` hoặc `docker volume rm`.

---

## Backup & Restore

```bash
# Backup
docker exec cdkt_mysql mysqldump -u root -p$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2) cdkt_admin > backup_$(date +%Y%m%d).sql

# Restore
docker exec -i cdkt_mysql mysql -u root -p$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2) cdkt_admin < backup.sql
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
| `Unknown column` errors | Import lại dump: xem Bước 4 Cách A |
| Git "dubious ownership" | `git config --global --add safe.directory /path/to/repo` |
