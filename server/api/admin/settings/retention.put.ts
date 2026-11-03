/**
 * Save the retention policy.
 *
 * Deliberately its own endpoint rather than keys on the general settings form:
 * these values decide what gets deleted, so they carry a stricter validator and
 * their own audit row. `ALLOWED_SETTING_KEYS` in settings/index.put.ts does not
 * list them, so the generic form cannot reach them either.
 *
 * A change is audited with before/after values, in the same transaction as the
 * keys themselves — inside `saveRetentionPolicy`. This handler used to save and
 * then write the audit row on the pool, so a failed audit left the changed
 * deletion window in force with nothing recording who changed it (FINDING-R3-1).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import {
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

  try {
    // The body is handed over whole rather than copied field by field. The
    // hand-written copy that used to be here listed ten option names, so a scope
    // added to `RETENTION_SCOPES` would have been accepted by the service,
    // described by `RetentionPolicyInput`, shown on the settings page — and
    // silently dropped by this file, which is the one place nobody would look.
    // `saveRetentionPolicy` reads only the keys it knows and skips `undefined`,
    // so an unknown key in the body is inert rather than trusted.
    const { after } = await saveRetentionPolicy(body, { userId: admin.id })
    return { ok: true, policy: after }
  } catch (error) {
    if (error instanceof RetentionPolicyValidationError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
})
