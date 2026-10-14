import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { createR2Client } from '../../../utils/media-r2'
import { requireResourcePermission } from '../../../utils/permissions'
import { logWarn } from '../../../utils/logger'
import { loadR2Config } from '../../../services/media'
import {
  classifyR2Error,
  r2ErrorHttpStatus,
  r2FailureMessage,
  r2TestUsesSavedConfig,
  resolveR2TestConfig,
} from '../../../utils/r2-test-config'

/** Trần cho một lượt thử: không có nó, một đích không trả lời giữ request treo tới khi socket tự hết giờ. */
const TEST_TIMEOUT_MS = 15_000

/**
 * Kiểm tra kết nối Cloudflare R2 (`ListObjectsV2`, tối đa 1 khoá — không ghi gì).
 *
 * Quyền `settings.update`, không phải `settings.read`: lượt thử khiến máy chủ mở
 * kết nối ra ngoài bằng thông tin đăng nhập, nên nó cùng mức tin cậy với LƯU cấu
 * hình — đúng như nút "gửi email thử" (`test-email.post.ts`). Không đòi SuperAdmin
 * cho thông số gõ tay: người có `settings.update` vốn LƯU được đúng các thông số
 * đó, và account id bị ghim 32 ký tự hex nên host luôn là một tên con của
 * `r2.cloudflarestorage.com` — không lái được sang máy khác.
 *
 * Dùng thông số nào do `resolveR2TestConfig` quyết định: ô Secret Key trống / còn
 * dấu che → NGUYÊN BỘ cấu hình đã lưu (account id / bucket trong thân bị bỏ qua);
 * gõ Secret Key → đúng bốn giá trị đã gõ. Lỗi trả về là một câu đã phân loại; chi
 * tiết thô chỉ vào log máy chủ.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const raw = await readBody(event).catch(() => ({}))
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}

  const saved = r2TestUsesSavedConfig(body) ? await loadR2Config() : null
  const decision = resolveR2TestConfig(body, saved)
  if (!decision.ok) {
    throw createError({ statusCode: 400, statusMessage: decision.message })
  }

  const client = createR2Client({ ...decision.credentials, publicUrl: '' })
  try {
    await client.send(
      new ListObjectsV2Command({ Bucket: decision.credentials.bucket, MaxKeys: 1 }),
      { abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS) },
    )
    const note = decision.ignoredUnsavedChanges
      ? ' Lưu ý: đã thử bằng cấu hình ĐÃ LƯU; thay đổi chưa lưu không được dùng vì Secret Key chưa được nhập lại.'
      : ''
    return { ok: true, usedSaved: decision.usedSaved, message: `Kết nối Cloudflare R2 thành công!${note}` }
  } catch (err: unknown) {
    const kind = classifyR2Error(err)
    logWarn({
      event: 'r2.test_failed',
      userId: adminUser?.id,
      kind,
      usedSaved: decision.usedSaved,
      name: err instanceof Error ? err.name : undefined,
      httpStatus: r2ErrorHttpStatus(err),
      code: typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code ?? '') : undefined,
      error: err instanceof Error ? err.message : String(err),
    })
    throw createError({ statusCode: 400, statusMessage: `Kết nối R2 thất bại: ${r2FailureMessage(kind)}` })
  } finally {
    client.destroy()
  }
})
