import { createError } from 'h3'
import { z } from 'zod'
import { requireResourcePermission } from '../../../utils/permissions'
import { readValidated } from '../../../utils/request-body'
import { callAi } from '../../../services/ai-gateway'
import { requireLanguage, upsertTranslations } from '../../../services/languages'
import { modelSingleTranslation } from '../../../utils/ai/model-translations'

const MISSING = 'Thiếu mã ngôn ngữ hoặc khóa bản dịch.'

const bodySchema = z.object({
  langCode: z.string({ error: MISSING }).trim().toLowerCase().min(1, MISSING).max(10),
  langName: z.string().trim().max(100).optional(),
  group: z.string().trim().min(1).max(50).default('general'),
  key: z.string({ error: MISSING }).trim().min(1, MISSING).max(200),
  sourceText: z.string().max(10_000).optional(),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const { langCode, langName, group, key, sourceText } = await readValidated(event, bodySchema)
  // Refuse an unknown language before paying for an AI call (the write checks again, locked).
  await requireLanguage(langCode)

  const prompt = `Bạn là biên dịch viên chuyên nghiệp.
Hãy dịch chính xác chuỗi giao diện người dùng sau sang ${langName || langCode}.
Yêu cầu:
1. Chuẩn xác, ngắn gọn, phù hợp với nút bấm / nhãn giao diện phần mềm.
2. Giữ nguyên mọi placeholder như {0}, {name}, %s.
3. CHỈ TRẢ VỀ DUY NHẤT VĂN BẢN ĐÃ DỊCH (không giải thích, không bọc markdown, không dấu ngoặc kép thừa).

[KHÓA]: ${key}
[NGỮ CẢNH NHÓM]: ${group}
[BẢN GỐC (TIẾNG VIỆT)]: ${sourceText?.trim() || key}`

  const result = await callAi('translation_ui', {
    prompt,
    userId: adminUser?.id ?? null,
  })

  if (!result.ok || !result.text) {
    throw createError({ statusCode: 502, statusMessage: result.errorMessage || 'Không thể dịch khóa này.' })
  }

  // An answer of "null"/"undefined"/blank is not a translation: storing it put the
  // word "null" on the public site.
  const translatedValue = modelSingleTranslation(result.text)
  if (translatedValue === null) {
    throw createError({ statusCode: 502, statusMessage: 'AI không trả về bản dịch cho khóa này — chưa lưu gì.' })
  }

  await upsertTranslations(
    adminUser,
    langCode,
    [{ group, key, value: translatedValue }],
    true,
  )

  return {
    ok: true,
    group,
    key,
    value: translatedValue,
  }
})
