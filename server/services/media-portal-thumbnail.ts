/**
 * Đích phục vụ ẢNH THU NHỎ của một mục media đã xuất bản (`resolveThumbnailTarget`)
 * — địa chỉ thượng nguồn cho mục nguồn ngoài, khoá R2 (liệt kê cây để tìm
 * `thumb.jpg` gốc rồi `generations/<claim>/thumb.jpg`), hoặc tệp đĩa local (cũng là
 * đường lùi khi R2 thiếu). Tách khỏi `media-portal.ts` (nay là barrel); tệp này
 * không import ngược barrel.
 *
 * Cùng ranh giới với `media-portal-stream.ts`: chọn tập cột nội bộ
 * (`assetMediaSelection`) và **không bao giờ** trả một hàng cho nơi gọi — chỉ một
 * đích đã kiểm, hoặc `null`.
 */
import { statSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import type { MediaConfig } from '../utils/media-config'
import { resolveMediaConfig } from '../utils/media-config'
import {
  buildYouTubeThumbnailUpstreamUrl,
} from '../utils/youtube-parser'
import { listR2Keys } from './video-r2-sync'
import { PUBLISHED_MEDIA_STATUS } from './media-portal-constants'
import {
  MEDIA_THUMBNAIL_FILE,
  assetMediaSelection,
  resolveMediaDirectory,
} from './media-portal-assets'

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
