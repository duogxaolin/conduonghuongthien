import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateCategory } from '../../../services/i18n-auto-translate'
import { createCategory } from '../../../services/category-writes'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const type = String(body?.type || '').trim()
  const description = (() => { const d = String(body?.description || '').trim(); return (!d || d.toLowerCase() === 'null') ? null : d })()
  const displayOrder = Number(body?.displayOrder ?? 0)
  const parentId = body?.parentId ? Number(body.parentId) : null
  const rawSlug = String(body?.slug || '').trim()

  // Parent check, same-name check (same parent, or same type's roots) and insert in one
  // transaction — services/category-writes.ts.
  const created = await createCategory(adminUser, { name, rawSlug, type, description, displayOrder, parentId })

  // Non-blocking i18n auto-translate (vi gốc + AI dịch 5 lang), after the commit.
  void autoTranslateCategory(adminUser, created.slug, name, description).catch(() => {})

  return { ok: true, id: created.id, slug: created.slug }
})
