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

## Livestream & live chat — one replica only

The live chat keeps its registry of open SSE streams **in process memory**
(`server/utils/sse-manager.ts`). That is what makes the slow-reader bound and the
shutdown broadcast cheap, and it is also the constraint: a reader connected to
instance A never receives a message published on instance B. The only symptom is
"chat works, sometimes" — no error, no log line, and it only shows up once enough
people are watching.

The pin is in two places, and both are needed:

- `container_name: cdkt_app` in `docker-compose.yml`. Compose refuses a second
  container with the same name, so `docker compose up --scale app=2` fails rather
  than silently starting a second instance.
- `CDKT_SSE_REPLICA_GUARD=1`, a declaration by the operator that they have checked
  by whatever other route they deploy with. It does nothing on its own; it only
  silences the boot-time warning from `server/plugins/livestream-replica-guard.ts`.
  Leaving it unset in production logs a warning on every start.

Multi-replica needs a pub/sub backplane (Redis) so that a message published on one
instance reaches the streams held by the others. That is **out of scope** for this
version.

**Nginx** must disable proxy buffering and caching for the stream location and
raise the read timeout, or the stream is buffered and readers see messages in
bursts or not at all:

```nginx
location /api/public/livestream/chat/stream {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
}
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
