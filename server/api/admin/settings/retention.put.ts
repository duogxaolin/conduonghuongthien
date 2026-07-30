/**
 * Save the retention policy.
 *
 * Deliberately its own endpoint rather than keys on the general settings form:
 * these values decide what gets deleted, so they carry a stricter validator and
 * their own audit row. `ALLOWED_SETTING_KEYS` in settings/index.put.ts does not
 * list them, so the generic form cannot reach them either.
 *
 * A change is audited with before/after values. "Who shortened the audit-log
 * retention window, and from what" is exactly the question this table has to be
 * able to answer about itself.
 */
import { getDb } from '../../../utils/db'
import { activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import {
  resolveRetentionPolicy,
  saveRetentionPolicy,
  RetentionPolicyValidationError,
} from '../../../services/retention-policy'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'update')

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const before = await resolveRetentionPolicy()

  let keys: string[]
  try {
    keys = await saveRetentionPolicy({
      autoEnabled: body.autoEnabled,
      runHour: body.runHour,
      activityLogDays: body.activityLogDays,
      activityLogMaxRows: body.activityLogMaxRows,
      submissionDays: body.submissionDays,
      submissionMaxRows: body.submissionMaxRows,
    })
  } catch (error) {
    if (error instanceof RetentionPolicyValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }

  const after = await resolveRetentionPolicy()

  const summarise = (policy: typeof before) => ({
    autoEnabled: policy.autoEnabled,
    runHour: policy.runHour,
    scopes: policy.scopes.map(scope => ({ scope: scope.scope, days: scope.days, maxRows: scope.maxRows })),
  })

  const db = getDb()
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'data_retention',
    meta: { keysUpdated: keys, before: summarise(before), after: summarise(after) },
  })

  return { ok: true, policy: after }
})
