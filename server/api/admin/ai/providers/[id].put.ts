import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { encryptAiSecret } from '../../../../utils/ai/crypto'
import { checkProviderBaseUrl, normalizedProviderBaseUrl } from '../../../../utils/ai/provider-url'

function hasStoredKey(row: typeof aiProviders.$inferSelect): boolean {
  return Boolean(row.apiKeyCiphertext)
}

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
  if (typeof body.isActive === 'boolean') {
    patch.isActive = body.isActive
  }

  // API key: empty/null = keep existing (spec R4.4)
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

  // Base URL. Trang quản trị luôn gửi lại địa chỉ đang có, nên chỉ một địa chỉ
  // THỰC SỰ đổi mới bị kiểm — một hàng cũ lỡ lưu địa chỉ xấu vẫn tắt/đổi nhãn
  // được (lúc gọi `callAi` đã chặn nó). Đổi đích gọi của một nhà cung cấp đang
  // giữ khoá thì phải nhập lại khoá trong cùng lần lưu: nếu không, người có quyền
  // `ai.update` chỉ cần đổi địa chỉ là khoá đã lưu (người khác nhập) bay tới máy
  // của họ ở lần gọi kế tiếp.
  if (typeof body.baseUrl === 'string') {
    const raw = body.baseUrl.trim()
    if (raw !== (existing.baseUrl ?? '').trim()) {
      let next: string | null = null
      if (raw) {
        const checked = checkProviderBaseUrl(raw)
        if (!checked.ok) throw createError({ statusCode: 400, statusMessage: checked.message })
        next = checked.url
      }
      // Chỉ khác cách viết (hoa/thường, gạch chéo cuối) thì không phải đổi đích.
      const current = existing.baseUrl ? normalizedProviderBaseUrl(existing.baseUrl) : null
      const destinationChanged = next !== null && next !== current
      if (destinationChanged && hasStoredKey(existing) && !apiKey) {
        throw createError({ statusCode: 400, statusMessage: 'Đổi địa chỉ nhà cung cấp (Base URL) phải nhập lại API key trong cùng lần lưu.' })
      }
      patch.baseUrl = next
    }
  }

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
      meta: {
        provider: existing.provider,
        changedFields: Object.keys(patch),
        apiKeyChanged: apiKey !== '',
      },
    })
  })

  return { ok: true }
})
