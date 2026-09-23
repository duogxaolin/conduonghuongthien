import { inArray } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiServiceConfigs, aiModelPricing, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Bulk delete AI providers.
 * Accepts `{ ids: number[] }`.
 * Rejects if any selected provider is currently linked to an active service config.
 * Automatically removes associated models in ai_model_pricing.
 * Writes activity_logs in the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object' || !Array.isArray(body.ids)) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách ID nhà cung cấp không hợp lệ.' })
  }

  const ids = body.ids
    .filter((id: unknown): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0)

  if (ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn ít nhất 1 nhà cung cấp để xoá.' })
  }

  const db = getDb()

  // Find the providers to be deleted
  const providersToDelete = await db.select().from(aiProviders)
    .where(inArray(aiProviders.id, ids))

  if (providersToDelete.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy nhà cung cấp nào.' })
  }

  const providerNames = providersToDelete.map(p => p.provider)

  // Check if any of these providers are assigned to any service config
  const linkedServices = await db.select({
    serviceKey: aiServiceConfigs.serviceKey,
    serviceName: aiServiceConfigs.serviceName,
    provider: aiServiceConfigs.provider,
  }).from(aiServiceConfigs)
    .where(inArray(aiServiceConfigs.provider, providerNames))

  if (linkedServices.length > 0) {
    const conflicts = linkedServices.map(l => `"${l.provider}" đang dùng cho ${l.serviceName} (${l.serviceKey})`).join(', ')
    throw createError({
      statusCode: 409,
      statusMessage: `Không thể xoá vì có nhà cung cấp đang được sử dụng: ${conflicts}. Vui lòng gán dịch vụ sang nhà cung cấp khác trước khi xoá.`,
    })
  }

  await db.transaction(async (tx) => {
    // 1. Delete associated models in ai_model_pricing
    await tx.delete(aiModelPricing).where(inArray(aiModelPricing.provider, providerNames))

    // 2. Delete the providers
    await tx.delete(aiProviders).where(inArray(aiProviders.id, ids))

    // 3. Write audit log
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: null,
      meta: JSON.stringify({
        type: 'provider_bulk_delete',
        count: ids.length,
        providers: providerNames,
      }),
    })
  })

  return { ok: true, deleted: providersToDelete.length }
})
