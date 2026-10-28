import { eq, sum, count } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiProviders, aiUsageLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { decryptAiSecret } from '../../../../utils/ai/crypto'
import { DelifyUsageError, fetchDelifyUsage, type DelifyUsagePath } from '../../../../utils/ai/delify-usage'
import { checkProviderBaseUrl } from '../../../../utils/ai/provider-url'

const ALLOWED_PERIODS = new Set(['1h', '24h', '7d', '30d', 'all'])

type PlainValue = string | number | boolean | null
const HISTORY_FIELDS = ['timestamp', 'model', 'status', 'cost', 'input', 'output', 'tok', 'tokS']
const SUMMARY_ITEM_FIELDS = ['model', 'input', 'output', 'cacheRead', 'requests', 'cost']
const SUMMARY_TOTAL_FIELDS = ['input', 'output', 'cacheRead', 'requests', 'cost']
const SUMMARY_PEAK_FIELDS = ['peakTpm', 'peakRpm', 'peakTokS']
const MODEL_FIELDS = ['name', 'input', 'output', 'cached']

/**
 * The fields of `value` named in `fields` whose value is plain (string, number,
 * boolean, null); null when `value` is not an object. The receipts answer used to be
 * passed on as it came — anything the router adds (the key it was asked with, a
 * request URL carrying it) reached everyone with `ai.read`. Only what the dashboard
 * shows (`AiDashboardTab.vue`) goes through now.
 */
function plainFields(value: unknown, fields: readonly string[]): Record<string, PlainValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const picked: Record<string, PlainValue> = {}
  for (const field of fields) {
    const item: unknown = Object.hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') picked[field] = item
  }
  return picked
}
const plainList = (value: unknown, fields: readonly string[], max = Infinity) =>
  (Array.isArray(value) ? value.slice(0, max) : []).map(item => plainFields(item, fields)).filter(item => item !== null)

function periodSummary(summary: unknown) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const { items, totals } = summary as { items?: unknown, totals?: unknown }
  const pickedTotals = plainFields(totals, SUMMARY_TOTAL_FIELDS)
  return {
    ...(Array.isArray(items) ? { items: plainList(items, SUMMARY_ITEM_FIELDS) } : {}),
    ...(pickedTotals ? { totals: pickedTotals } : {}),
    ...plainFields(summary, SUMMARY_PEAK_FIELDS),
  }
}

/**
 * Fetch real-time status, budget, and receipts breakdown from Delify Router API, on the
 * delify provider's host, through `fetchDelifyUsage` (outbound.ts — never a bare fetch):
 * 1. /api/usage/key (key info, total budget, used, remaining)
 * 2. /api/usage/key/receipts?period=... (breakdown by period)
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
  const ask = (path: DelifyUsagePath, params?: Record<string, string>) =>
    fetchDelifyUsage({ baseUrl: delifyProvider.baseUrl, secret: apiKey, path, params })

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

  // `summary`, `history`, `availableModels` — read field by field below (`plainFields`).
  interface DelifyReceiptsData {
    summary?: unknown
    history?: unknown
    availableModels?: unknown
  }

  let keyData: DelifyKeyData | null = null
  let receiptsData: DelifyReceiptsData | null = null
  let fetchError: string | null = null

  // Settled separately: the key card needs only the key answer, and a bad receipts
  // answer (down, not JSON) must not take it down — the breakdown is just left empty.
  const [keyResult, receiptsResult] = await Promise.allSettled([
    ask('/api/usage/key'),
    ask('/api/usage/key/receipts', { period, page: '1', pageSize: '20' }),
  ])

  if (keyResult.status === 'rejected') {
    // A fixed sentence (the old one appended the driver's own message).
    fetchError = keyResult.reason instanceof DelifyUsageError ? keyResult.reason.message : 'Không thể kết nối tới Delify Router API.'
  } else if (keyResult.value.data && typeof keyResult.value.data === 'object') {
    keyData = keyResult.value.data as DelifyKeyData
  } else {
    fetchError = `Key API trả HTTP ${keyResult.value.status}`
  }

  if (receiptsResult.status === 'fulfilled' && receiptsResult.value.data && typeof receiptsResult.value.data === 'object') {
    receiptsData = receiptsResult.value.data as DelifyReceiptsData
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
    // The host actually asked (the delify row's base URL) — the dashboard shows it.
    host: ((target) => (target.ok ? target.hostname : null))(checkProviderBaseUrl(delifyProvider.baseUrl)),
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
    periodSummary: periodSummary(receiptsData?.summary),
    recentHistory: plainList(receiptsData?.history, HISTORY_FIELDS, 10),
    availableModels: plainList(receiptsData?.availableModels, MODEL_FIELDS),
  }
})
