/**
 * Cổng media — hai nửa của cùng một bảng `media_items`: đường ĐỌC công khai và
 * đường GHI của quản trị.
 *
 * File này là **barrel + phần còn lại** sau khi tách 4 cluster ra file con:
 *   • `media-validation.ts` — các `require*`/`optional*` + `MediaValidationError`
 *   • `media-views.ts` — `recordMediaView` + `buildMediaViewDedupeKey`
 *   • `media-portal-public.ts` — serialize + read công khai
 *   • `media-portal-admin-read.ts` — serialize + read quản trị
 *   • `media-portal-constants.ts` — hằng số + type chia sẻ
 *
 * Ở lại file này: cluster E (stream/thumbnail resolution — gắn chính, nhiều
 * helper nội bộ), cluster G (admin write — `createMediaItem`/`updateMediaItem`/
 * `deleteMediaItem`), cluster H (thumbnail override). 168 endpoint import qua
 * barrel re-export cuối file, không cần đổi import path.
 *
 * Hai nửa nằm chung một tệp vì chúng chia sẻ đúng một thứ dễ sai nhất: **tập cột
 * nào được ra khỏi máy chủ**. `media_items` mang theo `processing_status`,
 * `resolutions_ready`, `is_featured`, `status`, `created_by`, `claimed_by` và
 * `processing_error`; chuỗi cuối cùng chứa **đường dẫn tệp và thông báo FFmpeg**,
 * tức là nó mô tả cấu trúc đĩa của máy chủ cho bất kỳ ai gọi endpoint. Một lượt
 * `select()` trần rồi trả thẳng hàng sẽ đẩy hết nhóm đó ra ngoài, và nó **trông
 * đúng** — không có gì đỏ ở đâu cả.
 *
 * Nên `serializePublicMedia` **liệt kê từng trường** thay vì chép hàng. Hệ quả
 * cố ý: thêm một cột vào `media_items` sau này **không** tự động xuất hiện trong
 * phản hồi công khai; người thêm phải tự viết nó vào đây, và đó là bước duy nhất
 * trong toàn bộ thay đổi mà việc "quên" là an toàn theo hướng đúng.
 *
 * Ba đường đọc riêng biệt, không phải một đường tham số hoá:
 *   • `listPublishedMedia` / `getPublishedMediaByShortId` — chọn **tập cột công
 *     khai**, không hề chạm tới `storage_path`.
 *   • `resolveStreamTarget` / `resolveThumbnailTarget` — chọn **tập cột nội bộ**
 *     (cần `storage_path`, `source`, `youtube_video_id`) và **không bao giờ** trả
 *     một hàng cho nơi gọi: chúng trả về một đường dẫn tệp đã kiểm, hoặc `null`.
 *     Đây là ranh giới thật — một hàm trả hàng rồi để nơi gọi tự lọc là một hàm
 *     sẽ có nơi gọi thứ hai quên lọc.
 */
import { randomUUID } from 'node:crypto'
import { statSync, readdirSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { activityLogs, media, mediaAssetCleanup, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import type { MediaConfig } from '../utils/media-config'
import { resolveMediaConfig } from '../utils/media-config'
import { uniqueMediaSlug } from '../utils/unique-media-slug'
import { uniqueShortMediaId } from '../utils/short-media-id'
import {
  buildYouTubeThumbnailUpstreamUrl,
} from '../utils/youtube-parser'
import { abortProcessingClaim, mediaAssetRoot } from './video-processing'
import { locateR2Original, listR2Keys, putR2Object, headR2Object } from './video-r2-sync'
import { getR2Object, type R2Config } from '../utils/media-r2'
import { loadR2Config } from './media'
import sharp from 'sharp'

// Hằng số chia sẻ từ file con — re-export để 168 endpoint import từ đây không đổi.
export {
  MEDIA_ITEM_STATUSES, MEDIA_SOURCES, PUBLISHED_MEDIA_STATUS,
  MEDIA_TITLE_MAX_LENGTH, MEDIA_DESCRIPTION_MAX_LENGTH, MEDIA_SEARCH_MAX_LENGTH,
  MEDIA_LIST_MAX_LIMIT, MANIFEST_CACHE_SECONDS, SEGMENT_CACHE_SECONDS,
  MEDIA_VIEW_DEDUPE_WINDOW_SECONDS, MEDIA_VIEW_DEDUPE_RULE,
  MEDIA_VIEW_DEDUPE_KEY_MAX_LENGTH, MEDIA_VIEW_DEDUPE_TOKEN_LENGTH,
  type MediaItemStatus, type MediaSource,
} from './media-portal-constants'

// Các hàm validation từ file con — re-export.
export {
  MediaValidationError, requireMediaTitle, optionalMediaText,
  requireMediaSource, requireMediaStatus, requireMediaBoolean,
  optionalMediaId, requireMediaSourceId,
} from './media-validation'

// Đếm lượt xem từ file con — re-export.
export { buildMediaViewDedupeKey, recordMediaView } from './media-views'

// Đường đọc công khai từ file con — re-export.
export {
  serializePublicMedia, buildMediaStreamPath, coerceResolutionsReady,
  listPublishedMedia, countPublishedMediaByCategory,
  getPublishedMediaByShortId, resolvePublishedMediaIdByShortId,
  type PublicMediaRow, type PublicMediaItem, type PublishedMediaQuery,
  type PublishedMediaPage, type PublicMediaCategory,
} from './media-portal-public'

// Đường đọc quản trị từ file con — re-export.
export {
  serializeAdminMedia, listAllMediaForAdmin, getMediaItemForAdmin,
  type AdminMediaRow, type AdminMediaItem, type AdminMediaQuery,
  type AdminMediaPage,
} from './media-portal-admin-read'

// Import nội bộ để cluster E/G/H dùng (không re-export).
import {
  PUBLISHED_MEDIA_STATUS,
  MEDIA_DESCRIPTION_MAX_LENGTH,
  MANIFEST_CACHE_SECONDS,
  SEGMENT_CACHE_SECONDS,
  type MediaItemStatus,
} from './media-portal-constants'
import {
  requireMediaTitle, optionalMediaText,
  requireMediaSource, requireMediaStatus, requireMediaBoolean,
  optionalMediaId, requireMediaSourceId,
} from './media-validation'
import { coerceResolutionsReady } from './media-portal-public'

// ─── Hằng số nội bộ (chỉ dùng trong file này, không re-export) ──────────────
// Hằng số chia sẻ (manifest cache, dedup view, độ dài tiêu đề...) đã chuyển
// sang `media-portal-constants.ts` và re-export ở đầu file. Bốn hằng số dưới đây
// là internal — chỉ cluster E/G/H dùng, không có endpoint nào import trực tiếp.

const MEDIA_THUMBNAIL_FILE = 'thumb.jpg'
const MEDIA_MASTER_PLAYLIST = 'master.m3u8'
const MEDIA_SUBDIR = 'media'
/** Trần độ dài một đường dẫn tài nguyên trong cây đã công bố. */
const MAX_ASSET_PATH_LENGTH = 512

/**
 * Đuôi tệp → kiểu nội dung, cho cây HLS đã công bố.
 *
 * `.m3u8` và `.ts` là hai đuôi thật sự được phục vụ. Danh sách **không** mở rộng
 * theo kiểu "thêm cho đủ": một đuôi không nhận ra đi ra dưới
 * `application/octet-stream` kèm `Content-Disposition: attachment`, đúng như
 * `server/routes/uploads/[...path].ts` làm — nội dung không rõ loại thì tải về,
 * không hiển thị.
 */
const STREAM_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  // Tệp gốc khi `MEDIA_AUTO_TRANSCODE=false` — không có HLS, stream endpoint phục
  // vụ trực tiếp `original.<ext>` qua byte-range. Bốn thùng chứa nhận ở đường tải
  // lên (xem `EXT_BY_VIDEO_MIME`); chỉ `.mp4` và `.webm` trình duyệt phát được
  // gốc, `.mov`/`.mkv` phụ thuộc codec — nhưng phục vụ đúng content-type vẫn đúng
  // hơn `application/octet-stream` (kèm nosniff trình duyệt tự quyết định).
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.vtt': 'text/vtt',
}

// ─── Đích phục vụ tệp (đường dẫn nội bộ) ─────────────────────────────────────

/** Tập cột nội bộ, chỉ dùng cho hai endpoint phục vụ tệp. Không có `select()`
 *  trần nào ở đây, cùng lý do như tập cột công khai. */
const assetMediaSelection = {
  id: mediaItems.id,
  slug: mediaItems.slug,
  shortId: mediaItems.shortId,
  source: mediaItems.source,
  youtubeVideoId: mediaItems.youtubeVideoId,
  storagePath: mediaItems.storagePath,
  storageProvider: mediaItems.storageProvider,
  status: mediaItems.status,
  resolutionsReady: mediaItems.resolutionsReady,
} as const

/**
 * Thư mục đã công bố của một mục: `<workdir>/media/<slug>`.
 *
 * Dựng từ `storage_path` khi có, và **luôn** kiểm lại rằng kết quả nằm trong
 * `<workdir>/media/`. `storage_path` là một chuỗi trong CSDL; một giá trị chứa
 * `../..` sẽ trỏ ra ngoài cây media, và chốt chặn không thể là "giá trị đó do
 * máy chủ ghi nên nó đúng".
 */
export function resolveMediaDirectory(
  config: MediaConfig,
  item: { slug: string, storagePath?: string | null },
): string | null {
  const root = path.resolve(config.workdir, MEDIA_SUBDIR)
  const stored = typeof item.storagePath === 'string' ? item.storagePath.trim() : ''
  // `storagePath` có thể chứa `/generations/<gen-id>` — đường dẫn cây R2 sau khi
  // transcode ghi `storageProvider='r2'`. Khi R2 **chưa cấu hình** (deploy không có
  // R2 env, hoặc worker ghi nhầm cột), code lùi về đĩa local, nhưng tệp gốc và
  // manifest trên đĩa nằm ở **base UUID folder** (`media/<uuid>/original.mp4`,
  // `media/<uuid>/generations/<gen-id>/master.m3u8`), không phải theo `storagePath`
  // đầy đủ. Strip phần `/generations/...` về base UUID — cùng phép `mediaAssetRoot`
  // dùng cho asset cleanup, để nhánh local tìm đúng thư mục.
  const stripped = stored.split('/generations/')[0] ?? stored
  const relative = stripped || `${MEDIA_SUBDIR}/${item.slug}`
  const resolved = path.resolve(config.workdir, relative)
  if (resolved === root || !resolved.startsWith(root + path.sep)) return null
  return resolved
}

/**
 * Tìm tệp gốc `original.<ext>` trong thư mục đã công bố.
 *
 * Khi `MEDIA_AUTO_TRANSCODE=false`, pipeline chỉ probe + thumbnail rồi đặt
 * `processingStatus='ready'` mà không cắt HLS, nên không có `master.m3u8`. Stream
 * endpoint vẫn phải phát được — công dân bấm play trên một video đã xuất bản và
 * thấy 404 là đúng cái tính năng "tắt transcode để đỡ lag" ra đời để tránh.
 *
 * Trả đường dẫn tuyệt đối tới tệp đầu tiên khớp `original.*`, hoặc `null` khi thư
 * mục không tồn tại / không có tệp gốc. Giống `locateOriginal` trong
 * `video-processing.ts` nhưng ở đây để **phục vụ** tệp, không để FFmpeg đọc — nên
 * đặt trong service này tránh phụ thuộc vòng (video-processing import service này).
 */
async function locateOriginalFile(directory: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(directory)
  } catch {
    return null
  }
  // Chỉ nhận tệp có đuôi trong `STREAM_CONTENT_TYPES` — một tệp `original.bin` lạ
  // không nên được phục vụ, và `original.mp4.part` (tải đang dở) thì tuyệt đối
  // không (nửa tệp đọc ra là nửa video hỏng).
  const found = entries.find(entry => {
    if (!entry.startsWith('original.')) return false
    const ext = path.extname(entry).toLowerCase()
    return ext in STREAM_CONTENT_TYPES
  })
  return found ? path.resolve(directory, found) : null
}

/**
 * Đường dẫn tài nguyên trong cây đã công bố, đã lọc bỏ mọi đoạn nguy hiểm.
 *
 * `..` bị **bỏ hẳn** (không phải từ chối): `a/../../b` thành `a/b`, đúng như
 * `server/routes/uploads/[...path].ts` làm. Phép kiểm `startsWith` ở nơi gọi là
 * lớp thứ hai, và hai lớp này độc lập — lớp này sai thì lớp kia vẫn đứng.
 */
export function normalizeAssetPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > MAX_ASSET_PATH_LENGTH) return null
  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
  if (segments.length === 0) return null
  return segments.join('/')
}

export type StreamTarget =
  | {
      kind: 'local'
      filePath: string
      contentType: string
      size: number
      cacheSeconds: number
      attachment: boolean
      /**
       * `true` khi đây là tệp gốc `original.<ext>` phục vụ trực tiếp (không HLS).
       * Endpoint cần xử lý byte-range (Range → 206) vì trình phát `<video>` cần
       * tua được — HLS đã cóRange trong giao thức, tệp gốc thì không.
       */
      passthrough?: boolean
    }
  | {
      kind: 'r2'
      r2Key: string
      contentType: string
      size: number
      cacheSeconds: number
      attachment: boolean
      /**
       * `true` khi phục vụ tệp gốc `original.<ext>` trực tiếp (autoTranscode=false,
       * không rendition HLS). Endpoint cần byte-range qua R2 (Range header → GetObject
       * với `Range` param → 206). `r2Key` trỏ tới `original.<ext>`, không phải manifest.
       */
      passthrough?: boolean
    }

/**
 * Tệp cần phục vụ cho một yêu cầu phát, hoặc `null`.
 *
 * `null` gộp **mọi** lý do không phục vụ được: slug lạ, mục chưa xuất bản, mục
 * nguồn ngoài (không có gì để phát từ đĩa), đường dẫn thoát khỏi cây media, và
 * tệp không tồn tại. Nơi gọi chỉ có một nhánh 404, và không có nhánh nào trong
 * số đó nói ra lý do thật — một phản hồi khác nhau giữa chúng là cách liệt kê ra
 * những slug chưa xuất bản.
 *
 * R2: khi `storageProvider='r2'`, trả `{ kind: 'r2', r2Key }` — nơi gọi pipe
 * stream từ R2 qua proxy (không redirect, giữ design.md dòng 196 "không lộ
 * storage location"). `r2Key` = `storagePath + '/' + assetPath`.
 */
export async function resolveStreamTarget(
  shortId: string,
  relativePath: unknown,
  deps: { db?: Database, config?: MediaConfig, lookupSlug?: boolean } = {},
): Promise<StreamTarget | null> {
  const db = deps.db ?? getDb()
  const config = deps.config ?? resolveMediaConfig()

  const assetPath = normalizeAssetPath(relativePath)
  if (!assetPath) return null

  // Mặc định tra theo `short_id` (định danh URL công khai). `lookupSlug: true` cho
  // fallback link cũ — endpoint stream/thumb tra short_id trước, nếu null thử
  // slug (asset phục vụ thẳng, không redirect — redirect segment hỏng cache).
  const lookup = deps.lookupSlug ? mediaItems.slug : mediaItems.shortId
  const [row] = await db
    .select(assetMediaSelection)
    .from(mediaItems)
    .where(eq(lookup, shortId))
    .limit(1)

  if (!row || row.status !== PUBLISHED_MEDIA_STATUS) return null
  if (row.source !== 'upload') return null

  // Cột `resolutions_ready` là `json()` — `MySqlJson` **không** có `mapFromDriverValue`
  // (xem drizzle-orm/mysql-core/columns/json.cjs), nên việc parse JSON thành mảng
  // thuộc về **mysql2 driver** (`typeCast` mặc định parse cột JSON). Trên driver thật
  // `row.resolutionsReady` là mảng; trên một pool giả trong test (bypass driver) nó
  // đến dưới dạng chuỗi JSON, và `Array.isArray('["360p"]')` là `false` → nhánh fallback
  // kích hoạt sai cho một mục **có** rendition → 404. Parse ở đây để hai đường ra đồng
  // nhất: đây là khác biệt thật giữa driver và mock, không phải đoán kiểu.
  const renditions = coerceResolutionsReady((row as { resolutionsReady?: unknown }).resolutionsReady)
  // `MEDIA_AUTO_TRANSCODE=false` — không có HLS: `master.m3u8` không tồn tại và
  // `resolutionsReady` rỗng. Trả về 404 ở đây khiến một video đã xuất bản phát
  // không được, đúng khi tắt transcode để đỡ lag: công dân bấm play và thấy khung
  // đen. Fallback: phục vụ tệp gốc `original.<ext>` qua byte-range. Chỉ áp dụng
  // cho đúng manifest — một yêu cầu phân đoạn (`.ts`/`.m4s`) khi không có rendition
  // thực sự là lỗi, và lùi về tệp gốc ở đó sẽ trả video gốc dưới dạng `video/mp2t`.
  const isPassthroughManifest = assetPath === MEDIA_MASTER_PLAYLIST
    && (renditions === null || renditions.length === 0)

  // R2 stream — `storagePath` là R2 key prefix (cùng hình dạng cây, khác backend).
  // Không kiểm `startsWith(directory)` vì không có filesystem — chỉ kiểm
  // `assetPath` đã lọc `..` qua `normalizeAssetPath`.
  //
  // Chỉ đi nhánh R2 khi R2 **thật sự cấu hình**. Một mục có `storageProvider='r2'`
  // mà `videoStorage.r2` chưa đặt (deploy chưa cấu hình, hoặc worker ghi nhầm cột)
  // vẫn có tệp gốc trên đĩa local — pipeline upload ghi `original.<ext>` đến thư
  // mục làm việc trước khi sync, và khi R2 chưa cấu hình thì tệp ở lại đó. Lùi về
  // local ở nhánh này để video vẫn phát được; trả 404 trên một mục đã xuất bản chỉ
  // vì cấu hình R2 chưa khớp CSDL là đúng loại hỏng đọc ra "cổng bị gãy".
  if (row.storageProvider === 'r2' && config.videoStorage.r2) {
    const stored = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
    if (!stored) return null
    const r2Config = config.videoStorage.r2

    // Nhánh passthrough R2: không có rendition → phục vụ `original.<ext>` từ R2
    // qua byte-range (Range → GetObject `Range` → 206). Tương tự nhánh local
    // `locateOriginalFile` nhưng list R2 prefix.
    //
    // **Lùi về local nếu R2 không có original**: pipeline `video-processing.ts`
    // sync cây `published` lên R2 rồi xoá local (dòng 741), nhưng sync có thể bỏ
    // sót `original.<ext>` — tệp gốc lớn có thể put fail một phần mà log vẫn ghi
    // `r2_synced` cho phần đã xong. Khi R2 thiếu original, local thường vẫn còn,
    // vì xoá `published` chỉ chạy sau sync thành công toàn cây; một original còn
    // trên đĩa nghĩa là sync đã không thấy nó. Trả 404 trên một video có tệp gốc
    // trên đĩa chỉ vì R2 liệt kê thiếu là đúng loại hỏng đọc ra "cổng bị gãy".
    if (isPassthroughManifest) {
      const originalR2 = await locateR2Original(stored, r2Config)
      if (originalR2) {
        const extension = path.extname(originalR2.key).toLowerCase()
        const known = STREAM_CONTENT_TYPES[extension]
        return {
          kind: 'r2',
          r2Key: originalR2.key,
          contentType: known ?? 'application/octet-stream',
          size: 0,
          cacheSeconds: SEGMENT_CACHE_SECONDS,
          attachment: known === undefined,
          passthrough: true,
        }
      }
      // R2 không có original → thử local đĩa (upload ghi `original.<ext>` thẳng
      // vào `published`, và nếu sync R2 không thấy nó thì xoá local cũng không chạy).
      const directory = resolveMediaDirectory(config, row)
      if (directory) {
        const original = await locateOriginalFile(directory)
        if (original) {
          let size: number
          try {
            const stat = statSync(original)
            if (!stat.isFile()) return null
            size = stat.size
          } catch {
            return null
          }
          const extension = path.extname(original).toLowerCase()
          const known = STREAM_CONTENT_TYPES[extension]
          return {
            kind: 'local',
            filePath: original,
            contentType: known ?? 'application/octet-stream',
            size,
            cacheSeconds: SEGMENT_CACHE_SECONDS,
            attachment: known === undefined,
            passthrough: true,
          }
        }
      }
      return null
    }

    const r2Key = `${stored.replace(/\/+$/g, '')}/${assetPath}`
    const extension = path.extname(assetPath).toLowerCase()
    const known = STREAM_CONTENT_TYPES[extension]

    // Manifest `master.m3u8` trên R2 có thể chưa tồn tại khi đang transcode —
    // `resolutions_ready` đã liệt kê các bản xong nhưng manifest chỉ được publish
    // sau khi **mọi** bản trong plan xong (`publishChain` nối đuôi). HeadObject kiểm
    // tồn tại; null → lùi về `original.<ext>` trên R2 (đã có ngay sau upload), để
    // công dân phát được video gốc thay vì thấy 404.
    //
    // Chỉ áp dụng cho manifest — segment (`.ts`/`.m4s`) khi manifest chưa publish
    // là lỗi thật.
    if (assetPath === MEDIA_MASTER_PLAYLIST) {
      const head = await headR2Object(r2Key, r2Config)
      if (!head) {
        const originalR2 = await locateR2Original(stored, r2Config)
        if (originalR2) {
          const ext = path.extname(originalR2.key).toLowerCase()
          const origKnown = STREAM_CONTENT_TYPES[ext]
          return {
            kind: 'r2',
            r2Key: originalR2.key,
            contentType: origKnown ?? 'application/octet-stream',
            size: 0,
            cacheSeconds: SEGMENT_CACHE_SECONDS,
            attachment: origKnown === undefined,
            passthrough: true,
          }
        }
        // R2 không có original → thử local đĩa (upload ghi `original.<ext>` đến
        // thư mục làm việc trước khi sync; nếu sync R2 chưa thấy, local còn).
        const directory = resolveMediaDirectory(config, row)
        if (directory) {
          const original = await locateOriginalFile(directory)
          if (original) {
            let stat
            try {
              stat = statSync(original)
              if (!stat.isFile()) return null
            } catch {
              return null
            }
            const ext = path.extname(original).toLowerCase()
            const origKnown = STREAM_CONTENT_TYPES[ext]
            return {
              kind: 'local',
              filePath: original,
              contentType: origKnown ?? 'application/octet-stream',
              size: stat.size,
              cacheSeconds: SEGMENT_CACHE_SECONDS,
              attachment: origKnown === undefined,
              passthrough: true,
            }
          }
        }
        return null
      }
    }

    return {
      kind: 'r2',
      r2Key,
      contentType: known ?? 'application/octet-stream',
      size: 0, // không biết trước — R2 GetObject trả ContentLength, nơi gọi đọc
      cacheSeconds: extension === '.m3u8' ? MANIFEST_CACHE_SECONDS : SEGMENT_CACHE_SECONDS,
      attachment: known === undefined,
    }
  }

  const directory = resolveMediaDirectory(config, row)
  if (!directory) return null

  if (isPassthroughManifest) {
    const original = await locateOriginalFile(directory)
    if (!original) return null
    let size: number
    try {
      const stat = statSync(original)
      if (!stat.isFile()) return null
      size = stat.size
    } catch {
      return null
    }
    const extension = path.extname(original).toLowerCase()
    const known = STREAM_CONTENT_TYPES[extension]
    return {
      kind: 'local',
      filePath: original,
      contentType: known ?? 'application/octet-stream',
      size,
      // Tệp gốc không đổi sau khi upload xong, nên đệm lâu hơn manifest HLS.
      cacheSeconds: SEGMENT_CACHE_SECONDS,
      attachment: known === undefined,
      passthrough: true,
    }
  }
  const generationPath = typeof row.storagePath === 'string' && row.storagePath.includes('/generations/')
    ? path.resolve(config.workdir, row.storagePath.trim())
    : directory
  const filePath = path.resolve(generationPath, assetPath)
  if (filePath !== generationPath && !filePath.startsWith(generationPath + path.sep)) return null

  let size: number
  let resolvedPath = filePath
  let passthrough = false
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return null
    size = stat.size
  } catch {
    // Manifest `master.m3u8` không tồn tại — manifest HLS chỉ được xuất bản **sau
    // khi mọi bản trong plan transcode xong** (`publishChain` nối đuôi), nên một
    // mục đang `processing` có `resolutions_ready` đã liệt kê các bản xong nhưng
    // tệp manifest vẫn chưa có. Lúc này công dân bấm play thấy 404 → "báo lỗi
    // luôn", trong khi tệp gốc `original.<ext>` đã nằm trên đĩa ngay sau khi
    // upload xong (probe xong là có). Lùi về tệp gốc: phát được ngay, không đợi
    // transcode xong.
    //
    // Chỉ áp dụng cho đúng manifest — một yêu cầu phân đoạn (`.ts`/`.m4s`) khi
    // manifest chưa publish thực sự là lỗi, và lùi về tệp gốc ở đó sẽ trả video
    // gốc dưới dạng `video/mp2t`.
    if (assetPath !== MEDIA_MASTER_PLAYLIST) return null
    const original = await locateOriginalFile(directory)
    if (!original) return null
    let stat
    try {
      stat = statSync(original)
      if (!stat.isFile()) return null
    } catch {
      return null
    }
    resolvedPath = original
    size = stat.size
    passthrough = true
  }

  const extension = path.extname(resolvedPath).toLowerCase()
  const known = STREAM_CONTENT_TYPES[extension]

  return {
    kind: 'local',
    filePath: resolvedPath,
    contentType: known ?? 'application/octet-stream',
    size,
    // Tệp gốc không đổi sau khi upload xong, nên đệm lâu hơn manifest HLS.
    cacheSeconds: passthrough ? SEGMENT_CACHE_SECONDS
      : (extension === '.m3u8' ? MANIFEST_CACHE_SECONDS : SEGMENT_CACHE_SECONDS),
    attachment: known === undefined,
    passthrough,
  }
}

/** Đường dẫn manifest của một mục. Tách thành hằng để hai endpoint (manifest và
 *  tài nguyên) không thể lệch nhau về tên tệp. */
export const MEDIA_STREAM_MANIFEST_PATH = MEDIA_MASTER_PLAYLIST

export type ThumbnailTarget =
  | { kind: 'local', filePath: string, contentType: string, size: number }
  | { kind: 'remote', url: string }
  | { kind: 'r2', r2Key: string }

/**
 * Ảnh thu nhỏ của một mục đã xuất bản.
 *
 * Mục nguồn ngoài trả về **địa chỉ thượng nguồn** để endpoint đi lấy, và đó là
 * chỗ duy nhất trong toàn bộ mã công khai mà máy chủ ảnh của nền tảng được nêu
 * tên — nó không bao giờ đi vào một phản hồi. Tra theo `slug` của mục đã xuất
 * bản, không theo định danh video: khoá theo định danh thì bất kỳ ai cũng biến
 * cổng này thành một proxy ảnh mở cho mọi video trên nền tảng.
 *
 * R2: khi `storageProvider='r2'`, thumbnail nằm cùng cây R2 với rendition —
 * trả `{ kind: 'r2', r2Key }`, endpoint pipe qua proxy như stream.
 */
export async function resolveThumbnailTarget(
  shortId: string,
  deps: { db?: Database, config?: MediaConfig, lookupSlug?: boolean } = {},
): Promise<ThumbnailTarget | null> {
  const db = deps.db ?? getDb()
  const config = deps.config ?? resolveMediaConfig()

  const lookup = deps.lookupSlug ? mediaItems.slug : mediaItems.shortId
  const [row] = await db
    .select(assetMediaSelection)
    .from(mediaItems)
    .where(eq(lookup, shortId))
    .limit(1)

  if (!row || row.status !== PUBLISHED_MEDIA_STATUS) return null

  if (row.source === 'youtube') {
    const url = buildYouTubeThumbnailUpstreamUrl(row.youtubeVideoId)
    return url ? { kind: 'remote', url } : null
  }

  // R2 thumbnail — cùng key prefix với rendition, tệp `thumb.jpg`. Pipeline lưu
  // thumb ở `${stored}/generations/<claim>/thumb.jpg` (dòng 596 của video-processing
  // đặt `published` sâu hơn `assetRoot`), nên phải **list** keys để tìm nó thay
  // vì đoán cấp. Ưu tiên `thumb.jpg` ở cấp gốc (cho deployment sửa sau này), rồi
  // mới tới `generations/<claim>/thumb.jpg` (kiểu present).
  if (row.storageProvider === 'r2') {
    const stored = typeof row.storagePath === 'string' ? row.storagePath.trim() : ''
    if (stored) {
      const base = stored.replace(/\/+$/g, '')
      const r2Config = config.videoStorage.r2
      if (r2Config) {
        const keys = await listR2Keys(base, r2Config)
        if (keys) {
          const rootKey = `${base}/${MEDIA_THUMBNAIL_FILE}`
          if (keys.includes(rootKey)) {
            return { kind: 'r2', r2Key: rootKey }
          }
          // Tìm `thumb.jpg` ở cấp sâu hơn — `generations/<claim>/thumb.jpg`. Lấy
          // key ngắn nhất (cấp nông nhất) để khớp layout hiện tại và không ưu tiên
          // thumb của phiên thử cũ nằm sâu hơn.
          const deeper = keys
            .filter(k => k.endsWith(`/${MEDIA_THUMBNAIL_FILE}`) && k !== rootKey)
            .sort((a, b) => a.length - b.length)
          const firstDeeper = deeper[0]
          if (firstDeeper) {
            return { kind: 'r2', r2Key: firstDeeper }
          }
        }
      }
    }
    // R2 không có thumb → thử đĩa local. Cùng lý do `resolveStreamTarget` dòng
    // 960-1008 lùi local khi R2 thiếu original: pipeline sync R2 có thể bỏ sót
    // thumb, và khi đó thumb thường vẫn còn trên đĩa (sync xoá `published` chỉ
    // chạy sau khi sync thành công toàn cây). Trả 404 trên một mục có thumb trên
    // đĩa chỉ vì R2 liệt kê thiếu là đúng loại hỏng đọc ra "cổng bị gãy".
    const localThumb = resolveLocalThumbnail(config, row)
    if (localThumb) return localThumb
    return null
  }

  return resolveLocalThumbnail(config, row)
}

/**
 * Tìm `thumb.jpg` trên đĩa local — cấp gốc rồi `generations/<claim>/`. Tách ra
 * để nhánh R2 fallback dùng chung (khi R2 list không có thumb).
 */
function resolveLocalThumbnail(
  config: MediaConfig,
  row: { slug: string, storagePath?: string | null },
): ThumbnailTarget | null {
  const directory = resolveMediaDirectory(config, row)
  if (!directory) return null

  // Cấp gốc: `<workdir>/media/<slug>/thumb.jpg` (layout sau khi sửa pipeline).
  const rootFile = path.join(directory, MEDIA_THUMBNAIL_FILE)
  try {
    const stat = statSync(rootFile)
    if (stat.isFile()) return { kind: 'local', filePath: rootFile, contentType: 'image/jpeg', size: stat.size }
  } catch { /* không có ở gốc — thử generations */ }

  // Cấp `generations/<claim>/thumb.jpg` (layout hiện tại — `published` sâu hơn
  // `assetRoot`). Đọc thư mục `generations`, tìm subdir có `thumb.jpg`, lấy cái
  // mới nhất. Không đệ quy toàn cây: thumb chỉ ở đúng một cấp đó.
  const genDir = path.join(directory, 'generations')
  try {
    const subs = readdirSync(genDir, { withFileTypes: true })
    let best: { filePath: string, mtime: number, size: number } | null = null
    for (const sub of subs) {
      if (!sub.isDirectory()) continue
      const thumb = path.join(genDir, sub.name, MEDIA_THUMBNAIL_FILE)
      try {
        const stat = statSync(thumb)
        if (!stat.isFile()) continue
        if (!best || stat.mtimeMs > best.mtime) best = { filePath: thumb, mtime: stat.mtimeMs, size: stat.size }
      } catch { /* subdir không có thumb — bỏ qua */ }
    }
    if (best) return { kind: 'local', filePath: best.filePath, contentType: 'image/jpeg', size: best.size }
  } catch { /* generations/ không tồn tại — bình thường cho item chưa transcode */ }

  return null
}

// ─── Ghi quản trị ────────────────────────────────────────────────────────────

export type CreateMediaItemInput = {
  title: unknown
  description?: unknown
  source?: unknown
  youtubeVideoId?: unknown
  categoryId?: unknown
  storagePath?: unknown
  createdBy: number
}

export type CreatedMediaItem = { mediaItemId: number, slug: string, shortId: string }

/**
 * Tạo một mục media, cùng dòng audit trong **cùng một transaction**.
 *
 * Slug sinh qua `uniqueMediaSlug(tx, …)` — nhận **client giao dịch**, không nhận
 * `db`: lượt `SELECT` kiểm trùng phải đọc đúng ảnh chụp mà lượt `INSERT` sắp ghi
 * vào, nếu không hai lượt tạo cùng lúc cùng thấy "slug còn trống" và lượt thứ hai
 * ném lỗi UNIQUE.
 *
 * Id đọc vào **biến cục bộ** rồi `return` nó ra ngoài: đọc biến của chính khối
 * transaction trong dòng audit bên trong khối đó là vùng chết tạm thời, và hình
 * dạng đó đã làm bốn endpoint tạo mới của dự án trả 500.
 */
export async function createMediaItem(
  input: CreateMediaItemInput,
  // `Pick<Database, 'transaction'>` chứ không `Database`: nơi gọi có thể truyền
  // **client giao dịch đang mở** (lượt lưu buổi phát thành bản ghi ở
  // `livestream.ts` cần mục media và cột `saved_media_id` nằm chung một giao
  // dịch). Một `tx` không gán được cho `Database`, nhưng gán được cho đúng một
  // phương thức này — cùng lối đi mà `recordMediaView` đã dùng với
  // `Pick<Database, 'update'>`. Drizzle lồng giao dịch bằng SAVEPOINT, không mở
  // giao dịch thứ hai, nên lượt gọi lồng vẫn là **một** giao dịch thật.
  deps: { db?: Pick<Database, 'transaction'> } = {},
): Promise<CreatedMediaItem> {
  const db = deps.db ?? getDb()

  const title = requireMediaTitle(input.title)
  const source = requireMediaSource(input.source ?? 'upload')
  const description = optionalMediaText(input.description, MEDIA_DESCRIPTION_MAX_LENGTH, 'Mô tả')
  const categoryId = optionalMediaId(input.categoryId, 'Danh mục')
  const storagePath = source === 'upload'
    ? optionalMediaText(input.storagePath, 1024, 'Đường dẫn lưu trữ')
    : null
  // Chỉ mục nguồn ngoài mới có định danh video, và định danh đó bắt buộc phải bóc
  // ra được: lưu một giá trị không nhận ra là để nó hỏng ở trang công khai, nơi
  // không có gì giải thích vì sao khung nhúng trắng.
  const youtubeVideoId = source === 'youtube'
    ? requireMediaSourceId(input.youtubeVideoId)
    : null

  return db.transaction(async (tx) => {
    const slug = await uniqueMediaSlug(tx, title)
    const shortId = await uniqueShortMediaId(tx)
    const [inserted] = await tx.insert(mediaItems).values({
      slug,
      shortId,
      title,
      description,
      source,
      youtubeVideoId,
      storagePath,
      categoryId,
      status: 'draft',
      // Mục nguồn ngoài không có gì để chuyển mã, nên nó sẵn sàng ngay. Để
      // `pending` thì nó nằm mãi trong nhóm mà bộ dọn coi là việc đang dở.
      processingStatus: source === 'upload' ? 'pending' : 'ready',
      createdBy: input.createdBy,
    })

    const mediaItemId = Number(inserted?.insertId ?? 0)
    if (!mediaItemId) throw new Error('media_items insert returned no id')

    await tx.insert(activityLogs).values({
      userId: input.createdBy,
      action: 'create',
      resource: 'media_portal',
      resourceId: mediaItemId,
      // Chỉ id và giá trị không định danh. Slug **không** vào đây: nó là một
      // chuỗi do người gõ quyết định, và nhật ký kiểm toán không phải chỗ chở nó.
      meta: { source, hasCategory: categoryId !== null },
    })

    return { mediaItemId, slug, shortId }
  })
}

export type UpdateMediaItemInput = {
  id: number
  actorId: number
  title?: unknown
  description?: unknown
  categoryId?: unknown
  status?: unknown
  commentsEnabled?: unknown
  isFeatured?: unknown
  youtubeVideoId?: unknown
}

export type UpdateMediaItemResult =
  | { ok: true, slug: string, status: MediaItemStatus }
  | { ok: false, reason: 'not_found' }

/**
 * Sửa một mục media, cùng dòng audit trong một transaction.
 *
 * **Tiêu đề đổi nhưng slug thì không.** Đây là quy tắc đã có của bài viết
 * (`articles/[id].put.ts` không slugify lại), và lý do là hậu quả: slug nằm trong
 * URL công khai, trong liên kết đã phát ra ngoài và trong chỉ mục tìm kiếm. Đổi
 * nó theo tiêu đề là làm chết mọi liên kết đã chia sẻ, cho một thay đổi mà cán bộ
 * không hề yêu cầu.
 */
export async function updateMediaItem(
  input: UpdateMediaItemInput,
  deps: { db?: Database } = {},
): Promise<UpdateMediaItemResult> {
  const db = deps.db ?? getDb()

  const changes: Record<string, unknown> = {}
  const changedFields: string[] = []

  if (input.title !== undefined) {
    changes.title = requireMediaTitle(input.title)
    changedFields.push('title')
  }
  if (input.description !== undefined) {
    changes.description = optionalMediaText(input.description, MEDIA_DESCRIPTION_MAX_LENGTH, 'Mô tả')
    changedFields.push('description')
  }
  if (input.categoryId !== undefined) {
    changes.categoryId = optionalMediaId(input.categoryId, 'Danh mục')
    changedFields.push('categoryId')
  }
  if (input.commentsEnabled !== undefined) {
    changes.commentsEnabled = requireMediaBoolean(input.commentsEnabled, 'Bật bình luận')
    changedFields.push('commentsEnabled')
  }
  if (input.isFeatured !== undefined) {
    changes.isFeatured = requireMediaBoolean(input.isFeatured, 'Nổi bật')
    changedFields.push('isFeatured')
  }
  if (input.youtubeVideoId !== undefined) {
    changes.youtubeVideoId = requireMediaSourceId(input.youtubeVideoId)
    changedFields.push('youtubeVideoId')
  }

  let requestedStatus: MediaItemStatus | null = null
  if (input.status !== undefined) {
    requestedStatus = requireMediaStatus(input.status)
    changes.status = requestedStatus
    changedFields.push('status')
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: mediaItems.id, slug: mediaItems.slug, status: mediaItems.status, publishedAt: mediaItems.publishedAt })
      .from(mediaItems)
      .where(eq(mediaItems.id, input.id))
      .limit(1)

    // Không có hàng nào thì không có gì để ghi và cũng không có gì để kể lại —
    // một dòng audit cho một lượt sửa không xảy ra là một dòng làm nhật ký mờ đi.
    if (!current) return { ok: false, reason: 'not_found' } as const

    const fromStatus = String(current.status) as MediaItemStatus
    const statusChanged = requestedStatus !== null && requestedStatus !== fromStatus

    // Xuất bản lần đầu đóng dấu `published_at`. Đổi từ `published` sang trạng thái
    // khác **giữ nguyên** dấu đó: rút bài rồi đăng lại không phải một lượt đăng mới.
    if (statusChanged && requestedStatus === PUBLISHED_MEDIA_STATUS && !current.publishedAt) {
      changes.publishedAt = new Date()
    }

    if (changedFields.length > 0) {
      await tx.update(mediaItems).set(changes).where(eq(mediaItems.id, input.id))
    }

    await tx.insert(activityLogs).values({
      userId: input.actorId,
      // `publish` là nhãn riêng vì "ai đã cho bài này lên cổng" là câu hỏi khác
      // với "ai đã sửa tiêu đề của nó", và trộn hai câu trả lời vào một nhãn là
      // làm cả hai khó trả lời hơn.
      action: statusChanged && requestedStatus === PUBLISHED_MEDIA_STATUS ? 'publish' : 'update',
      resource: 'media_portal',
      resourceId: input.id,
      meta: {
        changed: changedFields,
        fromStatus,
        toStatus: requestedStatus ?? fromStatus,
      },
    })

    return { ok: true, slug: String(current.slug), status: requestedStatus ?? fromStatus } as const
  })
}

export type DeleteMediaItemInput = { id: number, actorId: number }

/** Kết quả xoá: `removed=false` khi mục không tồn tại; `fromStatus` cho biết trạng thái trước xoá. */
export type DeleteMediaItemResult =
  | { removed: false, fromStatus: null }
  | { removed: true, fromStatus: string }

/**
 * Xoá một mục media, cùng dòng audit trong một transaction.
 *
 * Thứ tự **xoá rồi ghi log, cả hai trong transaction** là chủ đích: ngoài
 * transaction thì câu thứ hai hỏng sẽ để lại một hàng đã mất mà không còn gì ghi
 * ai xoá — và với một lượt xoá thì không có gì để đối chiếu sửa lại.
 *
 * Tác dụng phụ `rm()` vẫn nằm ngoài transaction, nhưng transaction ghi một outbox
 * bền vững. Worker sẽ retry việc xoá sau commit/restart thay vì để tệp mồ côi.
 */
export async function deleteMediaItem(
  input: DeleteMediaItemInput,
  deps: { db?: Database } = {},
): Promise<DeleteMediaItemResult> {
  const db = deps.db ?? getDb()

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: mediaItems.id, slug: mediaItems.slug, source: mediaItems.source, status: mediaItems.status,
        storagePath: mediaItems.storagePath, storageProvider: mediaItems.storageProvider, claimedBy: mediaItems.claimedBy })
      .from(mediaItems)
      .where(eq(mediaItems.id, input.id))
      .limit(1)

    if (!current) return { removed: false as const, claim: null as string | null, fromStatus: null as string | null }

    let assetRoot: string | null = null
    if (current.source === 'upload') {
      try { assetRoot = mediaAssetRoot(current) } catch { /* invalid legacy path: preserve it for manual inspection */ }
    }

    if (assetRoot) {
      await tx.insert(mediaAssetCleanup).values({
        id: randomUUID(), assetRoot,
        // `assetRoot` là R2 key prefix khi storageProvider='r2', local path khi
        // 'local' — worker branch theo cột này để xoá đúng backend.
        storageProvider: current.storageProvider,
        // A worker cannot race a just-aborted encoder; defer one short interval.
        nextAttemptAt: new Date(Date.now() + 30_000),
      })
    }

    await tx.delete(mediaItems).where(eq(mediaItems.id, input.id))
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'delete',
      resource: 'media_portal',
      resourceId: input.id,
      // Trạng thái lúc xoá là thứ duy nhất còn nói được mục này đã từng ở trên
      // cổng hay chưa — sau lượt xoá, hàng không còn để hỏi lại.
      meta: { source: String(current.source), fromStatus: String(current.status) },
    })

    return { removed: true as const, claim: current.claimedBy, fromStatus: String(current.status) }
  })

  if (outcome.removed) abortProcessingClaim(outcome.claim)
  if (outcome.removed) return { removed: true, fromStatus: outcome.fromStatus ?? '' }
  return { removed: false, fromStatus: null }
}

// ─── Thumbnail custom ─────────────────────────────────────────────────────────
//
// Pipeline vốn tự trích thumbnail (`extractThumbnail` ở `processMediaItem` giai
// đoạn 5), và `thumb.get.ts` có fallback trích at-the-fly khi thumb vắng. Nhóm hàm
// này cho cán bộ **chọn ảnh thumbnail từ Thư viện Media** — ghi đè `thumb.jpg`
// ở cấp gốc mà `resolveThumbnailTarget` tìm (R2 list ưu tiên gốc, local ưu tiên
// gốc), nên sau khi đặt, thumb tĩnh phục vụ ngay không cần FFmpeg.
//
// Cột `thumbnail_url` lưu URL/đường dẫn ảnh thư viện **chỉ để admin page hiển thị
// preview** "đang dùng ảnh nào". Phía công khai vẫn serve qua `resolveThumbnailTarget`
// (không redirect theo URL tự do — xem comment `serializePublicMedia` dòng 310).

/** Đường dẫn R2 key của thumb cấp gốc: `<storagePath>/thumb.jpg`. */
function r2ThumbnailKey(storagePath: string): string {
  return `${storagePath.replace(/\/+$/g, '')}/${MEDIA_THUMBNAIL_FILE}`
}

export type SetMediaThumbnailInput = {
  id: number
  /** Id của hàng `media` (thư viện ảnh) làm thumbnail mới. */
  mediaId: number
  actorId: number
  config: MediaConfig
}

export type SetMediaThumbnailResult =
  | { ok: true }
  | { ok: false, reason: 'not_found' | 'media_not_found' | 'not_an_image' | 'not_upload' }

/**
 * Trần dung lượng ảnh thư viện được đọc vào RAM để làm thumbnail. Trên trần tải
 * lên của Thư viện Media (20MB, `media/upload.post.ts`) một chút — tệp nhập bằng
 * quét thư mục có thể lớn hơn ảnh tải qua form, nhưng không vô hạn.
 */
export const THUMBNAIL_SOURCE_MAX_BYTES = 25 * 1024 * 1024
const THUMBNAIL_SOURCE_TIMEOUT_MS = 20_000

/**
 * Bytes của một ảnh Thư viện Media — CHỈ từ kho của chính cổng, không bao giờ qua
 * `media.url`.
 *
 * Trước đây ảnh R2 được tải bằng `fetch(img.url)` trần: không hạn thời gian, không
 * trần byte, không kiểm host, theo chuyển hướng. `media.url` là một ô CSDL (đi theo
 * bản khôi phục, import SQL, sửa tay) — một URL `http://169.254.169.254/…` hay tới
 * dịch vụ nội bộ biến nút "đặt thumbnail" thành SSRF có kênh đọc ngược (bytes thành
 * thumbnail công khai). Không có host bên thứ ba nào hợp với tính năng này (nguồn
 * luôn là ảnh thư viện của cổng), nên không có allowlist mạng:
 *  - `provider='r2'`: đọc theo KHOÁ (`storagePath` — chính là khoá R2, cùng quy ước
 *    với đồng bộ/self-heal) bằng `getR2Object` với cấu hình R2 của **thư viện ảnh**
 *    (`settings` group `media`; khác R2 video của `input.config`). Endpoint đi qua
 *    `openR2` (account id 32 hex → `<hex>.r2.cloudflarestorage.com`), có trần byte
 *    và hạn thời gian. Cấu hình hỏng → `R2ConfigInvalidError`; không có đường lùi
 *    về URL công khai (cấu hình thư viện không dùng được thì chính thư viện cũng
 *    không quản lý được tệp đó).
 *  - `provider='local'`: `storagePath` phải nằm dưới `<cwd>/public/uploads` (cùng gốc
 *    `uploadLocalFile` ghi và `deleteLocalFile` chặn), là tệp thường, dưới trần.
 */
async function readLibraryImage(img: { provider: string, storagePath: string }): Promise<Buffer> {
  if (img.provider === 'r2') {
    if (!img.storagePath) throw new Error('Ảnh thư viện R2 không có khoá lưu trữ.')
    return await getR2Object(img.storagePath, await loadR2Config(), {
      maxBytes: THUMBNAIL_SOURCE_MAX_BYTES,
      timeoutMs: THUMBNAIL_SOURCE_TIMEOUT_MS,
    })
  }

  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads')
  const filePath = path.resolve(img.storagePath)
  if (!filePath.startsWith(uploadsRoot + path.sep)) {
    throw new Error('Ảnh thư viện không nằm trong thư mục uploads — không đọc.')
  }
  const stat = await fs.lstat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) throw new Error('Ảnh thư viện không còn trên đĩa.')
  if (stat.size > THUMBNAIL_SOURCE_MAX_BYTES) throw new Error('Ảnh thư viện quá lớn để làm thumbnail.')
  return await fs.readFile(filePath)
}

/**
 * Đặt thumbnail cho mục video từ một ảnh Thư viện Media.
 *
 * Đọc bytes ảnh thư viện (đĩa hoặc R2 theo `provider`), tối ưu qua `sharp` về
 * 16:9 ≤720px JPEG, ghi vào `thumb.jpg` cấp gốc ở **cả** đĩa và R2 (nếu video
 * đang R2). Cập nhật `thumbnail_url` + audit trong một transaction.
 *
 * R2 push fail **không rollback đĩa** — đĩa đã ghi là thumb hợp lệ, R2 chỉ là
 * tier dự phòng; `resolveThumbnailTarget` có fallback local nên một R2 hỏng
 * không làm hỏng thumb. Ngược lại, đĩa fail (vd. `workdir` không ghi được) thì
 * return `ok: false` trước khi chạm CSDL — không ghi `thumbnail_url` cho một
 * thumb thực sự không phục vụ được.
 */
export async function setMediaThumbnail(
  input: SetMediaThumbnailInput,
  deps: { db?: Database } = {},
): Promise<SetMediaThumbnailResult> {
  const db = deps.db ?? getDb()

  // 1. Đọc mục video + ảnh thư viện (ngoài transaction — chỉ đọc).
  const [item] = await db
    .select({
      id: mediaItems.id, source: mediaItems.source, storagePath: mediaItems.storagePath,
      storageProvider: mediaItems.storageProvider, slug: mediaItems.slug,
    })
    .from(mediaItems)
    .where(eq(mediaItems.id, input.id))
    .limit(1)
  if (!item) return { ok: false, reason: 'not_found' }
  if (item.source !== 'upload') return { ok: false, reason: 'not_upload' }

  const [img] = await db
    .select({ id: media.id, provider: media.provider, storagePath: media.storagePath, mimeType: media.mimeType, url: media.url })
    .from(media)
    .where(eq(media.id, input.mediaId))
    .limit(1)
  if (!img) return { ok: false, reason: 'media_not_found' }
  if (!img.mimeType.startsWith('image/')) return { ok: false, reason: 'not_an_image' }

  // 2. Đọc bytes ảnh nguồn — chỉ từ kho của chính cổng (xem `readLibraryImage`).
  const sourceBuffer = await readLibraryImage(img)

  // 3. Tối ưu qua sharp — 16:9, ≤720px, JPEG q80.
  const optimized = await sharp(sourceBuffer)
    .resize({ width: 1280, height: 720, fit: 'cover', position: 'centre' })
    .jpeg({ quality: 80 })
    .toBuffer()
    .catch(() => null)
  if (!optimized) throw new Error('Không xử lý được ảnh thumbnail.')

  // 4. Ghi đĩa cấp gốc.
  const directory = resolveMediaDirectory(input.config, { slug: item.slug, storagePath: item.storagePath })
  if (!directory) return { ok: false, reason: 'not_found' }
  await fs.mkdir(directory, { recursive: true })
  const localPath = path.join(directory, MEDIA_THUMBNAIL_FILE)
  await fs.writeFile(localPath, optimized)

  // 5. Ghi R2 nếu video đang R2.
  let pushedR2 = false
  if (item.storageProvider === 'r2' && item.storagePath && input.config.videoStorage.r2) {
    pushedR2 = await putR2Object(r2ThumbnailKey(item.storagePath), optimized, 'image/jpeg', input.config.videoStorage.r2)
  }

  // 6. Cập nhật thumbnail_url + audit trong transaction.
  await db.transaction(async (tx) => {
    await tx.update(mediaItems)
      .set({ thumbnailUrl: img.url })
      .where(eq(mediaItems.id, input.id))
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'media_portal',
      resourceId: input.id,
      meta: { changed: ['thumbnail'], thumbSource: 'media_library', mediaId: input.mediaId, pushedR2 },
    })
  })

  return { ok: true }
}

export type ClearMediaThumbnailInput = {
  id: number
  actorId: number
  config: MediaConfig
}

export type ClearMediaThumbnailResult =
  | { ok: true }
  | { ok: false, reason: 'not_found' | 'not_upload' }

/**
 * Xoá thumbnail custom — xoá `thumb.jpg` cấp gốc ở đĩa + R2, reset `thumbnail_url`.
 * Sau khi xoá, `resolveThumbnailTarget` lùi về `generations/<claim>/thumb.jpg`
 * (nếu pipeline đã trích) hoặc `extractFallbackFrame` (nếu vắng) — đúng hành vi
 * "không có thumb custom thì về thumb tự sinh".
 */
export async function clearMediaThumbnail(
  input: ClearMediaThumbnailInput,
  deps: { db?: Database } = {},
): Promise<ClearMediaThumbnailResult> {
  const db = deps.db ?? getDb()

  const [item] = await db
    .select({ id: mediaItems.id, source: mediaItems.source, storagePath: mediaItems.storagePath, storageProvider: mediaItems.storageProvider, slug: mediaItems.slug })
    .from(mediaItems)
    .where(eq(mediaItems.id, input.id))
    .limit(1)
  if (!item) return { ok: false, reason: 'not_found' }
  if (item.source !== 'upload') return { ok: false, reason: 'not_upload' }

  // Xoá đĩa cấp gốc.
  const directory = resolveMediaDirectory(input.config, { slug: item.slug, storagePath: item.storagePath })
  if (directory) {
    await fs.rm(path.join(directory, MEDIA_THUMBNAIL_FILE), { force: true })
  }

  // Xoá R2 cấp gốc (video R2).
  if (item.storageProvider === 'r2' && item.storagePath && input.config.videoStorage.r2) {
    // Best-effort — xoá hỏng không làm hỏng reset CSDL; thumb R2 sẽ bị list ra
    // nhưng `thumbnail_url` null báo admin "không còn custom".
    await deleteR2Thumb(item.storagePath, input.config.videoStorage.r2)
  }

  // Reset thumbnail_url + audit trong transaction.
  await db.transaction(async (tx) => {
    await tx.update(mediaItems)
      .set({ thumbnailUrl: null })
      .where(eq(mediaItems.id, input.id))
    await tx.insert(activityLogs).values({
      userId: input.actorId,
      action: 'update',
      resource: 'media_portal',
      resourceId: input.id,
      meta: { changed: ['thumbnail'], cleared: true },
    })
  })

  return { ok: true }
}

/** Best-effort xoá object R2 thumb cấp gốc. */
async function deleteR2Thumb(storagePath: string, _r2Config: R2Config): Promise<void> {
  // `putR2Object` dùng `PutObjectCommand`; xoá cần `DeleteObjectCommand`. Tránh
  // thêm export mới cho một thao tác best-effort — dùng `deleteR2File` từ media-r2
  // (R2Config khớp về shape).
  try {
    const { deleteR2File } = await import('../utils/media-r2')
    await deleteR2File(r2ThumbnailKey(storagePath), _r2Config)
  } catch { /* best-effort */ }
}
