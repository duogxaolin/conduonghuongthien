import { count } from 'drizzle-orm'
import {
  activityLogs,
  aiBudgetSettings,
  aiModelPricing,
  aiProviders,
  aiServiceConfigs,
} from '../db/schema'
import { getDb } from '../utils/db'

/**
 * Xoá TOÀN BỘ cấu hình AI do con người nhập: nhà cung cấp (kèm khoá API đã mã hoá),
 * cấu hình dịch vụ (model + system prompt + temperature + max token), giá model và
 * hạn mức ngân sách.
 *
 * Phạm vi CÓ CHỦ ĐÍCH — những thứ KHÔNG bị xoá:
 *  - `ai_moderation_rules` / cấu hình kiểm duyệt: luật an ninh đã được duyệt, xoá chúng
 *    là mở đường cho nội dung vi phạm cho tới khi ai đó nhập lại từ đầu;
 *  - `chatbot_settings`: đích AI của chatbot có công cụ SuperAdmin riêng
 *    (`/admin/chatbot/settings`), xoá kèm ở đây sẽ vô hiệu hoá trợ lý cho người dân mà
 *    người bấm nút không thấy điều đó trong nhãn;
 *  - `ai_usage_logs`: sổ chi phí đã tiêu, không phải cấu hình.
 *
 * Toàn bộ hàng nghiệp vụ + dòng audit commit trong MỘT transaction: audit không ghi
 * được thì cấu hình còn nguyên (xem `tests/ai-config-wipe-behavior.test.ts`).
 *
 * Xoá xong phải nhập lại khoá API: khoá mã hoá bằng `CHATBOT_ENCRYPTION_SECRET` và
 * không có bản khôi phục nào khác trong hệ thống.
 */
export type AiConfigWipeCounts = {
  providers: number
  services: number
  pricing: number
  budget: number
}

export async function wipeAiConfig(actorId: number | null, requestId: string | null): Promise<AiConfigWipeCounts> {
  const db = getDb()
  return db.transaction(async (tx) => {
    // Đếm TRƯỚC khi xoá: cần con số cho audit, và `affectedRows` của DELETE trên bảng
    // rỗng vẫn là 0 — dùng nó cho audit sẽ khiến lượt wipe "không xoá gì" trông giống
    // nhau ở cả hai trường hợp.
    const [providersBefore] = await tx.select({ total: count() }).from(aiProviders)
    const [servicesBefore] = await tx.select({ total: count() }).from(aiServiceConfigs)
    const [pricingBefore] = await tx.select({ total: count() }).from(aiModelPricing)
    const [budgetBefore] = await tx.select({ total: count() }).from(aiBudgetSettings)
    const before: AiConfigWipeCounts = {
      providers: Number(providersBefore?.total ?? 0),
      services: Number(servicesBefore?.total ?? 0),
      pricing: Number(pricingBefore?.total ?? 0),
      budget: Number(budgetBefore?.total ?? 0),
    }

    await tx.delete(aiProviders)
    await tx.delete(aiServiceConfigs)
    await tx.delete(aiModelPricing)
    await tx.delete(aiBudgetSettings)

    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: { type: 'ai_config_wipe', ...before, requestId },
    })

    return before
  })
}
