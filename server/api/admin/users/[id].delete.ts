import { deleteUserById } from '../../../services/users'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid user ID' })

  // The self-delete and SuperAdmin guards live in the service, so the bulk route
  // enforces exactly the same two rules per row.
  await deleteUserById(event.context.adminUser, id)

  return { ok: true }
})
