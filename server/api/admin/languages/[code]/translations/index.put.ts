import { createError } from 'h3'
import { z } from 'zod'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { readValidated } from '../../../../../utils/request-body'
import { upsertTranslations } from '../../../../../services/languages'

/**
 * Save UI translations of one language (the "Bản dịch UI" tab sends one item per save).
 *
 * `value` is a string — stored as typed, '' included — or `null`, which CLEARS the
 * row: SQL NULL, the state "Đồng bộ key" and a new language give a row, and what every
 * reader already treats as untranslated (public `t()` falls back, the coverage stats
 * and the AI batch scan count it as missing). Rejecting null instead would turn a
 * save of an untouched empty row from a tab loaded before this fix into an error.
 * Anything else is a 400 before any write: this handler used to store
 * `String(i.value)`, so a null became the TEXT "null" on the public site
 * (`npm run db:repair-null-translations` clears rows written that way).
 */
const MAX_ITEMS = 1000
const MAX_VALUE_CHARS = 10_000

const bodySchema = z.object({
  items: z.array(z.object({
    // Bounds of `lang_translations` (VARCHAR(50) / VARCHAR(200)): past them MySQL fails the write.
    group: z.string().trim().min(1).max(50).default('general'),
    key: z.string().trim().min(1).max(200),
    value: z.string().max(MAX_VALUE_CHARS).nullable(),
  })).min(1).max(MAX_ITEMS),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  const { items } = await readValidated(event, bodySchema)
  await upsertTranslations(adminUser, code, items, false)

  return { ok: true, count: items.length }
})
