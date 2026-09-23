import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiModelPricing, aiUsageLogs, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'
import { logInfo, logWarn } from '../../../../utils/logger'

/**
 * Sync model pricing AND request history from Delify Router API.
 * Calls https://router.delify.vn/api/usage/key/receipts with the stored API key
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

  // 3. Call Delify API to get available models with pricing AND history
  const receiptsUrl = `https://router.delify.vn/api/usage/key/receipts?key=${encodeURIComponent(apiKey)}&period=all&page=1&pageSize=100`

  let response: Response
  try {
    response = await fetch(receiptsUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Không thể kết nối tới Delify Router API.' })
  }

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: `Delify API trả lỗi HTTP ${response.status}.` })
  }

  const data = await response.json() as {
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
      meta: JSON.stringify({
        action: 'delify-pricing-and-logs-sync',
        upserted,
        skipped,
        syncedLogs,
        totalFromApi: models.length,
      }),
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
    const keyUrl = `https://router.delify.vn/api/usage/key?key=${encodeURIComponent(apiKey)}`
    const keyResp = await fetch(keyUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (keyResp.ok) {
      delifyUsage = (await keyResp.json()) as DelifyKeyResponse
    }
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
