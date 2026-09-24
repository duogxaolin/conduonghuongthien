import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiServiceConfigs, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const patch: Partial<typeof aiServiceConfigs.$inferInsert> = {}

  if (typeof body.enabled === 'boolean') {
    patch.isActive = body.enabled
  } else if (body.mode === 'keyword_only') {
    patch.isActive = false
  } else if (body.mode === 'ai') {
    patch.isActive = true
  }

  if (typeof body.provider === 'string' && body.provider.trim()) {
    patch.provider = body.provider.trim().slice(0, 32)
  }

  if (typeof body.model === 'string' && body.model.trim()) {
    patch.model = body.model.trim().slice(0, 64)
  }

  if (typeof body.systemPrompt === 'string') {
    patch.systemPrompt = body.systemPrompt.trim()
  }

  patch.updatedBy = adminUser.id ?? null

  const db = getDb()

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: aiServiceConfigs.id })
      .from(aiServiceConfigs)
      .where(eq(aiServiceConfigs.serviceKey, 'moderation'))
      .limit(1)

    if (existing) {
      await tx
        .update(aiServiceConfigs)
        .set(patch)
        .where(eq(aiServiceConfigs.id, existing.id))
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: existing?.id ?? 1,
      meta: JSON.stringify({
        type: 'update_moderation_settings',
        changedFields: Object.keys(patch),
      }),
    })
  })

  return { ok: true }
})
