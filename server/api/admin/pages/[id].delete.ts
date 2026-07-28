import { deletePageById } from '../../../services/pages'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  // Permission, the system-page guard and the audit entry all live in the
  // service, so bulk-delete.post.ts cannot drift from this route.
  await deletePageById(event.context.adminUser, id)

  return { ok: true }
})
