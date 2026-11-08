/**
 * Moderation rules in the admin panel (`server/api/admin/ai/moderation/rules*`) — their queries,
 * moved out of the handlers verbatim. The permission checks, the input checks (category, severity,
 * action, rule type, `checkModerationPattern`), the 400/404 before anything is written and
 * `invalidateModerationRulesCache()` after the commit stay in the handlers. Each write and its
 * audit row commit in one transaction, here.
 */
import { createError } from 'h3'
import { desc, asc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiModerationRules, activityLogs } from '../db/schema'
import { readAffectedRows } from '../utils/affected-rows'

type Actor = { id?: number | null }

/** Every rule, grouped by category, newest first within one. */
export async function listModerationRules() {
  const db = getDb()
  const rules = await db
    .select()
    .from(aiModerationRules)
    .orderBy(asc(aiModerationRules.category), desc(aiModerationRules.id))
  return rules
}

/** The rule with this id; undefined if absent. */
export async function findModerationRuleById(id: number) {
  const db = getDb()
  const [existing] = await db.select().from(aiModerationRules).where(eq(aiModerationRules.id, id)).limit(1)
  return existing
}

/** Insert the rule and its audit row together; the new id. */
export async function createModerationRuleWithAudit(
  adminUser: Actor,
  rule: { category: string, pattern: string, severity: string, action: string, ruleType: string, isEnabled: boolean },
) {
  const { category, pattern, severity, action, ruleType, isEnabled } = rule
  const db = getDb()

  const newId = await db.transaction(async (tx) => {
    const [insertRes] = await tx.insert(aiModerationRules).values({
      category,
      pattern,
      severity,
      action,
      ruleType,
      isEnabled,
      createdBy: adminUser.id ?? null,
    })

    const id = Number(insertRes?.insertId ?? 0)

    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'create',
      resource: 'ai',
      resourceId: id,
      meta: { type: 'create_moderation_rule', category, pattern, action },
    })

    return id
  })

  return newId
}

/** Apply `patch` to rule `id` and write its audit row together. */
export async function updateModerationRuleWithAudit(adminUser: Actor, id: number, patch: Partial<typeof aiModerationRules.$inferInsert>) {
  const db = getDb()
  await db.transaction(async (tx) => {
    await tx.update(aiModerationRules).set(patch).where(eq(aiModerationRules.id, id))
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: id,
      meta: { type: 'update_moderation_rule', changedFields: Object.keys(patch) },
    })
  })
}

/** Delete rule `id` and write its audit row together; 404 (rolled back) when it is already gone. */
export async function deleteModerationRuleWithAudit(adminUser: Actor, id: number, existing: { pattern: string }) {
  const db = getDb()
  await db.transaction(async (tx) => {
    // Counted: a rule another officer deleted since the handler's read is a 404 with no second
    // "delete" audit row (FINDING-R7-12, the R6-10 rule).
    const [deleted] = await tx.delete(aiModerationRules).where(eq(aiModerationRules.id, id))
    if (readAffectedRows(deleted) !== 1) {
      throw createError({ statusCode: 404, statusMessage: 'Quy tắc không tồn tại.' })
    }
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'ai',
      resourceId: id,
      meta: { type: 'delete_moderation_rule', pattern: existing.pattern },
    })
  })
}
