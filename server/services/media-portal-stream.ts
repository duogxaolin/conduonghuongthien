/**
 * Đích phục vụ một yêu cầu PHÁT của cổng media (`resolveStreamTarget`) — manifest
 * HLS, phân đoạn, hoặc tệp gốc `original.<ext>` khi chưa/không có rendition; trên
 * đĩa local hoặc R2, kèm các đường lùi R2 → đĩa. Tách khỏi `media-portal.ts` (nay
 * là barrel); tệp này không import ngược barrel.
 *
 * Chọn **tập cột nội bộ** (`assetMediaSelection` — cần `storage_path`, `source`) và
 * **không bao giờ** trả một hàng cho nơi gọi: chỉ một đích đã kiểm, hoặc `null`.
 * Đây là ranh giới thật — một hàm trả hàng rồi để nơi gọi tự lọc là một hàm sẽ có
 * nơi gọi thứ hai quên lọc.
 */
import { statSync } from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import type { MediaConfig } from '../utils/media-config'
import { resolveMediaConfig } from '../utils/media-config'
import { locateR2Original, headR2Object } from './video-r2-sync'
import {
  PUBLISHED_MEDIA_STATUS,
  MANIFEST_CACHE_SECONDS,
  SEGMENT_CACHE_SECONDS,
} from './media-portal-constants'
import { coerceResolutionsReady } from './media-portal-public'
import {
  STREAM_CONTENT_TYPES,
  assetMediaSelection,
  locateOriginalFile,
  normalizeAssetPath,
  resolveMediaDirectory,
} from './media-portal-assets'

const MEDIA_MASTER_PLAYLIST = 'master.m3u8'

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
    // sync cây `published` lên R2 rồi xoá local (`processMediaItem`, sau
    // `syncDirectoryToR2`), nhưng sync có thể bỏ
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
