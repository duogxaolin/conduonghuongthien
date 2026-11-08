import { requireResourcePermission } from '../../../../utils/permissions'
import { readMobileMenuRow } from '../../../../services/admin-settings-navigation'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  // Bottom-nav config has its own shape — no fallback to nav_menu (different structure)
  const row = await readMobileMenuRow()
  const raw = row[0]?.value ?? null

  let menu = null
  if (raw) {
    try { menu = JSON.parse(raw) } catch { /* ignore */ }
  }

  return { ok: true, menu }
})
