import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { callAi } from '../../../services/ai-gateway'
import { upsertTranslations } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const langCode = String(body.langCode || '').trim().toLowerCase()
  const langName = String(body.langName || langCode)
  const group = String(body.group || 'general')
  const key = String(body.key || '')
  const sourceText = String(body.sourceText || '').trim()

  if (!langCode || !key) {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu mã ngôn ngữ hoặc khóa bản dịch.' })
  }

  const prompt = `Bạn là biên dịch viên chuyên nghiệp.
Hãy dịch chính xác chuỗi giao diện người dùng sau sang ${langName}.
Yêu cầu:
1. Chuẩn xác, ngắn gọn, phù hợp với nút bấm / nhãn giao diện phần mềm.
2. Giữ nguyên mọi placeholder như {0}, {name}, %s.
3. CHỈ TRẢ VỀ DUY NHẤT VĂN BẢN ĐÃ DỊCH (không giải thích, không bọc markdown, không dấu ngoặc kép thừa).

[KHÓA]: ${key}
[NGỮ CẢNH NHÓM]: ${group}
[BẢN GỐC (TIẾNG VIỆT)]: ${sourceText || key}`

  const result = await callAi('translation_ui', {
    prompt,
    userId: adminUser?.id ?? null,
  })

  if (!result.ok || !result.text) {
    throw createError({ statusCode: 502, statusMessage: result.errorMessage || 'Không thể dịch khóa này.' })
  }

  const translatedValue = result.text.trim().replace(/^["']|["']$/g, '')

  // Save directly to database
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
