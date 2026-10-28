import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiModelPricing, aiUsageLogs, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'
import { DelifyUsageError, fetchDelifyUsage } from '../../../../utils/ai/delify-usage'
import { logInfo } from '../../../../utils/logger'

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

  const data = response.data as {
    availableModels?: Array<{
      name: string
      input: number
      output: number
      cached?: number
      modelsCount?: number
    }>
    history?: Array<{
      timestamp: string
      model: string
      status: string
      cost: number
      input: number
      output: number
      tok: number
      tokS?: number
    }>
  }

  const models = data.availableModels
  if (!Array.isArray(models) || models.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy danh sách model từ Delify API.' })
  }

  let upserted = 0
  let skipped = 0
  let syncedLogs = 0

  await db.transaction(async (tx) => {
    // 3.1. Upsert each model into ai_model_pricing
    for (const m of models) {
      if (!m.name || typeof m.input !== 'number' || typeof m.output !== 'number') {
        skipped++
        continue
      }
      const modelName = m.name.slice(0, 64)

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
      for (const item of data.history) {
        if (!item.timestamp || !item.model) continue
        const itemDate = new Date(item.timestamp)
        if (isNaN(itemDate.getTime())) continue

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
          const costUsd = Number(item.cost) || 0
          const costVnd = costUsd * 25500
          const executionMs = Math.round(item.tokS ? (totalTokens / item.tokS) * 1000 : 0)

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
            errorMessage: item.status !== '200' ? `HTTP ${item.status}` : null,
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
