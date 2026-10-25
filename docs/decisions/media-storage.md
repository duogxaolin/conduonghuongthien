# Media Storage — diễn giải vì-sao

Phần này bổ sung cho `CLAUDE.md` mục "Media" và `openspec/changes/add-media-portal/`.
Quy tắc hành động nằm trong `CLAUDE.md`; tệp này giữ **lý do, ràng buộc, và procedure restore** của AUD-16 (task 18.6) — script và procedure đã có, **lượt diễn tập restore trên host mới chưa được thực hiện** (xem mục procedure bên dưới).

> Đồng bộ **ảnh** thư viện media lên R2 (`media-sync*.ts`: thay URL trong một transaction rồi mới xoá bản local, khoá tên + mã thế hệ, bước sửa lượt bị cắt ngang) và dọn cây video cũ khi thay file (outbox `media_asset_cleanup`) → `data-layer.md` § "Audit 2026-10-13".

---

## R2 cho Media Portal video đã được triển khai, không phải "kế hoạch"

OpenSpec docs từng ghi "R2 chưa được triển khai" (`proposal.md`, `media-portal-plan.md:263`). Điều đó **sai với thực tế** — R2 đã implement hoàn thiện cho HLS tree video. Lỗi tài liệu là khoảng trống thật; code không phải.

### Triển khai nằm ở đâu

R2 cho video tách rời khỏi Thư viện Media (ảnh) — ảnh vẫn lưu local `/public/uploads/`, chỉ video Media Portal mới có R2.

- **`server/services/video-r2-sync.ts`** (346 dòng): `syncDirectoryToR2` (upload recursive cây HLS), `deleteR2Tree` (list+delete theo prefix), `listR2Keys`, `locateR2Original` (tìm `original.<ext>` cho passthrough), `streamR2Object` (GetObject pipe HLS), `streamR2ObjectRange` (byte-range 206 cho passthrough), `headR2Object`, `putR2Object` (single file, cho thumbnail). Dùng `@aws-sdk/client-s3`, endpoint `https://${accountId}.r2.cloudflarestorage.com`.
- **`processMediaItem` trong `server/services/video-transcode-pipeline.ts`** (giai đoạn 7): nếu `provider='r2'` và đủ credential → `syncDirectoryToR2` cây `published/` rồi xoá local → `storageProvider='r2'`. **Sync fail → giữ local + `storageProvider='local'`** (lùi an toàn — video vẫn phát từ đĩa). FFmpeg cần filesystem local nên không transcode thẳng lên R2.
- **`server/services/media-config-service.ts`**: `MEDIA_PORTAL_SETTING_KEYS` liệt kê 6 khoá R2; `readR2Config(db)` đọc từ bảng `settings`, giải mã secret; `resolveMediaConfigWithDb(db)` merge `videoStorage` từ DB (ưu tiên DB > env > default).
- **`resolveStreamTarget()` trong `server/services/media-portal-stream.ts`** (xuất lại qua barrel `media-portal.ts`): trả `{kind:'local',filePath}` hoặc `{kind:'r2',r2Key}` hoặc `{kind:'r2',passthrough:true}`. Lùi local khi R2 thiếu object.
- **`server/api/public/media/[shortId]/stream.get.ts`**: pipe R2 stream (HLS qua `streamR2Object`, byte-range passthrough qua `streamR2ObjectRange`). `X-Content-Type-Options: nosniff` luôn.
- **`server/api/admin/settings/media-portal.put.ts`** + **`app/pages/admin/settings/media-portal.vue`**: admin form R2 đầy đủ — validate `provider` ('local'|'r2'), validate 6 trường R2, encrypt secret qua `encryptVideoR2Secret`.
- **`tests/media-api.test.ts`**: `FORBIDDEN_HOSTS` = `['r2.dev', 'r2.cloudflarestorage.com', 'amazonaws.com', ...]` — chặn host storage rò ra response công khai (kiểm bằng HTTP server thật, không đọc mã).

### Envelope bí mật — một khoá, mỗi bí mật một nhãn

R2 secret key mã hoá AES-256-GCM qua `server/utils/media-r2-secret.ts`. Khoá vật liệu dùng chung `CHATBOT_ENCRYPTION_SECRET` (cùng khoá at-rest cho cả chatbot provider key, Google OAuth client secret, R2 video secret) — **không** thêm bí mật production thứ năm. Mỗi bí mật một nhãn HKDF riêng:

- `cdkt-video-r2-secret:v1` (R2 video) — `CONTEXT` trong `media-r2-secret.ts`.
- `cdkt-chatbot-provider-key:v1` (chatbot), `cdkt-google-oauth-secret:v1` (OAuth) — xem `realm-safety.md`.

Nhãn riêng nghĩa là một envelope lưu ở đây không giải mã được thành chatbot key hay OAuth secret và ngược lại. `decryptVideoR2Secret` ném `VideoR2EncryptionError` khi khoá đọc không được (vd. `JWT_SECRET` xoay làm `CHATBOT_ENCRYPTION_SECRET` suy ra khoá khác) — service trả `secretUnreadable: true` flag, admin form hiển thị cảnh báo, **không** làm sập trang.

### Ba tầng lùi an toàn (fallback)

R2 Không bao giờ là "bật hoặc chết". Một video phải phát được trong mọi trạng thái R2:

1. **R2 chưa cấu hình** (`provider='local'` hoặc thiếu credential) → transcode ghi local, stream đọc local. Đây là trạng thái mặc định.
2. **R2 bật nhưng sync fail** (khối catch giai đoạn 7 của `processMediaItem`, `video-transcode-pipeline.ts`) → giữ local, `storageProvider='local'`, log `media.r2_sync_failed`. Lượt transcode vẫn thành công.
3. **R2 bật, sync thành công, nhưng stream thiếu object** (`resolveStreamTarget` trong `media-portal-stream.ts` không tìm thấy object trên R2) → lùi local nếu file local còn; nếu không → 404.

Không bao giờ redirect tới R2 presigned URL — pipe byte qua proxy server, đúngPattern `server/routes/uploads/[...path].ts`. Một redirect đặt địa chỉ kho đã ký vào trình duyệt người đọc, lịch sử, và log của mọi trung gian.

### Khi nào bật R2 vs giữ local

**Giữ local (mặc định)** khi: VPS đủ ổ đĩa cho thư mục video, ít viewer, không cần CDN ra ngoài Việt Nam. Deploy mới không cần R2 bucket — không thêm credential, không thêm dependency.

**Bật R2** khi: ổ VPS nhỏ (video chiếm nhiều GB), cần băng thông ngoài VPS (Cloudflare R2 free egress), cần CDN giảm tải VPS. Bật trong `/admin/settings/media-portal` → `provider=r2` → nhập 6 khoá: `accountId`, `accessKey`, `secretKey`, `bucket`, `publicUrl` (5 + provider). Secret key chọn mã hoá at-rest.

---

## Procedure backup/restore — AUD-16 task 18.6 (đã triển khai; chưa diễn tập)

> AUD-16 yêu cầu: "*archive the matching DB and `media_work`, restore onto a fresh host, and play a restored manifest, segment, and thumbnail before archive.*"

**Trạng thái có bằng chứng:** script backup/restore đã có và được test hành vi trong sandbox có `docker` giả (`tests/ops-scripts-sandbox.test.ts`); R2 cho cây HLS đã triển khai. **Chưa có lượt diễn tập restore nào trên host mới/docker fresh được ghi nhận** — nên AUD-16 chưa được coi là đóng. Khi diễn tập xong, ghi ngày, người làm và kết quả ba phép thử ở cuối mục này rồi mới đổi trạng thái.

Diễn tập restore làm **manual** trên host mới/docker fresh — không chạy trong CI (R2 cần credential thật, FFmpeg cần image thật). Ghi procedure đây để cán bộ vận hành lặp lại được. Bản đầy đủ nằm ở `DEPLOY.md` § Backup & Restore; dưới đây là phần riêng của Media Portal.

### Backup

```bash
# DB + hai volume file, cùng mã thời điểm (script dựng sẵn)
scripts/backup.sh
# → backup-db.sh    → cdkt-<db>-<mã>-<pid>.sql.gz
# → backup-media.sh → cdkt-media-<mã>-<pid>.tar.gz    (docker cp /var/lib/cdkt/media/.  — volume media_work)
#                   → cdkt-uploads-<mã>-<pid>.tar.gz  (docker cp /app/public/uploads    — volume uploads_data)
```

(Tên thật có `-<pid>` ở cuối, không phải `<timestamp>.sql.gz` / `<timestamp>-media.tar.gz` như bản trước của tài liệu này ghi. Archive uploads là mới: trước đây cron bỏ sót `uploads_data`.)

Quando R2 bật: cây `published/` local đã bị xoá sau sync (R2 là nguồn chính). Media archive khi đó **có thể rỗng hoặc chỉ chứa `processing/` + `uploads/` tạm** — video thật nằm trên R2 bucket, không trên đĩa. **Restore chỉ cần DB + R2 bucket vẫn còn** (R2 bucket không nằm trong archive này).

### Restore trên host mới (local-only)

```bash
# 1. Dừng app (giữ MySQL chạy)
docker compose stop app

# 2. Restore hai volume (script nhận volume từ TÊN archive)
scripts/restore-media.sh backups/cdkt-media-<mã>-<pid>.tar.gz   --replace
scripts/restore-media.sh backups/cdkt-uploads-<mã>-<pid>.tar.gz --replace
# --replace ghi đè volume hiện có; script validate tar path (`..`, `/`) và, với uploads,
# thư mục gốc `uploads/` trước khi ghi

# 3. Restore DB — (tuỳ chọn) nạp thử vào CSDL tạm trước, rồi khôi phục thật
scripts/verify-restore.sh backups/cdkt-<db>-<mã>-<pid>.sql.gz   # scratch DB, đếm tables/users/articles
scripts/restore-db.sh     backups/cdkt-<db>-<mã>-<pid>.sql.gz <db> --replace
# → kiểm dump, DUMP BẢN HIỆN CÓ ra cdkt-prerestore-<db>-*.sql.gz (hỏng thì không khôi phục), rồi nạp

# 4. Khởi động lại
docker compose up -d app

# 5. Verify 1 video phát được
#    - Manifest:  GET /api/public/media/<slug>/master.m3u8    → 200, content-type application/vnd.apple.mpegurl
#    - Segment:   GET /api/public/media/<slug>/360p/seg-*.ts  → 200, content-type video/mp2t
#    - Thumbnail: GET /api/public/media/<slug>/thumb.jpg      → 200, content-type image/jpeg
#    - Passthrough: GET /api/public/media/<shortId>/stream    → 206 byte-range (nếu video passthrough) hoặc 200 HLS
```

### Restore trên host mới (R2 bật)

Khi R2 đã cấu hình trên host mới (`/admin/settings/media-portal` → 6 khoá R2):

```bash
# 1-4. Như local-only (DB restore là bắt buộc; media archive có thể rỗng)
# 5. R2 bucket giữ nguyên qua lần restore này (object không bị xoá khi restore DB)
# 6. Verify stream trả từ R2:
#    GET /api/public/media/<shortId>/stream → 200/206, pipe byte từ R2
#    - resolveStreamTarget nhánh R2; nếu object thiếu → lùi local (nếu local có)
```

### Yêu cầu AUD-16 "play a restored manifest, segment, and thumbnail"

Sau restore (bất kỳ chế độ nào), cả ba phải trả 200:

| Asset | Endpoint | Content-type |
|-------|----------|-------------|
| Manifest | `GET /api/public/media/<slug>/master.m3u8` | `application/vnd.apple.mpegurl` |
| Segment | `GET /api/public/media/<slug>/<rendition>/seg-N.ts` | `video/mp2t` |
| Thumbnail | `GET /api/public/media/<slug>/thumb.jpg` | `image/jpeg` |

Nếu một trong ba trả 404 → restore thất bại, **không** archive. Ghi lại kết quả verify vào ticket deploy.

### Archive lớn và script khôi phục (đợt sửa 2026-10-14)

- **Archive > 15 GiB giải nén** bị khôi phục trong app từ chối (413 `decompressed_too_large`). Trần này là hằng số `DEFAULT_RESTORE_LIMITS.maxArchiveBytes` (`backup-restore-guards.ts`, không phải biến môi trường) và đếm byte của **luồng tar** sau giải nén. Trước đây là 8 GiB; chủ repo nâng lên 15 GiB (2026-10-14) để archive media 10,9 GB nén trên máy dev (`cdkt-media-20260925T191853Z-pre-sync.tar.gz`) khôi phục được qua giao diện. Đã đo trên tệp thật: luồng tar 11.373.357.056 byte (10,59 GiB), 11.786 mục, `inspectArchive` nhận trong ~34 s (trần cũ từ chối ở mốc 8 GiB). Archive lớn hơn 15 GiB vẫn phải khôi phục bằng `scripts/restore-media.sh`. Trần tải lên (512 MiB đã nén) và trần SQL (256 MiB) không đổi. Archive media 2,3 GB còn lại (`…185215Z-pre-sync`) là tệp bị cắt cụt (`corrupt_gzip`), không phải do trần này.
- Khôi phục theo tên chạy đồng bộ trong **một** request (kiểm ~34 s rồi thêm một lượt `tar -xzf` cho archive 10,6 GiB). Sau nginx `location /` (`proxy_read_timeout` mặc định 60 s) trình duyệt có thể nhận 504 trong khi máy chủ vẫn giải nén tiếp; giao diện đã dừng theo dõi, nên phải đợi rồi xem lại `/api/admin/backup/status` / nhật ký. Không có bước kiểm dung lượng đĩa trống trước khi giải nén.
- `scripts/restore-media.sh` viết lại: liệt kê bằng GNU tar và chỉ nhận file thường/thư mục (symlink/hard link có thể trỏ tới `/app/backups/*.sql.gz`, và app phục vụ `/uploads` theo link); tên tuyệt đối, `..`, `\`, ký tự điều khiển, ngoài gốc → từ chối; ghi bản an toàn `cdkt-prerestore-<kind>-*.tar.gz` trước (bỏ bằng `--no-safety-copy`; tên khác mẫu của `backup-media.sh` nên xoay vòng theo tuổi không xoá); giải nén vào thư mục staging **trên chính volume**, `find` kiểm lại (symlink/thiết bị/fifo/socket/hard link → bỏ staging, volume giữ nguyên) rồi mới đổi chỗ; app phải dừng (`--i-know-app-is-stopped` khi Compose quá cũ để kiểm). Mã thoát 0/1/2/3/4 ghi ở đầu script. Đã chạy thật trên `node:24-alpine` (BusyBox): symlink/hard link/fifo → mã 4, volume giữ nguyên.
- `scripts/restore-db.sh` + `verify-restore.sh`: bộ chặn câu lệnh cấm viết lại — `gzip -dc | grep -q` dưới `set -o pipefail`: `grep -q` dừng ở lần khớp đầu, `gzip` chết vì SIGPIPE (141), `pipefail` làm cả `if` thành sai — **đúng lúc tìm thấy câu lệnh cấm thì bộ chặn cho qua**; nay `grep -c` đọc tới EOF + kiểm `PIPESTATUS`, và tập câu lệnh cấm rộng hơn (`\u`, `connect`, `source`, comment thực thi `/*! … */`). `verify-restore.sh --latest` chọn dump mới nhất của `MYSQL_DATABASE` (dùng cho cron). Test: `tests/ops-restore-hardening.test.ts` (chạy script thật trong sandbox `docker`/`git` giả, đỏ trên bản cũ).

### Cấu hình R2 kiểm lúc dùng (G3, 2026-10-14)

- Mọi lệnh R2 (ảnh `media-r2.ts`, video `video-r2-sync.ts`) mở client qua `openR2(config, scope)`: account id phải là 32 ký tự hex, bucket đúng quy tắc tên, đã trim — hỏng → `R2ConfigInvalidError` (400, `code: 'R2_CONFIG_INVALID'`, không phản chiếu giá trị; log `r2.config_invalid` tối đa một dòng/10 phút mỗi `scope:field`). Trước đó luật "đổi đích phải gõ lại bí mật" chỉ chặn lúc ghi; hàng đã lưu từ trước đi thẳng vào endpoint.
- Phân biệt "không kiểm được" với "không tồn tại": `headR2Object`/`deleteR2File` **ném** lỗi cấu hình (trả `false` từng khiến quét thumbnail báo mọi ảnh R2 hỏng và self-heal coi mọi object là mất). Các hàm video "không ném" tạo client **trong** `try`. Đồng bộ media kiểm cấu hình một lần trước khi bắt đầu. Còn mở: lỗi mạng/xác thực/5xx của `HeadObject` vẫn trả `false` → self-heal gặp R2 chập chờn đổi thumbnail + `media.url` sang ảnh mặc định (có bản `pre-self-heal` trước đó).
- Ảnh nguồn thumbnail Media Portal (`readLibraryImage`, `media-portal-thumbnail-override.ts`): R2 → `getR2Object(storagePath, …, { maxBytes: 25 MiB, timeoutMs: 20 s })` (trần đếm cả trong lúc đọc thân, quá trần/quá hạn → `R2ReadLimitError`); local → tệp thường dưới `public/uploads` (`lstat`, trần byte). Không bao giờ `fetch(media.url)`. Theo nhánh G3 (SELECT chỉ đọc trên CSDL dev, người kiểm cuối không chạy lại): cả 3213 hàng R2 có `storage_path` dạng `YYYY/MM/…`.
- **Fixture test phải dùng cấu hình hợp lệ**: `tests/media-replace-cleanup.test.ts` đã đổi sang account id 32 hex + bucket `video-bucket`; `tests/media-self-heal-integration.test.ts` cũng vậy (từng giữ `stub-account` → đỏ trên MySQL thật sau G3) và nay giả SDK S3 (HEAD 404) — không còn chạm mạng; trước đó nó chỉ xanh nhờ lỗi TLS tới `*.r2.cloudflarestorage.com` bị nuốt thành `false`.

---

## Điều kiện tiên quyết giữ quy tắc

- **`nosniff` mọi response stream** (`X-Content-Type-Options: nosniff`) — đã có trong `stream.get.ts`, không phải thêm.
- **Stream pipe, không redirect** — `sendStream`/`streamR2Object`/`streamR2ObjectRange`, không `sendRedirect`. Test `FORBIDDEN_HOSTS` chặn host R2 rò ra header/body.
- **Local là nguồn chính mặc định** — R2 opt-in, deploy mới không cần R2 credential. Đổi mặc định sang R2 sẽ bắt buộc mọi deploy phải có bucket.
- **Secret envelope nhãn riêng** `cdkt-video-r2-secret:v1` — không trộn với chatbot/OAuth. Xoay `CHATBOT_ENCRYPTION_SECRET` vô hiệu hoá giải mã R2 (flag `secretUnreadable`), nhưng **không** xoá object trên R2 (bucket vẫn còn, chỉ cần cấu hình lại secret key).

## Kiểm chứng âm tính

- R2 tắt (mặc định) → mọi video phát local, không có credential nào bị đòi hỏi.
- R2 bật nhưng thiếu object → `resolveStreamTarget` lùi local nếu file còn, không 500.
- `FORBIDDEN_HOSTS` test (`tests/media-api.test.ts`) dựng HTTP server thật, fetch stream, assert `r2.cloudflarestorage.com`/`r2.dev`/`amazonaws.com` không xuất hiện trong response.
- `secretUnreadable` flag khi `CHATBOT_ENCRYPTION_SECRET` sai/không đọc được → admin form cảnh báo, không crash.

## Triệu chứng production đọc ra thế nào

- **R2 sync fail im lặng**: log `media.r2_sync_failed` (không ném), `storageProvider='local'`, video vẫn phát. Cán bộ chỉ thấy qua `/admin/media-portal` listing cột storage, hoặc log. Không có lỗi khách.
- **R2 stream thiếu object**: log cảnh báo, lùi local (nếu có), hoặc 404 (nếu local cũng mất). Khách thấy 404 cho 1 video cụ thể, không toàn bộ.
- **Secret unreadable**: admin form hiển thị cảnh báo "R2 secret không đọc được", R2 chuyển về local fallback. Xoay `CHATBOT_ENCRYPTION_SECRET` mà không cấu hình lại R2 secret key → tất cả video lùi local cho tới khi admin nhập lại secret.
