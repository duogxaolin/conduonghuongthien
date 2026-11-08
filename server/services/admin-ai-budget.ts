/**
 * The AI budget settings in the admin panel (`GET` / `PUT /api/admin/ai/budget`) — their queries,
 * moved out of the handlers verbatim. The permission checks, the input parsing and clamping, the
 * "no change" answer and the response shaping stay in the handlers. The spend check itself
 * (`checkBudget`, utils/ai-budget.ts) is not here: it only reads this row.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiBudgetSettings, activityLogs } from '../db/schema'

type Actor = { id?: number | null }

/**
 * The single budget row (id 1). When it is missing it is created with the defaults and read
 * back: `row` is the row found, `created` the one read back after the insert.
 */
export async function readBudgetSettingsCreatingDefault() {
  const db = getDb()

  // Ensure the row exists (seed creates it, but init may run before seed)
  const [row] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)

  if (!row) {
    // Create default row if missing
    await db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 })
      .onDuplicateKeyUpdate({ set: { id: 1 } })
    const [created] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)
    return { row: undefined, created }
  }

  return { row, created: undefined }
}

/**
 * Apply `patch` to the budget row and write its audit row together. A missing row is first
 * created with the defaults, on the pool, before the transaction (as the handler always did).
 */
export async function updateBudgetSettingsWithAudit(adminUser: Actor, patch: Partial<typeof aiBudgetSettings.$inferInsert>) {
  const db = getDb()

  // Ensure the row exists
  const [existing] = await db.select().from(aiBudgetSettings).where(eq(aiBudgetSettings.id, 1)).limit(1)
  if (!existing) {
    await db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 0, warningThresholdPct: 80 })
  }

  await db.transaction(async (tx) => {
    await tx.update(aiBudgetSettings).set(patch).where(eq(aiBudgetSettings.id, 1))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: 1,
      meta: {
        type: 'budget_update',
        changedFields: Object.keys(patch),
      },
    })
  })
}
