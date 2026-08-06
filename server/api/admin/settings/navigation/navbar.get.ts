import { getDb } from '../../../../utils/db'
import { settings } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const db = getDb()

  // Try navbar-specific key first, fallback to shared nav_menu
  const navbarRow = await db.select().from(settings).where(eq(settings.key, 'nav_menu_navbar')).limit(1)
  const fallbackRow = navbarRow.length ? null : await db.select().from(settings).where(eq(settings.key, 'nav_menu')).limit(1)

  const raw = navbarRow[0]?.value ?? fallbackRow?.[0]?.value ?? null
  let menu = null
  if (raw) {
    try { menu = JSON.parse(raw) } catch { /* ignore */ }
  }

  return { ok: true, menu }
})
