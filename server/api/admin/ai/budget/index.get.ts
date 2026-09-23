import { eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiBudgetSettings } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Get AI budget settings (spec R9.1).
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const db = getDb()

  // Ensure the row exists (seed creates it, but init may run before seed)
  const [row] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)

  if (!row) {
    // Create default row if missing
    await db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 })
      .onDuplicateKeyUpdate({ set: { id: 1 } })
    const [created] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)
    return { ok: true, budget: created ?? { id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80, updatedBy: null, updatedAt: null } }
  }

  return { ok: true, budget: row }
})
