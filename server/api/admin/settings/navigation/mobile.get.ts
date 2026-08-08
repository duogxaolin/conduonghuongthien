import { getDb } from '../../../../utils/db'
import { settings } from '../../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const db = getDb()

  // Bottom-nav config has its own shape — no fallback to nav_menu (different structure)
  const row = await db.select().from(settings).where(eq(settings.key, 'nav_menu_mobile')).limit(1)
  const raw = row[0]?.value ?? null

  let menu = null
  if (raw) {
    try { menu = JSON.parse(raw) } catch { /* ignore */ }
  }

  return { ok: true, menu }
})
