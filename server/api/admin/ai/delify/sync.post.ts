import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiModelPricing, aiUsageLogs, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'
import { DelifyUsageError, fetchDelifyUsage } from '../../../../utils/ai/delify-usage'
import { isStorableCostPerMillion } from '../../../../utils/ai/pricing-cost'
import { logInfo } from '../../../../utils/logger'

/** `ai_model_pricing.model` and `ai_usage_logs.model` are VARCHAR(64). */
const MODEL_NAME_MAX = 64
/** `ai_usage_logs.cost_usd` is DECIMAL(10,6). */
const MAX_COST_USD = 9999.999999

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
 * The router's timestamp as `ai_usage_logs.created_at` (TIMESTAMP, no fractional
 * seconds) keeps it: MySQL ROUNDS the fraction (…00.567 → …01). Stored and compared
 * with its milliseconds, the dedupe below never matched a row it had written itself
 * on MySQL, and every sync inserted the whole history again — spend `checkBudget`
 * sums, counted twice, three times…
 */
function storedSecond(timestamp: unknown): Date | null {
  if (typeof timestamp !== 'string' || !timestamp) return null
  const ms = new Date(timestamp).getTime()
  return Number.isFinite(ms) ? new Date(Math.round(ms / 1000) * 1000) : null
}

/** One request of the router's history, or null when it cannot be recorded as it is (wrong shape, a cost that is not a cost). */
function storableHistoryItem(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const { timestamp, model, status, cost, input, output, tok, tokS } = value as Record<string, unknown>
  const createdAt = storedSecond(timestamp)
  if (!createdAt || typeof model !== 'string' || !model) return null
  const costUsd = Number(cost) || 0
  if (costUsd < 0 || costUsd > MAX_COST_USD) return null
  return { createdAt, model, status, costUsd, input, output, tok, tokS }
}

/**
 * Sync model pricing AND request history from Delify Router API.
 * Calls `/api/usage/key/receipts` on the delify provider's host with the stored API key
 * to get `availableModels` AND `history` requests,
 * then upserts models into `ai_model_pricing` AND merges router history into `ai_usage_logs`.
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

  // 3. Call Delify API to get available models with pricing AND history — through
  //    `fetchDelifyUsage` (host from the stored base URL, outbound.ts), never a bare fetch.
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

  // Every item is parsed by `storableModel` / `storableHistoryItem` before use.
  const data = response.data as { availableModels?: unknown, history?: unknown }

  const models = data.availableModels
  if (!Array.isArray(models) || models.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy danh sách model từ Delify API.' })
  }

  let upserted = 0
  let skipped = 0
  let syncedLogs = 0

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

    // 3.2. Sync history requests from Delify Router into ai_usage_logs
    if (Array.isArray(data.history) && data.history.length > 0) {
      for (const candidate of data.history) {
        const item = storableHistoryItem(candidate)
        if (!item) continue
        const itemDate = item.createdAt

        // Check if this log entry already exists by timestamp and provider
        const [existingLog] = await tx.select({ id: aiUsageLogs.id })
          .from(aiUsageLogs)
          .where(and(
            eq(aiUsageLogs.provider, 'delify'),
            eq(aiUsageLogs.createdAt, itemDate),
          ))
          .limit(1)

        if (!existingLog) {
          const promptTokens = Number(item.input) || 0
          const completionTokens = Number(item.output) || 0
          const totalTokens = Number(item.tok) || (promptTokens + completionTokens)
          const costUsd = item.costUsd
          const costVnd = costUsd * 25500
          const tokS = Number(item.tokS) || 0
          const executionMs = Math.round(tokS ? (totalTokens / tokS) * 1000 : 0)

          await tx.insert(aiUsageLogs).values({
            serviceKey: 'delify_router',
            provider: 'delify',
            model: item.model.slice(0, 64),
            promptTokens,
            completionTokens,
            totalTokens,
            costUsd: costUsd.toFixed(6),
            costVnd: costVnd.toFixed(2),
            executionMs,
            userId: adminUser.id ?? null,
            success: item.status === '200',
            errorMessage: item.status !== '200' ? `HTTP ${String(item.status)}` : null,
            createdAt: itemDate,
          })
          syncedLogs++
        }
      }
    }

    // 3.3. Write audit log inside the same transaction
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: delifyProvider.id,
      meta: {
        action: 'delify-pricing-and-logs-sync',
        upserted,
        skipped,
        syncedLogs,
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
    syncedLogs,
    totalFromApi: models.length,
  })

  return {
    ok: true,
    upserted,
    skipped,
    syncedLogs,
    totalFromApi: models.length,
    delifyUsage: delifyUsage ? {
      windowCostUsd: delifyUsage.windowCostUsd ?? null,
      windowRequests: delifyUsage.windowRequests ?? null,
      allowedModels: delifyUsage.allowedModels ?? null,
    } : null,
  }
})
