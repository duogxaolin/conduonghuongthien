import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'
import { DelifyUsageError, fetchDelifyUsage } from '../../../../utils/ai/delify-usage'
import { logInfo } from '../../../../utils/logger'
import { findDelifyProvider, syncDelifyPricingWithAudit } from '../../../../services/admin-ai-delify'

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

  // 1. Find the Delify provider
  const delifyProvider = await findDelifyProvider()

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

  // Every item is parsed by `storableModel` (admin-ai-delify.ts) before use.
  const models = (response.data as { availableModels?: unknown }).availableModels
  if (!Array.isArray(models) || models.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy danh sách model từ Delify API.' })
  }

  // Pricing rows and the audit row in one transaction; each item checked before it is written
  // (`storableModel`, in the service).
  const { upserted, skipped } = await syncDelifyPricingWithAudit(adminUser, delifyProvider, models)

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
