import { deleteContentTypeById } from '../../../services/content-types'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid content type ID' })

  await deleteContentTypeById(event.context.adminUser, id)

  return { ok: true }
})
