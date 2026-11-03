import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateCategoryUpdate } from '../../../services/i18n-auto-translate'
import { readCategoryName, readDisplayOrder, readParentId, updateCategory, type CategoryUpdateInput } from '../../../services/category-writes'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  const body = await readBody(event).catch(() => ({}))
  const input: CategoryUpdateInput = {}
  // `name: null` used to be stored as the text "null"; a parent that is not an id or an order
  // that is not a number reached MySQL as a 500 — all 400 now (services/category-writes.ts).
  if (body.name !== undefined) input.name = readCategoryName(body.name)
  if (body.type !== undefined) input.type = String(body.type).trim()
  if (body.description !== undefined) { const d = String(body.description).trim(); input.description = (!d || d.toLowerCase() === 'null') ? null : d }
  if (body.displayOrder !== undefined) input.displayOrder = readDisplayOrder(body.displayOrder, 0)
  if (body.slug !== undefined) input.rawSlug = String(body.slug).trim()
  if ('parentId' in body) input.parentId = readParentId(body.parentId)

  // Existence, parent rules, same-name check (where the category will be) and the update in
  // one transaction — services/category-writes.ts.
  const result = await updateCategory(adminUser, id, input)
  if (!result.written) {
    return { ok: true }
  }

  // Non-blocking i18n auto-translate update khi name/description đổi, after the commit.
  if (result.textChanged) {
    void autoTranslateCategoryUpdate(adminUser, result.slug, result.name, result.description).catch(() => {})
  }

  // After the commit, only when something was written: a renamed or re-slugged category
  // changes `/news/<category>` (the old slug now renders 404) and every cached list that
  // shows it (server/utils/public-page-cache.ts).
  await purgePublicPageCacheAfterWrite('categories.update')

  return { ok: true, slug: result.slug }
})
