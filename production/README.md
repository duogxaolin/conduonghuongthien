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
  4) Media    — bật/tắt tải video, đặt trần RAM
  5) Cài cron sao lưu — sao lưu đêm + kiểm chứng khôi phục hằng tháng
  6) Xuất .env đã mã hoá — giữ bí mật ngoài VPS
  q) Thoát
```

Gọi thẳng không qua menu: `./manage.sh deploy|update|migrate|media-tuning|backup-cron|export-env` (hoặc `1`–`6`).

### 1. Deploy — thiết lập mới (lần đầu)

Chạy khi mới dựng VPS, chưa có `.env` và container. Sáu bước (+ 2b tự chủ webfont):

| Bước | Việc | Gợi ý | Có thể sửa? |
|------|------|-------|-------------|
| 1 | Nguồn CSDL: **MySQL đi kèm docker compose** (chỉ thông báo, không còn lựa chọn — xem ghi chú dưới bảng) | — | — |
| 2 | DB name / user / password / port | Tự sinh password ngẫu nhiên | ✓ (gõ enter giữ default) |
| 2b | Tự chủ webfont Inter (nếu chưa có `public/assets/fonts/inter.css`) | `node scripts/fetch-fonts.mjs` | ✓ (bỏ qua nếu không có Internet) |
| 3 | Bí mật app (JWT/Chatbot/Analytics) | Tự sinh hex/base64 32 | ✓ |
| 4 | Tên miền `PUBLIC_BASE_URL` + `PUBLIC_HOST_ALLOWLIST` | `https://conduonghuongthien.com.vn` / host của nó | ✓ |
| 5 | Tài khoản SuperAdmin, `TRUSTED_PROXY_IPS`, `HEALTHCHECK_PING_URL` (tuỳ chọn — xem *Giám sát cron sao lưu*), `OPS_ALERT_EMAIL` (tuỳ chọn — xem *Thư cảnh báo vận hành*), rồi tạo `.env` chuẩn và kiểm journald (xem *Log của app*) | enter = bỏ qua ping / cảnh báo | ✓ / tự động |
| 6 | Kéo image CI + khởi động luôn, hay làm sau | khởi động luôn | ✓ |

Sau khi xong:
- `.env` tạo ở thư mục gốc repo (cha của `production/`)
- Container `cdkt_app` + `cdkt_mysql` khởi động (nếu chọn khởi động luôn) và Deploy **đợi `cdkt_app` healthy** — quá hạn thì thoát mã khác 0 kèm log, không in "DEPLOY XONG"
- Nếu có file SQL trong `production/migrations/` → hỏi import

> **Bước 1 — chỉ còn MySQL đi kèm compose.** Lựa chọn "Existing DB" từng có ở đây là
> lựa chọn chết: `docker-compose.yml` cố định `DB_HOST: mysql` / `DB_PORT: 3306` cho
> container app, nên app luôn nối tới MySQL rỗng đi kèm dù `.env` khai gì. Nên đã bỏ.
> Có dữ liệu cũ thì Deploy xong rồi nhập bằng **Migrate (3)**. Hỗ trợ MySQL ngoài thật
> sự cần sửa compose để `DB_HOST`/`DB_PORT` đi qua. `DB_HOST`/`DB_PORT` trong `.env`
> chỉ dành cho lệnh chạy trên máy chủ (qua cổng loopback `MYSQL_EXTERNAL_PORT`).
>
> **Tải video lên máy chủ (`MEDIA_UPLOAD_ENABLED`)** chỉ được ghi `true` khi RAM máy
> chủ ≥ 4000 MB (ngưỡng thật của pipeline transcode FFmpeg — dưới đó OOM-killer hạ một
> container khác). Dưới ngưỡng Deploy ghi `false` và báo; muốn bật dù thiếu RAM thì dùng
> **Media (4)**.
>
> **Không build trên VPS mặc định.** Deploy kéo image do CI dựng (`docker pull
> <CDKT_IMAGE>`, rồi kiểm image thật sự có mặt — `docker compose pull` không đáng tin ở
> điểm này: với service có cả `image:` và `build:`, một số bản Compose thoát 0 khi kéo
> hỏng, và `up -d` kế tiếp sẽ build ngầm). Kéo không được (chưa `docker login ghcr.io` —
> package GHCR là private — hoặc CI chưa đẩy image) thì hỏi riêng có build tại chỗ không
> (mặc định **không**, kèm cảnh báo OOM).

### 2. Update — cập nhật VPS

Chạy khi muốn kéo code/image mới lên VPS đang chạy:

1. **Hiển thị trạng thái cũ**: image, port, domain, container status (trước đó Update chỉ siết quyền `.env` về 600 — không đổi nội dung)
2. **Sao lưu DB trước khi cập nhật? [Y/n]** (mặc định **có**) — câu hỏi **đầu tiên**, trước khi Update đổi bất cứ thứ gì: trước `git pull` (đổi `docker-compose.yml`), trước các câu hỏi ghi `.env`, trước khi kéo/đổi image — đúng chỗ của lượt CI deploy. `scripts/backup-db.sh --prefix cdkt-predeploy` → `.deploy-db-backups/` — cùng bản dump, cùng thư mục, cùng vòng xoay 5 bản với lượt CI deploy (xem *Bản dump CSDL trước deploy*); dùng `backup-db.sh` của chính bản checkout đang chạy `manage.sh` (chưa pull). Dump hỏng → Update **dừng**: chưa pull code, chưa sửa `.env`, chưa kéo image hay khởi động lại gì. Chỉ trả lời `n` khi vừa có bản sao lưu mới, hoặc chính bước sao lưu đang hỏng mà phải cập nhật gấp
3. **Pull code** từ `git pull origin main` (xác nhận trước). `docker-compose.yml` có thay đổi cục bộ là bản CI đã đặt — Update tự sao lưu nó vào `.deploy-compose-backups/` rồi `git checkout -- docker-compose.yml` trước khi pull (xem *An toàn khi Update* bên dưới; pull tay thì làm đúng hai bước đó). Pull mà đổi chính `production/manage.sh` → Update **tự chạy tiếp bằng bản vừa kéo về** (`exec`, không hỏi lại sao lưu/pull; bản sao lưu compose của lượt này đi theo cho đường lùi) — phần còn lại luôn là mã mới
4. **Sửa cấu hình**: port, `PUBLIC_BASE_URL`, `PUBLIC_HOST_ALLOWLIST` (gõ enter giữ giá trị cũ, hoặc sửa; `.env` cũ chưa có `PUBLIC_HOST_ALLOWLIST` thì gợi ý host của `PUBLIC_BASE_URL`), `OPS_ALERT_EMAIL` (địa chỉ nhận thư cảnh báo, phẩy ngăn cách; enter = giữ nguyên, `-` = xoá; giá trị không phải danh sách địa chỉ bị từ chối), `HEALTHCHECK_PING_URL` (chỉ báo *đang đặt*/*chưa đặt* — **không in URL**; enter = giữ nguyên, `-` = xoá; URL có `?`/`&`/`#` bị từ chối). Ngay trước bước 5, Update kiểm journald và đặt/gỡ override log dự phòng (xem *Log của app*) — không hỏi; cấu hình log hiệu lực không chạy được trên máy này thì **dừng** trước khi kéo image hay khởi động lại

> **`PUBLIC_HOST_ALLOWLIST`** — mọi tên miền thật của cổng, phẩy ngăn cách
> (`conduonghuongthien.com.vn,www.conduonghuongthien.com.vn`). Liên kết trong email
> thông báo lấy host của request **chỉ khi** host đó nằm trong danh sách (hoặc là host
> của `PUBLIC_BASE_URL`); host lạ → dùng `PUBLIC_BASE_URL`. Thiếu tên miền thật nào thì
> email của tên miền đó trỏ về `PUBLIC_BASE_URL` (vẫn mở được, chỉ khác tên miền). Bỏ
> trống cả hai → hành vi cũ + cảnh báo `security.link_host_unchecked` trong log.
> Cùng lúc, nginx phải đặt `proxy_set_header X-Forwarded-Host $host;` và có site mặc
> định từ chối tên miền lạ — xem `CI-CD.md` Bước 8.

> **Cookie phiên luôn `Secure` ở production** (`server/utils/request-secure.ts`, từ
> wave1 1A): cookie đăng nhập admin, MFA, người đọc và OAuth chỉ bỏ `Secure` khi
> **proxy nằm trong `TRUSTED_PROXY_IPS`** báo `X-Forwarded-Proto: http`; header từ
> peer không tin cậy bị bỏ qua. Hệ quả: phục vụ cổng qua **HTTP thường** (chưa có TLS)
> mà proxy không nằm trong `TRUSTED_PROXY_IPS` → trình duyệt không gửi lại cookie,
> đăng nhập admin/người đọc không giữ được phiên. Cấu hình chuẩn đã đúng: nginx mẫu
> gửi `proxy_set_header X-Forwarded-Proto $scheme;` và `manage.sh` đặt mặc định
> `TRUSTED_PROXY_IPS=172.16.0.0/12` (dải docker) — chạy HTTPS hay HTTP đều giữ phiên.
> Tự sửa `.env` thì đừng xoá `TRUSTED_PROXY_IPS` khi còn phục vụ qua HTTP.

> **IP thật sau Cloudflare** (bắt buộc khi tên miền đi qua Cloudflare, kiểm TRƯỚC khi
> merge wave1 1C): không có real-IP ở nginx thì app thấy IP **edge của Cloudflare**
> cho mọi khách — giới hạn tần suất theo IP gộp lại, và trần lượt xem bài **60 lượt /
> 10 phút mỗi IP** (`view.post.ts`) đếm thiếu lượt xem thật. **Không nên** vá bằng
> cách thêm dải Cloudflare vào `TRUSTED_PROXY_IPS`: `client-ip.ts` từ chối CIDR IPv6
> (khách IPv6 vẫn ra IP edge), còn access log nginx và `X-Real-IP` vẫn mang IP edge.
> Sửa ở nginx: `set_real_ip_from` cho mọi dải trong https://www.cloudflare.com/ips-v4
> và `ips-v6` + `real_ip_header CF-Connecting-IP;` — lệnh sinh tệp (có kiểm tệp không
> rỗng trước khi thay) và khối cấu hình ở `CI-CD.md`
> Bước 8, mục "IP thật sau Cloudflare". Kiểm: đăng xuất admin rồi
> `SELECT JSON_UNQUOTE(JSON_EXTRACT(meta,'$.ip')) FROM activity_logs WHERE action='logout' ORDER BY id DESC LIMIT 3;`
> phải ra IP của bạn (`curl -s https://<domain>/cdn-cgi/trace | grep ^ip=`), không phải
> dải Cloudflare (`104.16.0.0/13`, `172.64.0.0/13`, `162.158.0.0/15`, `2606:4700::/32`…);
> log `article_view.ip_ceiling_hit` lặp lại với `bucket` là IP Cloudflare cũng là dấu hiệu.

5. **Pull image + restart chỉ app**: kéo image `CDKT_IMAGE`, rồi `docker compose up -d --no-recreate mysql` + `up -d --no-deps app`, đợi healthcheck (hỏng thì lùi — xem bên dưới). Khoẻ thì dọn image `sha-*` cũ (giữ image đang chạy + 5 bản mới nhất, như CI — *Giữ image*) và cảnh báo khi đĩa Docker dùng > 80 %
6. **Hỏi migrate** nếu có file SQL mới

**An toàn khi Update** (bước 3 và 5):

- **Khởi động lại chỉ app**, đúng như CI: `docker compose up -d --no-recreate mysql` rồi
  `up -d --no-deps app`. Không bao giờ `up -d app` trơn — lệnh đó tạo lại cả mysql khi
  cấu hình mysql trong compose lệch.
- **`docker-compose.yml` do CI quản lý**: Update sao lưu bản hiện tại vào
  `.deploy-compose-backups/` (cùng thư mục, cùng khuôn tên với CI), bỏ thay đổi cục bộ
  của riêng tệp đó (`git checkout -- docker-compose.yml`) rồi mới `git pull`. Nếu anh
  từng sửa tay tệp này **ngoài** bản CI đặt, phần sửa nằm trong bản sao lưu. `git pull`
  hỏng thì Update **đặt lại** bản đang chạy từ bản sao lưu đó rồi mới thoát — không để
  compose nằm lại ở HEAD cũ, khác với container đang chạy.
- **`.env` quyền 600.** Deploy tạo `.env` qua tệp tạm quyền 600 rồi `mv`; Update siết
  `.env` cũ (bản Deploy trước tạo với 644 — mọi user trên máy đọc được bí mật) về 600 và
  báo. Chạy bằng root mà thư mục repo thuộc user khác (user CI deploy), `.env` được trao
  cho chủ thư mục đó — nếu không, lượt CI deploy kế tiếp không đọc được `.env`.
- **Đợi healthy, hỏng thì lùi.** Trước khi kéo, image đang chạy được gắn thẻ cục bộ
  `cdkt-rollback/app:<thời-điểm>` (theo **ID image**, vì thẻ `:latest` sẽ bị kéo sang
  bản mới). Nếu bản mới không healthy sau 300 giây: in log, trả `docker-compose.yml` về
  bản trước lượt pull, trỏ `CDKT_IMAGE` về thẻ lùi, khởi động lại, rồi **thoát mã khác 0**
  ("UPDATE THẤT BẠI"). `.env` khi đó đang đặt `CDKT_IMAGE=cdkt-rollback/app:…`; lượt CI
  deploy kế tiếp, hoặc Update lần sau, sẽ đề nghị trỏ lại về GHCR.
  - **Lùi chạy image cũ trên CSDL image mới đã nâng cấp** (`init.ts` của image mới đã chạy
    trước khi healthcheck hỏng). Vì vậy lược đồ chỉ được thêm theo cách image cũ chịu được.
    Với tổng lượt xem bài viết (đợt 2C — `articles.view_total_real`/`view_total_fabricated`/
    `view_total`): lùi **an toàn** — ba cột là cột thường, image cũ không biết tới chúng nên
    đọc/ghi bài như cũ, và bản sao lưu nó dump (`SELECT *`) khôi phục được. Lượt xem image cũ
    đếm trong lúc đó không vào tổng; lần khởi động kế tiếp của image mới **tự đối soát** và
    sửa đúng những bài lệch (log `db.migration.article_view_totals_reconciled` kèm số bài),
    không cần làm gì tay. (d079453 từng khai `view_total` là cột sinh — bản dump của image
    cũ khi đó chết 3105 lúc khôi phục; bản này đã đổi thành cột thường, CSDL nào đã chạy
    d079453 được đổi lại lúc khởi động.)
- **`CDKT_IMAGE` bị CI ghim vào `:sha-<commit>`** sau lượt deploy đầu tiên, nên "pull"
  chỉ kéo đúng bản đó. Update nói rõ điều này và hỏi có trỏ về `:latest` không (CI sẽ ghim
  lại ở lượt deploy sau). Kéo về trùng image đang chạy → báo "không có bản mới hơn".
- **Không build trên VPS ngầm.** Kéo image lỗi thì hỏi riêng (mặc định **không**, kèm
  cảnh báo OOM); không chấp nhận thì thoát mã khác 0 và container đang chạy không bị đụng.

### 3. Migrate — nhập data SQL

Chạy khi có file `.sql` mới (bài viết, dump data). Luồng:

1. **Quét** `production/migrations/*.sql`
2. **Hiển thị** mỗi file kèm trạng thái `đã import` / `chưa` (đánh dấu bằng file `.imported-*`) và dấu **⚠** nếu nội dung chứa lệnh xoá dữ liệu
3. **Chọn** file (số thứ tự, hoặc `all` cho tất cả chưa import)
4. **Quét nội dung thật** từng file, theo câu lệnh chứ không theo dòng: bỏ BOM và chú thích (`-- `, `#`, `/* */`) nhưng **giữ** nội dung `/*!NNNNN … */` / `/*M!… */` (MySQL/MariaDB vẫn chạy), hiểu chuỗi `'…'`/`"…"` và `` `định danh` `` (nên `--`, `/*`, `;` trong chuỗi không đánh lừa được), gộp xuống dòng. Bị đánh dấu: mọi `DROP`/`TRUNCATE` (kể cả `DROP` và `TABLE` trên hai dòng, `DROP/**/TABLE`, ``TRUNCATE`a` ``, `TRUNCATE t` không có `TABLE`, `ALTER … DROP`, `DROP` trong thân thủ tục), SQL động `PREPARE`/`EXECUTE`, mọi `DELETE` (trừ `ON DELETE` của khoá ngoại), `UPDATE` không có `WHERE`, và chuỗi/chú thích chưa đóng tới cuối file. Chữ "drop"/"delete" **trong dữ liệu** (chuỗi) không bị đánh dấu — trừ khi file đổi cách MySQL đọc chuỗi (`NO_BACKSLASH_ESCAPES`, `SET NAMES gbk/big5/sjis…`), khi đó quét thêm cả văn bản thô. File bị đánh dấu phải được **gõ lại đúng tên file** mới chạy; gõ sai/enter = bỏ qua file đó
5. **Xác nhận** rồi import từng file qua `docker exec -i cdkt_mysql mysql ... < file.sql`, vào database lấy từ `.env` — đúng quy tắc của compose: `MYSQL_DATABASE`, không có thì `cdkt_admin` (dòng `DB_NAME` trong `.env` compose không đọc, nên Migrate cũng không; lệch nhau thì cảnh báo). Mật khẩu root đi qua biến môi trường (không nằm trên dòng lệnh)
6. **Đếm** bài viết trước/sau để đối chiếu

Lưu ý: bản dump `mysqldump` nào cũng chứa `DROP TABLE IF EXISTS` nên **luôn** bị đánh dấu — đúng, vì nó sẽ xoá bảng cũ. Máy quét chủ đích bắt thừa hơn thiếu (bị đánh dấu chỉ tốn công gõ tên file); thả vào `migrations/` file INSERT-only như dưới đây vẫn là cách an toàn nhất.

Để **re-import** một file đã đánh dấu: xoá file `.imported-<tên>` trong `production/migrations/`.

### 4. Media — bật/tắt tải video, đặt trần RAM

Chỉ đọc/ghi `.env`, không khởi động lại gì. Đo RAM máy chủ: dưới 4000 MB thì mặc định từ chối bật tải video; đề xuất `MYSQL_MEM_LIMIT`/`APP_MEM_LIMIT` từ `scripts/check-resources.sh` (bảng tham khảo: *Trần RAM khuyến nghị theo cỡ máy*); bật/tắt tự nén sau upload. Áp dụng bằng `docker compose up -d`.

### 5. Cài cron sao lưu — sao lưu đêm + kiểm chứng khôi phục hằng tháng

Cài đúng hai dòng mà mục *Sao lưu & khôi phục* bên dưới bảo gõ tay — vào crontab của **user đang chạy lệnh**, nên **chạy bằng root** (`sudo ./manage.sh backup-cron`): cron sao lưu là việc của máy chủ, và `./backups` là bind mount mà container giao cho user `node` (uid 1000) mỗi lần khởi động — user deploy không phải root thường không ghi được vào đó:

```
# BEGIN cdkt-backup — production/manage.sh (Cài cron sao lưu); chạy lại lệnh đó để sửa
0 2 * * * cd '<repo>' && ./scripts/backup.sh >> '<log>/cdkt-backup.log' 2>&1
30 3 1 * * cd '<repo>' && ./scripts/verify-restore.sh --latest >> '<log>/cdkt-verify-restore.log' 2>&1
# END cdkt-backup
```

- **In đúng các dòng trước, chỉ cài khi anh trả lời `y`** (mặc định **không** — enter là không cài).
- `backup.sh` = dump CSDL (`backup-db.sh`, có kiểm chứng + xoay vòng) + archive media/uploads; `verify-restore.sh --latest` nạp thử bản dump mới nhất vào CSDL tạm. Cả hai tự đọc `.env`, kể cả `HEALTHCHECK_PING_URL` — lệnh này chỉ báo ping *đang đặt*/*chưa đặt*, không in URL.
- **Chạy lại an toàn:** các dòng nằm trong khối `# BEGIN cdkt-backup` … `# END cdkt-backup`; chạy lại là **thay** khối đó (đổi đường dẫn repo, đổi log), không thêm khối thứ hai. Dòng crontab khác của user giữ nguyên.
- Crontab đã có dòng gọi `scripts/backup*.sh`/`verify-restore.sh` **ngoài** khối (thêm tay theo tài liệu cũ) → lệnh chỉ ra các dòng đó (cài thêm là mỗi đêm chạy hai lần); xoá chúng bằng `crontab -e` trước.
- **User không ghi được thư mục sao lưu** (`BACKUP_DIR` trong `.env`, mặc định `./backups`) → từ chối cài và bảo dùng root: cron của user đó sẽ hỏng `EACCES` mỗi đêm mà không ai thấy.
- **Log:** `/var/log/…` khi user ghi được vào đó (root); user khác (đã qua phép kiểm trên, vd. `BACKUP_DIR` trỏ chỗ khác) → `<repo>/logs/…` (tạo sẵn). Một dòng cron chuyển hướng vào tệp không mở được thì lệnh **không chạy**, không báo gì. Hai tệp log chỉ lớn dần (vài dòng JSON mỗi đêm/tháng) — muốn xoay vòng thì thêm `/etc/logrotate.d/cdkt-backup`:
  ```
  /var/log/cdkt-backup.log /var/log/cdkt-verify-restore.log {
      monthly
      rotate 12
      compress
      missingok
      notifempty
      copytruncate
  }
  ```
- Không đọc được crontab hiện tại (lỗi khác "chưa có crontab") → dừng, không cài: coi nó là rỗng rồi cài là xoá crontab thật. Đường dẫn repo chứa `%` hoặc dấu nháy đơn → từ chối (cron hiểu `%` là xuống dòng).
- Gỡ: `crontab -e`, xoá khối `# BEGIN cdkt-backup` … `# END cdkt-backup`.

### 6. Xuất .env đã mã hoá — giữ bí mật ngoài VPS

Mất VPS là mất `.env`: `JWT_SECRET`, `CHATBOT_ENCRYPTION_SECRET` (khoá giải mã API key AI, Google OAuth secret, liên kết Drive **đã lưu trong CSDL** — bản dump CSDL không có khoá này thì các giá trị đó vô dụng), mật khẩu MySQL. Lệnh này ghi `<repo>/.env.enc`:

- `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt`; passphrase gõ **hai lần**, không hiện, **≥ 12 ký tự**. Passphrase tới openssl qua file descriptor (`-pass fd:3`) — không bao giờ nằm trên dòng lệnh (`ps`). Không in nội dung `.env` hay passphrase.
- Ghi tệp tạm quyền 600 rồi `mv`, **giải mã thử ngay** bằng passphrase vừa gõ (không khớp `.env` → không ghi gì). Đã có `.env.enc` → hỏi ghi đè (mặc định không). openssl thiếu `-pbkdf2` (OpenSSL 1.0.x) → từ chối, không lùi về mã hoá yếu hơn.
- **Việc của anh:** tải về (`scp <user>@<vps>:<repo>/.env.enc ./cdkt-env-<ngày>.enc`), cất ở nơi khác VPS, **xoá bản trên VPS** (`rm <repo>/.env.enc`), và giữ passphrase ở chỗ **khác** tệp đó. Giải mã khi cần: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in .env.enc -out .env` (hỏi passphrase).
- `.env.enc` đã nằm trong `.gitignore`/`.dockerignore` (khuôn `.env.*`).

---

## Cấu trúc thư mục

```
production/
├─ manage.sh           # script chính (menu 1/2/3/4)
├─ README.md           # tệp này
└─ migrations/          # thả file .sql vào đây (INSERT-only, không DROP)
   └─ .imported-*       # đánh dấu đã import (tự tạo)
```

Ở **root repo** trên VPS, các thư mục deploy tự tạo (đều trong `.gitignore` — bản dump
CSDL chứa toàn bộ dữ liệu production, không bao giờ được commit):

```
.deploy-compose-backups/   # docker-compose.yml trước mỗi lượt đổi (giữ 10)
.deploy-db-backups/        # dump CSDL trước mỗi lượt đổi image (giữ 5)
.deploy-incoming/          # backup-db.sh CI gửi lên trong lúc deploy (tự xoá)
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

Dev merge code vào `main`. **CI tự deploy**: build image → push GHCR → SSH vào VPS → gửi `docker-compose.yml` và `scripts/backup-db.sh` của đúng commit đó lên (kiểm SHA-256) → `docker pull` → **dump CSDL vào `.deploy-db-backups/`** (hỏng thì dừng, chưa chạm gì — xem *Bản dump CSDL trước deploy*) → sao lưu compose cũ vào `.deploy-compose-backups/`, chạy `docker compose config -q` (sai thì dừng, không chạm container) → khởi động lại **chỉ app** (`up -d --no-deps app`; mysql chỉ được bật nếu đang dừng, không bao giờ bị tạo lại) → chờ healthcheck (container khởi động lại > 2 lần = crash loop → dừng chờ ngay), hỏng thì tự lùi về image **và** compose trước → khoẻ thì dọn image cũ → **smoke test qua tên miền công khai** (`VPS_SMOKE_URL`) (job `deploy` trong `.github/workflows/ci.yml`, chạy khi job `image` thành công; chi tiết `CI-CD.md`). **Merge vào `main` là lên production ngay** — chỉ merge khi đã sẵn sàng. Ngoại lệ: merge mà **mọi** tệp đổi **so với bản đang chạy trên production** là `*.md`, `docs/` hoặc `openspec/` thì CI vẫn chạy test nhưng **không** build image, **không** deploy, không khởi động lại container. "Bản đang chạy" là `version` mà `<VPS_SMOKE_URL>/api/public/health` trả về, hoặc (biến chưa đặt / trang không trả lời) commit của lượt CI gần nhất có job `Deploy to VPS` thành công — không phải commit ngay trước trên `main`: một commit mã chưa từng lên production (lượt của nó bị huỷ khi đang chờ, hoặc đỏ trước bước build image) vẫn được deploy cùng merge tài liệu kế tiếp. Không xác định được bản đang chạy → deploy (chi tiết `CI-CD.md` § *Mốc so của "chỉ tài liệu"*).

> ⚠️ **`docker-compose.yml` trên VPS do CI quản lý.** Vì CI ghi đè tệp này mỗi lượt
> deploy, bản clone git trên VPS sẽ thấy nó "đã sửa", và `git pull` (kể cả bước Pull
> code của `manage.sh` → Update) sẽ **từ chối** mỗi khi lượt kéo đó cũng đổi
> `docker-compose.yml`. Tệp CI đặt vào luôn là bản đã commit trên `main`, nên bỏ thay
> đổi cục bộ là an toàn:
>
> ```bash
> cd /www/wwwroot/conduonghuongthien
> git checkout -- docker-compose.yml && git pull origin main
> ```
>
> Thay đổi ở service `mysql` trong compose **không** được CI tự áp (CI không tạo lại
> CSDL). Muốn áp: `docker compose up -d` trong giờ thấp điểm.
>
> Container app chạy giờ Việt Nam (`TZ=Asia/Ho_Chi_Minh`), mysql giữ UTC — xem mục
> *Múi giờ* trong `DEPLOY.md`. Biến dạng công tắc (`RETENTION_SCHEDULER`,
> `ANALYTICS_SCHEDULER`, `BACKUP_SCHEDULER`, `LOG_LEVEL`, `LOGIN_CAPTCHA_ENABLED`,
> `MFA_ENFORCEMENT`) nay đặt được trong `.env`; để trống = mặc định của code. **Đừng đặt
> `LOGIN_CAPTCHA_ENABLED=0` trên production** — biến đó chỉ dành cho bộ E2E.
> `MFA_ENFORCEMENT=0` chỉ dùng như công tắc khẩn cấp (xem § *Bảo mật đợt 2 — 2A*).

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

## Giải mã HTML entity trong tiêu đề/sapo đã lưu (làm một lần, `db:decode-excerpts`)

Sapo nhập từ CMS cũ lưu chữ dạng entity (`Ng&agrave;y 26/8`). Trang công khai đã hiện đúng (giải mã lúc đọc), nhưng tìm kiếm SQL (`LIKE '%Ngày%'`) không khớp các hàng đó. Lệnh này ghi lại `title`/`excerpt` của `articles` và `article_translations` thành đúng chữ trang công khai đang hiện. Nó **không** đụng `content`, giữ nguyên `updated_at`, duyệt theo lô 200 hàng, và bỏ qua hàng vừa có người sửa. Sau khi CI đã deploy bản có `db:decode-excerpts`:

```bash
cd /www/wwwroot/conduonghuongthien
docker exec -it cdkt_app npm run db:decode-excerpts              # 1. xem trước: KHÔNG ghi
./scripts/backup-db.sh                                           # 2. sao lưu (chỉ hoàn tác được bằng bản này)
docker exec -it cdkt_app npm run db:decode-excerpts -- --apply   # 3. ghi
```

Đọc báo cáo bước 1 trước khi ghi:
- `changed`: số hàng sẽ đổi ở mỗi bảng.
- `fragments`: những trường mà kết quả **bỏ một đoạn cuối** (`… nh&ac` → `… nh…`, sapo CMS cũ bị cắt giữa entity). Phép đoán không phân biệt được entity bị cắt với một `&chữ` thật ở cuối chuỗi có entity khác: `C&ocirc;ng ty AT&T` cũng thành `Công ty AT…`. Mỗi mục có `id`, `field` và phần cuối trước/sau. Thấy mục nào cắt sai thì sửa tay bài đó trong admin trước (lưu lại bài là làm sạch nó), rồi mới `--apply`.
- `unstable`: các trường **không** được ghi. Đó là chữ entity viết nguyên văn (`&amp;agrave;`), loại mà ghi xong thì trang công khai lại giải mã thêm một lần. Sửa tay nếu cần.

Chạy lại được: lượt sau chỉ báo những hàng còn ở dạng entity.

---

## Sao lưu tự động trong ứng dụng (scheduler)

Từ đợt wave1 1B, ở production scheduler sao lưu **tự khởi động** (trước đây chỉ khởi động khi `.env` có `BACKUP_SCHEDULER=1`, nên công tắc trong admin bật mà không bao giờ chạy). Có bản sao lưu hay không vẫn do công tắc **"Backup tự động theo lịch"** ở `/admin/settings/backup` quyết định. Công tắc mặc định tắt, nên bản cập nhật này không tự sinh bản sao lưu nào.

- **Trước khi deploy bản 1B:** mở `/admin/settings/backup` và xem công tắc. Nếu nó **đã bật** từ trước (lần bật cũ "không có tác dụng"), sao lưu theo lịch sẽ bắt đầu ở **khe kế tiếp** sau deploy (ngày + giờ đã chọn). Mỗi lượt tạo một dump CSDL và hai archive (`uploads`, `media`) trong `./backups`, nên kiểm dung lượng đĩa (`df -h`). Không muốn thì tắt công tắc trước. Cũng trước khi deploy: archive mồ côi (tệp tên-app không có trong danh sách, do lỗi cũ để lại) sẽ bị xoá ở lần khởi động đầu. Muốn giữ thì chép chúng ra ngoài `./backups`.
- **Lịch:** chạy đúng ngày + giờ đã chọn (giờ Việt Nam; `0` là nửa đêm). Lượt hỏng (kể cả lượt bị cắt ngang khi container dừng) được thử lại sau 60 phút, tối đa 3 lượt cho một khe, rồi bỏ khe đó và ghi log `backup.slot_abandoned`. Khe lỡ vì máy chủ tắt được bù **một lần** khi khởi động lại. Những trường hợp sau thì **không** bù, mà đợi khe kế tiếp: bật công tắc lần đầu, bật lại công tắc, hoặc sửa giờ/ngày. Sửa giờ 3 → 10 thì lượt kế tiếp chạy lúc 10:00, không chạy ngay.
- **Trạng thái lịch** nằm ở một hàng `settings` (`backup_scheduler_state`), không suy từ danh sách backup. Xoá bản sao lưu hay xoay vòng (`backup_keep_count`) không làm lịch chạy thêm lượt nào. Khôi phục một bản dump CSDL cũng không đè hàng này: app giữ trạng thái của hệ thống đang chạy. Đừng sửa tay hàng này: xoá nó thì scheduler coi như chưa từng chạy và đợi khe kế tiếp.
- **Tắt hẳn ở máy chủ:** đặt `BACKUP_SCHEDULER=0` trong `.env` rồi `./manage.sh` → Update. Trang cài đặt backup sẽ hiện dòng "Máy chủ đang tắt sao lưu tự động".
- **Tệp dở:** lượt sao lưu ghi vào `<tên>.partial` và chỉ đổi sang tên thật khi đã ghi hàng vào danh sách. Lượt hỏng tự xoá `.partial` của mình. Lượt bị giết (hết thời gian dừng, `docker kill`) để lại một tệp `.partial`; app tự dọn tệp đó ở lượt sao lưu kế tiếp, và 1 phút sau mỗi lần khởi động (chỉ khi máy chủ bật scheduler, tức mặc định ở production; `BACKUP_SCHEDULER=0` thì không dọn lúc khởi động). App chỉ dọn tệp mang đúng tên do chính nó sinh, nên tệp `.partial` của `scripts/backup-db.sh` (cron, cùng thư mục `./backups`) do script đó tự lo. Hàng "thất bại" trong danh sách nêu đúng tệp đã hỏng.
- **Tệp tên dạng app mà không có trong danh sách** (`cdkt-<mã thời điểm>-<trigger>.sql.gz`, `cdkt-uploads|media-<mã thời điểm>-<trigger>.tar.gz`) và cũ hơn 10 phút sẽ bị app xoá. Đó là dấu vết của một lượt bị giết đúng lúc ghi danh sách. **Đừng chép tay** một tệp backup của app vào `./backups` để giữ: nó sẽ bị xoá. Muốn nạp một bản từ ngoài thì dùng "Khôi phục từ tệp tải lên". Tệp của `scripts/backup*.sh` (`cdkt-<db>-…-<pid>`, `cdkt-media-…-<pid>`) không bị đụng.
- **Hai lượt cùng trigger trong cùng một giây** (ví dụ bấm "Backup" hai lần thật nhanh): lượt sau bị từ chối với thông báo "đã tồn tại" (kể cả khi lượt trước hỏng). Bản đã có không bị đụng tới. Thử lại sau giây lát.
- **Xoá một bản** trong danh sách chỉ xoá đúng hàng đó. Tệp chỉ bị xoá khi không còn hàng nào khác cùng tên.
- **Bản ngoài máy chủ (Google Drive) — wave2 D-OFFSITE.** Mọi lượt sao lưu (theo lịch, bấm tay, `pre-*`) tự upload lên Drive khi đã bật "Upload lên Google Drive" **và** có liên kết OAuth hoặc service account. Cột **"Bản ngoài máy chủ"** trong danh sách nói từng tệp: *Đã lên Drive* / *Lỗi tải lên Drive* / *Chỉ trên máy chủ* (cột `backups.offsite_status`: `uploaded`/`failed`/`none`). Drive hỏng **không xoá tệp cục bộ** và không làm lượt sao lưu hỏng — tệp mang *Lỗi tải lên Drive* và log có `backup.drive_failed` (kèm tên tệp). Lượt chết giữa chừng khi Drive đang bật: các tệp đã ghi trước đó mang *Lỗi tải lên Drive*. Drive bật mà chưa liên kết, chưa có service account → *Chỉ trên máy chủ* + log `backup.offsite_not_configured`. Hàng có từ trước bản này giữ trống trong CSDL (không suy ngược), trang hiển thị theo `drive_uploaded` cũ.
- **Khôi phục một bản dump cũ hơn bản đang chạy.** Dump của app mang `DROP TABLE` + `CREATE TABLE`, nên bảng quay về hình dạng của lúc dump — thiếu các cột/bảng thêm sau đó (vd. `backups.offsite_status`). Ngay sau khi nạp dump (cả khi dump hỏng giữa chừng), app chạy lại đúng các bước cấu trúc của lúc khởi động (`initDb`: `CREATE TABLE IF NOT EXISTS` + di trú bổ sung) **trước** khi gắn lại danh sách backup và ghi audit — nên khôi phục thành công, danh sách và lượt sao lưu kế dùng được ngay, không cần khởi động lại. Log `backup.restore_schema_converged`. Bước này chỉ *thêm*: cột đã bỏ khỏi mã mà dump cũ còn mang không được gỡ; giá trị mặc định (seed) chỉ quay lại ở lần khởi động sau.
  - **Bước cấu trúc hỏng** (`schema_convergence_failed`, log `backup.restore_schema_convergence_failed`): dữ liệu **đã** được nạp, nhưng chính dữ liệu đó chặn một bước khởi động (vd. một hàng mồ côi chặn khoá ngoại). **Đừng khởi động lại container để "sửa"**: mỗi lần khởi động chạy đúng bước đó (`init.ts && …`) và container sẽ dừng lặp lại. Thông báo nêu **tên bản an toàn** (`cdkt-<mã>-pre-restore.sql.gz`) — khôi phục bản đó để về trạng thái ngay trước lượt này, đọc log để biết bước nào hỏng, rồi sửa bản dump.
    - Bấm khôi phục bản an toàn **chạy được cả khi** lượt hỏng để bảng `backups` ở hình dạng cũ (bước cấu trúc dừng trước khi tới nó): mỗi lượt khôi phục CSDL đưa riêng `backups` về hình dạng hiện tại **trước** khi tạo bản an toàn, và mọi lối ghi vào danh sách (đăng ký bản sao lưu, kể cả `pre-restore`; tệp tải lên; gắn lại sau khôi phục) tự thích ứng với bảng thiếu cột (log `backup.registry_old_shape`).
    - **Không khôi phục được trong app** (vd. app không lên): làm trên máy chủ với **chính tệp đó** trong `./backups` — `docker compose stop app`, `./scripts/restore-db.sh backups/cdkt-<mã>-pre-restore.sql.gz <MYSQL_DATABASE> --replace` (script tự dump bản hiện có ra `backups/cdkt-prerestore-*` trước khi ghi đè), rồi `docker compose up -d --no-deps app`. Xem DEPLOY.md, mục *Khôi phục thật*. Script nhận dump của app từ bản này trở đi (có dòng `-- Dump completed` ở cuối); dump của app tạo **trước** bản này không có dòng đó và bị từ chối là "bị cắt cụt" — khôi phục chúng trong app.
  - **Khôi phục hỏng giữa chừng** (dump chết sau khi đã thay bảng, bước cấu trúc hỏng, hoặc transaction audit hỏng): app đưa riêng `backups` về hình dạng hiện tại rồi **gắn lại** danh sách backup của hệ thống đang chạy (bản `pre-restore` và mọi bản mới hơn, giữ nguyên giá trị kể cả ngày giờ) ngay trong khoá khôi phục — nên bản an toàn luôn hiện trong danh sách để bấm khôi phục. Trạng thái lịch sao lưu (`backup_scheduler_state`) của hệ thống đang chạy cũng được ghi lại, như ở lượt thành công. Log `backup.restore_failed_rows_reattached`.
  - **Trong lúc khôi phục CSDL không có lượt sao lưu nào bắt đầu** (bấm tay → 409 "Đang khôi phục cơ sở dữ liệu…"; lịch → log `backup.scheduler_busy`, không tính là một lần thử, tick kế tiếp chạy lại): lượt khôi phục sẽ tua lại danh sách, một bản tạo giữa chừng sẽ mất hàng. Chỉ bản `pre-restore` của chính lượt khôi phục được chạy.
  - Cấu hình `DB_NAME` trống mà `MYSQL_DATABASE` khác `cdkt_admin`: khôi phục CSDL bị từ chối **trước** bản an toàn (`db_name_mismatch`) — bước cấu trúc sẽ chạy trên CSDL khác. Container compose luôn đặt `DB_NAME`.
  - **Dump có từ trước 2026-09-22:** khôi phục nó cũng chạy các bước chuyển đổi đã thiết kế của lúc khởi động trên dữ liệu cũ đó, như lần nâng cấp thật đã làm: danh mục video trỏ về bảng thể loại bài viết cũ bị gỡ (`media_items.category_id` = NULL — xem *Sửa dữ liệu sau deploy*), `short_id` được điền, URL media cũ được sửa. Đó là hành vi đúng của bản đang chạy, không phải mất dữ liệu do khôi phục.
- **Lượt dọn tệp mồ côi đóng an toàn** (nó chỉ dọn tệp tên-app không có hàng, cũ hơn 10 phút):
  - chỉ tin bảng `backups` khi đọc được **đủ mọi cột** app chờ — bảng sai hình dạng (vd. vừa nạp dump cũ) → không xoá tệp tên-thật nào, log `backup.orphan_sweep_skipped`;
  - **không bao giờ** xoá bản `pre-restore` (như xoay vòng);
  - giữ mọi tệp có mã thời điểm **không sau** bản `pre-restore` mới nhất: tệp đó có từ trước lượt khôi phục gần nhất, nên có thể mất hàng chỉ vì khôi phục đã tua lại danh sách (log `backup.orphan_kept_restore_window`). Cái giá: tệp sót của một lượt bị giết *trước* lượt khôi phục đó nằm lại tới khi anh xoá bản `pre-restore` ấy;
  - không xoá tệp tên-thật nào khi một lượt khôi phục đang giữ khoá (hoặc không hỏi được MySQL).
- **Cảnh báo "chỉ nằm trên máy chủ".** Khối *Cài đặt backup* hiện cảnh báo vàng khi "Backup tự động theo lịch" bật mà chưa có nơi lưu ngoài máy chủ (Drive tắt, hoặc bật mà chưa liên kết/không có service account). Ngoài Drive, nơi lưu ngoài VPS còn lại là việc của anh: chép `./backups/` sang máy khác, và giữ `.env.enc` (Menu 6) ngoài VPS.

---

## Bảo mật đợt 2 — 2A: MFA bắt buộc, bí mật mã hoá, chặn yêu cầu khác site

Bản cập nhật này **không cần sửa `.env`** — mọi thứ mặc định giữ nguyên hành vi cũ, trừ hai việc tự chạy:

- **Mật khẩu SMTP, Secret Key R2 (ảnh) và khoá JSON service account Drive được mã hoá** trong bảng `settings` (khoá `CHATBOT_ENCRYPTION_SECRET`). Lần khởi động đầu của image mới tự mã hoá giá trị đang lưu nguyên văn (log `db.migration.settings_secrets_encrypted`, chỉ tên khoá); các lần sau không ghi gì. Bản dump trước deploy (`.deploy-db-backups/`) còn bản nguyên văn — **xử lý như tài liệu mật**, xoá khi không cần.
  - Log `db.migration.settings_secret_unreadable` = một bí mật đã lưu không mở được bằng khoá hiện tại (khoá đã đổi). Giá trị đó **không bị ghi đè**; trang cài đặt (Email / Lưu trữ Media / Sao lưu) báo "cần nhập lại" — nhập lại rồi lưu.
  - **Lùi về image cũ hơn bản này** thì ba giá trị trên là envelope mà code cũ không đọc được: email, R2 ảnh, Drive service account ngừng chạy cho tới khi nhập lại ở trang cài đặt (code cũ lưu lại nguyên văn).
- **Chặn yêu cầu ghi khác site** (`server/middleware/00.origin-gate.ts`): mọi POST/PUT/PATCH/DELETE mà trình duyệt gửi thay một trang khác (kể cả tên miền con anh em `*.delify.vn`) bị 403, log `security.cross_site_refused` (đường dẫn + host của `Origin`). Host được chấp nhận làm `Origin`: host của `PUBLIC_BASE_URL`, `PUBLIC_HOST_ALLOWLIST`, và host của chính request **chỉ khi** nginx là proxy đã khai trong `TRUSTED_PROXY_IPS` (khi đó `X-Forwarded-Host`/`Host` nginx chuyển — xem `CI-CD.md`). Đặt đủ mọi tên miền thật vào `PUBLIC_HOST_ALLOWLIST` là đủ. Trình duyệt hiện đại gửi `Sec-Fetch-Site` nên phần lớn lượt được quyết định trước bước so `Origin`. Cron/curl không gửi `Origin`/`Sec-Fetch-Site` nên không bị ảnh hưởng.
- **Chính sách bắt buộc MFA** — mặc định `off`, không đổi gì cho tới khi SuperAdmin bật ở `/admin/settings/security` (`privileged` = SuperAdmin + ai sửa/xoá được Người dùng, Vai trò, Cài đặt; `all` = mọi tài khoản). Bật = 14 ngày chuyển tiếp (banner báo ngày), sau đó tài khoản thuộc diện chưa có yếu tố chỉ vào được trang "Tài khoản của tôi" để bật; lúc bật yếu tố đầu tiên hệ thống phát kèm mã dự phòng (hiện một lần).
  - **Công tắc khẩn cấp `MFA_ENFORCEMENT=0`** trong `.env` (đã có trong `environment:` của compose) → `./manage.sh` Update hoặc `docker compose up -d --no-deps app`: không ai bị chặn vì thiếu MFA (chính sách vẫn lưu). Dùng khi một yếu tố hỏng hàng loạt — SMTP chết (email OTP), xoay `JWT_SECRET` (TOTP vô hiệu). Bỏ lại ngay khi xong sự cố.
  - Khoá cứng một tài khoản: SuperAdmin xoá yếu tố của nó ở trang Người dùng (break-glass), hoặc đăng nhập bằng mã dự phòng. Runbook: `docs/decisions/realm-safety.md` § *MFA bắt buộc — khoá ngoài & break-glass*.
- **Xoay `CHATBOT_ENCRYPTION_SECRET`** nay kéo theo: nhập lại mật khẩu SMTP, Secret Key R2 (ảnh + video) và khoá service account Drive, liên kết lại Drive OAuth, nhập lại API key các nhà cung cấp ở AI Panel (`cdkt-ai-provider-key:v1`), API key của trợ lý (`cdkt-chatbot-provider-key:v1`) và secret Google OAuth — tám nhãn, bảng đầy đủ trong runbook: `docs/decisions/realm-safety.md` § *Xoay CHATBOT_ENCRYPTION_SECRET*.

---

## Dọn dữ liệu analytics thô (tồn đọng sau bản vá 1B)

Lệnh dọn sự kiện xem trang thô (`analytics_page_view_events`, giữ 14 ngày) trước đây là câu SQL MySQL không chấp nhận, và lỗi bị nuốt. Vì vậy dữ liệu thô **chưa từng được dọn**, và các bảng tổng hợp theo ngày cũng không được dọn. Sau khi deploy, lượt bảo trì hằng đêm (scheduler trong app, hoặc cron `npm run analytics:maintenance`) bắt đầu xoá phần tồn đọng. Mỗi lượt xoá theo lô có trần (mặc định tối đa 1000 lô × 500 hàng mỗi bảng), nên với tồn đọng lớn, vài đêm đầu lượt bảo trì báo trạng thái `warning` (chưa dọn hết). Đó là bình thường; trạng thái tự về `success` khi đã dọn kịp. Chỉ xoá sự kiện của những ngày **đã tổng hợp xong**. Bước dọn nào hỏng sẽ ghi một dòng log `analytics.retention_step_failed` kèm `step` và `code`, và không chặn các bước khác.

---

## Sửa dữ liệu sau deploy (post-deploy data repair): danh mục video bị xoá lúc khởi động

Từ 2026-09-22 tới bản vá `fix-media-category-wipe-on-boot`, **mỗi lần app khởi động** (deploy CI, `manage.sh` Update, restart sau sự cố) đều xoá danh mục của mọi video trong Media Portal. Bản vá chặn việc xoá từ lần khởi động đầu tiên của image mới. Giá trị đã mất thì không tự về: phải khôi phục từ bản sao lưu theo runbook ở [`docs/decisions/data-layer.md` § Khôi phục danh mục video sau lỗi xoá lúc khởi động](../docs/decisions/data-layer.md#media-category-restore).

- **Ngay hôm nay, trước cả khi merge:** làm bước 0 của runbook — chép `./backups/*.sql.gz` ra một thư mục ngoài vòng xoay. Vòng xoay (`BACKUP_KEEP_DAYS`, `backup_keep_count`) đang xoá đúng những bản có thể còn giữ danh mục.
- Chỉ khôi phục **sau khi** image đã vá chạy healthy. Bản dump chỉ nạp vào CSDL **nháp**, không bao giờ vào CSDL production.

> ⚠️ **Đừng bao giờ lùi về image cũ hơn bản vá này** — kể cả lùi tay, kể cả lượt lùi
> tự động của deploy khi healthcheck hỏng. Lần khởi động đầu của image cũ sẽ xoá
> danh mục video **lại**, kể cả những giá trị vừa khôi phục. Image mới không khởi
> động được vì lý do khác thì sửa tiến (fix forward), đừng lùi.

---

## Dữ liệu mặc định, đổi domain R2, quét ảnh (wave2 2B — CHANGELOG § 37)

Không có biến `.env` mới, không có bước tay bắt buộc. Lần khởi động đầu sau deploy tự làm hai việc: thêm cột `media.scanned_source_path` cùng chỉ mục của nó (chỉ đổi lược đồ), và ghi 5 dấu seed vào `settings`.

**Dữ liệu mặc định seed một lần cho mỗi CSDL.** Năm nhóm này trước đây được chèn lại mỗi lần container khởi động: thể loại, danh mục bài viết, danh mục video, luật kiểm duyệt, mạng xã hội. Mục cán bộ đã **xoá** vì thế quay lại sau mỗi deploy. Nay mỗi bộ default của một nhóm được đánh dấu một lần bằng một hàng `settings` (`seed.<nhóm>.v<N>.done`, nhóm `internal`, giá trị là giờ ghi):
- **Lần khởi động đầu sau deploy:** bảng đã có hàng thì chỉ ghi dấu, **không chèn gì**. Mục đã xoá vẫn xoá, mục đã sửa giữ nguyên.
- **CSDL mới tinh:** chèn đủ default một lần rồi ghi dấu. `npm run db:init` một mình **không còn** tạo thể loại/danh mục bài viết. Luôn chạy `db:init` rồi `db:seed`, như `Dockerfile` CMD và `tests/e2e/global-setup.ts` đã làm.
- **Muốn có lại default của một nhóm** (ví dụ lỡ xoá hết danh mục video): tạo tay trong trang quản trị. Hoặc làm cả hai bước sau, rồi khởi động lại app: xoá hết hàng của bảng đó, và xoá dấu của nhóm (ví dụ danh mục video):

  ```sql
  DELETE FROM settings WHERE `key` = 'seed.media_categories.v1.done';
  ```

  Chỉ xoá dấu thì không đủ: bảng còn hàng nghĩa là chỉ ghi dấu lại, không chèn. Tên dấu của các nhóm khác: `seed.content_types.v1.done`, `seed.categories.v1.done`, `seed.moderation_rules.v1.done`, `seed.social_links.v1.done`.
- **Khôi phục một bản dump cũ** (chưa có dấu) thì lần khởi động sau lại chỉ ghi dấu, không hồi sinh mục đã xoá.
- Dấu không hiện ở trang cài đặt, và API cài đặt không nhận khoá `seed.*`.

**Đổi domain R2** (`/admin/media/scan` → "Đổi domain URL R2"):
- **Điều kiện trước (bắt buộc):** domain mới phải nằm trong cả hai danh sách ở `shared/media-hosts.ts`:
  - `CSP_IMG_SRC_HOSTS` — nguồn ảnh của header CSP `img-src`, hiện `*.delify.vn`, `*.conduonghuongthien.vn`, `www.facebook.com`, `www.googletagmanager.com`, `*.gov.vn`. `*.x` gồm mọi subdomain của `x` nhưng **không** gồm chính `x`. Host có cổng khác mặc định không khớp.
  - `IMAGE_PROXY_DOMAINS` — `image.domains` của NuxtImg/IPX, so đúng tên host, hiện chỉ `cdn1.delify.vn`.

  Ngoài danh sách thì trang trả lỗi 400 nêu đúng danh sách cho phép và **không đổi gì**. Bỏ qua phép kiểm này thì sẽ hỏng ảnh: ngoài CSP là trình duyệt chặn **mọi** ảnh vừa đổi trên toàn site; ngoài IPX là logo và ảnh đại diện tối ưu thành ảnh dự phòng. Chuyển sang CDN mới: thêm host vào file đó, merge + deploy, **rồi** mới đổi domain.
- **Đổi ở đâu:** `media.url` của hàng R2, và **mọi** cột nội dung đang nhúng URL ảnh. Đó là 27 cột: bài viết, bản dịch, khối trang, phiên bản trang, `settings` (logo, menu…), chatbot, livestream, danh mục, bản dịch giao diện. Trước đây chỉ đổi `media.url` và `articles.content`.
- **Đổi gì:** chỉ đổi domain đứng ngay sau `https://`/`http://` và trước `/` hoặc hết URL. `xold.cdn`, `old.cdn.evil`, `old.cdn:8443` và `//old.cdn` không bị đụng.
  - **Hoa thường:** scheme + host so không phân biệt hoa thường (`HTTPS://OLD.CDN/…` cũng đổi), đường dẫn thì có. Domain nhập vào được chuẩn hoá: host chữ thường, tên miền tiếng Việt có dấu → punycode, bỏ `/` cuối.
  - **Cài đặt cũng đổi theo:** `r2_public_url`, nếu lưu kèm `https://` và đúng domain cũ, được đổi sang domain mới. **`media_video_r2_public_url` (R2 riêng của video) cũng bị đổi nếu nó dùng chung domain cũ** — một domain là một domain; nếu bucket video vẫn phải ở domain cũ thì sửa lại ô đó ở `/admin/settings/media-portal` sau khi đổi.
- **Kết quả:** một transaction cùng dòng audit `repoint_urls`. Kết quả báo số hàng đã đổi theo từng cột (`byTarget`).
- **Sao lưu SQL trước khi đổi là bắt buộc:** sao lưu hỏng (đầy đĩa, khoá backup bận…) thì trả lỗi và **không đổi URL nào**. Nguyên nhân nằm ở log `media.repoint_pre_backup_failed`. Dọn đĩa / đợi lượt backup khác xong rồi bấm lại.
- **Không chạy song song:** lượt đổi giữ khoá của lượt đồng bộ local ↔ R2 / "Sửa URL" và của lượt quét thư mục — các lượt đó dựng URL từ domain cũ. Đang có lượt nào chạy thì trả 409, đợi xong rồi bấm lại. Lỗi khác trả câu chung, nguyên nhân ở log `media.repoint_failed`. Transaction đã rollback nên không có URL nào bị đổi.
  - Tải ảnh lên thường (thư viện ảnh, trình soạn bài) không giữ khoá: một ảnh tải lên **đúng lúc** đang đổi domain có thể mang domain cũ. Bấm đổi lại cùng cặp domain một lần nữa thì chỉ những URL sót đó được đổi.
- Chạy lại cùng cặp domain thì không đổi gì.

**Quét thư mục ảnh** (`/admin/media/scan`):
- **Không nhập lại:** mỗi tệp được nhập ghi lại đường dẫn nguồn (tương đối với `public/uploads/`). Quét lại thì không nhập lại tệp đó, kể cả khi bản nhập nằm trên R2.
- **Tệp do lượt quét cũ nhập** (trước bản này, chưa ghi nguồn): lượt quét đầu tiên nhận chúng bằng **tên tệp + kích thước** của một hàng R2 còn trống nguồn, rồi ghi nguồn cho hàng đó. Dòng tiến độ báo "đã được lượt quét trước nhập lên R2". Lượt cũ đặt khoá R2 theo tháng tải lên chứ không theo thư mục nguồn, nên không so được theo khoá. Mỗi tệp nhận đúng một hàng.
  - **Ngoại lệ còn lại:** một tệp đã bị sửa (khác kích thước) sau lượt quét cũ thì vẫn được nhập thêm. Các hàng trùng còn lại xem ở báo cáo ảnh trùng bên dưới.
- **Không ghi đè:** tệp trùng tên với một ảnh đã có trên R2 cùng tháng (cùng khoá `YYYY/MM/<tên>`) bị **bỏ qua**, và hiện ở dòng "trùng tên" của tiến độ. Đổi tên tệp rồi quét lại nếu cần nhập.
- **Ghi hàng hỏng sau khi đã tải lên:** object vừa tải bị xoá (log `media.scan_insert_failed`, `objectDeleted`). Ngoại lệ: lỗi mất kết nối đúng lúc COMMIT mà hàng vẫn đã được ghi. Khi đó object được **giữ**, log có `keptBecause: owned_by_row`.

**Báo cáo ảnh trùng**: `GET /api/admin/media/duplicates`, quyền `media.read`, mở khi đã đăng nhập quản trị.
- **Trả về:** các nhóm hàng cùng tên tệp + kích thước, và các nhóm hai hàng chung một chỗ lưu. Mỗi hàng kèm số nơi đang dùng URL của nó (`usage.total`, `usage.byTarget`).
- **Có trần:** đọc các cột nội dung tối đa 20 giây / 200 000 hàng.
  - `usageTruncated: true` nghĩa là chưa đọc hết, số nơi dùng chỉ là cận dưới. **Đừng xoá hàng chỉ vì `usage.total` = 0 khi cờ này bật.**
  - `truncated: true` nghĩa là còn nhóm ngoài trần 200 nhóm.
  - Mỗi lúc chỉ một báo cáo chạy; lượt thứ hai trả 409.
- **Chỉ đọc, không xoá gì.** Giữ hàng đang được dùng. Xoá hàng thừa qua thư viện ảnh; thư viện chặn xoá ảnh còn được dùng.
- **Cảnh báo:** nhóm `storage_path` là hai hàng **một object**. Xoá một hàng qua thư viện là xoá ảnh của hàng kia.

**Vá URL ảnh lúc khởi động** (`repairLegacyMediaUrls`, tự chạy):
- Domain lấy từ `r2_public_url`, không còn `cdn1.delify.vn` viết cứng. Chưa cấu hình mà còn URL `localhost:3000/<domain>` chờ vá thì log `db.migration.legacy_media_domain_unknown`.
- Liên kết `…/uploads/migrated/media/<tên>` mà các hàng `media` mang tên đó trỏ tới **hơn một URL khác nhau** thì được giữ nguyên, kèm log `db.migration.legacy_media_ambiguous` liệt kê tên tệp. Sửa tay bài viết đó (chọn đúng ảnh). Hai hàng trùng cùng một URL thì không tính là mơ hồ.
- Vá liên kết không còn đổi "ngày cập nhật" của bài.

**Quét lại kiểm duyệt** ("Quét & Dọn ngay" ở `/admin/ai/moderation`): nếu kết nối CSDL giữ khoá rơi giữa chừng, lượt quét dừng trước lô kế tiếp. Lúc đó trang báo "đã tạm dừng" và log ghi `ai_moderation.rescan_lock_lost`. Bấm lại để quét tiếp phần còn lại.

---

## Sao lưu & khôi phục (tóm tắt — chi tiết ở `DEPLOY.md` § Backup & Restore)

Toolkit này **không** tự chạy sao lưu định kỳ (nó chỉ dump trước mỗi lượt Update — xem *Bản dump
CSDL trước deploy*); sao lưu định kỳ chạy bằng cron trên host — **cài bằng Menu 5** (`./manage.sh
backup-cron`: in đúng các dòng dưới, chỉ cài khi đồng ý, chạy lại không nhân đôi) hoặc gõ tay.
Đặt thêm `HEALTHCHECK_PING_URL` để biết khi cron ngừng (xem *Giám sát cron sao lưu*):

```bash
0 2 * * * cd /www/wwwroot/conduonghuongthien && ./scripts/backup.sh >> /var/log/cdkt-backup.log 2>&1
```

`backup.sh` tạo một bộ **cùng mã thời điểm**: dump CSDL `cdkt-<db>-<mã>-<pid>.sql.gz`,
archive `media_work` `cdkt-media-<mã>-<pid>.tar.gz` **và** archive `uploads_data`
`cdkt-uploads-<mã>-<pid>.tar.gz` (ảnh/tệp tải lên qua admin — trước đây chỉ bản sao lưu
trong ứng dụng mới có). Khôi phục: `scripts/restore-db.sh` (CSDL, bắt buộc nêu tên
database + `--replace`, tự dump bản hiện có trước khi ghi đè) và
`scripts/restore-media.sh` (media hoặc uploads, theo tên archive). **Sau `restore-db.sh`
luôn khởi động lại app** (`docker compose up -d --no-deps --force-recreate app`): bản dump
trước 2A mang mật khẩu SMTP / Secret Key R2 / khoá service account nguyên văn, và chỉ lượt
khởi động mới mã hoá chúng (`db.migration.settings_secrets_encrypted` trong log).

**Một bản sao lưu chưa từng được khôi phục chỉ là giả thuyết** — nên lên lịch kiểm chứng
hằng tháng (nạp vào CSDL tạm, không đụng CSDL đang chạy):

```bash
30 3 1 * * cd /www/wwwroot/conduonghuongthien && ./scripts/verify-restore.sh --latest >> /var/log/cdkt-verify-restore.log 2>&1
```

(`--latest` chọn bản `backup-db.sh` mới nhất của database trong `.env` — `MYSQL_DATABASE` —
nên không phải sửa dòng cron khi Deploy đặt tên database khác `cdkt_admin`.)

`restore-db.sh` / `restore-media.sh` từ chối khi **không xác định được** app đã dừng hay
chưa (vd. Docker Compose cũ không có `ps --status`): kiểm tay `docker ps`, rồi thêm
`--i-know-app-is-stopped` sau `--replace`. `restore-media.sh` sao lưu volume hiện có ra
`backups/cdkt-prerestore-<media|uploads>-*.tar.gz` trước khi thay (khôi phục lại bằng
chính lệnh đó với tên tệp này; bỏ bước sao lưu bằng `--no-safety-copy`) và từ chối mọi
archive có symlink/hard link/fifo/thiết bị. Chi tiết: DEPLOY.md, mục *Khôi phục thật*.

**Một lần sau bản cập nhật 2026-10:** healthcheck của mysql nay dùng `MYSQL_PWD` thay vì
`-p<mật-khẩu>` (hiện trong `ps` mỗi 10 giây). CI và Update chỉ khởi động lại app
(`--no-recreate mysql`), nên chạy `docker compose up -d mysql` lúc thấp điểm để áp dụng
(dữ liệu ở volume, không mất).

**Bản sao lưu nằm cùng VPS**: mất VPS là mất cả dữ liệu lẫn bản sao lưu. Hãy chép
`./backups/` sang nơi khác (máy khác/đối tượng lưu trữ ngoài VPS; backup Google Drive
trong trang quản trị là tuỳ chọn, phải tự bật). Hai bộ xoay vòng không thấy nhau: shell
xoay theo **ngày** (`BACKUP_KEEP_DAYS`), bản sao lưu trong ứng dụng xoay theo **số bản**
(`backup_keep_count`); chúng dùng chung `./backups` và chỉ xoá tệp do chính mình tạo.

---

## Bản dump CSDL trước deploy (`.deploy-db-backups/`)

Mỗi lượt đổi image — CI deploy, và `./manage.sh` → Update khi trả lời *có* (mặc định) — dump
CSDL **trước** khi đụng tới compose, `.env` hay container. CI: ngay sau `docker pull`, trước khi
đặt compose mới hay sửa `.env`. Update: là câu hỏi **đầu tiên** — trước `git pull`, trước
`git checkout -- docker-compose.yml`, trước các câu hỏi ghi `.env` và trước khi kéo image; thứ
duy nhất chạy trước nó là bước siết quyền `.env` về 600 (không đổi nội dung).

- **Ở đâu:** `<root repo>/.deploy-db-backups/cdkt-predeploy-<db>-<thời-điểm UTC>-<pid>.sql.gz`
  (cạnh `.deploy-compose-backups/`). Không nằm trong `./backups`: `./backups` là bind mount mà
  container giao cho user `node` (uid 1000) mỗi lần khởi động, user deploy của CI chưa chắc
  ghi được vào đó. Update chạy bằng root thì trao thư mục này cho chủ thư mục repo, để lượt
  CI kế tiếp vẫn ghi được.
- **Ai đọc được:** bản dump là toàn bộ CSDL production (hash mật khẩu, email bạn đọc): tệp
  quyền **600**, thư mục **700** (đặt lại cả khi đã có sẵn với quyền rộng hơn). Xem/khôi phục
  bằng chính user deploy hoặc root. Thư mục này (và `.deploy-incoming/`,
  `.deploy-compose-backups/`) nằm trong `.gitignore` **và** `.dockerignore` — một lượt
  `docker compose build` ngay trên VPS không đưa bản dump vào build context.
- **Không bao giờ có bản cụt mang tên thật:** dump được viết dưới tên `….sql.gz.partial` và
  chỉ đổi sang `.sql.gz` sau khi kiểm xong — điều này đúng dù lượt dump dừng kiểu gì. Lượt
  nhận HUP/INT/TERM (Ctrl-C, `kill`) xoá luôn phần dở dang. Lượt không nhận tín hiệu nào có
  thể để lại `….sql.gz.partial`: bị giết hẳn (`kill -9`, mất điện), hoặc job CI bị huỷ/SSH
  đứt (phiên `ssh` không PTY nên VPS không nhận tín hiệu treo máy; script chạy tiếp hoặc chết
  vì SIGPIPE khi ghi log). Lượt dump sau cùng họ xoá phần đó khi đã quá 1 ngày.
- **Kiểm như bản đêm:** cùng `scripts/backup-db.sh` (gzip, dấu `Dump completed`, ≥ 20 bảng,
  ≥ 50 KB SQL); bản không đạt bị xoá và lượt deploy **dừng** — compose, `.env`, container y
  như trước. Lý do thường gặp: đĩa đầy, `cdkt_mysql` không chạy, `.env` thiếu `MYSQL_ROOT_PASSWORD`.
- **Giữ 5 bản** mới nhất (theo số lượng, không theo ngày); không đụng tới bản đêm
  `backups/cdkt-<db>-…` và không gửi ping giám sát.
- **Đi cặp với lượt lùi:** bản `cdkt-predeploy-*` mới nhất có giờ trước lượt deploy hỏng là
  CSDL của **image trước**. Image mới hỏng dữ liệu (migration) thì lùi image (CI-CD.md § Lùi
  phiên bản) **và** khôi phục bản đó:

  ```bash
  cd /www/wwwroot/conduonghuongthien
  ls -t .deploy-db-backups/
  docker compose stop app
  ./scripts/restore-db.sh .deploy-db-backups/cdkt-predeploy-<db>-<thời-điểm>-<pid>.sql.gz <db> --replace
  ```

  `restore-db.sh` tự dump bản hiện có (`backups/cdkt-prerestore-*`) trước khi ghi đè.
  Rồi `docker compose up -d --no-deps app` — app khởi động lại cũng là lúc nó mã hoá bí mật
  nguyên văn mà một bản dump cũ mang về.
  ⚠️ Lùi tay chỉ tạm thời: với `VPS_SMOKE_URL` đã đặt, lượt merge kế tiếp vào `main` — **kể cả
  merge chỉ sửa tài liệu** — so với bản vừa lùi về và deploy lại `HEAD` (gồm commit hỏng) đè
  lên nó. **Revert commit hỏng trên `main` trước lượt merge kế tiếp** (`CI-CD.md` § Lùi phiên bản).
- Bản dump lớn dần theo dữ liệu và kéo dài lượt deploy tương ứng (job `deploy` có trần 30 phút).

## Smoke test qua tên miền công khai (`VPS_SMOKE_URL`)

Healthcheck trong container chỉ chứng minh app trả lời ở `127.0.0.1`. Sau đó job `deploy`
hỏi `GET <VPS_SMOKE_URL>/api/public/health?t=<lượt>` từ runner của GitHub — đi qua nginx,
CDN, DNS như khách, theo cả chuyển hướng (`curl -L`) — tối đa 12 lần, nghỉ 10 giây giữa hai
lần (không nghỉ sau lần cuối), và chỉ xanh khi nhận `200` với `version` bằng SHA ngắn vừa
deploy. Hết 12 lần thì job đỏ: ~2 phút nếu mỗi lần trang trả lời ngay, tệ nhất ~3 phút 50
giây khi mỗi lần đều chờ hết trần 10 giây của curl. Job Plan của lượt CI kế tiếp cũng hỏi
URL này để biết bản đang chạy (mốc so khi quyết định merge "chỉ tài liệu" có deploy không).

- **Khai một lần:** GitHub → *Settings → Secrets and variables → Actions → Variables* →
  `VPS_SMOKE_URL` = `https://<tên miền thật>`. Chưa khai thì bước này chỉ in `::warning::`.
- **`/api/public/health`** trả `{ ok: true, version }` (CSDL trả lời `SELECT 1` trong 2 giây)
  hoặc `503`, luôn `Cache-Control: no-store`. Dùng chính URL này cho dịch vụ giám sát uptime.
- **`version` nướng vào image** (`ARG/ENV APP_VERSION`, lớp cuối của `Dockerfile`, CI truyền
  12 ký tự đầu của SHA). Vì vậy compose **không** liệt kê `APP_VERSION` — giá trị thuộc về
  image, không thuộc `.env`; build tại chỗ (`docker compose build`) báo `dev`.
- **Smoke đỏ không tự lùi:** container đã healthy, nguyên nhân có thể là CDN/DNS. Kiểm
  `curl -s https://<tên miền>/api/public/health`; đúng là image hỏng thì lùi tay (CI-CD.md
  § Lùi phiên bản).

## Giữ image (VPS và GHCR)

- **VPS:** sau mỗi lượt deploy khoẻ (CI và Update), giữ image đang chạy + **5** image
  `ghcr.io/…:sha-*` mới nhất khác; phần cũ hơn bị gỡ **theo thẻ** (`docker image rm`, không
  `-f` — image còn container dùng thì để lại), rồi `docker image prune -f`. Thẻ lùi
  `cdkt-rollback/app:*` của Update không bị đụng. Đĩa Docker dùng **> 80 %** → cảnh báo trong
  log deploy. Trước đây chỉ có `docker image prune` — lệnh đó không bao giờ gỡ image còn thẻ.
- **GHCR:** `.github/workflows/ghcr-retention.yml` giữ **20** version mới nhất, chạy hằng tuần
  (và bấm tay được). Cần một lần: package → *Package settings* → *Manage Actions access* →
  repo này quyền **Admin**.

## Giám sát cron sao lưu (`HEALTHCHECK_PING_URL`)

Cron `scripts/backup-db.sh` (qua `backup.sh`) và `scripts/verify-restore.sh` âm thầm ngừng
chạy thì chỉ phát hiện vào đúng ngày cần bản sao lưu. Đặt một URL ping kiểu
[healthchecks.io](https://healthchecks.io) (`https://hc-ping.com/<uuid>`):

- Thành công → gọi `<URL>`; hỏng → gọi `<URL>/fail`. Dịch vụ giám sát báo động khi quá hạn
  không nhận ping, hoặc nhận `/fail`.
- `curl -fsS -m 10 --retry 2 … || true`: dịch vụ giám sát hỏng **không** làm cron sao lưu
  hỏng theo. Không đặt biến → script chạy y như trước.
- **Đặt:** `./manage.sh` → Deploy (bước 5) hoặc Update (bước 4) — ghi vào `.env`; hoặc sửa tay
  `HEALTHCHECK_PING_URL=https://hc-ping.com/<uuid>` trong `.env` (không `?`, `&`, `#`).
- Chỉ script trên **host** đọc biến này (chúng tự đọc `.env`), nên compose **không** liệt kê
  nó trong `environment:` — container app không dùng.
- Bản dump trước deploy **không** ping: một lượt deploy thành công không được che một cron
  đêm đã chết. `verify-restore.sh` (hằng tháng) ping cùng URL.
- Cấu hình bên dịch vụ giám sát: chu kỳ 1 ngày, ân hạn vài giờ (cron 02:00).

## Log của app (journald — wave2 D-LOG)

`docker-compose.yml` cho app ghi log vào **systemd-journald** của máy chủ (`logging: driver: journald`, `tag: cdkt-app`). Trước đây là `json-file`: log nằm trong thư mục của container và **bị xoá cùng nó** — mỗi lượt deploy tạo lại container app, nên log của hôm qua mất đúng lúc cần đọc. MySQL vẫn dùng `json-file` xoay vòng.

```bash
journalctl CONTAINER_TAG=cdkt-app --since "1 hour ago"        # log app, kể cả của container đã bị thay
journalctl CONTAINER_TAG=cdkt-app -f                           # theo dõi trực tiếp
journalctl CONTAINER_TAG=cdkt-app -o cat | jq 'select(.event=="backup.drive_failed")'
docker logs cdkt_app / docker compose logs -f app              # vẫn dùng được, nhưng chỉ của container hiện tại
```

**Việc của anh (một lần, trên VPS):**

- **Kiểm máy chủ có journald** — *trước* khi merge bản này: `journalctl --version` và `ls -l /run/systemd/journal/socket`. Ubuntu/Debian/CentOS/AlmaLinux cài aaPanel đều có.
- **Giữ log qua lần khởi động lại máy:** journald mặc định có thể chỉ ghi vào RAM (`/run/log/journal`). Bật lưu đĩa: `sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald` (hoặc `Storage=persistent` trong `/etc/systemd/journald.conf`).
- **Trần dung lượng:** trong `/etc/systemd/journald.conf` đặt ví dụ `SystemMaxUse=1G` (và tuỳ chọn `MaxRetentionSec=3month`), rồi `sudo systemctl restart systemd-journald`. Xem đang dùng bao nhiêu: `journalctl --disk-usage`.
- **Giới hạn tốc độ của journald:** mặc định `RateLimitIntervalSec=30s` + `RateLimitBurst=10000` mỗi dịch vụ — một trận lỗi dồn dập (vd. CSDL mất kết nối, mỗi request một dòng) vượt mức đó thì journald **bỏ** phần còn lại của 30 giây và chỉ ghi "Suppressed N messages". Máy chủ bận có thể nâng `RateLimitBurst` (hoặc đặt `RateLimitIntervalSec=0` để tắt) trong cùng tệp, rồi khởi động lại journald.

**Máy chủ không có journald:** driver journald làm `docker compose up` hỏng ("journald is not enabled on this host"), tức mọi lượt deploy lùi lại. Nên **cả lượt CI deploy (`scripts/deploy-remote.sh`) lẫn `manage.sh` Deploy/Update** kiểm trước khi khởi động app. "Có journald" nghĩa là đủ cả: socket `/run/systemd/journal/socket`, lệnh `journalctl`, daemon Docker có driver `journald` (`docker info --format '{{json .Plugins.Log}}'` — daemon rootless/chạy trong VM có thể không có), và — khi image đã có trên máy — một container thử `docker run --rm --pull=never --network none --log-driver journald --entrypoint true <image>` chạy được (cả hai lệnh docker có trần thời gian: daemon kẹt không treo lượt deploy; không bao giờ kéo image chỉ để thử).

- Không có journald → tự ghi `docker-compose.override.yml` có dấu `# cdkt-log-fallback` (app dùng `json-file`, 3 × 10 MB — như trước) và in cảnh báo. Compose tự đọc tệp này ở mọi lệnh `docker compose` trong thư mục repo.
- Có journald mà tệp có dấu đó còn → tự gỡ (lượt deploy kế tiếp app chuyển sang journald).
- Đã có `docker-compose.override.yml` **không** mang dấu (của anh) → không bao giờ sửa. Script hỏi `docker compose config` driver log **hiệu lực** của app: nếu override của anh đã đặt `json-file` (hay driver khác) thì đi tiếp; nếu app vẫn ghi vào journald thì **dừng trước khi chạm container** (CI: trả `docker-compose.yml` cũ về, `.env` không đổi) và in khối `logging` cần thêm vào override.
- Tệp này (và tệp tạm `.docker-compose.override.*` của nó) nằm trong `.gitignore`/`.dockerignore` — `git pull` không vướng.
- **Update tay lần đầu sau bản này** trên máy **không** có journald mà CI deploy chưa chạy (CI deploy tự ghi override nên thường đã có): `manage.sh` cũ trên VPS chưa biết kiểm journald. Từ bản này, Update thấy `git pull` vừa đổi `manage.sh` thì **tự chạy tiếp bằng bản mới** (không hỏi lại sao lưu/pull) — nhưng bản *cũ* không có bước đó, nên lần đầu có thể hỏng ở `up` (tự lùi lại như mọi lượt hỏng). Chạy lại Update một lần: bản mới ghi override rồi khởi động bình thường.

## Thư cảnh báo vận hành (`OPS_ALERT_EMAIL` — wave2 D-ALERT)

Đặt `OPS_ALERT_EMAIL` (Deploy bước 5 hoặc Update bước 4; nhiều địa chỉ: phẩy ngăn cách) thì app gửi thư khi log một trong các sự kiện:

| Sự kiện | Nghĩa là |
|---|---|
| `backup.restore_failed` / `backup.restore_refused` | khôi phục CSDL/tệp hỏng, hoặc bị từ chối (không phải SuperAdmin, tệp quá lớn…) |
| `auth.mfa_challenge_locked` | ai đó có đúng mật khẩu đang đoán mã MFA và bị khoá |
| `security.link_host_rejected` | liên kết email bị yêu cầu dưới một Host giả |
| `security.cross_site_refused` | một trình duyệt gửi yêu cầu ghi (POST/PUT/PATCH/DELETE) thay cho trang khác và bị cổng chặn khác site từ chối (xem *Bảo mật đợt 2 — 2A*). Thư nêu đường dẫn + host của `Origin` — host thật của cổng mà vẫn bị chặn thì kiểm `PUBLIC_HOST_ALLOWLIST`/`TRUSTED_PROXY_IPS` |
| `backup.slot_abandoned` | một khe sao lưu theo lịch hỏng 3 lần — hôm đó không có bản sao lưu |
| `db.migration.media_category_fk_blocked` | di trú lúc khởi động không thể hoàn tất mà không mất dữ liệu (xem *Sửa dữ liệu sau deploy*) |

- Gửi qua **SMTP cấu hình trong admin** (`/admin/settings/email`) — chưa cấu hình SMTP thì không gửi được (log `ops.alert_failed`). Mật khẩu SMTP lưu dạng mã hoá (2A) được giải mã như mọi thư khác; không giải mã được (đã xoay `CHATBOT_ENCRYPTION_SECRET`) thì thư cảnh báo **không** gửi — `ops.alert_failed` nêu câu "nhập lại mật khẩu" — cho tới khi nhập lại mật khẩu ở trang Cấu hình Email.
- **Tối đa 1 thư mỗi sự kiện mỗi 15 phút** — riêng `security.cross_site_refused` **6 giờ** (một lượt dò lặp lại hàng giờ; lượt đầu là tín hiệu, mọi lượt vẫn ở log) — theo tên sự kiện, kể cả qua nhiều tiến trình/lần khởi động lại (bảng `rate_limit_counters`); thư kế tiếp nói số lần lặp lại đã gộp. Nội dung chỉ có tên sự kiện, thời điểm, máy chủ và ngữ cảnh không bí mật (khoá bí mật đã che trong log bị bỏ hẳn, không có stack trace).
- Gửi kiểu "bắn rồi quên": lỗi gửi chỉ ghi log `ops.alert_failed`, **không** ảnh hưởng request đã log sự kiện. Thư gửi thành công → log `ops.alert_sent`.
- Trống = không gửi gì, không chạm CSDL. Sự kiện di trú lúc khởi động (`server/db/init.ts`, chạy trước server) cũng gửi được: đường gửi tự mở và đóng một kết nối riêng, không giữ container ở bước khởi động.

## User deploy không phải root (việc của anh — wave2 D-DOCS)

CI SSH vào VPS bằng `VPS_USER` + `VPS_SSH_KEY`. Dùng `root` là cho khoá CI (nằm trong GitHub) toàn quyền máy chủ. Nên dùng một user riêng:

```bash
# Trên VPS, bằng root
adduser --disabled-password --gecos "" cdkt-deploy
usermod -aG docker cdkt-deploy                      # chạy được docker / docker compose
chown -R cdkt-deploy:cdkt-deploy /www/wwwroot/conduonghuongthien   # repo, .env, docker-compose.yml, .deploy-*
chown -R 1000:1000 /www/wwwroot/conduonghuongthien/backups          # ./backups thuộc user `node` của container — trả lại ngay
install -d -m 700 -o cdkt-deploy -g cdkt-deploy /home/cdkt-deploy/.ssh
```

> **Group `docker` tương đương root** (ai chạy được `docker run -v /:/host` là đọc/ghi được mọi tệp). User riêng **không** làm khoá CI kém quyền hơn root trên máy này — nó giới hạn *những gì khoá đó làm được qua SSH* và tách log/khoá khỏi tài khoản quản trị.

Khoá CI (khoá công khai của `~/.ssh/cdkt_deploy`, `CI-CD.md` Bước 1) vào `/home/cdkt-deploy/.ssh/authorized_keys` **với `restrict`** — không chuyển tiếp cổng/agent/X11, không cấp PTY:

```
restrict ssh-ed25519 AAAA…(khoá công khai)… cdkt-ci-deploy
```

(Lượt deploy chạy `bash -s` và `cat > tệp` qua SSH — không cần PTY hay chuyển tiếp, nên `restrict` không chặn gì nó cần.) `chmod 600 /home/cdkt-deploy/.ssh/authorized_keys`, rồi:

1. Đăng nhập GHCR **bằng chính user đó** (`su - cdkt-deploy -c 'docker login ghcr.io -u <user>'` — `CI-CD.md` Bước 5): thông tin nằm ở `~/.docker/config.json` của user deploy.
2. GitHub → *Settings → Secrets*: đổi `VPS_USER=cdkt-deploy`; `VPS_SSH_KEY` giữ khoá riêng tương ứng (đổi khoá → xem `CI-CD.md` *Xoay khoá SSH*).
3. Chạy thử một lượt deploy (Actions → CI → *Run workflow*), xác nhận xanh, rồi mới gỡ khoá CI khỏi `/root/.ssh/authorized_keys`.
4. `manage.sh` vẫn chạy được bằng root (nó trao `.env` và `.deploy-db-backups/` lại cho chủ thư mục repo). **Cron sao lưu (Menu 5) vẫn cài bằng root** — đó là việc của máy chủ, không phải của CI; user deploy chỉ dùng cho SSH của CI. (`./backups` thuộc uid 1000 của container nên user deploy không ghi được; Menu 5 tự từ chối khi chạy bằng user như vậy.)

## Trần RAM khuyến nghị theo cỡ máy (việc của anh — wave2 D-DOCS)

Compose mặc định **không trần** (`MYSQL_MEM_LIMIT`/`APP_MEM_LIMIT` trống = `0`). Nên đặt trần khi máy còn chạy dự án khác (container không trần có thể khiến OOM-killer hạ container **khác**). Số đúng cho máy của anh: chạy **trên VPS** `npm run check:resources` (hoặc Menu 4) — nó đọc RAM thật, trần và mức đang dùng, đếm container khác, rồi in hai dòng để dán vào `.env`. Bảng dưới là cùng công thức (chừa 512 MB + 256 MB mỗi container khác; MySQL 2/3, app 1/3; MySQL 512 MB–4 GB, app 512 MB–2 GB), tính với RAM danh nghĩa:

| RAM máy chủ | Không container khác | 2 container khác |
|---|---|---|
| 1 GB | `MYSQL_MEM_LIMIT=0.5g` · `APP_MEM_LIMIT=0.5g` | như cột trái (sàn 512 MB — máy quá nhỏ cho cổng này) |
| 2 GB | `1g` · `0.5g` | `0.666015625g` · `0.5g` |
| 4 GB | `2.333007812g` · `1.166015625g` | `2g` · `1g` |
| 8 GB trở lên | `4g` · `2g` | `4g` · `2g` |

Áp dụng: ghi vào `.env` rồi `docker compose up -d` (đổi trần cần tạo lại container). Trên VPS ≤ 2 GB cũng nên hạ `NODE_OPTIONS=--max-old-space-size=1024` (`.env.example`). Tải video (`MEDIA_UPLOAD_ENABLED`) chỉ bật khi RAM ≥ 4000 MB.

## Dừng container êm

Service app có `stop_grace_period: 45s`: `docker stop` / mỗi lượt deploy cho Nitro tới 45 giây
để trả xong request dở và chạy hook `close` (dừng scheduler sao lưu…) thay vì bị giết sau 10
giây mặc định. Container dừng sớm hơn thì không phải chờ đủ 45 giây.

## Tắt auto-deploy (tuỳ chọn)

Job `deploy` trong `.github/workflows/ci.yml` chạy mỗi khi job `image` thành công
(`if: needs.image.result == 'success'`). Muốn CI chỉ build image mà không tự lên VPS (rồi deploy bằng `./manage.sh` → 2):

```yaml
  deploy:
    if: false    # thay cho needs.image.result == 'success'
```

---

## Câu hỏi thường gặp

**Q: Đổi mật khẩu admin?**
A: Vào `$PUBLIC_BASE_URL/admin/profile` sau đăng nhập. Mật khẩu đầu nằm trong `.env` (`ADMIN_PASSWORD`) — chỉ dùng lúc seed, đổi sau không cần sửa `.env`.

**Q: Merge vào `main` rồi mà VPS không lên bản mới?**
A: Auto-deploy đang bật, nên xem job `Deploy to VPS` trong Actions (có thể thiếu secret, hoặc container mới không healthy nên đã tự lùi). Cần gấp thì chạy `./manage.sh` → 2 (Update) để pull + restart bằng tay.

**Q: File SQL nào nên thả vào `migrations/`?**
A: File `.sql` chỉ `INSERT` (thêm data, không `DROP TABLE`). Script quét nội dung từng file và đòi gõ lại tên file nếu có `DROP`/`TRUNCATE`/`DELETE`/`UPDATE` không `WHERE`/`PREPARE`·`EXECUTE`; không import lại file đã đánh dấu trừ khi xoá marker.

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
