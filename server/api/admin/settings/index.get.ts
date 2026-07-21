import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'settings', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()
  const allSettings = await db.select().from(settings)

  const settingsMap: Record<string, string | null> = {}
  for (const s of allSettings) {
    // Mask sensitive keys for safety unless superadmin
    if (s.key === 'r2_secret_key' && s.value && !adminUser.isSuperAdmin) {
      settingsMap[s.key] = '********'
    } else {
      settingsMap[s.key] = s.value
    }
  }

  return { ok: true, settings: settingsMap }
})
