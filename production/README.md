# production/ — Công cụ quản trị VPS CDKT

Một cửa vào để deploy mới, update VPS, và import data migration. Không cần nhớ lệnh docker compose dài — chạy `manage.sh` rồi làm theo menu.

## Cài đặt

```bash
cd /www/wwwroot/conduonghuongthien/production
chmod +x manage.sh
./manage.sh
```

Yêu cầu trên VPS:
- **Docker + Docker Compose** đã cài
- **Git** (để pull code khi update)
- **openssl** (để sinh bí mật ngẫu nhiên — có sẵn hầu hết VPS)

---

## Menu

```
╔═══════════════════════════════════════════════════╗
║   CDKT — Production Manager                        ║
║   Con Đường Hướng Thiện · C11 Bộ Công an          ║
╚═══════════════════════════════════════════════════╝

  1) Deploy   — thiết lập mới (chạy lần đầu)
  2) Update   — cập nhật VPS (pull + restart)
  3) Migrate  — nhập data SQL mới
  q) Thoát
```

### 1. Deploy — thiết lập mới (lần đầu)

Chạy khi mới dựng VPS, chưa có `.env` và container. Sáu bước (+ 2b tự chủ webfont):

| Bước | Việc | Gợi ý | Có thể sửa? |
|------|------|-------|-------------|
| 1 | Chọn nguồn SQL: **1=existing DB** hay **2=docker fresh** | 2 (docker) | ✓ |
| 2 | DB name / user / password / port | Tự sinh password ngẫu nhiên | ✓ (gõ enter giữ default) |
| 2b | Tự chủ webfont Inter (nếu chưa có `public/assets/fonts/inter.css`) | `node scripts/fetch-fonts.mjs` | ✓ (bỏ qua nếu không có Internet) |
| 3 | Bí mật app (JWT/Chatbot/Analytics) | Tự sinh hex/base64 32 | ✓ |
| 4 | Tên miền `PUBLIC_BASE_URL` | `https://conduonghuongthien.com.vn` | ✓ |
| 5 | Tạo `.env` chuẩn | — | tự động |
| 6 | Hỏi build luôn hay làm sau | build luôn | ✓ |

Sau khi xong:
- `.env` tạo ở thư mục gốc repo (cha của `production/`)
- Container `cdkt_app` + `cdkt_mysql` khởi động (nếu chọn build luôn)
- Nếu có file SQL trong `production/migrations/` → hỏi import

### 2. Update — cập nhật VPS

Chạy khi muốn kéo code/image mới lên VPS đang chạy:

1. **Hiển thị trạng thái cũ**: image, port, domain, container status
2. **Pull code** từ `git pull origin main` (xác nhận trước)
3. **Sửa cấu hình**: port, `PUBLIC_BASE_URL` (gõ enter giữ giá trị cũ, hoặc sửa)
4. **Pull image + restart**: `docker compose pull && up -d`, đợi healthcheck
5. **Hỏi migrate** nếu có file SQL mới

### 3. Migrate — nhập data SQL

Chạy khi có file `.sql` mới (bài viết, dump data). Luồng:

1. **Quét** `production/migrations/*.sql`
2. **Hiển thị** mỗi file kèm trạng thái `đã import` / `chưa` (đánh dấu bằng file `.imported-*`)
3. **Chọn** file (số thứ tự, hoặc `all` cho tất cả chưa import)
4. **Cảnh báo** file có `DROP TABLE` sẽ xóa data cũ
5. **Xác nhận** rồi import từng file qua `docker exec -i cdkt_mysql mysql ... < file.sql`
6. **Đếm** bài viết trước/sau để đối chiếu

Để **re-import** một file đã đánh dấu: xoá file `.imported-<tên>` trong `production/migrations/`.

---

## Cấu trúc thư mục

```
production/
├─ manage.sh           # script chính (menu 1/2/3)
├─ README.md           # tệp này
└─ migrations/          # thả file .sql vào đây (INSERT-only, không DROP)
   └─ .imported-*       # đánh dấu đã import (tự tạo)
```

Mẫu `.env` thật ở **root repo** (`.env.example`) — không có `.env.template` trong folder này. Trên VPS, `.env` do `manage.sh` sinh ra.

---

## Luồng hoạt động đầy đủ

### Lần đầu dựng VPS

```bash
ssh root@vps
cd /www/wwwroot
git clone https://github.com/duogxaolin/conduonghuongthien.git
cd conduonghuongthien/production
chmod +x manage.sh
./manage.sh        # chọn 1 → Deploy
```

→ Có `.env`, container chạy, data đã import.

### Cập nhật code mới

Dev merge code vào `main`. **CI tự deploy**: build image → push GHCR → SSH vào VPS → `docker pull` + `docker compose up -d` → chờ healthcheck, hỏng thì tự lùi về image trước (job `deploy` trong `.github/workflows/ci.yml`, `if: true`; chi tiết `CI-CD.md`). **Merge vào `main` là lên production ngay** — chỉ merge khi đã sẵn sàng.

Không cần làm gì trên VPS cho một lần cập nhật code thường. Chạy tay `manage.sh` chỉ khi cần (deploy lần đầu, đổi `.env`/port/domain, import SQL, hoặc CI deploy hỏng):

```bash
ssh root@vps
cd /www/wwwroot/conduonghuongthien/production
./manage.sh        # chọn 2 → Update
```

→ Pull code, pull image GHCR mới, restart, healthy.

### Có data bài viết mới

Anh xuất dump SQL (chỉ `INSERT`, không `DROP`), thả vào `production/migrations/`:

```bash
# Trên máy dev: commit file .sql mới
# Trên VPS:
cd /www/wwwroot/conduonghuongthien
git pull origin main
cd production
./manage.sh        # chọn 3 → Migrate
```

→ Quét file chưa import, hỏi xác nhận, import, đếm trước/sau.

---

## Dọn HTML bản dịch đã lưu trước bản vá bảo mật (làm một lần)

Bản vá XSS bản dịch (PR #92) lọc HTML ở mọi đường ghi mới và lọc lại lúc đọc, nên người đọc không còn nhận script từ dữ liệu cũ. Hàng cũ vẫn nằm nguyên trong DB; lượt dọn này đưa chính dữ liệu lưu về dạng đã lọc. Sau khi CI đã deploy bản có `db:sanitize-html`:

```bash
cd /www/wwwroot/conduonghuongthien
./scripts/backup-db.sh                                   # sao lưu trước
docker exec -it cdkt_app npm run db:sanitize-html        # xem trước: đếm hàng sẽ đổi, KHÔNG ghi
docker exec -it cdkt_app npm run db:sanitize-html -- --apply   # ghi
```

Chạy lại được nhiều lần (hàng đã sạch thì không đổi). Thay đổi thường gặp là cosmetic: `alt=""` → `alt` (tương đương trong HTML); chỉ mã độc (`<script>`, `onerror=`, `javascript:`…) bị bỏ thật.

---

## Tắt auto-deploy (tuỳ chọn)

Hiện job `deploy` trong `.github/workflows/ci.yml` có `if: true` (bật). Muốn CI chỉ build image mà không tự lên VPS (rồi deploy bằng `./manage.sh` → 2):

```yaml
  deploy:
    if: false    # đổi từ true
```

---

## Câu hỏi thường gặp

**Q: Đổi mật khẩu admin?**
A: Vào `$PUBLIC_BASE_URL/admin/profile` sau đăng nhập. Mật khẩu đầu nằm trong `.env` (`ADMIN_PASSWORD`) — chỉ dùng lúc seed, đổi sau không cần sửa `.env`.

**Q: Merge vào `main` rồi mà VPS không lên bản mới?**
A: Auto-deploy đang bật, nên xem job `Deploy to VPS` trong Actions (có thể thiếu secret, hoặc container mới không healthy nên đã tự lùi). Cần gấp thì chạy `./manage.sh` → 2 (Update) để pull + restart bằng tay.

**Q: File SQL nào nên thả vào `migrations/`?**
A: File `.sql` chỉ `INSERT` (thêm data, không `DROP TABLE`). Script tự detect, không ghi đè file đã import trừ khi xoá marker.

**Q: Lỗi `Access denied for user 'root'@'localhost'`?**
A: `.env` dùng `MYSQL_ROOT_PASSWORD` (không phải `DB_PASSWORD`). `manage.sh` đọc đúng biến — chạy qua script, đừng gõ tay.

**Q: Muốn dựng lại sạch từ đầu?**
A: `docker compose down -v` (xoá volume = mất data) → `./manage.sh` → 1 (Deploy). App tự `init.ts` + `seed.ts`, không cần dump.

**Q: Chatbot trả lời rất chậm hoặc bị cắt giữa chừng ở production?**
A: Provider AI có lúc mất 40–200 giây cho một câu. Server giữ kết nối bằng một dòng `: ping` mỗi 15 giây, nhưng nginx (aaPanel) phải cho phép kết nối sống lâu và không đệm. Thêm vào cấu hình site (cùng khối `server { }` với các `proxy_set_header`; đổi `54432` cho khớp `PORT` trong `.env`), rồi reload nginx:

```nginx
location /api/public/chatbot {
    proxy_pass http://127.0.0.1:54432;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

Kiểm tra: `curl -N -s -X POST https://<domain>/api/public/chatbot -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"có hỗ trợ vay vốn không?"}]}' | head -20` — trong lúc chờ phải thấy `: ping` xen kẽ mỗi 15 giây. Giải thích đầy đủ ở `CI-CD.md` (Bước 8).
