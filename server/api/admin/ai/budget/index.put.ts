import type { aiBudgetSettings } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { updateBudgetSettingsWithAudit } from '../../../../services/admin-ai-budget'

const MAX_BUDGET_VND = Number.MAX_SAFE_INTEGER
const MAX_THRESHOLD = 100
const MIN_THRESHOLD = 1

/**
 * Update AI budget settings (spec R9.2).
 * Requires ai.update permission. Writes activity_logs.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const patch: Partial<typeof aiBudgetSettings.$inferInsert> = {}

  if (typeof body.monthlyBudgetVnd === 'number' && Number.isFinite(body.monthlyBudgetVnd) && body.monthlyBudgetVnd >= 0) {
    patch.monthlyBudgetVnd = Math.min(body.monthlyBudgetVnd, MAX_BUDGET_VND)
  }
  if (typeof body.warningThresholdPct === 'number' && Number.isFinite(body.warningThresholdPct)) {
    patch.warningThresholdPct = Math.max(MIN_THRESHOLD, Math.min(Math.floor(body.warningThresholdPct), MAX_THRESHOLD))
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, message: 'Không có thay đổi.' }
  }

  patch.updatedBy = adminUser.id ?? null

  // The row ensured, then the update and its audit row in one transaction (in the service).
  await updateBudgetSettingsWithAudit(adminUser, patch)

  return { ok: true }
})
