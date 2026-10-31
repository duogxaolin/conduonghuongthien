import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiModelPricing, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'
import { DelifyUsageError, fetchDelifyUsage } from '../../../../utils/ai/delify-usage'
import { isStorableCostPerMillion } from '../../../../utils/ai/pricing-cost'
import { logInfo } from '../../../../utils/logger'

/** `ai_model_pricing.model` is VARCHAR(64). */
const MODEL_NAME_MAX = 64

/**
 * What the router sends is data from outside, checked like an officer's entry before
 * it is written (slice R5): a name longer than the column used to be cut to 64
 * characters — i.e. into ANOTHER model's name, whose price was then overwritten; a
 * price outside DECIMAL(8,4) failed the whole sync on MySQL (strict) and a negative one
 * made negative costs; an item of another shape threw inside the transaction (500,
 * nothing synced).
 */
function storableModel(m: unknown): { name: string, input: number, output: number } | null {
  if (!m || typeof m !== 'object') return null
  const { name, input, output } = m as { name?: unknown, input?: unknown, output?: unknown }
  if (typeof name !== 'string' || !name || name.length > MODEL_NAME_MAX) return null
  if (typeof input !== 'number' || typeof output !== 'number') return null
  if (!isStorableCostPerMillion(input) || !isStorableCostPerMillion(output)) return null
  return { name, input, output }
}

/**
 * Sync model pricing from Delify Router API: calls `/api/usage/key/receipts` on the
 * delify provider's host with the stored API key and upserts its `availableModels`
 * into `ai_model_pricing`.
 *
 * The router's request `history` is NOT written to `ai_usage_logs`. It used to be, as
 * `delify_router` rows — and every request this app makes through delify is already a
 * row there, written by `callAi` (or the test call) the moment it is answered. The two
 * have no shared identity (the history has no request id; a streamed tool-loop turn is
 * two router requests but one gateway row; the router's cost and the local price
 * differ), so each imported request was spend counted twice by `checkBudget`, the
 * dashboard and the key card (R5, verifier PROBE-5). The history stays visible on the
 * dashboard, read live from the router (`status.get.ts`, `recentHistory`). Rows an
 * earlier sync wrote: `npm run db:repair-ai-usage-duplicates`.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const db = getDb()

  // 1. Find the Delify provider
  const [delifyProvider] = await db.select().from(aiProviders)
    .where(eq(aiProviders.provider, 'delify'))
    .limit(1)

  if (!delifyProvider) {
    throw createError({ statusCode: 404, statusMessage: 'Nhà cung cấp "delify" chưa được tạo. Vui lòng thêm Delify Router trong tab Nhà cung cấp trước.' })
  }

  if (!delifyProvider.apiKeyCiphertext || !delifyProvider.apiKeyNonce || !delifyProvider.apiKeyAuthTag || !delifyProvider.apiKeyVersion || !delifyProvider.apiKeyKeyId) {
    throw createError({ statusCode: 400, statusMessage: 'Chưa cấu hình API key cho Delify Router.' })
  }

  // 2. Decrypt the API key
  let apiKey: string
  try {
    apiKey = decryptAiSecret({
      ciphertext: delifyProvider.apiKeyCiphertext,
      nonce: delifyProvider.apiKeyNonce,
      authTag: delifyProvider.apiKeyAuthTag,
      version: delifyProvider.apiKeyVersion,
      keyId: delifyProvider.apiKeyKeyId,
      lastFour: delifyProvider.apiKeyLastFour ?? '',
    })
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Không thể giải mã API key. Vui lòng cấu hình lại.' })
  }

  // 3. Call Delify API to get available models with pricing — through `fetchDelifyUsage`
  //    (host from the stored base URL, outbound.ts), never a bare fetch.
  let response: { status: number, data: unknown }
  try {
    response = await fetchDelifyUsage({
      baseUrl: delifyProvider.baseUrl, secret: apiKey, path: '/api/usage/key/receipts',
      params: { period: 'all', page: '1', pageSize: '100' }, timeoutMs: 15_000,
    })
  } catch (error) {
    if (!(error instanceof DelifyUsageError)) throw error
    throw createError({ statusCode: error.reason === 'provider_url_rejected' ? 400 : 502, statusMessage: error.message })
  }

  if (response.data === null || typeof response.data !== 'object') {
    throw createError({ statusCode: 502, statusMessage: `Delify API trả lỗi HTTP ${response.status}.` })
  }

  // Every item is parsed by `storableModel` before use.
  const models = (response.data as { availableModels?: unknown }).availableModels
  if (!Array.isArray(models) || models.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy danh sách model từ Delify API.' })
  }

  let upserted = 0
  /** Models not written (`upserted + skipped` = the router's model count). */
  let skipped = 0

  await db.transaction(async (tx) => {
    // 3.1. Upsert each model into ai_model_pricing
    for (const candidate of models) {
      const m = storableModel(candidate)
      if (!m) {
        skipped++
        continue
      }
      const modelName = m.name

      const [existing] = await tx.select().from(aiModelPricing)
        .where(eq(aiModelPricing.model, modelName))
        .limit(1)

      if (existing) {
        await tx.update(aiModelPricing).set({
          provider: 'delify',
          label: modelName,
          promptCostPerMillion: String(m.input),
          completionCostPerMillion: String(m.output),
        }).where(eq(aiModelPricing.model, modelName))
      } else {
        await tx.insert(aiModelPricing).values({
          model: modelName,
          provider: 'delify',
          label: modelName,
          isActive: true,
          promptCostPerMillion: String(m.input),
          completionCostPerMillion: String(m.output),
        }).onDuplicateKeyUpdate({ set: { model: modelName } })
      }
      upserted++
    }

    // 3.2. Write audit log inside the same transaction
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: delifyProvider.id,
      meta: {
        action: 'delify-pricing-sync',
        upserted,
        skipped,
        totalFromApi: models.length,
      },
    })
  })

  // 4. Get usage info from Delify key endpoint for the dashboard
  interface DelifyKeyResponse {
    windowCostUsd?: number
    windowRequests?: number
    allowedModels?: string[]
  }
  let delifyUsage: DelifyKeyResponse | null = null
  try {
    const keyResp = await fetchDelifyUsage({ baseUrl: delifyProvider.baseUrl, secret: apiKey, path: '/api/usage/key' })
    if (keyResp.data && typeof keyResp.data === 'object') delifyUsage = keyResp.data as DelifyKeyResponse
  } catch {
    // Usage info is optional
  }

  logInfo({
    event: 'ai_panel.delify_sync',
    upserted,
    skipped,
    totalFromApi: models.length,
  })

  return {
    ok: true,
    upserted,
    skipped,
    totalFromApi: models.length,
    // Only plain values of the router's answer reach the browser (as in `status.get.ts`).
    delifyUsage: delifyUsage ? {
      windowCostUsd: typeof delifyUsage.windowCostUsd === 'number' ? delifyUsage.windowCostUsd : null,
      windowRequests: typeof delifyUsage.windowRequests === 'number' ? delifyUsage.windowRequests : null,
      allowedModels: Array.isArray(delifyUsage.allowedModels) ? delifyUsage.allowedModels.filter((model): model is string => typeof model === 'string') : null,
    } : null,
  }
})
