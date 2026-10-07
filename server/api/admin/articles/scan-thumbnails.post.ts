/**
 * POST /api/admin/articles/scan-thumbnails — quét + sửa ảnh thumbnail hỏng.
 *
 * Body: `{ dryRun?: boolean; fixIds?: number[]; defaultCover?: string }`
 *
 * - `dryRun: true` (mặc định): quét tất cả bài có `thumbnail_url`, trả danh sách
 *   bài hỏng (R2 404 hoặc file local thiếu) để admin xem + chọn.
 * - `dryRun: false` + `fixIds`: UPDATE `thumbnail_url` cho `fixIds` sang
 *   `defaultCover` (mặc định `/assets/default_cover_light.png`). Sửa URL trong
 *   SQL thực sự → IPX/NuxtImg không còn fetch URL hỏng → console hết 404.
 *
 * Quyền `media.update` — không có resource `articles` trong `PERMISSION_RESOURCES`
 * (article map theo type `news`/`role_models`/…); thao tác bản chất là vá media
 * (cùng họ `self-heal`/`repair-urls` đã dùng `media.update`); quét **tất cả**
 * article types → cần quyền cha. Backend không phân biệt quyền từng type.
 *
 * Idempotent, tự backup SQL trước khi sửa. Khoá `cdkt:articles:scan-thumbnails`.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { scanArticleThumbnails, DEFAULT_COVER } from '../../../services/articles-thumbnail-scan'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  let dryRun = true
  let fixIds: number[] | undefined
  let defaultCover: string | undefined
  try {
    const body = await readBody(event)
    if (body && typeof body === 'object') {
      const b = body as { dryRun?: unknown; fixIds?: unknown; defaultCover?: unknown }
      if (typeof b.dryRun === 'boolean') dryRun = b.dryRun
      if (Array.isArray(b.fixIds)) {
        fixIds = b.fixIds
          .map((id) => Number(id))
          .filter((id) => Number.isSafeInteger(id) && id > 0)
      }
      if (typeof b.defaultCover === 'string' && b.defaultCover.startsWith('/assets/')) {
        defaultCover = b.defaultCover
      }
    }
  } catch { /* body rỗng — giữ dryRun: true */ }

  try {
    const r = await scanArticleThumbnails(adminUser.id ?? null, {
      dryRun,
      fixIds,
      defaultCover,
    })

    if (dryRun) {
      return {
        ok: true,
        ...r,
        message: r.brokenCount === 0
          ? `Đã quét ${r.scanned} bài — không phát hiện ảnh hỏng.`
          : `Đã quét ${r.scanned} bài — phát hiện ${r.brokenCount} bài ảnh hỏng.`,
      }
    }

    return {
      ok: true,
      ...r,
      message: r.fixedCount && r.fixedCount > 0
        ? `Đã sửa ${r.fixedCount} bài → ${defaultCover ?? DEFAULT_COVER}.`
        : 'Không có bài nào được sửa (thumbnail đã đúng hoặc id không hợp lệ).',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt quét')) throw createError({ statusCode: 409, statusMessage: msg })
    if (msg.includes('Cơ sở dữ liệu')) throw createError({ statusCode: 503, statusMessage: msg })
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
