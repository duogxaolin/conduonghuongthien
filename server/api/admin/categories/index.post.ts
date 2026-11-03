import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateCategory } from '../../../services/i18n-auto-translate'
import { createCategory, readCategoryName, readDisplayOrder, readParentId } from '../../../services/category-writes'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'create')

  const body = await readBody(event).catch(() => ({}))
  // A non-string name, a parent that is not an id, an order that is not a number → 400 here
  // (they reached MySQL as a 500 before); `null` name is "no name" (the empty-name sentence).
  const name = readCategoryName(body?.name ?? undefined) ?? ''
  const type = String(body?.type || '').trim()
  const description = (() => { const d = String(body?.description || '').trim(); return (!d || d.toLowerCase() === 'null') ? null : d })()
  const displayOrder = readDisplayOrder(body?.displayOrder, 0) ?? 0
  const parentId = readParentId(body?.parentId)
  const rawSlug = String(body?.slug || '').trim()

  // Parent check, same-name check (same parent, or same type's roots) and insert in one
  // transaction — services/category-writes.ts.
  const created = await createCategory(adminUser, { name, rawSlug, type, description, displayOrder, parentId })

  // Non-blocking i18n auto-translate (vi gốc + AI dịch 5 lang), after the commit.
  void autoTranslateCategory(adminUser, created.slug, name, description).catch(() => {})

  // After the commit: category pills and lists are in the `swr`-cached public pages
  // (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('categories.create')

  return { ok: true, id: created.id, slug: created.slug }
})
