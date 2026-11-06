import { requireResourcePermission, requireSuperAdmin } from '../../../../utils/permissions'
import { wipeAiConfig } from '../../../../services/ai-config-wipe'
import { logInfo } from '../../../../utils/logger'
import { bumpAnswerCacheVersion } from '../../../../services/chatbot-answer-cache'

/**
 * `POST /api/admin/ai/config/wipe` — xoá toàn bộ cấu hình AI (nhà cung cấp + khoá API,
 * cấu hình dịch vụ, giá model, hạn mức ngân sách).
 *
 * Hai cổng: `ai.update` (người quản trị panel AI) VÀ SuperAdmin — thao tác này làm
 * trợ lý AI ngừng chạy cho tới khi ai đó nhập lại khoá API, nên không thể là một cú
 * bấm của người chỉ được sửa cấu hình. Cùng khuôn với `backup/drive/disconnect`,
 * `backup/restore`.
 *
 * KHÔNG đụng luật kiểm duyệt, `chatbot_settings` hay `ai_usage_logs` — phạm vi đã chốt
 * ở `services/ai-config-wipe.ts`.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')
  requireSuperAdmin(adminUser)

  const deleted = await wipeAiConfig(adminUser.id ?? null, event.context.requestId ?? null)
  logInfo({ event: 'ai.config_wiped', ...deleted, adminUserId: adminUser.id ?? null })
  // Xoá cấu hình dịch vụ `chatbot` (model, prompt) như sửa/xoá từng nhà cung cấp, dịch vụ: tăng phiên bản cache.
  await bumpAnswerCacheVersion().catch(() => undefined)

  return { ok: true, deleted }
})
