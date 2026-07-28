import { deleteMediaById } from '../../../services/media'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid media ID' })

  // Guards, storage cleanup and the audit entry live in the service so the bulk
  // route cannot drift from this one. It reads the R2 credentials itself here;
  // the bulk route passes them in once for the whole lot.
  await deleteMediaById(event.context.adminUser, id)

  return { ok: true }
})
