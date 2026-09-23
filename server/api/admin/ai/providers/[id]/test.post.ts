import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../utils/db'
import { aiProviders } from '../../../../../db/schema'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { decryptAiSecret } from '../../../../../utils/ai/crypto'
import { safeProviderRequest } from '../../../../../utils/chatbot/outbound'
import { buildProviderProbeCall, resolveProviderPolicy } from '../../../../../utils/chatbot/providers'
import { logWarn } from '../../../../../utils/logger'

/**
 * Test an AI provider's API connection (spec R4.5).
 * Sends a minimal GET /v1/models (or equivalent) using the stored key.
 * Returns `{ ok: true, model?: string }` or `{ ok: false, error: string }`.
 * MUST NOT log the API key in any form.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const db = getDb()
  const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1)

  if (!provider) {
    return { ok: false, error: 'Provider không tồn tại.' }
  }
  if (!provider.apiKeyCiphertext || !provider.apiKeyNonce || !provider.apiKeyAuthTag || !provider.apiKeyVersion || !provider.apiKeyKeyId) {
    return { ok: false, error: 'Chưa cấu hình API key cho provider này.' }
  }
  if (!provider.baseUrl) {
    return { ok: false, error: 'Chưa cấu hình base URL.' }
  }

  let secret: string
  try {
    secret = decryptAiSecret({
      ciphertext: provider.apiKeyCiphertext,
      nonce: provider.apiKeyNonce,
      authTag: provider.apiKeyAuthTag,
      version: provider.apiKeyVersion,
      keyId: provider.apiKeyKeyId,
      lastFour: provider.apiKeyLastFour ?? '',
    })
  } catch {
    logWarn({
      event: 'ai_gateway.key_unavailable',
      serviceKey: 'provider_test',
      provider: provider.provider,
      reason: 'decrypt_failed',
    })
    return { ok: false, error: 'Không thể giải mã API key. Vui lòng cấu hình lại.' }
  }

  // Build a probe request (GET /v1/models) — uses the same policy mapping as chat
  const policy = provider.provider === 'anthropic' ? 'anthropic' : 'openai-compatible'
  const probe = buildProviderProbeCall({ policy, baseUrl: provider.baseUrl, secret })

  try {
    const url = new URL(probe.url)
    const response = await safeProviderRequest({
      url: probe.url,
      allowedHosts: [url.hostname],
      method: 'GET',
      headers: probe.headers,
      timeoutMs: 10_000,
      maxResponseBytes: 65_536,
    })

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    // Try to extract a model name from the response for confirmation
    const payload = JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown
    const models = (payload as { data?: unknown }).data
    if (Array.isArray(models) && models.length > 0 && typeof models[0] === 'object' && models[0] !== null) {
      const modelId = (models[0] as { id?: unknown }).id
      return { ok: true, model: typeof modelId === 'string' ? modelId : undefined }
    }

    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi kết nối'
    return { ok: false, error: message }
  }
})
