import { requireResourcePermission } from '../../../../utils/permissions'
import { bumpAnswerCacheVersion } from '../../../../services/chatbot-answer-cache'
import { deleteProviderWithAudit, findProviderById, findServicesUsingProvider } from '../../../../services/admin-ai-providers'

/**
 * Delete an AI provider.
 * Rejects deletion if any active service config references this provider.
 * Writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const existing = await findProviderById(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Provider không tồn tại.' })
  }

  // Check if any service config uses this provider
  const linked = await findServicesUsingProvider(existing.provider)
  if (linked.length > 0 && linked[0]) {
    throw createError({ statusCode: 409, statusMessage: `Không thể xoá: nhà cung cấp "${existing.provider}" đang được dùng bởi dịch vụ "${linked[0].serviceKey}". Gán dịch vụ sang nhà cung cấp khác trước khi xoá.` })
  }

  // The delete and its audit row in one transaction (in the service).
  await deleteProviderWithAudit(adminUser, id, existing)

    await bumpAnswerCacheVersion().catch(() => undefined)
  return { ok: true }
})
