# Media Portal Implementation Plan (v4 source plan; implementation status below)

> **Trạng thái review v4:** Đã qua 3 vòng review workflow. v3 còn 4 blocker + 18 major thật (23 finding bị refuted đúng, giữ nguyên). v4 này giải nốt 4 blocker + 18 major ở mức kế hoạch.
>
> **Trạng thái triển khai, 20/09/2026:** Typecheck, schema drift (47 bảng / 464
> cột), test suite (1.970 pass, 0 fail, 12 skip), build và E2E Media Portal trên
> database disposable đã qua. Đây là bằng chứng cho code hiện tại, chưa là nghiệm
> thu production/archive.
>
> **Storage thực tế:** Media Portal ghi, đọc và dọn asset dưới volume local
> `media_work` / `CDKT_MEDIA_WORKDIR`; không dùng R2, signed URL R2, hoặc Plyr.
> Video YouTube dùng iframe `youtube-nocookie`; chỉ video tự lưu trữ tải động
> HLS.js. Các đoạn ghi R2 bên dưới là yêu cầu của kế hoạch v4 lịch sử, không phải
> mô tả implementation hiện tại.
>
> **Không được archive khi thiếu bằng chứng:** AUD-09 (soak claim/fencing),
> AUD-11 (cleanup retry), AUD-12 (race chunk MySQL trong CI), AUD-13
> (crash-recovery worker), AUD-14 (hai reader SSE + close khi stop), và AUD-16
> (quyết định R2/local + restore trên host mới). Xem
> `docs/codebase-audit-2026-09-19.md` và checklist §18.

## Overview

Gắn vào cổng một **kênh đa phương tiện** với 3 tính năng ăn khớp:

1. **Thư viện Media** (`/media`, `/media/[slug]`) — lưới video công khai, phát bằng HLS.js cho video local hoặc iframe `youtube-nocookie` cho YouTube; bình luận **tái sử dụng `comments.ts` bằng tham số hóa** (không bảng riêng).
2. **Upload video lớn** (≤10GB) chunked resumable, transcode FFmpeg nền theo rendition cấu hình, cắt HLS và lưu asset vào `media_work` local. **Có reaper tick cứu video stuck**.
3. **Livestream** qua YouTube/HLS relay — Hero `/media` tự biến dạng. Chat realtime qua SSE, dùng **`h3.EventStream` instance** + **Nitro shutdown hook** + **bounded queue thủ công** + **`container_name` pin single-replica**.

---

## Quyết định kiến trúc (pin sẵn, giải hết blocker v3)

### A. Schema — parameterize `comments.ts`, KHÔNG tạo `media_comments` bảng riêng

**Lý do:** `comments.ts` đã có `reader_notifications` insert trong cùng tx (line ~290 "Comment and notification commit together"), `countReaderCommentImpact`, rate limit, email, `serializePublicComment` — 7+ cơ chế dùng chung. Tạo bảng riêng = mất hết. Parameterize = giữ toàn bộ.

```ts
// server/services/comments.ts — đổi signature (KHÔNG clone):
export type CreateCommentInput = {
  readerId:    number
  articleId?:  number       // XOR với mediaItemId — runtime guard ở đầu createComment
  mediaItemId?: number
  parentId:    number | null
  body:        string
  ip:          string | null
  userAgent:    string | null
}
// checkParentEligibility(parent, articleId?, mediaItemId?) — kiểm cha cùng loại (article↔article, media↔media)
// loadCommentThread({ articleId?, mediaItemId?, page, perPage, viewerReaderId })
//   → XOR guard runtime + nhánh where theo loại ở query đếm (line ~550) và query trả lời (line ~572)
```

**Sửa `article_comments`** (additive, bảng đã có dữ liệu):

```ts
// migrations-additive.ts — thêm cột + đổi cột hiện có SANG NULL:
// 1. Thêm cột media_item_id (ensureColumn — cột mới, không có DEFAULT string → nháy đơn OK)
await ensureColumn(db, database, 'article_comments', 'media_item_id', 'INT NULL')
await ensureForeignKeyIfMissing(db, database, 'article_comments', 'fk_article_comments_media',
  'FOREIGN KEY (`media_item_id`) REFERENCES `media_items` (`id`) ON DELETE CASCADE')
await ensureIndex(db, database, 'article_comments', 'article_comments_media_parent_created_idx',
  'INDEX `article_comments_media_parent_created_idx` (`media_item_id`, `parent_id`, `created_at`)')

// 2. ⚠️ BLOCKER B2 v3 — ĐỔI cột article_id SANG NULL (bảng đã có dữ liệu, ensureColumn KHÔNG đổi cột)
//    Dùng pattern MODIFY COLUMN đã có ở migrations-additive.ts:255,299 (hàm ensureColumnDefinition).
//    THỰC HIỆN SAU khi mọi code đã chuyển sang optional (tránh breaking chạy giữa chừng).
await ensureColumnDefinition(db, database, 'article_comments', 'article_id', 'INT NULL')
```

**Drizzle (`schema.ts:766`):** `articleId` từ `.notNull()` → nullable. Mọi query `where: eq(articleComments.articleId, ...)` vẫn hoạt động (cột nullable). Rà `loadCommentThread`, `listCommentsForAdmin`, `deleteReaderComments`, `createAdminReply` — tất cả nhận `mediaItemId?`.

**`listCommentsForAdmin` (major v3):** thêm `leftJoin(mediaItems)`, select `mediaTitle`/`mediaSlug` vào `AdminCommentRow`; filter `?source=article|media` (chọn 1 trong 2, không cả hai). Tiền lệ `leftJoin('users')` cho log tài khoản đã xoá.

**`deleteComment` (major v3 — dùng chung 6 chỗ):** select `mediaItemId` ở lượt đọc comment đầu, ghi `meta.mediaItemId` vào audit (cùng `meta.articleId` hiện có). Một đường xoá duy nhất giữ đúng cho cả article + media.

**`createAdminReply` + `notification-email.ts` (major v3):** thêm nhánh `media_items` lookup; `reply.articleId` nullable → `if (reply.articleId) { article branch } else if (reply.mediaItemId) { media lookup: select slug,title,status,comments_enabled from media_items }`; URL `/media/<slug>?comments=<page>#comment-<id>`; `sendReplyEmail` thêm nhánh media. `countOlderTopLevel` nhận `mediaItemId?` + nhánh where.

**`notifications.ts` (major v3):** `eq(articles.id, reply.articleId)` → `reply.articleId != null ? eq(articles.id, reply.articleId) : isNull(...)` (TS-safe khi nullable). `listNotifications` + `countOlderTopLevel` thêm nhánh `media_item_id` (left-join `media_items`, URL `/media/<slug>#comment-<id>`). `notificationTargetPage` nhận `{articleId? | mediaItemId?}`.

**`uniqueMediaSlug` (major v3):** nhận `tx` (transaction client) làm tham số, KHÔNG `db` — gọi trong `db.transaction` cho livestream VOD save & media CRUD. Cùng khuôn `uniqueCategorySlug` nhưng param thứ nhất là client.

**RBAC:** `comments` resource dùng chung (không mint mới). Comment moderator hiện tại thấy cả hai — `listCommentsForAdmin` filter `?source=article|media`.

### B. 4 bảng mới (43-46)

**`media_items` (43)** — `CREATE TABLE` trong `init.ts` (bảng mới):
- `slug VARCHAR(512) NOT NULL UNIQUE` — `uniqueMediaSlug(db, title)` helper (clone `uniqueCategorySlug` pattern, nhận tx).
- `resolutions_ready JSON DEFAULT '[]'` — Drizzle `json('resolutions_ready').$type<string[]>().default([])`, DEFAULT chỉ ở DDL.
- `status VARCHAR(16) NOT NULL DEFAULT 'draft'` — CREATE TABLE (nháy đơn SQL OK).
- `comments_enabled TINYINT(1) NOT NULL DEFAULT 0` — mặc định TẮT (tiền lệ article).
- `category_id` FK `categories` — thêm content type 'media' (minor m1).
- `processing_status VARCHAR(16) NOT NULL DEFAULT 'pending'` — `pending|processing|ready|failed`.
- FK `created_by → users ON DELETE SET NULL`, `category_id → categories ON DELETE SET NULL`.

**`livestream_sessions` (44):**
- `is_active TINYINT(1) NOT NULL DEFAULT 0` — **KHÔNG UNIQUE index**. **1-active invariant dùng `GET_LOCK('cdkt:livestream:active', 0)`** (blocker B1 v3 — tiền lệ `view-boost-scheduler.ts:94`). Xem §I.
- `saved_media_id → media_items ON DELETE SET NULL` (major M5 — VOD tồn tại độc lập sau session purge).
- `started_at DATETIME NULL`, `ended_at DATETIME NULL` — DATETIME không TIMESTAMP (tránh 2038 + tz trap).
- `claimed_by VARCHAR(64) NULL` — heartbeat token dùng cho reaper.
- FK `created_by → users ON DELETE SET NULL`.

**`livestream_messages` (45):**
- `id BIGINT AUTO_INCREMENT` — lượng tin lớn.
- `reader_id → reader_accounts ON DELETE CASCADE` — khớp `article_comments.readerId`.
- `display_name VARCHAR(100) NOT NULL` — snapshot tên lúc gửi.
- `content VARCHAR(200) NOT NULL` — text thuần, valid qua `plain-text.ts`.
- `created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)` — ms precision, DATETIME.
- `is_deleted TINYINT(1) NOT NULL DEFAULT 0` — soft delete.
- FK `session_id → livestream_sessions ON DELETE CASCADE`.
- Index `(session_id, created_at)`, `(reader_id)`.

**`article_comments.media_item_id`** — additive (xem §A).

### C. RBAC — 2 resource mới

```ts
// seed.ts — VALID_RESOURCES thêm:
'media_portal',   // thư viện media: CRUD, upload, transcode
'livestream',     // session live: start/stop, chat delete
// 'comments' đã có, dùng chung (không mint mới)
```

Mặc định KHÔNG cấp (tiền lệ `readers`/`comments`). Seed insert-only → SuperAdmin cấp tay sau triển khai. `media_portal` cho editor video, `livestream` cho cán bộ phát sóng. Admin chat-delete dùng `livestream.delete`.

### D. Cache safety — `/media` swr, `/media/**` swr (KHÔNG bỏ)

`/media/[slug]` **CÓ** dùng swr:60 — cùng pattern `/news/[id]` (ArticleDetail.vue:363 `useFetch lazy: true`). `ArticleComments` load sau mount, `canDelete` client-only. Bỏ khỏi routeRules như `/profile` là over-correct.

```ts
// nuxt.config.ts routeRules:
'/media':      { swr: 60 },   // list
'/media/**':   { swr: 60 },   // detail — ArticleComments fetch sau mount như /news/[id]
```

Hero `/media` fetches `/api/public/livestream/active` sau mount (`lazy: true`). Endpoint `active.get.ts` **KHÔNG đọc cookie reader** (minor v3) — `optionalReader` không gọi, trả active session public.

### E. SSE — `h3.EventStream` instance + Nitro shutdown hook + bounded queue thủ công + container_name pin

**Blocker B3 v3 giải:** `EventStream.push()` không bao giờ reject (h3 nuốt internal error) → `push().catch()` là dead-code. v4 track bounded queue thủ công.

```ts
// server/utils/sse-manager.ts
interface ManagedStream {
  stream: EventStream
  pending: number         // số message đang chờ flush (đếm, không lưu chuỗi)
  closed: boolean
}
const connections = new Map<number, Set<ManagedStream>>()
let shuttingDown = false
const MAX_PENDING = 50

export function addSseConnection(sessionId: number, stream: EventStream): ManagedStream {
  const ms: ManagedStream = { stream, pending: 0, closed: false }
  if (!connections.has(sessionId)) connections.set(sessionId, new Set())
  connections.get(sessionId)!.add(ms)
  stream.onClosed(() => {
    ms.closed = true
    connections.get(sessionId)?.delete(ms)
  })
  return ms
}

// Bounded queue thủ công: đếm pending, drop+close khi vượt MAX_PENDING
export function broadcastChatMessage(sessionId: number, msg: ChatMessage) {
  if (shuttingDown) return
  const streams = connections.get(sessionId)
  if (!streams?.size) return
  for (const ms of streams) {
    if (ms.closed) { streams.delete(ms); continue }
    if (ms.pending >= MAX_PENDING) {
      // Client chậm → drop connection (backpressure thủ công, KHÔNG dựa push().catch)
      ms.closed = true; streams.delete(ms); ms.stream.close().catch(() => {})
      continue
    }
    ms.pending++
    // push() resolve/reject đều nuốt — ta dùng onClosed để decrement
    ms.stream.push(`data: ${JSON.stringify(msg)}\n\n`).then(() => {
      if (!ms.closed) ms.pending = Math.max(0, ms.pending - 1)
    }).catch(() => { ms.closed = true; streams.delete(ms) })
  }
}

// Nitro shutdown hook (M1) — push object {event,data}, KHÔNG chuỗi (major v3)
export function defineSseShutdownHook(nitroApp) {
  nitroApp.hooks.hook('close', async () => {
    shuttingDown = true
    for (const streams of connections.values()) {
      for (const ms of streams) {
        if (!ms.closed) {
          await ms.stream.push({ event: 'shutdown', data: 'server restarting' }).catch(() => {})
          await ms.stream.close().catch(() => {})
        }
      }
    }
    connections.clear()
  })
}
```

**`stream.get.ts` (major v3 — callsite cụ thể):**
```ts
// server/api/public/livestream/chat/stream.get.ts
import { createEventStream } from 'h3'
export default defineEventHandler(async (event) => {
  const sessionId = /* từ query */
  const stream = createEventStream(event)
  addSseConnection(sessionId, stream)
  return stream.send()   // h3 lo response headers + keepalive
})
```

**docker-compose.yml (M2 — fix major v3):** `deploy.replicas` **no-op trong Compose non-Swarm**. v4 pin qua `container_name` (đã có, chặn scale) + env check boot.
```yaml
services:
  app:
    container_name: cdkt_app    # giữ — chặn `docker compose up --scale app=2` (Compose refuse duplicate container_name)
    environment:
      - CDKT_SSE_REPLICA_GUARD=1
# server/plugins/sse-shutdown.ts: boot check `if (process.env.CDKT_SSE_REPLICA_GUARD !== '1' && process.env.NODE_ENV === 'production') console.warn(...)`
# README pin: multi-replica cần Redis pub/sub (out of scope v4)
```

**nginx:** `proxy_buffering off; proxy_cache off; proxy_read_timeout 86400s; X-Accel-Buffering: no` cho `/api/public/livestream/chat/stream`.

### F. FFmpeg — spawn async + withLock helper dùng chung + REAPER TICK + runtime disk check + giải phóng pool connection

**Blocker liên quan v3 (ffmpeg-holds-pooled-connection):** `withNamedLock` giữ pool connection suốt ffmpeg long-running (hàng giờ). v4 giải phóng kết nối **trước** spawn ffmpeg; track sống qua row heartbeat (`media_items.claimed_by` token + `updated_at`) — chính là thứ reaper đã đọc.

```ts
// server/utils/named-lock.ts — gom 3 bản withLock (retention-scheduler, view-boost, analytics-maintenance)
export async function withNamedLock<T>(pool: Pool, name: string, timeoutSec: number, action: (conn: PoolConnection) => Promise<T>): Promise<T | null>
// Trả về pool connection đã giữ lock cho action dùng — action tự giải phóng.
// Analytics-maintenance preserve emitNocBestEffort hook (major v3) — action nhận conn, gọi emitNocBestEffort(conn, ...).
```

**B1 — Reaper tick 15 phút:**
```ts
// server/services/media-processing-reaper.ts + server/plugins/media-processing-reaper.ts
// Cùng khuôn retention-scheduler.ts: TICK 15min, unref, swallow error.
// Quét: SELECT id, claimed_by FROM media_items WHERE processing_status='processing' AND updated_at < NOW() - 10min
// Check ffmpeg PID còn sống (lưu claimed_by = PID string). Nếu chết → re-trigger pipeline.
// Nếu sống → bump updated_at (heartbeat) để reaper sau không đo lại.
```

**FFmpeg pipeline (KHÔNG giữ pool connection — major v3):**
```ts
// 1. Acquire lock: const conn = await withNamedLock(pool, 'cdkt:media:transcode', 0, async (c) => c)
// 2. Lấy workdir + metadata row, GẢI PHÓNG conn (conn.release()) — lock giữ bằng row claimed_by, không bằng connection.
// 3. spawn ffmpeg async — KHÔNG giữ DB connection suốt transcode.
// 4. Heartbeat: scheduled task bump updated_at mỗi 5min (giữ connection ngắn, trả pool ngay).
// 5. Reaper dùng updated_at + claimed_by PID để quyết định re-trigger.
```

**M4 — Disk check:** dùng `fs.statfs` (Node 18+, KHÔNG `statvfs` — major v3), poll 60s, abort khi free < 1GB, đặt `processing_status='failed'`, log `media.disk_full`.

**Pipeline (7 bước):**
1. Ghép chunks → input.mp4, `detectVideoMime()`, tạo hàng `processing_status='processing'`, `claimed_by=<PID>`
2. ffprobe metadata → ghi DB
3. Transcode lũy tiến (libx264 CRF 23, AAC, `nice -n 19`, 2 thread/bản, 3 bản song song ≤ 6 core). Bản xong → cắt HLS, ghi vào asset root local và thêm `resolutions_ready`.
4. Cắt HLS `-c copy`, segments 4s. **Atomic master.m3u8 rewrite:** `writeFileSync(dir/master.m3u8.tmp)` + `renameSync`.
5. Thumbnail 3 frame.
6. Giữ `original`, `master.m3u8`, rendition/segment và `thumb.jpg` trong asset root local của item. **Yêu cầu upload R2 ở v4 chưa được triển khai.**
7. Dọn, `processing_status='ready'`, audit (cuối pipeline — sau transcode, trong chunked-upload complete tx, không trong long-running async).

### G. Ops — Dockerfile + docker-compose + manage.sh cmd_media_tuning (fix major v3) + nginx

**Dockerfile:**
```dockerfile
FROM node:22-alpine
RUN apk add --no-cache ffmpeg   # Alpine community: libx264 + native aac + hls muxer
RUN mkdir -p /var/lib/cdkt/media/processing /var/lib/cdkt/media/uploads \
    && chown -R node:node /var/lib/cdkt/media
ENV CDKT_MEDIA_WORKDIR=/var/lib/cdkt/media
```

**docker-compose.yml (major v3 — thêm deploy.resources.limits.memory):**
```yaml
services:
  app:
    container_name: cdkt_app
    volumes:
      - media_work:/var/lib/cdkt/media
      - uploads_data:/app/public/uploads
    environment:
      - MEDIA_UPLOAD_MAX_SIZE=10737418240
      - CDKT_MEDIA_WORKDIR=/var/lib/cdkt/media
      - MEDIA_UPLOAD_ENABLED=${MEDIA_UPLOAD_ENABLED:-true}
      - CDKT_SSE_REPLICA_GUARD=1
    deploy:
      resources:
        limits:
          memory: ${APP_MEM_LIMIT}      # dùng biến env, manage.sh set
volumes:
  media_work:
# MySQL service: cùng thêm deploy.resources.limits.memory: ${MYSQL_MEM_LIMIT}
```

**`production/manage.sh` — `cmd_media_tuning` (blocker A7 + major v3 fix `set_env` + RAM formula):**
```bash
# Định nghĩa set_env helper (tiền lệ sed tại manage.sh:328-329) nếu chưa có:
set_env() {  # $1 key, $2 value
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

cmd_media_tuning() {
  echo -e "\n${C_BOLD}═══ Media Portal — cấu hình RAM/CPU ═══${C_RESET}"
  local host_ram_mb=$(free -m | awk '/^Mem:/{print $2}')
  local host_cpus=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1)
  echo -e "  Máy chủ: ${C_CYAN}${host_ram_mb}MB${C_RESET} RAM, ${C_CYAN}${host_cpus} nhân${C_RESET}"

  if [ "$host_ram_mb" -lt 4000 ]; then
    echo -e "  ${C_RED}⚠  Media Portal cần ≥4GB RAM cho transcode FFmpeg.${C_RESET}"
    echo -e "  ${C_YELLOW}   VPS (${host_ram_mb}MB) quá nhỏ — upload video tắt, chỉ YouTube/CDN.${C_RESET}"
    if confirm "Bật upload video (cần ≥4GB RAM)?" "n"; then
      set_env MEDIA_UPLOAD_ENABLED true
    else
      set_env MEDIA_UPLOAD_ENABLED false
      echo -e "  ${C_DIM}→ Upload video tắt. Media Portal chỉ chạy YouTube/CDN.${C_RESET}"
      return
    fi
  else
    set_env MEDIA_UPLOAD_ENABLED true
  fi

  # RAM formula: đồng nhất check-resources.sh (host - 1g hệ thống - 0.5g nginx)
  # MySQL cgroup limit = 1000m (check-resources default), App = phần còn lại, clamp [2g, 6g]
  local suggest_app=$((host_ram_mb - 1500))
  [ "$suggest_app" -lt 2000 ] && suggest_app=2000
  [ "$suggest_app" -gt 6000 ] && suggest_app=6000
  set_env APP_MEM_LIMIT ${suggest_app}m
  set_env MYSQL_MEM_LIMIT 1000m
  echo -e "  ${C_GREEN}→ APP_MEM_LIMIT=${suggest_app}m, MYSQL_MEM_LIMIT=1000m${C_RESET}"
  echo -e "  ${C_DIM}CPU: không đặt trần (tiền lệ check-resources.sh). FFmpeg tự nice -n 19.${C_RESET}"
  echo -e "  ${C_DIM}deploy.resources.limits.memory trong compose dùng 2 biến này.${C_RESET}"
}
```

**Runtime gate upload:**
```ts
// server/api/admin/media-portal/upload/init.post.ts
if (useRuntimeConfig().mediaUploadEnabled !== true) {
  return createError({ statusCode: 503, message: 'Tải lên video đã tắt trên máy chủ này.' })
}
```

**nginx:** (như v3 + `client_max_body_size 12g` cho upload).

### H. Security — serializer + IDOR + YouTube noscookie + thumbnail proxy + stream byte-pipe + audit meta

- **`serializePublicMedia()`** tường minh, không `select()`. Lộ: id, slug, title, type, mediaSource, streamUrl, youtubeVideoId, thumbnailUrl, duration, description, categoryId, viewCount, publishedAt. **Không lộ:** processingStatus, resolutionsReady, isFeatured, status, createdBy.
- **streamUrl byte-pipe KHÔNG redirect (blocker B4 v3):** `serializePublicMedia` trả `streamUrl: '/api/public/media/<slug>/stream'`. Endpoint `stream.get.ts` resolve `storage_path` local ở server rồi **pipe byte stream** về client qua `sendStream(event, createReadStream(...))` (tiền lệ `server/routes/uploads/[...path].ts:67`), không 302 và không lộ internal path. Signed URL R2 không phải hành vi hiện tại.
- **IDOR (major v3 — bind mechanism cụ thể):** `upload_id` random UUID; lưu hàng `media_upload_sessions` (upload_id, admin_user_id, created_at, parts_received JSON, status) trong DB. Mỗi chunk/status/complete **re-verify** `WHERE upload_id=? AND admin_user_id=event.context.adminUser.id`. Disk workdir namespaced `/var/lib/cdkt/media/uploads/<upload_id>/` (UUID, không user input → chống path-traversal).
- **YouTube noscookie + thumbnail proxy (major v3):** embed `https://www.youtube-nocookie.com/embed/<id>`. `thumbnailUrl` cho media-sourced YouTube **KHÔNG** lộ `i.ytimg.com` — proxy server-side `/api/public/media/<slug>/thumb`; thumbnail upload được lưu local. Chỉ YouTube embed (noscookie) là domain Google duy nhất.
- **HLS.js lazy-load chỉ /media/\*\***: `MediaPlayer.vue` chỉ dynamic-import HLS.js cho video local. Nhánh YouTube dùng iframe `youtube-nocookie`; Plyr không được dùng.
- **Audit meta:** `id` + `slug` (không full media_url). `id` survives post-delete.
- **Reader-actor audit:** `userId: null` + `meta.readerId` (FK `user_id` trỏ `users`).
- **Chat content:** `getClientIp(event)` (KHÔNG `getRequestIP` — minor v3), `plain-text.ts` control char reject, max 200.

### I. Livestream — 1-active invariant GET_LOCK + VOD save TDZ-safe + chat rate-limit + retention

**Blocker B1 v3 giải — 1-active dùng `GET_LOCK` (KHÔNG dựa db.transaction alone):**
```ts
// server/services/livestream.ts
export async function startLivestream(input, adminUser) {
  // GET_LOCK timeout 0: skip nếu đã có session active (tiền lệ view-boost-scheduler:94)
  const conn = await pool.getConnection()
  const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', ['cdkt:livestream:active'])
  if (lock.acquired !== 1) { conn.release(); throw createError({ statusCode: 409, message: 'Đã có phiên phát sóng đang hoạt động.' }) }
  try {
    return await db.transaction(async (tx) => {
      await tx.update(livestreamSessions).set({ isActive: 0 }).where(eq(livestreamSessions.isActive, 1))
      const [header] = await tx.insert(livestreamSessions).values({ ...input, createdBy: adminUser.id, isActive: 1 })
      const sessionId = Number(header?.insertId ?? 0)  // TDZ-safe: dùng local
      await tx.insert(activityLogs).values({ /* ... */ })
      return { sessionId }
    })
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', ['cdkt:livestream:active'])
    conn.release()
  }
}
// stop: không cần GET_LOCK (đã active), 1 tx TDZ-safe save VOD (như v3).
// Test livestream-toggle.test.ts: 2 start concurrent → 1 thắng (409), 1 insert.
```

**Chat send:**
```ts
// POST /api/public/livestream/chat/send
// requireReader. Rate limit: 1 tin/3s/account + 20 tin/5 phút/account + 50 tin/5 phút/IP
// recordRateLimitHit RIGHT BEFORE insert (tiền lệ comment send). 2 keys: account AND IP.
// Content qua plain-text.ts (max 200). getClientIp(event).
// Save: db.transaction — INSERT livestream_messages + tx.insert(activityLogs) reader-actor.
// Broadcast SAU persist.
```

**Soft delete:** `DELETE /api/admin/livestream/chat/[msgId]` — UPDATE `is_deleted=1` + audit trong tx. Broadcast `{type:'delete', id}`. `GET /chat/history` lọc `is_deleted=0`.

**Listen:** `optionalReader` (anonymous xem chat OK). **Send:** `requireReader`.

### J. Data retention — `livestream_sessions` scope mới + ĐỦ 9 tệp (fix major v3)

**`server/services/retention-policy.ts` (KHÔNG phải data-retention.ts — major v3):**
```ts
export const RETENTION_SCOPES = [
  'activity_logs', 'submissions', 'chat_sessions', 'reader_accounts',
  'livestream_sessions',   // MỚI
] as const

// SCOPE_SETTINGS (Record<RetentionScope,...> — compile-checked):
// 'livestream_sessions': { daysKey: 'livestreamSessionDays', maxRowsKey: 'livestreamSessionMaxRows',
//                          envKey: 'LIVESTREAM_SESSION_DAYS', envField: ..., defaultDays: 90,
//                          defaultMaxRows: 0, bounds: { minDays: 30, maxDays: 365 } }
```

**`TABLE_COLUMNS` (major v3 — dùng `ended_at` KHÔNG `created_at`):**
```ts
'livestream_sessions': { timestamp: 'ended_at', order: 'ended_at' }
// Cùng bài học chat_sessions.last_message_at: một phiên live "cũ" khi nó KẾT THÚC, không khi nó BẮT ĐẦU.
// Purge theo created_at sẽ xoá phiên ĐANG streaming (ended_at NULL) → guard WHERE ended_at IS NOT NULL.
```

**9 tệp cần update (liệt kê đầy đủ — major v3):**
1. `server/services/retention-policy.ts` — `RETENTION_SCOPES` + `SCOPE_SETTINGS` (Record compile-checked)
2. `server/services/data-retention.ts` — `TABLE_COLUMNS` Record + `RetentionTarget` type re-export (nếu có) + `purgeDisabled` logic
3. `server/services/data-retention-config.ts` (nếu có) — runtime config keys
4. `server/services/retention-scheduler.ts` — `isRunDue` không cần đổi nhưng `runRetentionPass` lặp qua scope mới
5. `server/api/admin/settings/data-retention.get.ts` — expose scope settings cho UI
6. `server/api/admin/settings/data-retention.put.ts` — validate + save scope mới
7. `app/pages/admin/settings/data-retention.vue` — UI row cho livestream_sessions (v-if/else chain — test `public-pages-structure`)
8. `server/services/notifications.ts` — không liên quan (skip)
9. `tests/` liên quan retention — rà `tests/ops-scripts.test.ts` + retention test files

**`DataRetentionOptions` + `windows[]` (major v3):** thêm `livestreamSessionDays`/`livestreamSessionMaxRows` vào `DataRetentionOptions` interface và vào mảng `windows[]` tại `data-retention.ts:217-238` — **không** compile-checked bởi `Record<RetentionTarget,...>` nên phải khai tường minh.

`livestream_messages` **không phải scope** — CASCADE từ `livestream_sessions` (tiền lệ `chat_messages`). VOD (`saved_media_id SET NULL`) tồn tại độc lập sau session purge — chat history đi theo session, VOD vẫn xem được.

---

## Danh sách file (~42)

### Tạo mới (30)
```
server/services/
├── media-portal.ts              CRUD + serializePublicMedia + local-asset cleanup outbox (db.transaction, uniqueMediaSlug(tx))
├── video-processing.ts          FFmpeg spawn async + local assets + giải phóng pool conn + heartbeat + disk poll + atomic m3u8
├── chunked-upload.ts            chunks + IDOR (media_upload_sessions row) + disk check + merge + 24h cleanup
├── livestream.ts                start (GET_LOCK) / stop / VOD — 1 tx, TDZ-safe
├── livestream-chat.ts           SSE broadcast (bounded queue thủ công) + send/delete + rate limit
└── media-processing-reaper.ts   tick 15min cứu video stuck (claimed_by PID + updated_at heartbeat)

server/utils/
├── youtube-parser.ts            bóc video_id + noscookie embed URL
├── video-mime.ts                magic-byte mp4/webm/quicktime (two-allowlist)
├── sse-manager.ts               Map<sessionId, Set<ManagedStream>> + bounded queue + shutdown hook
├── named-lock.ts                withNamedLock helper dùng chung (gom 3 bản, trả conn cho action)
└── unique-media-slug.ts         uniqueMediaSlug(tx, title) anti-collision

server/plugins/
├── media-processing-reaper.ts   start reaper scheduler (unref, swallow error)
└── sse-shutdown.ts              Nitro close hook dọn SSE + replica guard boot check

server/api/admin/media-portal/   (CRUD + upload init/chunk/status/complete + processing-status)
server/api/admin/livestream/     (start, stop, history, chat delete)
server/api/public/media/         (index, [slug], [slug]/view, [slug]/stream (byte-pipe), [slug]/thumb (yt proxy), [slug]/comments)
server/api/public/livestream/    (active (no reader cookie), chat/{stream, send, history})

app/pages/media/{index.vue, [slug].vue}
app/pages/admin/media-portal/index.vue
app/components/{MediaCard, MediaPlayer, LiveHero, LiveChat, MediaDefaultHero, ChunkedUploader}.vue
app/composables/useLiveChat.ts

tests/ (10 file mới — xem §Test)
```

### Sửa (14)
```
server/db/schema.ts              4 bảng mới + article_comments.mediaItemId nullable + articleId nullable
server/db/init.ts                CREATE TABLE 4 bảng + re-export
server/db/migrations-additive.ts article_comments.media_item_id (ensureColumn) + article_id MODIFY NULL + FK + index
server/db/seed.ts                'media_portal' + 'livestream' resources
server/services/retention-policy.ts  RETENTION_SCOPES + SCOPE_SETTINGS livestream_sessions
server/services/data-retention.ts   TABLE_COLUMNS livestream_sessions (ended_at) + DataRetentionOptions + windows[]
server/services/comments.ts      PARAMETERIZE: CreateCommentInput + loadCommentThread (XOR) + checkParentEligibility + listCommentsForAdmin (left-join media) + deleteComment (mediaItemId audit) + createAdminReply (mediaItemId)
server/services/notifications.ts listNotifications + countOlderTopLevel + notificationTargetPage (mediaItemId? branch)
server/services/notification-email.ts  sendReplyEmail thêm nhánh media_items
server/services/{retention,view-boost,analytics-maintenance}.ts  refactor dùng withNamedLock (preserve emitNocBestEffort)
server/utils/named-lock.ts       (mới — liệt kê tách riêng)
app/utils/nav-config.ts          DEFAULT_NAV + labelKey 'video_lib' + interface + normalizeNavItem + test assertion
app/components/ArticleComments.vue thêm prop `mediaItemId?: number`
app/layouts/admin.vue            sidebar menu Media Portal
nuxt.config.ts                   routeRules['/media', '/media/**': swr 60]
Dockerfile                       apk add ffmpeg + /var/lib/cdkt/media
docker-compose.yml               media_work volume + deploy.resources.limits.memory (APP/MYSQL_MEM_LIMIT) + CDKT_SSE_REPLICA_GUARD
production/manage.sh             cmd_media_tuning + set_env helper
nginx (DEPLOY.md/CI-CD.md)       SSE + upload 10GB location
```

---

## Kiểm thử (10 file mới + bổ sung)

| File | Nội dung |
|------|----------|
| `tests/media-youtube-parser.test.ts` | Bóc video_id 10+ dạng URL, noscookie domain, thumbnail proxy path |
| `tests/media-processing.test.ts` | State machine pending→processing→ready/failed, resolutions_ready, reaper reclaim |
| `tests/chunked-upload.test.ts` | Resume, dọn 24h, disk check (statfs), IDOR (upload_id bind admin, re-verify mỗi request), path-traversal |
| `tests/livestream-toggle.test.ts` | GET_LOCK 1-active, 2 start concurrent → 1 thắng (409), TDZ save-VOD |
| `tests/livestream-chat.test.ts` | Rate limit (account+IP), soft delete, max 200, control char, history lọc is_deleted, bounded queue drop (pending >= 50) |
| `tests/media-comments.test.ts` | article_comments.media_item_id XOR, parameterized comments.ts, reader_notifications cho media reply, notification-email media branch |
| `tests/media-api.test.ts` | serializePublicMedia không lộ processingStatus, streamUrl byte-pipe (KHÔNG Location redirect), finitePositive |
| `tests/admin-media-portal-ui.test.ts` | role="alert", nút thử lại, skeleton, motion-reduce |
| `tests/media-sse-guard.test.ts` | Không text/event-stream ngoài server/api/**; EventStream instance không H3Event; shutdown hook đăng ký; bounded queue (push().catch không phải backpressure duy nhất) |
| `tests/media-portal-audit.test.ts` | Mọi service media_portal/livestream có db.transaction hoặc SERVICE_EXEMPTIONS; meta log id+slug không full URL; reader-actor userId:null + meta.readerId |

**Bổ sung:**
- `tests/reader-audit-atomicity.test.ts`: thêm 6 service media vào scan guard. `video-processing.ts` audit ở `chunked-upload complete` = SERVICE_EXEMPTIONS (long-running async).
- `tests/transaction-tdz.test.ts`: thêm `livestream.ts stop` (save-VOD) + `start` (GET_LOCK形状).
- `tests/nav-config-boundary.test.ts`: assertion `video_lib` key cả 2 ngôn ngữ.
- `tests/public-pages-structure.test.ts`: đếm `video_lib`/`fa-photo-film` × 2 (desktop + mobile drawer).
- `npm run db:drift`: 46 bảng (4 mới + article_comments đổi NULL).

---

## Thứ tự triển khai (17 bước)

| # | Việc | Phụ thuộc |
|---|------|----------|
| 1 | Schema: 4 bảng Drizzle + init.ts + article_comments (additive media_item_id + MODIFY article_id NULL) + db:drift 46 | — |
| 2 | RBAC: `media_portal` + `livestream` seed.ts | 1 |
| 3 | Data retention: `livestream_sessions` scope (9 tệp + DataRetentionOptions + windows) | 1 |
| 4 | `named-lock.ts` helper + refactor 3 scheduler dùng chung (preserve emitNocBestEffort) | — |
| 5 | youtube-parser.ts + video-mime.ts (two-allowlist) + thumbnail proxy | — |
| 6 | `unique-media-slug.ts` (nhận tx) | 1 |
| 7 | chunked-upload.ts (init/chunk/status/complete + IDOR row + disk check statfs + 24h cleanup) | 1, 5 |
| 8 | video-processing.ts (FFmpeg spawn + local assets + giải phóng pool conn + heartbeat + withNamedLock + disk poll + atomic m3u8) | 4, 7 |
| 9 | media-processing-reaper.ts + plugin (tick 15min, claimed_by PID) | 8 |
| 10 | media-portal.ts CRUD + serializePublicMedia + stream byte-pipe | 1, 6 |
| 11 | Parameterize comments.ts (mediaItemId XOR) + notifications.ts + notification-email.ts + ArticleComments.vue prop | 1 |
| 12 | livestream.ts (start GET_LOCK / stop / VOD — 1 tx, TDZ-safe) | 1, 6 |
| 13 | sse-manager.ts (bounded queue) + livestream-chat.ts (EventStream + shutdown hook + rate limit) + stream.get.ts | 12 |
| 14 | Admin API + Public API + audit tx | 7-13 |
| 15 | Nav-config + i18n + admin sidebar + public /media/** + components (lazy HLS.js + YouTube nocookie iframe) | 2, 14 |
| 16 | Deploy: Dockerfile + compose (deploy.resources.limits + container_name + REPLICA_GUARD) + manage.sh cmd_media_tuning + nginx | — |
| 17 | Test + typecheck + db:drift + build + verify | all |

---

## Out of scope v4 (ghi để sau)

- **Multi-replica SSE + Redis pub/sub**: v4 pin `container_name` + env guard. Scale cần Redis backplane.
- **Dash streaming**: chỉ HLS v4.
- **Album ảnh (type=album)**: schema có, UI v4 chỉ video.
- **Live chat emoji/reaction**: text-only v4.
- **Backfill lượt xem video**: 0 like article-views.
- **Video chapters/timeline markers**: v4 không.

---

## Tóm tắt thay đổi v3 → v4

| Vấn đề v3 | Sửa v4 |
|-----------|--------|
| **B1 blocker**: livestream 1-active db.transaction alone không race-safe | `GET_LOCK('cdkt:livestream:active', 0)` + 409 nếu lock bận |
| **B2 blocker**: article_id nullable thiếu MODIFY COLUMN | `ensureColumnDefinition` (MODIFY precedent line 255,299) |
| **B3 blocker**: `push().catch()` dead-code (h3 không reject) | Bounded queue thủ công `pending >= 50` → drop+close, track `closed` |
| **B4 blocker**: stream 302 leak storage URL | Byte-pipe `sendStream` (tiền lệ uploads/[...path]:67), KHÔNG redirect; current store is local |
| **M**: uniqueMediaSlug nhận `tx` không `db` | Tham số `tx` |
| **M**: sendReplyEmail thiếu nhánh media | Thêm `media_items` lookup + URL `/media/<slug>` |
| **M**: loadCommentThread thiếu XOR guard | Runtime XOR + nhánh query |
| **M**: listCommentsForAdmin thiếu media join | leftJoin media_items + `?source` filter |
| **M**: deleteComment thiếu mediaItemId audit | Select + meta.mediaItemId |
| **M**: createAdminReply/notification media | listNotifications + countOlderTopLevel + sendReplyEmail nhánh media |
| **M**: docker replicas no-op Compose | `container_name` pin + env guard boot check |
| **M**: SSE shutdown event malformed chuỗi | `push({event,data})` object |
| **M**: stream.get.ts thiếu callsite | `createEventStream → addSseConnection → return stream.send()` |
| **M**: ffmpeg holds pool connection | Giải phóng conn trước spawn, heartbeat qua row claimed_by |
| **M**: set_env undefined manage.sh | Helper sed tiền lệ line 328-329 |
| **M**: RAM formula mâu thuẫn + compose thiếu limits | Đồng nhất check-resources + `deploy.resources.limits.memory` tham chiếu env |
| **M**: IDOR bind mechanism | `media_upload_sessions` row + re-verify mỗi request + UUID disk namespace |
| **M**: YouTube thumbnail leak i.ytimg.com | Server-side thumb proxy hoặc ffmpeg frame |
| **M**: J "8 tệp" underspecified | 9 tệp + đúng `retention-policy.ts` |
| **M**: J DataRetentionOptions/windows | Thêm `livestreamSession*` tường minh |
| **M**: J timestamp created_at | `ended_at` (cùng bài học chat_sessions) |
| **M**: analytics emitNocBestEffort lost | Preserve trong withNamedLock action |

**Trạng thái hiện tại:** code path lõi đã triển khai, nhưng còn các điều kiện archive/production tại thông báo đầu file và checklist §18. Không coi kế hoạch lịch sử là nghiệm thu hoàn tất.
