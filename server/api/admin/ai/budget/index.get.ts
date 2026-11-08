import { requireResourcePermission } from '../../../../utils/permissions'
import { readBudgetSettingsCreatingDefault } from '../../../../services/admin-ai-budget'

/**
 * Get AI budget settings (spec R9.1).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  // The row is created with the defaults when missing (in the service).
  const { row, created } = await readBudgetSettingsCreatingDefault()

  if (!row) {
    return { ok: true, budget: created ?? { id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80, updatedBy: null, updatedAt: null } }
  }

  return { ok: true, budget: row }
})
