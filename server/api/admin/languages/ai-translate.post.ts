import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { getDb } from '../../../utils/db'
import { langTranslations } from '../../../db/schema'
import { eq } from 'drizzle-orm'
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
  if (!langCode) {
    throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })
  }

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
  const langName = String(body.langName || langCode)
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

    if (result.ok && result.text) {
      try {
        const raw = result.text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
        const parsed = JSON.parse(raw) as Array<{ key: string; value: string }>
        for (const p of parsed) {
          const viRow = batch.find((b) => b.key === p.key)
          if (viRow) {
            items.push({ group: viRow.group, key: p.key, value: p.value })
          }
        }
      } catch {
        // Skip unparseable batch
      }
    }
  }

  if (items.length > 0) {
    await upsertTranslations(adminUser, langCode, items, true)
  }

  return { ok: true, translated: items.length, total: toTranslate.length }
})
