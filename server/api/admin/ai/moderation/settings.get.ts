import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiServiceConfigs, aiProviders, aiModelPricing } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

export const DEFAULT_MODERATION_SYSTEM_PROMPT = `Bạn là sĩ quan an ninh mạng phụ trách kiểm duyệt an toàn và an ninh nội dung trên Cổng thông tin Cục C11 - Bộ Công an.

NHIỆM VỤ:
Đọc hiểu và đánh giá toàn diện nội dung (bình luận, tin nhắn, bài viết) nhằm bảo đảm an toàn chính trị, trật tự xã hội và môi trường trao đổi lành mạnh trên không gian mạng của Cục C11.

NGUYÊN TẮC ĐÁNH GIÁ NGỮ CẢNH:
1. Phân biệt rõ giữa hành vi vi phạm và phản ánh tích cực:
   - TÍCH CỰC: Nhắc đến tổ chức phản động hoặc từ khóa nhạy cảm nhằm mục đích cảnh giác, lên án, phản bác luận điệu sai trái, giải thích pháp luật hoặc chia sẻ thông tin đúng đắn -> Kết luận: "safe" (An toàn, cho phép hiển thị).
   - VI PHẠM: Tuyên truyền, kích động bạo loạn, lôi kéo lật đổ chính quyền, bôi nhọ lãnh đạo Đảng/Nhà nước, xuyên tạc chính sách nhân đạo của C11, phát tán cờ bạc, lừa đảo, dùng từ ngữ thô tục -> Kết luận: "violation" hoặc "spam" (Vi phạm, cần ẩn).
2. Khi phát hiện vi phạm, nêu rõ lý do và trích xuất điểm nghi vấn.`

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()

  const [config] = await db
    .select()
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
    .limit(1)

  const activeProviders = await db
    .select({
      id: aiProviders.id,
      provider: aiProviders.provider,
      label: aiProviders.label,
      isActive: aiProviders.isActive,
    })
    .from(aiProviders)
    .where(eq(aiProviders.isActive, true))

  const activePricing = await db
    .select()
    .from(aiModelPricing)
    .where(eq(aiModelPricing.isActive, true))

  return {
    ok: true,
    settings: {
      enabled: config ? config.isActive : true,
      mode: config?.isActive ? 'ai' : 'keyword_only',
      provider: config?.provider ?? 'delify',
      model: config?.model ?? 'delify-5.5',
      systemPrompt: config?.systemPrompt ?? DEFAULT_MODERATION_SYSTEM_PROMPT,
      defaultSystemPrompt: DEFAULT_MODERATION_SYSTEM_PROMPT,
    },
    activeProviders,
    activeModels: activePricing,
  }
})
