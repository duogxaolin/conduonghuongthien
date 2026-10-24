# 🚀 Hướng Dẫn Deploy VPS (Docker)

## Yêu cầu VPS

- **OS**: Ubuntu 22.04+ / Debian 12+ / CentOS 9
- **RAM**: tối thiểu 1 GB (khuyến nghị 2 GB)
- **Docker**: Docker Engine 24+ & Docker Compose v2+
- **systemd-journald** (có sẵn trên các bản phân phối trên): log app ghi vào journald
  (`journalctl CONTAINER_TAG=cdkt-app`) để còn sau mỗi lượt deploy. Không có journald thì
  deploy (CI hoặc `manage.sh`) tự lùi về `json-file` qua `docker-compose.override.yml` —
  xem `production/README.md` § *Log của app*. Bản tay: tự tạo override đó trước `up`.
- **Node.js**: KHÔNG cần cài — Docker multi-stage build dùng Node 24 LTS bên trong

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
# .env giữ mọi bí mật: chỉ chủ tệp được đọc (600). Tạo rỗng với quyền đó TRƯỚC khi ghi.
install -m 600 /dev/null .env
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
# Log của các container app TRƯỚC (đã bị thay ở lượt deploy trước) — chỉ journald còn giữ:
journalctl CONTAINER_TAG=cdkt-app --since today
```

Khi thấy `Listening on http://0.0.0.0:54432` → app sẵn sàng.

---

## Bước 4: Database

### Cách A: Để app tự khởi tạo (khuyến nghị cho cài mới)

**Không cần làm gì.** App tự chạy `init.ts` (tạo/hội tụ 27 bảng) + `seed.ts` (tài khoản, vai trò, trang hệ thống) mỗi lần khởi động. Cả hai **idempotent**: chạy lại không ghi đè mật khẩu, phân quyền hay cấu hình bạn đã sửa.

### Cách B: Khôi phục từ bản sao lưu của bạn

Bản sao lưu do `scripts/backup-db.sh` tạo (`.sql.gz`) thì dùng `scripts/restore-db.sh`
— xem **Backup & Restore** bên dưới (kiểm tra bản dump, dump bản hiện có trước khi ghi đè).
Với một tệp `.sql` thường:

```bash
# Mật khẩu root đi qua biến môi trường (-e MYSQL_PWD không kèm giá trị), KHÔNG nằm
# trên dòng lệnh — `-p<mật-khẩu>` hiện ra trong `ps` cho mọi người dùng trên máy chủ.
docker compose stop app
set -a; . ./.env; set +a
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" docker exec -i -e MYSQL_PWD cdkt_mysql \
  mysql -u root "$MYSQL_DATABASE" < backup.sql
docker compose up -d --no-deps app
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

    # ── Tải video lên theo phần (Media Portal) ────────────────────────────
    # `location` dài nhất thắng, nên khối này đứng trước `location /` bên dưới
    # mà không cần thứ tự đặc biệt — nhưng để nó ở trên cho người đọc thấy ngay.
    #
    # 12g chứ không 10g: một phần tải lên là multipart, nên phần thân request
    # lớn hơn phần dữ liệu thật. Để đúng bằng trần của ứng dụng
    # (`MEDIA_UPLOAD_MAX_SIZE`, mặc định 10 GB) thì nginx từ chối đúng những
    # phần mà ứng dụng sẵn sàng nhận — và nó từ chối bằng 413, trước khi ứng
    # dụng kịp thấy request, nên không có log nào phía cổng giải thích.
    #
    # Trần ở đây áp cho TOÀN BỘ khối `location`, không riêng lượt tải video;
    # `client_max_body_size` trong `location /` vẫn là 20M cho phần còn lại.
    location /api/admin/media-portal/ {
        proxy_pass http://127.0.0.1:54432;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 12g;
        # Một phần 10 GB qua đường truyền chậm lâu hơn 60 giây mặc định rất
        # nhiều; hết hạn giữa lượt ghi làm phần đó hỏng mà client chỉ thấy
        # "mất kết nối".
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # ── Luồng SSE của chat trực tiếp ──────────────────────────────────────
    # `X-Accel-Buffering: no` đã do tầng ứng dụng đặt (`setEventStreamHeaders`
    # của h3), nên ở đây chỉ cần phần của nginx: đệm và cache.
    #
    # Đệm là thứ giết SSE: nginx gom bytes lại để nén/nối cho hiệu quả, nghĩa
    # là một tin nhắn chat nằm trong bộ đệm của proxy cho tới khi đầy hoặc tới
    # khi stream đóng — khách gõ xong, người kia không thấy gì. `proxy_cache off`
    # vì cùng lý do: một luồng được phục vụ lại từ cache là một cuộc trò chuyện
    # của người khác.
    #
    # `proxy_read_timeout 86400s` (24 giờ) vì kết nối này sống lâu hơn mọi mặc
    # định: một phiên chat đang mở là một request chưa kết thúc, và ngắt nó theo
    # lịch là đóng cuộc trò chuyện của khách mà không ai bấm gì.
    location /api/public/livestream/chat/stream {
        proxy_pass http://127.0.0.1:54432;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        client_max_body_size 20M;
    }

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

## Bảo trì định kỳ (tự chạy trong tiến trình; cron là tuỳ chọn)

Dọn/gộp analytics và dọn retention **tự chạy trong tiến trình app** ở production
(`server/plugins/analytics-scheduler.ts`, `retention-scheduler.ts` — bật khi
`NODE_ENV=production`, tắt bằng `ANALYTICS_SCHEDULER=0` / `RETENTION_SCHEDULER=0`).
Chỉ khi đặt `ANALYTICS_SCHEDULER=0` thì **bắt buộc** có cron dưới đây, nếu không bảng
`analytics_page_view_events` phình vô hạn. Giữ cron song song vẫn an toàn (khoá
`cdkt:analytics:maintenance`).

```bash
# Tuỳ chọn — thêm vào crontab của host (chạy 3h sáng mỗi ngày)
0 3 * * * cd /path/to/cdkt && docker compose exec -T app npm run analytics:maintenance >> /var/log/cdkt-analytics.log 2>&1
```

Chạy thủ công để kiểm tra:

```bash
docker compose exec app npm run analytics:maintenance
```

> Dòng crontab ở trên chạy theo giờ của **máy chủ (host)**, không theo giờ của
> container — host để UTC thì `0 3 * * *` là 10:00 sáng giờ Việt Nam. Lượt chạy
> trong tiến trình (scheduler) thì theo giờ của container, xem mục dưới.

---

## Múi giờ

Container **app** chạy giờ Việt Nam (`TZ=Asia/Ho_Chi_Minh` — đặt sẵn trong image
và ghi chữ cố định trong `docker-compose.yml`, kèm gói `tzdata`). Mã đọc giờ/ngày
địa phương ở nhiều chỗ: lượt bảo trì analytics và lượt dọn retention lúc 03:00,
lịch sao lưu tự động, đầu tháng của hạn mức chi phí AI. CI chạy toàn bộ bộ test ở
`TZ=Asia/Ho_Chi_Minh` vì đó là giờ của máy chủ thật.

Container **mysql** cố ý **giữ UTC** (`time_zone=SYSTEM`): `NOW()`/`CURRENT_TIMESTAMP`
đã ghi theo UTC từ đầu, và pool CSDL của app tự khai `timezone` tường minh nên không
phụ thuộc TZ của tiến trình. Đừng đặt `TZ` cho service mysql.

**Hiệu ứng một lần khi lên bản có dòng này** (trước đó container chạy UTC):

- Lượt "03:00" của analytics/retention dời từ 10:00 sáng giờ VN về đúng 03:00 sáng
  giờ VN. Đêm chuyển đổi có thể chạy hai lượt trong cùng một ngày lịch VN hoặc bỏ
  qua một đêm; nhánh "stale 36 giờ" của scheduler tự bù, không cần làm gì.
- Ranh giới tháng của hạn mức AI (`ai_budget`) lùi 7 giờ: tháng mới bắt đầu lúc
  00:00 giờ VN thay vì 07:00 giờ VN. Chi phí trong 7 giờ đầu tháng giờ được tính
  vào tháng mới.
- Ngày giờ do máy chủ dựng (SSR, tên tệp sao lưu, nhật ký `date` trong container)
  hiện theo giờ VN.

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

### Cách A: Tự động qua CI/CD (khuyến nghị)

Đã cấu hình xong theo [CI-CD.md](./CI-CD.md) thì không phải làm gì: mỗi lần merge
vào `main`, GitHub Actions chạy đủ bốn cổng kiểm tra, xây image, đẩy lên GHCR, rồi
ssh vào VPS kéo về, **dump CSDL vào `.deploy-db-backups/`** (giữ 5 bản; dump hỏng thì
dừng, chưa chạm gì) và khởi động lại. `docker-compose.yml` của đúng commit đó cũng
được gửi lên (kiểm checksum + `docker compose config -q` trước khi dùng, bản cũ sao
lưu ở `.deploy-compose-backups/`). Deploy hỏng (kể cả container crash loop) thì tự lùi
về image **và** compose cũ; xong thì hỏi `/api/public/health` qua tên miền công khai
(`VPS_SMOKE_URL`) để chắc khách thấy đúng bản mới. Merge chỉ đổi `*.md`/`docs/`/`openspec/`
thì không deploy.

### Cách B: Thủ công

```bash
cd cdkt
# docker-compose.yml do CI đặt vào là bản đã commit — bỏ nó để git pull không từ chối
git checkout -- docker-compose.yml
git pull origin main
docker compose build --no-cache
docker compose up -d
```

> Database **không bị mất** khi update — volume `mysql_data` persist giữa các lần rebuild.
> Chỉ mất khi chạy `docker compose down -v` hoặc `docker volume rm`.

> **Một lần, sau bản cập nhật 2026-10 (healthcheck MySQL):** healthcheck của service
> `mysql` nay đưa mật khẩu qua `MYSQL_PWD` thay vì `-p<mật-khẩu>` (dòng lệnh đó hiện
> trong `ps` của máy chủ mỗi 10 giây). CI chỉ khởi động lại **app** (`--no-recreate mysql`),
> nên thay đổi này chỉ có hiệu lực khi anh chủ động tạo lại mysql lúc thấp điểm:
> `docker compose up -d mysql` (dữ liệu nằm trong volume, không mất). Cùng đợt: `.env` do
> bản `manage.sh` cũ tạo mang quyền 644 — `./manage.sh` → Update tự siết về 600, hoặc
> `chmod 600 .env`.

---

## CI/CD tự động

Toàn bộ hướng dẫn cài đặt, vận hành và xử lý sự cố nằm ở **[CI-CD.md](./CI-CD.md)**.

Tóm tắt: mỗi lần merge vào `main` (trừ merge chỉ đổi tài liệu), GitHub Actions chạy
bốn cổng kiểm tra (test, typecheck, build, hygiene), xây image và đẩy lên GHCR theo tag
`sha-<commit>`, rồi ssh vào VPS kéo image về, dump CSDL, và khởi động lại. Container mới
không `healthy` thì script tự trỏ `.env` về image cũ. Sau cùng, bước smoke hỏi
`<VPS_SMOKE_URL>/api/public/health` và đòi đúng version vừa deploy.

Cần khai trước 4 secret (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_SSH_KNOWN_HOSTS`)
và variable `VPS_PORT`, `VPS_APP_DIR`, `VPS_SMOKE_URL` (cái cuối tuỳ chọn) trên GitHub,
cộng một lần `docker login ghcr.io` trên VPS — GHCR để package ở chế độ private kể cả
khi repo là public.

---

## Backup & Restore

### Sao lưu tự động (BẮT BUỘC)

`scripts/backup.sh` tạo một bộ ba cùng mã thời điểm:

| Tệp | Nội dung |
|-----|----------|
| `cdkt-<db>-<mã>-<pid>.sql.gz` | dump CSDL (`mysqldump`) |
| `cdkt-media-<mã>-<pid>.tar.gz` | volume `media_work` — video gốc, thumbnail, đoạn HLS |
| `cdkt-uploads-<mã>-<pid>.tar.gz` | volume `uploads_data` (`/app/public/uploads`) — ảnh/tệp tải lên qua admin |

Asset nằm ngoài MySQL, nên chỉ dump CSDL sẽ khôi phục các dòng trỏ vào tệp không còn.
(Trước đây cron chỉ lưu `media_work`; `uploads_data` chỉ có trong bản sao lưu của ứng
dụng hoặc phải `docker cp` tay.) Mỗi file được nén, kiểm chứng và xoay vòng; file lỗi
bị xoá để không bị nhầm là bản tốt.

```bash
# Chạy thử một lần
./scripts/backup.sh

# Thêm vào crontab của host — 2h sáng mỗi ngày
0 2 * * * cd /path/to/CDKT && ./scripts/backup.sh >> /var/log/cdkt-backup.log 2>&1
```

**Cài bằng `production/manage.sh`** (khuyến nghị): `cd production && ./manage.sh backup-cron`
(Menu 5 "Cài cron sao lưu") in **đúng** dòng trên và dòng `verify-restore.sh --latest` hằng
tháng (mục *Kiểm chứng khôi phục* bên dưới) với đường dẫn repo thật, rồi chỉ cài khi anh trả
lời `y`. Hai dòng nằm trong khối `# BEGIN cdkt-backup` … `# END cdkt-backup` của crontab user
đang chạy lệnh: chạy lại là thay khối đó, không nhân đôi; dòng khác giữ nguyên; dòng sao lưu
gõ tay từ trước (ngoài khối) được chỉ ra để xoá. **Chạy bằng root** (`sudo`): `./backups` là
bind mount thuộc uid 1000 của container — user không ghi được thư mục sao lưu (`BACKUP_DIR`)
thì lệnh từ chối cài, vì cron đó sẽ hỏng mỗi đêm. Chi tiết: `production/README.md` § *5. Cài
cron sao lưu*.

Tuỳ chọn trong `.env`: `BACKUP_DIR` (mặc định `./backups`), `BACKUP_KEEP_DAYS`
(mặc định 14), `HEALTHCHECK_PING_URL` (URL ping kiểu healthchecks.io: `backup-db.sh` và
`verify-restore.sh` gọi URL khi xong, `<URL>/fail` khi hỏng; giám sát hỏng không làm
sao lưu hỏng; trống = không ping — `production/README.md` § *Giám sát cron sao lưu*).
Giữ ba tệp **cùng mã** cùng nhau khi sao chép sang nơi lưu trữ khác.

Ngoài bộ đêm còn **bản dump trước mỗi lượt deploy** (CI và `manage.sh` Update):
`.deploy-db-backups/cdkt-predeploy-<db>-<mã>-<pid>.sql.gz`, cùng phép kiểm, giữ 5 bản,
không nằm trong `./backups` và không gửi ping — điểm lùi dữ liệu đi cặp với image trước
lượt đó (`production/README.md` § *Bản dump CSDL trước deploy*).

**Hai bộ sao lưu dùng chung `./backups`.** Bản sao lưu trong ứng dụng
(`/admin`, `server/services/backup.ts`) cũng ghi `cdkt-media-*` / `cdkt-uploads-*` vào
đó, kết thúc bằng một **từ** (`-manual`, `-scheduled`, `-pre-restore`…) thay vì số pid,
và tự xoay vòng theo **số bản** (`backup_keep_count`). Script shell xoay theo **ngày**
và chỉ xoá tệp khớp đúng khuôn của nó (`…-<mã>-<pid>.tar.gz`, `cdkt-<db>-*.sql.gz`) —
không xoá bản của ứng dụng. Hai bên không thấy nhau nên tổng số tệp là tổng của cả hai.

> **Sao lưu nằm cùng VPS thì mất VPS là mất tất cả.** Cron ở trên chỉ ghi vào đĩa của
> chính máy chủ này; chỗ lưu ngoài duy nhất có sẵn là backup Google Drive trong trang
> quản trị (tuỳ chọn, phải tự bật — mọi lượt sao lưu của ứng dụng, kể cả theo lịch, tự
> upload khi đã cấu hình; danh sách backup có cột *Bản ngoài máy chủ* cho từng tệp, và
> khối cài đặt cảnh báo khi backup tự động bật mà chưa có Drive). **Khuyến nghị**: chép
> định kỳ `./backups/` sang một nơi khác VPS (máy khác, hoặc kho đối tượng ngoài) bằng
> công cụ của hạ tầng anh đang dùng (ví dụ `rsync`/`rclone` trong cron), và giữ ba tệp
> cùng mã đi cùng nhau. Repo này **không** kèm công cụ tải lên nào — việc chọn nơi lưu
> và cấp khoá truy cập là quyết định của đơn vị vận hành.

### Bản `.env` ngoài VPS (mã hoá)

Bản dump CSDL **không đủ** để dựng lại cổng trên máy mới: các giá trị đã mã hoá trong
CSDL (API key AI, Google OAuth secret, liên kết Drive) chỉ mở được bằng
`CHATBOT_ENCRYPTION_SECRET` trong `.env`, và `JWT_SECRET`, mật khẩu MySQL cũng chỉ có ở
đó. Xuất một bản mã hoá rồi cất ngoài VPS:

```bash
cd production && ./manage.sh export-env      # Menu 6 "Xuất .env đã mã hoá"
# → <repo>/.env.enc  (openssl enc -aes-256-cbc -pbkdf2 -iter 200000; passphrase gõ 2 lần, ≥ 12 ký tự)
scp <user>@<vps>:<repo>/.env.enc ./cdkt-env-$(date +%Y%m%d).enc   # trên máy của anh
ssh <user>@<vps> rm <repo>/.env.enc                                # bản trên VPS mất cùng VPS

# Khi dựng lại (máy mới):
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in cdkt-env-<ngày>.enc -out .env && chmod 600 .env
```

Passphrase không bao giờ nằm trên dòng lệnh (lệnh dùng `-pass fd:3`); lệnh giải mã thử
ngay sau khi ghi. Giữ passphrase ở chỗ **khác** tệp `.enc`. Xuất lại mỗi khi đổi `.env`
(xoay `JWT_SECRET`, đổi mật khẩu MySQL…). Chi tiết: `production/README.md` § *6. Xuất .env
đã mã hoá*.

### Kiểm chứng khôi phục (nên làm hàng tháng)

Bản sao lưu chưa từng được khôi phục chỉ là một giả thuyết. Script dưới đây nạp
dump vào một CSDL tạm trong cùng container, đếm bảng và bản ghi, rồi **xoá CSDL
tạm** — không đụng tới dữ liệu đang chạy.

```bash
./scripts/verify-restore.sh backups/cdkt-cdkt_admin-20260726T020000Z-1234.sql.gz
```

`verify-restore.sh` **không có trong lịch nào** — phải tự đặt cron. Dòng dưới kiểm chứng
bản dump mới nhất vào mùng 1 hằng tháng, 3:30 sáng. `--latest` tự chọn bản
`backup-db.sh` mới nhất của **database trong `.env`** (`MYSQL_DATABASE`, trong
`BACKUP_DIR`) — không phải gõ tên database vào crontab:

```bash
30 3 1 * * cd /path/to/CDKT && ./scripts/verify-restore.sh --latest >> /var/log/cdkt-verify-restore.log 2>&1
```

Script từ chối (mã 2, không nạp gì) một dump tự chọn database khác (`USE`,
`CREATE/DROP DATABASE`, lệnh client `\u`/`connect`/`source`/`system` ở đầu dòng):
nạp nó vào "CSDL tạm" sẽ chạy `DROP TABLE` của dump lên database mà nó chọn.

Script thoát mã 0 khi khôi phục được; khác 0 thì `/var/log/cdkt-verify-restore.log`
có sự kiện `restore_check.failed`. Cần có người đọc log đó — cron không tự báo.

### Khôi phục thật (khi có sự cố)

Dừng app trước (cả ba script đều từ chối chạy khi app còn chạy), chọn **ba tệp cùng
mã thời điểm**. Mỗi script là thao tác phá huỷ nên đòi xác nhận tường minh:

```bash
docker compose stop app

# 1. (tuỳ chọn, khuyến nghị) nạp thử dump vào CSDL tạm — không đụng CSDL thật
./scripts/verify-restore.sh backups/cdkt-cdkt_admin-<mã>-<pid>.sql.gz

# 2. CSDL: bắt buộc nêu tên database đích + --replace. Script kiểm dump (gzip, dấu
#    "Dump completed", ≥20 bảng, không tự chọn database khác), DUMP BẢN HIỆN CÓ ra
#    backups/cdkt-prerestore-<db>-*.sql.gz và kiểm chứng nó — dump đó hỏng thì KHÔNG
#    khôi phục gì — rồi mới nạp. Database đích phải tồn tại sẵn (compose tạo
#    MYSQL_DATABASE); gõ sai tên thì dừng chứ không tạo database lạ.
./scripts/restore-db.sh backups/cdkt-cdkt_admin-<mã>-<pid>.sql.gz cdkt_admin --replace

# 3. Volume: script nhận ra volume nào từ TÊN archive (cdkt-media-* / cdkt-uploads-*),
#    từ chối tên lạ, đường dẫn thoát khỏi thư mục (`..`, `/`), tên có `\`/ký tự
#    điều khiển, archive uploads có thư mục gốc không phải `uploads/`, và MỌI mục
#    không phải tệp thường/thư mục (symlink, hard link, fifo, thiết bị — một symlink
#    trỏ vào backups/*.sql.gz sẽ được /uploads phục vụ ra ngoài). Cần GNU tar trên
#    máy chủ. Sau đó: sao lưu volume hiện có ra backups/cdkt-prerestore-<media|uploads>-*.tar.gz
#    (kiểm chứng; hỏng = không đổi gì; bỏ bằng --no-safety-copy), giải nén vào thư
#    mục tạm NGAY TRÊN volume, kiểm lại bằng `find` trong container, rồi mới thay.
#    Cần chỗ trống trên volume cho bản mới trong lúc bản cũ còn đó. Uploads được trả
#    quyền về user `node`.
./scripts/restore-media.sh backups/cdkt-media-<mã>-<pid>.tar.gz   --replace
./scripts/restore-media.sh backups/cdkt-uploads-<mã>-<pid>.tar.gz --replace
# Lùi lại một lần restore volume: chính bản cdkt-prerestore-* vừa tạo
# ./scripts/restore-media.sh backups/cdkt-prerestore-uploads-<mã>-<pid>.tar.gz --replace

docker compose up -d --no-deps app
```

"App đã dừng" được kiểm bằng **hai** tín hiệu (`docker compose ps --status running`,
`docker inspect cdkt_app`). Cả hai đều không trả lời được — ví dụ Docker Compose cũ không
có `ps --status` — thì `restore-db.sh`/`restore-media.sh` **từ chối** (mã 2) thay vì coi
như đã dừng; kiểm tay bằng `docker ps`, rồi thêm `--i-know-app-is-stopped` sau `--replace`.

Ghi chú: dump chỉ `DROP`/tạo lại những bảng **có trong nó**; bảng có ở CSDL đích mà không
có trong dump được giữ nguyên. Muốn "đúng như bản sao lưu" thì khôi phục vào CSDL rỗng.
Archive `cdkt-uploads-*` của bản sao lưu trong ứng dụng dùng cùng khuôn (`uploads/…`) nên
khôi phục được bằng cùng lệnh; archive `cdkt-media-*` của ứng dụng (gốc `media/`) có khuôn
khác và `restore-media.sh` từ chối — khôi phục chúng bằng chức năng khôi phục của trang
quản trị (`/api/admin/backup/restore`).
Các tệp `cdkt-prerestore-*` (dump CSDL của `restore-db.sh`, archive volume của
`restore-media.sh`) **không** bị xoay vòng; dọn tay khi không còn cần.

---

## Chuyển máy chủ

```bash
# ─── Máy cũ ─────────────────────────────────────
# Một lệnh ra đủ bộ ba (SQL + media_work + uploads_data) cùng mã thời điểm.
./scripts/backup.sh ./transfer-backup
scp -r transfer-backup .env root@ip-may-moi:/path/to/cdkt/

# ─── Máy mới (sau khi clone + .env đã chép sang + docker compose up -d) ─
# `.env` phải là .env của máy cũ: compose dựng CSDL rỗng bằng đúng MYSQL_* trong đó.
docker compose stop app
./scripts/restore-db.sh transfer-backup/cdkt-cdkt_admin-<mã>-*.sql.gz cdkt_admin --replace
./scripts/restore-media.sh transfer-backup/cdkt-media-<mã>-*.tar.gz --replace
./scripts/restore-media.sh transfer-backup/cdkt-uploads-<mã>-*.tar.gz --replace
docker compose up -d --no-deps app
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
