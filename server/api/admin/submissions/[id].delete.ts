import { deleteSubmissionById } from '../../../services/submissions'

/**
 * Delete one submission. New route: this resource was read-only until now.
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: 'Invalid submission ID' })

  await deleteSubmissionById(event.context.adminUser, id)
  return { ok: true }
})
