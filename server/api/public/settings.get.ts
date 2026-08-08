import { getDb } from '../../utils/db'
import { settings } from '../../db/schema'

export default defineEventHandler(async () => {
  try {
    const db = getDb()
    const allSettings = await db.select().from(settings)

    const publicSettings: Record<string, string | null> = {}
    const allowedKeys = [
      'site_name', 'site_description', 'hotline', 'email',
      'address', 'facebook_url', 'logo_url', 'hero_banner_url', 'favicon_url',
      'nav_menu', 'nav_menu_navbar', 'nav_menu_mobile'
    ]

    for (const s of allSettings) {
      if (allowedKeys.includes(s.key)) {
        publicSettings[s.key] = s.value
      }
    }

    return { ok: true, settings: publicSettings }
  } catch {
    return { ok: false, settings: {} }
  }
})
