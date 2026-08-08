import { getDb } from '../../../utils/db'
import { settings, activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'

/**
 * Allow-list of settings keys writable through this endpoint. Previously ANY key
 * could be written, which let a delegated `settings:update` role invent keys or
 * overwrite unrelated configuration. Navigation keys (`nav_menu_*`) are managed
 * by their own endpoints and are intentionally NOT writable here.
 */
const ALLOWED_SETTING_KEYS = new Set([
  // General / contact
  'site_name', 'site_description', 'hotline', 'email', 'address', 'facebook_url',
  // `favicon_url` cố ý KHÔNG nằm trong `SUPERADMIN_ONLY_KEYS`: nó đi vào một
  // thuộc tính `href` đã qua `safeFaviconUrl()` (chỉ nhận đường dẫn tương đối
  // hoặc `https://`), nên nó không thực thi được gì — khác `tracking_custom_*`
  // vốn được chèn nguyên văn dưới dạng script.
  'logo_url', 'hero_banner_url', 'favicon_url',
  // Media storage
  'media_provider', 'r2_account_id', 'r2_access_key', 'r2_secret_key', 'r2_bucket', 'r2_public_url',
  // SMTP
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  // Tracking / marketing
  'tracking_enabled', 'ga4_measurement_id', 'gtm_container_id', 'google_ads_id',
  'google_ads_conversion_label', 'google_site_verification', 'facebook_pixel_id',
  'tiktok_pixel_id', 'clarity_project_id', 'tracking_custom_head', 'tracking_custom_body',
])

/**
 * These keys are injected RAW into every public page (see plugins/tracking.ts),
 * i.e. they can execute arbitrary JavaScript for every visitor. Changing them is
 * restricted to the superadmin boundary; a delegated settings editor may still
 * save the tracking form as long as it leaves these two values untouched.
 */
const SUPERADMIN_ONLY_KEYS = new Set(['tracking_custom_head', 'tracking_custom_body'])

const MAX_VALUE_LENGTH = 20_000

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const newSettings = body?.settings

  if (!newSettings || typeof newSettings !== 'object' || Array.isArray(newSettings)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cài đặt không hợp lệ.' })
  }

  const db = getDb()

  // Current values — used to tell "unchanged" from "modified" for gated keys.
  const currentRows = await db.select({ key: settings.key, value: settings.value }).from(settings)
  const current = new Map(currentRows.map(row => [row.key, row.value ?? '']))

  const isSuperAdmin = adminUser.isSuperAdmin === true
  const applied: string[] = []

  /**
   * Cả vòng lặp VÀ dòng audit trong một transaction.
   *
   * Ở đây transaction mua thêm một thứ mà các endpoint khác không cần: vòng lặp
   * có thể `throw` 403 ở giữa chừng (khoá chỉ SuperAdmin sửa được). Viết rời,
   * các khoá xử lý TRƯỚC lúc ném đã ghi xong và nằm lại — một lượt lưu biểu mẫu
   * bị từ chối vẫn đổi được một phần cấu hình, và `applied` trong dòng audit thì
   * không bao giờ được ghi. Bọc lại thì 403 hoàn tác sạch, đúng nghĩa "lượt lưu
   * này đã bị từ chối".
   *
   * Chạy trên `tx`, không phải `db`: một `db.insert()` đặt trong khối
   * transaction vẫn commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(newSettings)) {
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        throw createError({ statusCode: 400, statusMessage: `Khóa cài đặt không hợp lệ: ${key}` })
      }

      // Masked secrets: the UI sends '********' when the field was left untouched.
      if ((key === 'r2_secret_key' || key === 'smtp_pass') && value === '********') continue

      const strValue = value === null || value === undefined ? '' : String(value)
      if (strValue.length > MAX_VALUE_LENGTH) {
        throw createError({ statusCode: 400, statusMessage: `Giá trị cài đặt "${key}" quá dài.` })
      }

      if (SUPERADMIN_ONLY_KEYS.has(key)) {
        const unchanged = (current.get(key) ?? '') === strValue
        if (unchanged) continue // no-op: let non-superadmins save the rest of the form
        if (!isSuperAdmin) {
          throw createError({
            statusCode: 403,
            statusMessage: 'Chỉ SuperAdmin mới được thay đổi mã tuỳ chỉnh (Custom head/body) vì mã này chạy trên toàn bộ trang công khai.',
          })
        }
      }

      await tx.insert(settings).values({ key, value: strValue })
        .onDuplicateKeyUpdate({ set: { value: strValue } })
      applied.push(key)
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: { keysUpdated: applied },
    })
  })

  return { ok: true }
})
