import { inArray } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { MASKED_SECRET } from '../../../../shared/settings-credential-rules'

/**
 * The ONLY keys `GET /api/admin/settings` returns (spec admin-settings-secrets,
 * design D1): the union of what the five pages calling it read —
 * `app/pages/admin/settings/{general,email,media-storage,media-portal,tracking}.vue`
 * — and exactly the keys `index.put.ts` accepts back.
 *
 * An allowlist, not a deny-list. The endpoint used to return every row of
 * `settings` and mask two names; a key added later leaked by default, and one
 * did — `backup_drive_service_account` (the Google service-account JSON with its
 * `private_key`) went to every `settings.read` holder. Backup, retention, video
 * storage and navigation keys have their own endpoints and never come back here.
 *
 * Adding a field to one of those pages means adding its key here (and to the
 * PUT allowlist); `tests/admin-settings-get-masking-behavior.test.ts` reads the
 * pages' source and fails until both agree.
 */
export const SETTINGS_READ_KEYS: readonly string[] = Object.freeze([
  // general.vue
  'site_name', 'site_description', 'hotline', 'email', 'address', 'facebook_url',
  'logo_url', 'main_logo_url', 'hero_banner_url', 'favicon_url', 'og_image_url',
  // media-storage.vue, media-portal.vue ("Dùng R2 của Media Storage")
  'media_provider', 'r2_account_id', 'r2_access_key', 'r2_secret_key', 'r2_bucket', 'r2_public_url',
  // email.vue
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  // tracking.vue
  'tracking_enabled', 'ga4_measurement_id', 'gtm_container_id', 'google_ads_id',
  'google_ads_conversion_label', 'google_site_verification', 'facebook_pixel_id',
  'tiktok_pixel_id', 'clarity_project_id', 'tracking_custom_head', 'tracking_custom_body',
])

/**
 * Stored credentials among the keys above: returned as `MASKED_SECRET` whenever a
 * value is stored, for EVERY role — a SuperAdmin included. Nothing on a page
 * needs to read a saved secret back: the PUT keeps the stored value when it
 * receives the mask, and "gửi thử" / "kiểm tra R2" use the stored value when the
 * field still holds it. An empty value stays empty, because the pages read
 * "no value" as "not configured yet".
 */
const MASKED_KEYS: ReadonlySet<string> = new Set(['r2_secret_key', 'smtp_pass'])

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const db = getDb()
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...SETTINGS_READ_KEYS]))
  const stored = new Map(rows.map(row => [row.key, row.value]))

  // Built FROM the allowlist, not from the rows: the response cannot carry a key
  // the list does not name, whatever the query returned.
  const settingsMap: Record<string, string | null> = {}
  for (const key of SETTINGS_READ_KEYS) {
    if (!stored.has(key)) continue
    const value = stored.get(key) ?? null
    settingsMap[key] = MASKED_KEYS.has(key) && value ? MASKED_SECRET : value
  }

  return { ok: true, settings: settingsMap }
})
