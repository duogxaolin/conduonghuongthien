# Media Storage — diễn giải vì-sao

Phần này bổ sung cho `CLAUDE.md` mục "Media" và `openspec/changes/add-media-portal/`.
Quy tắc hành động nằm trong `CLAUDE.md`; tệp này giữ **lý do, ràng buộc, và procedure restore** — đóng AUD-16 (task 18.6).

---

## R2 cho Media Portal video đã được triển khai, không phải "kế hoạch"

OpenSpec docs từng ghi "R2 chưa được triển khai" (`proposal.md`, `media-portal-plan.md:263`). Điều đó **sai với thực tế** — R2 đã implement hoàn thiện cho HLS tree video. Lỗi tài liệu là khoảng trống thật; code không phải.

### Triển khai nằm ở đâu

R2 cho video tách rời khỏi Thư viện Media (ảnh) — ảnh vẫn lưu local `/public/uploads/`, chỉ video Media Portal mới có R2.

- **`server/services/video-r2-sync.ts`** (346 dòng): `syncDirectoryToR2` (upload recursive cây HLS), `deleteR2Tree` (list+delete theo prefix), `listR2Keys`, `locateR2Original` (tìm `original.<ext>` cho passthrough), `streamR2Object` (GetObject pipe HLS), `streamR2ObjectRange` (byte-range 206 cho passthrough), `headR2Object`, `putR2Object` (single file, cho thumbnail). Dùng `@aws-sdk/client-s3`, endpoint `https://${accountId}.r2.cloudflarestorage.com`.
- **`server/services/video-processing.ts:799-833`** (giai đoạn 7): nếu `provider='r2'` và đủ credential → `syncDirectoryToR2` cây `published/` rồi xoá local → `storageProvider='r2'`. **Sync fail → giữ local + `storageProvider='local'`** (lùi an toàn — video vẫn phát từ đĩa). FFmpeg cần filesystem local nên không transcode thẳng lên R2.
- **`server/services/media-config-service.ts`**: `MEDIA_PORTAL_SETTING_KEYS` liệt kê 6 khoá R2; `readR2Config(db)` đọc từ bảng `settings`, giải mã secret; `resolveMediaConfigWithDb(db)` merge `videoStorage` từ DB (ưu tiên DB > env > default).
- **`server/services/media-portal.ts:970-1143`** `resolveStreamTarget()`: trả `{kind:'local',filePath}` hoặc `{kind:'r2',r2Key}` hoặc `{kind:'r2',passthrough:true}`. Lùi local khi R2 thiếu object.
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
2. **R2 bật nhưng sync fail** (`video-processing.ts` giai đoạn 7 catch) → giữ local, `storageProvider='local'`, log `media.r2_sync_failed`. Lượt transcode vẫn thành công.
3. **R2 bật, sync thành công, nhưng stream thiếu object** (`resolveStreamTarget` trong `media-portal.ts` không tìm thấy object trên R2) → lùi local nếu file local còn; nếu không → 404.

Không bao giờ redirect tới R2 presigned URL — pipe byte qua proxy server, đúngPattern `server/routes/uploads/[...path].ts`. Một redirect đặt địa chỉ kho đã ký vào trình duyệt người đọc, lịch sử, và log của mọi trung gian.

### Khi nào bật R2 vs giữ local

**Giữ local (mặc định)** khi: VPS đủ ổ đĩa cho thư mục video, ít viewer, không cần CDN ra ngoài Việt Nam. Deploy mới không cần R2 bucket — không thêm credential, không thêm dependency.

**Bật R2** khi: ổ VPS nhỏ (video chiếm nhiều GB), cần băng thông ngoài VPS (Cloudflare R2 free egress), cần CDN giảm tải VPS. Bật trong `/admin/settings/media-portal` → `provider=r2` → nhập 6 khoá: `accountId`, `accessKey`, `secretKey`, `bucket`, `publicUrl` (5 + provider). Secret key chọn mã hoá at-rest.

---

## Procedure backup/restore — đóng AUD-16 task 18.6

> AUD-16 yêu cầu: "*archive the matching DB and `media_work`, restore onto a fresh host, and play a restored manifest, segment, and thumbnail before archive.*"

Diễn tập restore làm **manual** trên host mới/docker fresh — không chạy trong CI (R2 cần credential thật, FFmpeg cần image thật). Ghi procedure đây để cán bộ vận hành lặp lại được.

### Backup

```bash
# DB + media volume cùng timestamp (script dựng sẵn)
scripts/backup.sh
# → backup-db.sh → <timestamp>.sql.gz
# → backup-media.sh → <timestamp>-media.tar.gz  (docker cp /var/lib/cdkt/media)
```

Quando R2 bật: cây `published/` local đã bị xoá sau sync (R2 là nguồn chính). Media archive khi đó **có thể rỗng hoặc chỉ chứa `processing/` + `uploads/` tạm** — video thật nằm trên R2 bucket, không trên đĩa. **Restore chỉ cần DB + R2 bucket vẫn còn** (R2 bucket không nằm trong archive này).

### Restore trên host mới (local-only)

```bash
# 1. Dừng app (giữ MySQL chạy)
docker compose stop app

# 2. Restore media volume
scripts/restore-media.sh <timestamp>-media.tar.gz --replace
# --replace ghi đè volume hiện có; script validate tar path trước khi ghi

# 3. Restore DB
scripts/restore-db.sh <timestamp>.sql.gz
# → scratch DB verify (đếm tables/users/articles) qua verify-restore.sh

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
