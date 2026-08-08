import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const db = getDb()
  const allSettings = await db.select().from(settings)

  const settingsMap: Record<string, string | null> = {}
  for (const s of allSettings) {
    // Mask sensitive keys for safety unless superadmin
    if (s.key === 'r2_secret_key' && s.value && !adminUser.isSuperAdmin) {
      settingsMap[s.key] = '********'
    } else if (s.key === 'smtp_pass' && s.value) {
      // SMTP password is always masked on read (mirrors r2_secret_key); the
      // real value never leaves the server. Write-side skips the mask token.
      settingsMap[s.key] = '********'
    } else {
      settingsMap[s.key] = s.value
    }
  }

  return { ok: true, settings: settingsMap }
})
