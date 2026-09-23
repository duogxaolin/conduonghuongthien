import { eq, sum, count } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiUsageLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'

const ALLOWED_PERIODS = new Set(['1h', '24h', '7d', '30d', 'all'])

/**
 * Fetch real-time status, budget, and receipts breakdown from Delify Router API.
 * Calls:
 * 1. https://router.delify.vn/api/usage/key?key=... (key info, total budget, used, remaining)
 * 2. https://router.delify.vn/api/usage/key/receipts?key=...&period=... (breakdown by period)
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const query = getQuery(event)
  const rawPeriod = typeof query.period === 'string' ? query.period.trim().toLowerCase() : '7d'
  const period = ALLOWED_PERIODS.has(rawPeriod) ? rawPeriod : '7d'

  const db = getDb()

  // 1. Find Delify provider
  const [delifyProvider] = await db.select().from(aiProviders)
    .where(eq(aiProviders.provider, 'delify'))
    .limit(1)

  if (!delifyProvider) {
    return { ok: false, configured: false, error: 'Chưa tạo nhà cung cấp Delify Router.' }
  }

  if (!delifyProvider.apiKeyCiphertext || !delifyProvider.apiKeyNonce || !delifyProvider.apiKeyAuthTag || !delifyProvider.apiKeyVersion || !delifyProvider.apiKeyKeyId) {
    return { ok: false, configured: false, error: 'Chưa cấu hình API key cho Delify Router.' }
  }

  // 2. Decrypt key
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
    return { ok: false, configured: true, error: 'Không thể giải mã API key.' }
  }

  // 3. Query Delify Key endpoint and Receipts endpoint in parallel
  const encodedKey = encodeURIComponent(apiKey)
  const keyUrl = `https://router.delify.vn/api/usage/key?key=${encodedKey}`
  const receiptsUrl = `https://router.delify.vn/api/usage/key/receipts?key=${encodedKey}&period=${period}&page=1&pageSize=20`

  interface DelifyKeyData {
    name?: string
    active?: boolean
    groupId?: string
    groupName?: string
    allowedModels?: string[]
    rpm?: number | null
    tpm?: number | null
    budgetUsd?: number | null
    windowStartedAt?: string | null
    windowCostUsd?: number | null
    windowRequests?: number | null
    remainingBudgetUsd?: number | null
    resetAt?: string | null
    expiresAt?: string | null
  }

  interface DelifyReceiptsData {
    period?: string
    summary?: {
      items?: Array<{
        model: string
        input: number
        output: number
        cacheRead?: number
        requests: number
        cost: number
      }>
      totals?: {
        input: number
        output: number
        cacheRead?: number
        requests: number
        cost: number
      }
      peakTpm?: number
      peakRpm?: number
      peakTokS?: number
    }
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
    availableModels?: Array<{
      name: string
      input: number
      output: number
      cached?: number
    }>
  }

  let keyData: DelifyKeyData | null = null
  let receiptsData: DelifyReceiptsData | null = null
  let fetchError: string | null = null

  try {
    const [keyResp, receiptsResp] = await Promise.all([
      fetch(keyUrl, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000) }),
      fetch(receiptsUrl, { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000) }),
    ])

    if (keyResp.ok) {
      keyData = (await keyResp.json()) as DelifyKeyData
    } else {
      fetchError = `Key API trả HTTP ${keyResp.status}`
    }

    if (receiptsResp.ok) {
      receiptsData = (await receiptsResp.json()) as DelifyReceiptsData
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lỗi kết nối'
    fetchError = `Không thể kết nối tới Delify API: ${msg}`
  }

  if (!keyData) {
    return { ok: false, configured: true, error: fetchError ?? 'Không nhận được dữ liệu từ Delify Router.' }
  }
  // 1. Chỉ lấy API ngân sách được cấp thôi:
  const budgetUsd = keyData.budgetUsd != null ? Number(keyData.budgetUsd) : null
  const budgetVnd = budgetUsd != null ? budgetUsd * 25500 : null

  // 2. Tiền hiện tại đã dùng: lấy từ dữ liệu hiện tại (ai_usage_logs trong CSDL)
  const [localUsage] = await db
    .select({
      totalCostUsd: sum(aiUsageLogs.costUsd),
      totalCostVnd: sum(aiUsageLogs.costVnd),
      totalRequests: count(aiUsageLogs.id),
    })
    .from(aiUsageLogs)

  const usedCostUsd = Number(localUsage?.totalCostUsd ?? 0)
  const usedCostVnd = Number(localUsage?.totalCostVnd ?? 0)
  const totalRequests = Number(localUsage?.totalRequests ?? 0)

  // 3. Tiền còn lại: lấy ngân sách được cấp rồi trừ đi tiền đã dùng của dữ liệu hiện tại
  const remainingBudgetUsd = budgetUsd != null ? Math.max(0, budgetUsd - usedCostUsd) : null
  const remainingBudgetVnd = budgetVnd != null ? Math.max(0, budgetVnd - usedCostVnd) : null

  return {
    ok: true,
    configured: true,
    keyInfo: {
      name: keyData.name ?? 'Delify Key',
      groupName: keyData.groupName ?? 'Default',
      active: keyData.active ?? false,
      budgetUsd,
      budgetVnd,
      usedCostUsd,
      usedCostVnd,
      remainingBudgetUsd,
      remainingBudgetVnd,
      totalRequests,
      allowedModels: keyData.allowedModels ?? [],
      rpm: keyData.rpm ?? null,
      windowStartedAt: keyData.windowStartedAt ?? null,
    },
    period,
    periodSummary: receiptsData?.summary ?? null,
    recentHistory: (receiptsData?.history ?? []).slice(0, 10),
    availableModels: receiptsData?.availableModels ?? [],
  }
})
