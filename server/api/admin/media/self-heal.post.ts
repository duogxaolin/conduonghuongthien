/**
 * POST /api/admin/media/self-heal — tự vá ảnh R2 missing + repoint thumbnail.
 *
 * Hai bước:
 *   1. Tìm `media` (provider='r2') mà R2 object thực sự không tồn tại
 *      (HeadObject 404) → upload lại từ file local gốc nếu còn.
 *   2. Repoint `articles.thumbnail_url` `/uploads/migrated/...` → R2 URL
 *      khớp qua basename JOIN với `media.filename`.
 *
 * Body: `{ dryRun?: boolean }`. Dry-run chỉ phân tích, không UPDATE/upload.
 *
 * Quyền `media.update` (cùng repair/repoint — sửa `media` + `articles.thumbnail_url`).
 * Idempotent, tự backup SQL trước (snapshot recover thủ công). Đang khôi phục CSDL → 409,
 * chưa ghi gì.
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { selfHealMedia } from '../../../services/media-self-heal'
import { JobBlockedByRestoreError } from '../../../services/pre-job-backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'media', 'update')

  let dryRun = false
  try {
    const body = await readBody(event)
    if (body && typeof body === 'object' && typeof (body as { dryRun?: unknown }).dryRun === 'boolean') {
      dryRun = (body as { dryRun: boolean }).dryRun
    }
  } catch { /* body rỗng — giữ false */ }

  try {
    const r = await selfHealMedia(adminUser.id ?? null, { dryRun })
    const prefix = dryRun ? 'Xem trước: ' : 'Đã vá: '
    const detail = [
      `${r.r2Missing} R2 thiếu (đã upload lại ${r.r2Reuploaded}, mất gốc ${r.r2Lost})`,
      `${r.thumbnailsRepointed} thumbnail bài viết`,
    ].join(' · ')
    return {
      ok: true,
      ...r,
      message: prefix + detail + (r.backupStamp ? `. Snapshot: ${r.backupStamp}.` : ''),
    }
  } catch (err) {
    if (err instanceof JobBlockedByRestoreError) throw createError({ statusCode: 409, statusMessage: err.message })
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt tự vá')) throw createError({ statusCode: 409, statusMessage: msg })
    if (msg.includes('Cấu hình Cloudflare R2')) throw createError({ statusCode: 400, statusMessage: msg })
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
