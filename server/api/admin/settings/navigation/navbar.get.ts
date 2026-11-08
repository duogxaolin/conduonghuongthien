import { requireResourcePermission } from '../../../../utils/permissions'
import { readNavbarMenuRows } from '../../../../services/admin-settings-navigation'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  // Navbar-specific key first, the shared nav_menu only when it is absent (in the service).
  const { navbarRow, fallbackRow } = await readNavbarMenuRows()

  const raw = navbarRow[0]?.value ?? fallbackRow?.[0]?.value ?? null
  let menu = null
  if (raw) {
    try { menu = JSON.parse(raw) } catch { /* ignore */ }
  }

  return { ok: true, menu }
})
