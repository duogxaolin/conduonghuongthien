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
  const items = Array.isArray(body.items) ? body.items : []

  if (!langCode) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

  if (items.length === 0) {
    return { ok: true, translated: [] }
  }

  const promptLines = items.map(
    (item, idx) => `[${idx + 1}] key="${item.key}" group="${item.group}" text="${item.sourceText || item.key}"`,
  )

  const prompt = `Bạn là biên dịch viên chuyên nghiệp giao diện phần mềm.
Dịch các chuỗi giao diện người dùng sau sang ${langName}.
Yêu cầu:
1. Chuẩn xác, ngắn gọn, phù hợp nút bấm / nhãn phần mềm.
2. Giữ nguyên mọi placeholder như {0}, {name}, %s.
3. Trả về DUY NHẤT một JSON array hợp lệ, mỗi phần tử là {"key":"...", "value":"..."}:
${promptLines.join('\n')}`

  const result = await callAi('translation_ui', { prompt, userId: adminUser?.id ?? null })

  const translatedList: Array<{ group: string; key: string; value: string }> = []

  if (result.ok && result.text) {
    try {
      const raw = result.text.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim()
      const parsed = JSON.parse(raw) as Array<{ key: string; value: string }>
      if (Array.isArray(parsed)) {
        for (const p of parsed) {
          const matched = items.find((it) => it.key === p.key)
          if (matched && p.value) {
            translatedList.push({
              group: matched.group,
              key: matched.key,
              value: String(p.value).trim(),
            })
          }
        }
      }
    } catch {
      // Fallback: parse failure
    }
  }

  if (translatedList.length > 0) {
    await upsertTranslations(adminUser, langCode, translatedList, true)
  }

  return {
    ok: true,
    translated: translatedList,
  }
})
