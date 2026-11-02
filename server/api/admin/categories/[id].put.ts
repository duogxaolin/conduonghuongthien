import { requireResourcePermission } from '../../../utils/permissions'
import { autoTranslateCategoryUpdate } from '../../../services/i18n-auto-translate'
import { updateCategory, type CategoryUpdateInput } from '../../../services/category-writes'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'categories', 'update')

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  const body = await readBody(event).catch(() => ({}))
  const input: CategoryUpdateInput = {}
  if (body.name !== undefined) input.name = String(body.name).trim()
  if (body.type !== undefined) input.type = String(body.type).trim()
  if (body.description !== undefined) { const d = String(body.description).trim(); input.description = (!d || d.toLowerCase() === 'null') ? null : d }
  if (body.displayOrder !== undefined) input.displayOrder = Number(body.displayOrder)
  if (body.slug !== undefined) input.rawSlug = String(body.slug).trim()
  if ('parentId' in body) input.parentId = body.parentId ? Number(body.parentId) : null

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

  return { ok: true, slug: result.slug }
})
