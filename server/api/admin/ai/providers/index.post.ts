import { getDb } from '../../../../utils/db'
import { aiProviders, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { encryptAiSecret } from '../../../../utils/ai/crypto'
import { and, eq } from 'drizzle-orm'

/**
 * Create a new AI provider (spec R4 extension).
 * Validates uniqueness of `provider` name, encrypts API key if provided.
 * Writes activity_logs within the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const provider = typeof body.provider === 'string' ? body.provider.trim().slice(0, 32) : ''
  const label = typeof body.label === 'string' ? body.label.trim().slice(0, 128) : ''
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().slice(0, 1024) || null : null
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : false
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!provider) {
    throw createError({ statusCode: 400, statusMessage: 'Tên nhà cung cấp (provider) là bắt buộc.' })
  }
  if (!label) {
    throw createError({ statusCode: 400, statusMessage: 'Nhãn hiển thị (label) là bắt buộc.' })
  }

  const db = getDb()

  // Check uniqueness
  const [existing] = await db.select({ id: aiProviders.id })
    .from(aiProviders)
    .where(eq(aiProviders.provider, provider))
    .limit(1)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `Nhà cung cấp "${provider}" đã tồn tại.` })
  }

  const insert: typeof aiProviders.$inferInsert = {
    provider,
    label,
    baseUrl,
    isActive,
  }

  if (apiKey) {
    try {
      const envelope = encryptAiSecret(apiKey)
      insert.apiKeyCiphertext = envelope.ciphertext
      insert.apiKeyNonce = envelope.nonce
      insert.apiKeyAuthTag = envelope.authTag
      insert.apiKeyVersion = envelope.version
      insert.apiKeyKeyId = envelope.keyId
      insert.apiKeyLastFour = envelope.lastFour
    } catch {
      throw createError({ statusCode: 500, statusMessage: 'Không thể mã hoá API key.' })
    }
  }

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(aiProviders).values(insert)
    const newId = created?.insertId
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'create',
      resource: 'ai',
      resourceId: newId ?? null,
      meta: JSON.stringify({ provider, hasApiKey: apiKey !== '' }),
    })
    return newId
  })

  return { ok: true, id: result }
})
