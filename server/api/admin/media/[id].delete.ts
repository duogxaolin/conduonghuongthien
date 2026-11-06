import { deleteMediaById } from '../../../services/media'
import { bumpAnswerCacheVersion } from '../../../services/chatbot-answer-cache'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Invalid media ID' })

  // Guards, storage cleanup and the audit entry live in the service so the bulk
  // route cannot drift from this one. It reads the R2 credentials itself here;
  // the bulk route passes them in once for the whole lot.
  await deleteMediaById(event.context.adminUser, id)
  // Model chép URL ảnh (`search_c11_photos`) vào câu trả lời: câu đã cache không được dẫn ảnh vừa xoá.
  await bumpAnswerCacheVersion().catch(() => undefined)

  return { ok: true }
})
