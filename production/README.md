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

Chạy khi mới dựng VPS, chưa có `.env` và container. Sáu bước:

| Bước | Việc | Gợi ý | Có thể sửa? |
|------|------|-------|-------------|
| 1 | Chọn nguồn SQL: **1=existing DB** hay **2=docker fresh** | 2 (docker) | ✓ |
| 2 | DB name / user / password / port | Tự sinh password ngẫu nhiên | ✓ (gõ enter giữ default) |
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
├─ migrations/          # thả file .sql vào đây
│  ├─ full_dump.sql    # snapshot data (đã có sẵn)
│  └─ .imported-*       # đánh dấu đã import (tự tạo)
└─ .env.template       # mẫu .env (tham khảo, không dùng trực tiếp)
```

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

Dev push code lên `main`. CI build image + push GHCR (nhưng **không tự deploy** từ khi tắt auto-deploy). Anh deploy bằng tay:

```bash
ssh root@vps
cd /www/wwwroot/conduonghuongthien/production
./manage.sh        # chọn 2 → Update
```

→ Pull code, pull image GHCR mới, restart, healthy.

### Có data bài viết mới

Anh xuất dump SQL (hoặc em commit `full_dump.sql` mới), thả vào `production/migrations/`:

```bash
# Trên máy dev: commit full_dump.sql mới
# Trên VPS:
cd /www/wwwroot/conduonghuongthien
git pull origin main
cd production
./manage.sh        # chọn 3 → Migrate
```

→ Quét file chưa import, hỏi xác nhận, import, đếm trước/sau.

---

## Bật lại auto-deploy (tuỳ chọn)

Hiện job `deploy` trong `.github/workflows/ci.yml` có `if: false` (tắt). Muốn CI tự deploy mỗi push main:

```yaml
  deploy:
    if: false    # → đổi thành if: true (hoặc xoá dòng if)
```

---

## Câu hỏi thường gặp

**Q: Đổi mật khẩu admin?**
A: Vào `$PUBLIC_BASE_URL/admin/profile` sau đăng nhập. Mật khẩu đầu nằm trong `.env` (`ADMIN_PASSWORD`) — chỉ dùng lúc seed, đổi sau không cần sửa `.env`.

**Q: Sao CI build image nhưng VPS không tự lên?**
A: Auto-deploy đã tắt. Chạy `./manage.sh` → 2 (Update) để pull + restart bằng tay.

**Q: File SQL nào nên thả vào `migrations/`?**
A: `full_dump.sql` (snapshot đầy đủ, có `DROP TABLE` — ghi đè toàn bộ). Hoặc file `.sql` chỉ `INSERT` (thêm data). Script tự detect, không ghi đè file đã import trừ khi xoá marker.

**Q: Lỗi `Access denied for user 'root'@'localhost'`?**
A: `.env` dùng `MYSQL_ROOT_PASSWORD` (không phải `DB_PASSWORD`). `manage.sh` đọc đúng biến — chạy qua script, đừng gõ tay.

**Q: Muốn dựng lại sạch từ đầu?**
A: `docker compose down -v` (xoá volume = mất data) → `./manage.sh` → 1 (Deploy) → import lại `full_dump.sql` qua 3 (Migrate).
