import { getDb } from '../../../utils/db'
import { settings, activityLogs } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'settings', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const body = await readBody(event).catch(() => ({}))
  const newSettings = body?.settings

  if (!newSettings || typeof newSettings !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cài đặt không hợp lệ.' })
  }

  const db = getDb()

  for (const [key, value] of Object.entries(newSettings)) {
    // If r2_secret_key was masked, don't overwrite with masked string
    if (key === 'r2_secret_key' && value === '********') {
      continue
    }
    // Same masking guard for the SMTP password (mirrors r2_secret_key).
    if (key === 'smtp_pass' && value === '********') {
      continue
    }

    const strValue = value === null || value === undefined ? '' : String(value)
    await db.insert(settings).values({
      key,
      value: strValue,
    }).onDuplicateKeyUpdate({
      set: { value: strValue }
    })
  }

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'settings',
    meta: { keysUpdated: Object.keys(newSettings) },
  })

  return { ok: true }
})
