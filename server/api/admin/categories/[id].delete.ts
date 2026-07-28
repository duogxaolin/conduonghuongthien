import { deleteCategoryById } from '../../../services/categories'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid category ID' })

  // Permission and the child/article guards live in the service, so this route
  // and the bulk one cannot drift apart.
  await deleteCategoryById(event.context.adminUser, id)

  return { ok: true }
})
