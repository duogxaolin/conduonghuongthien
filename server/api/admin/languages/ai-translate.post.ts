import { z } from 'zod'
import { requireResourcePermission } from '../../../utils/permissions'
import { readValidated } from '../../../utils/request-body'
import { getDb } from '../../../utils/db'
import { langTranslations } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { callAi } from '../../../services/ai-gateway'
import { upsertTranslations } from '../../../services/languages'
import { readModelTranslations } from '../../../utils/ai/model-translations'

const LANG_CODE_REQUIRED = 'Mã ngôn ngữ bắt buộc.'
const bodySchema = z.object({
  langCode: z.string({ error: LANG_CODE_REQUIRED }).trim().toLowerCase().min(1, LANG_CODE_REQUIRED).max(10),
  langName: z.string().trim().max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readValidated(event, bodySchema)
  const langCode = body.langCode

  const db = getDb()

  // Find all keys that have a value in the default language (vi) but no value
  // or null value in the target language
  const viRows = await db
    .select()
    .from(langTranslations)
    .where(eq(langTranslations.langCode, 'vi'))

  const targetRows = await db
    .select()
    .from(langTranslations)
    .where(eq(langTranslations.langCode, langCode))

  const targetMap = new Map(targetRows.map((r) => [`${r.group}::${r.key}`, r]))

  // Keys that need translation: exist in vi with a value, but missing or empty in target
  const toTranslate = viRows.filter(
    (vi) => {
      const key = `${vi.group}::${vi.key}`
      const target = targetMap.get(key)
      return !target || !target.value || target.value.trim() === ''
    },
  )

  if (toTranslate.length === 0) {
    return { ok: true, translated: 0, message: 'Không còn key nào cần dịch.' }
  }

  // Batch translate via AI
  const langName = body.langName || langCode
  const items: Array<{ group: string; key: string; value: string }> = []

  // Process in batches of 20 keys to keep prompt manageable
  const BATCH = 20
  for (let i = 0; i < toTranslate.length; i += BATCH) {
    const batch = toTranslate.slice(i, i + BATCH)
    const promptLines = batch.map(
      (r, idx) => `[${idx + 1}] key=${r.key} value=${r.value ?? ''}`,
    )

    const prompt = `Dịch các chuỗi giao diện sau sang ${langName}.
Giữ nguyên placeholder như {0}, {name}, %s.
Trả về JSON array, mỗi phần tử là {"key":"...", "value":"..."}:
${promptLines.join('\n')}`

    const result = await callAi('translation_article', { prompt, userId: adminUser?.id ?? null })

    // Only text for keys in this batch; an unreadable answer skips the batch.
    if (result.ok && result.text) items.push(...readModelTranslations(result.text, batch))
  }

  if (items.length > 0) {
    await upsertTranslations(adminUser, langCode, items, true)
  }

  return { ok: true, translated: items.length, total: toTranslate.length }
})
