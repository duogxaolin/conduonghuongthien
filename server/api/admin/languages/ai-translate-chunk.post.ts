import { z } from 'zod'
import { requireResourcePermission } from '../../../utils/permissions'
import { readValidated } from '../../../utils/request-body'
import { callAi } from '../../../services/ai-gateway'
import { upsertTranslations } from '../../../services/languages'
import { readModelTranslations } from '../../../utils/ai/model-translations'

const LANG_CODE_REQUIRED = 'Mã ngôn ngữ bắt buộc.'

/** One chunk of the "Dịch AI còn thiếu" run (the page sends 10 keys at a time). */
const bodySchema = z.object({
  langCode: z.string({ error: LANG_CODE_REQUIRED }).trim().toLowerCase().min(1, LANG_CODE_REQUIRED).max(10),
  langName: z.string().trim().max(100).optional(),
  items: z.array(z.object({
    group: z.string().trim().min(1).max(50),
    key: z.string().trim().min(1).max(200),
    sourceText: z.string().max(10_000).optional(),
  })).max(100),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const { langCode, langName, items } = await readValidated(event, bodySchema)
  if (items.length === 0) return { ok: true, translated: [] }

  const promptLines = items.map(
    (item, idx) => `[${idx + 1}] key="${item.key}" group="${item.group}" text="${item.sourceText || item.key}"`,
  )

  const prompt = `Bạn là biên dịch viên chuyên nghiệp giao diện phần mềm.
Dịch các chuỗi giao diện người dùng sau sang ${langName || langCode}.
Yêu cầu:
1. Chuẩn xác, ngắn gọn, phù hợp nút bấm / nhãn phần mềm.
2. Giữ nguyên mọi placeholder như {0}, {name}, %s.
3. Trả về DUY NHẤT một JSON array hợp lệ, mỗi phần tử là {"key":"...", "value":"..."}:
${promptLines.join('\n')}`

  const result = await callAi('translation_ui', { prompt, userId: adminUser?.id ?? null })

  // Only text for keys that were asked for (`readModelTranslations`): a value the
  // model sent as null/an object/a number used to be stored as `String(p.value)`.
  const translated = result.ok && result.text ? readModelTranslations(result.text, items) : []
  if (translated.length > 0) {
    await upsertTranslations(adminUser, langCode, translated, true)
  }

  return {
    ok: true,
    translated,
  }
})
