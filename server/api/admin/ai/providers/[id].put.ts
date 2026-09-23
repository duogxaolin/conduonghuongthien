import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { encryptAiSecret } from '../../../../utils/ai/crypto'

/**
 * Update an AI provider (spec R4.4).
 * Accepts a new API key (plaintext), encrypts it server-side, and stores the
 * ciphertext. Passing null/empty for the key field keeps the existing key.
 * Writes activity_logs in the same transaction (spec R5.4 pattern).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const db = getDb()

  // Load current row to check existence and preserve key if not changing.
  const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Provider không tồn tại.' })
  }

  const patch: Partial<typeof aiProviders.$inferInsert> = {}

  if (typeof body.label === 'string' && body.label.trim()) {
    patch.label = body.label.trim().slice(0, 128)
  }
  if (typeof body.baseUrl === 'string') {
    patch.baseUrl = body.baseUrl.trim().slice(0, 1024) || null
  }
  if (typeof body.isActive === 'boolean') {
    patch.isActive = body.isActive
  }

  // API key: empty/null = keep existing (spec R4.4)
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (apiKey) {
    try {
      const envelope = encryptAiSecret(apiKey)
      patch.apiKeyCiphertext = envelope.ciphertext
      patch.apiKeyNonce = envelope.nonce
      patch.apiKeyAuthTag = envelope.authTag
      patch.apiKeyVersion = envelope.version
      patch.apiKeyKeyId = envelope.keyId
      patch.apiKeyLastFour = envelope.lastFour
    } catch {
      throw createError({ statusCode: 500, statusMessage: 'Không thể mã hoá API key.' })
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: 'Không có thay đổi.' }
  }

  await db.transaction(async (tx) => {
    await tx.update(aiProviders).set(patch).where(eq(aiProviders.id, id))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: id,
      meta: JSON.stringify({
        provider: existing.provider,
        changedFields: Object.keys(patch),
        apiKeyChanged: apiKey !== '',
      }),
    })
  })

  return { ok: true }
})
