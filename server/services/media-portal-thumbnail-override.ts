/**
 * Ảnh đại diện TUỲ CHỈNH của một mục video — `setMediaThumbnail` (chọn từ Thư viện
 * Media) và `clearMediaThumbnail` (về lại thumbnail tự sinh). Mỗi lượt cập nhật
 * `thumbnail_url` cùng dòng audit trong một transaction; tệp `thumb.jpg` (đĩa + R2)
 * nằm ngoài transaction nên được trả về như cũ khi bước CSDL hỏng. Tách khỏi
 * `media-portal.ts` (nay là barrel); tệp này không import ngược barrel.
 *
 * Guard: `tests/media-portal-audit.test.ts` (`AUDITED_SERVICES`) và cổng quét thư
 * mục của `tests/reader-audit-atomicity.test.ts`.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { activityLogs, media, mediaItems } from '../db/schema'
import { getDb, type Database } from '../utils/db'
import type { MediaConfig } from '../utils/media-config'
import { putR2Object } from './video-r2-sync'
import { deleteR2File, getR2Object, type R2Config } from '../utils/media-r2'
import { logWarn } from '../utils/logger'
import { loadR2Config } from './media'
import sharp from 'sharp'
import { MEDIA_THUMBNAIL_FILE, resolveMediaDirectory } from './media-portal-assets'

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

  // 3. Tối ưu qua sharp — 16:9, 1280×720, JPEG q80.
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
  // `thumb.jpg` là tên cố định trang công khai đọc thẳng, nên không ghi tên mới rồi
  // đổi sau commit được: giữ bản cũ để khôi phục nếu bước CSDL (6) hỏng.
  const previous = await fs.readFile(localPath).catch(() => null)
  await fs.writeFile(localPath, optimized)

  // 5. Ghi R2 nếu video đang R2.
  let pushedR2 = false
  const r2Config = item.storageProvider === 'r2' && item.storagePath ? input.config.videoStorage.r2 : undefined
  if (r2Config) {
    pushedR2 = await putR2Object(r2ThumbnailKey(item.storagePath!), optimized, 'image/jpeg', r2Config)
  }

  // 6. Cập nhật thumbnail_url + audit trong transaction. Hỏng → trả tệp về như cũ,
  // để trang công khai không hiện một thumbnail mà CSDL và nhật ký không biết tới.
  try {
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
  } catch (err) {
    await restoreThumbnailFiles(input.id, localPath, previous, pushedR2 && r2Config ? { key: r2ThumbnailKey(item.storagePath!), config: r2Config } : null)
    throw err
  }

  return { ok: true }
}

/**
 * Trả `thumb.jpg` (đĩa và R2) về trạng thái trước `setMediaThumbnail` khi bước CSDL
 * hỏng. Bản R2 được ghi cùng lượt với bản đĩa, nên bản đĩa cũ cũng là bản R2 cũ;
 * không có bản cũ thì xoá. Hỏng ở đây chỉ còn log được — lỗi gốc vẫn được ném.
 */
async function restoreThumbnailFiles(
  mediaItemId: number,
  localPath: string,
  previous: Buffer | null,
  r2: { key: string, config: R2Config } | null,
): Promise<void> {
  let restored = true
  try {
    if (previous) await fs.writeFile(localPath, previous)
    else await fs.rm(localPath, { force: true })
    if (r2) {
      restored = previous
        ? await putR2Object(r2.key, previous, 'image/jpeg', r2.config)
        : await deleteR2File(r2.key, r2.config)
    }
  } catch {
    restored = false
  }
  logWarn({ event: 'media_portal.thumbnail_db_write_failed', mediaItemId, filesRestored: restored })
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
  // `deleteR2File` (media-r2) trả `false` khi R2 lỗi và ném khi cấu hình hỏng. Vẫn
  // best-effort, nhưng không còn im lặng: object còn sót là thứ admin cần biết.
  let deleted = false
  try {
    deleted = await deleteR2File(r2ThumbnailKey(storagePath), _r2Config)
  } catch {
    deleted = false
  }
  if (!deleted) logWarn({ event: 'media_portal.thumbnail_r2_delete_failed', storagePath })
}
