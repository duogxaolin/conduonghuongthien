/**
 * Đường dẫn và tập cột NỘI BỘ của cổng media — phần chung của hai đường phục vụ
 * tệp (`media-portal-stream.ts`, `media-portal-thumbnail.ts`) và lượt đặt/xoá ảnh
 * đại diện tuỳ chỉnh (`media-portal-thumbnail-override.ts`). Tách khỏi
 * `media-portal.ts` (nay là barrel); tệp này không import ngược barrel.
 *
 * Barrel chỉ re-export `resolveMediaDirectory` và `normalizeAssetPath` (hai hàm
 * vốn đã công khai). Các hằng số, `STREAM_CONTENT_TYPES`, `assetMediaSelection` và
 * `locateOriginalFile` export ở đây chỉ để các tệp con dùng chung — không endpoint
 * nào import chúng.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { mediaItems } from '../db/schema'
import type { MediaConfig } from '../utils/media-config'

// ─── Hằng số nội bộ (không re-export ở barrel) ──────────────────────────────
// Hằng số chia sẻ (manifest cache, dedup view, độ dài tiêu đề...) nằm ở
// `media-portal-constants.ts`. Các hằng số dưới đây là internal — chỉ các tệp con
// stream/thumbnail/thumbnail-override dùng, không có endpoint nào import trực tiếp.

export const MEDIA_THUMBNAIL_FILE = 'thumb.jpg'
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
export const STREAM_CONTENT_TYPES: Readonly<Record<string, string>> = {
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
export const assetMediaSelection = {
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
 * `video-processing-job.ts` nhưng ở đây để **phục vụ** tệp, không để FFmpeg đọc. Không
 * dùng lại hàm đó: nó là hàm nội bộ của pipeline chuyển mã, và phụ thuộc chỉ đi một
 * chiều — cổng media (`media-portal-admin-write.ts`, `media-portal-public.ts`)
 * import `video-processing.ts`, không bao giờ ngược lại.
 */
export async function locateOriginalFile(directory: string): Promise<string | null> {
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
