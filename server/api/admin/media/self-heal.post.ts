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
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'

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

  // Lỗi đã phân loại (đang khôi phục CSDL, lượt khác đang chạy, thiếu cấu hình R2) xảy ra TRƯỚC lượt ghi nào.
  let refusedBeforeWriting = false
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
    const msg = err instanceof Error ? err.message : String(err)
    refusedBeforeWriting = err instanceof JobBlockedByRestoreError || msg.includes('Một lượt tự vá') || msg.includes('Cấu hình Cloudflare R2')
    if (err instanceof JobBlockedByRestoreError) throw createError({ statusCode: 409, statusMessage: err.message })
    if (msg.includes('Một lượt tự vá')) throw createError({ statusCode: 409, statusMessage: msg })
    if (msg.includes('Cấu hình Cloudflare R2')) throw createError({ statusCode: 400, statusMessage: msg })
    throw createError({ statusCode: 500, statusMessage: msg })
  } finally {
    // URL ảnh/bài vừa được viết lại: câu trả lời chatbot đã cache còn chép URL cũ không được phát lại. Ở `finally`
    // vì lượt vá commit theo HAI transaction (`media-self-heal.ts`): bước sau hỏng thì bước trước đã đổi URL rồi.
    if (!dryRun && !refusedBeforeWriting) await bumpAnswerCacheVersion()
  }
})
