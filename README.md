# Con Đường Hướng Thiện (CDKT)

Cổng thông tin điện tử hỗ trợ người hoàn lương tái hòa nhập cộng đồng — Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.

## Tech Stack

- **Frontend**: Nuxt 4 (Vue 3, TypeScript, Composition API), Tailwind CSS v3, FontAwesome 6 Pro
- **Backend**: Nitro / H3, Drizzle ORM, MySQL 8.0, JWT Auth
- **Deploy**: Docker Compose (multi-stage build, Node 22)

## Quick Start (Development)

```bash
npm install
npm run dev
```

Yêu cầu: Node.js ≥ 22.19, MySQL 8.0 running locally.

## Production Deploy

Xem [DEPLOY.md](./DEPLOY.md) để triển khai VPS với Docker, và [CI-CD.md](./CI-CD.md) để
tự động deploy mỗi lần merge vào `main` (GitHub Actions → GHCR → VPS).

**Không cần cài Node.js trên VPS** — Docker multi-stage build tự dùng Node 22 bên trong container.

## Database

- **Auto Init**: `server/db/init.ts` tạo toàn bộ bảng nếu chưa tồn tại
- **Auto Seed**: `server/db/seed.ts` tạo data mặc định (idempotent, không ghi đè data đã có)
- **Full Dump**: `migrations/full_dump.sql` — dump đầy đủ schema + data để import nhanh trên server mới

### Import dump thay vì auto-init

```bash
docker exec -i cdkt_mysql mysql -u root -p<PASSWORD> cdkt_admin < migrations/full_dump.sql
docker restart cdkt_app
```

### Backup & Restore

```bash
# Backup
docker exec cdkt_mysql mysqldump -u root -p<PASSWORD> cdkt_admin > backup_$(date +%Y%m%d).sql

# Restore
docker exec -i cdkt_mysql mysql -u root -p<PASSWORD> cdkt_admin < backup.sql
```

### Chuyển máy chủ

```bash
# Máy cũ
docker exec cdkt_mysql mysqldump -u root -p<PASSWORD> cdkt_admin > backup.sql
docker cp cdkt_app:/app/public/uploads ./uploads_backup
scp backup.sql uploads_backup root@ip-moi:/path/

# Máy mới (sau docker compose up)
docker exec -i cdkt_mysql mysql -u root -p<PASSWORD> cdkt_admin < backup.sql
docker cp uploads_backup/. cdkt_app:/app/public/uploads/
```

## Admin Panel

- URL: `/admin`
- Tài khoản mặc định: `admin` / `Admin@123456`
- **Đổi mật khẩu ngay sau lần đăng nhập đầu tiên!**

## Environment Variables

Xem `.env.example` để biết tất cả biến cấu hình. Các biến bắt buộc trên production:

| Biến | Mô tả |
|------|-------|
| `MYSQL_ROOT_PASSWORD` | Mật khẩu root MySQL |
| `JWT_SECRET` | Secret key cho JWT token |
| `ANALYTICS_HMAC_SECRET` | HMAC secret (≥32 ký tự) |
| `CHATBOT_ENCRYPTION_SECRET` | Mã hóa lịch sử chat |

## License

Private — All rights reserved.
