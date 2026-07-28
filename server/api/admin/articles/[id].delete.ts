import { deleteArticleById } from '../../../services/articles'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid article ID' })

  // The permission check lives inside the service because it depends on the
  // article's type, which is only known after the row is read.
  await deleteArticleById(event.context.adminUser, id)
  return { ok: true }
})
