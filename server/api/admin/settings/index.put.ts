import { eq } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { settings, activityLogs } from '../../../db/schema'
import { requireResourcePermission } from '../../../utils/permissions'
import { FAVICON_ICO_SETTING_KEY, clearFaviconSettingCache } from '../../../utils/favicon-setting'

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

      /**
       * Đổi `favicon_url` bằng tay thì bản `.ico` dẫn xuất phải mất theo.
       *
       * `favicon_ico_url` là bản `.ico` sinh ra từ ảnh **trước đó**. Để nó nằm lại
       * thì tuyến `/favicon.ico` phục vụ icon cũ trong khi thẻ `<link>` phục vụ
       * icon mới — hai địa chỉ của cùng một cổng trả về hai logo khác nhau, và
       * trình duyệt đệm favicon rất lâu nên tình trạng đó rất dai. Xoá đi thì
       * tuyến kia lùi về bộ mặc định: kém hơn một bản `.ico` khớp, nhưng nó **nhất
       * quán**, và đó là điều đáng giữ hơn.
       *
       * Nằm trong cùng transaction với lượt ghi trên: viết rời thì một lỗi ở giữa
       * để lại đúng trạng thái lệch mà nó ra đời để ngăn.
       */
      if (key === 'favicon_url' && (current.get(key) ?? '') !== strValue) {
        await tx.delete(settings).where(eq(settings.key, FAVICON_ICO_SETTING_KEY))
      }
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: { keysUpdated: applied },
    })
  })

  /**
   * Bỏ bộ đệm favicon SAU khi commit, không phải trong transaction.
   *
   * Trong transaction thì một lượt rollback để lại bộ đệm đã bị xoá cho một giá trị
   * chưa bao giờ được ghi — lần đọc kế tiếp truy vấn lại và lấy đúng giá trị cũ,
   * nên hậu quả chỉ là một lượt truy vấn dư. Nhưng thứ tự này vẫn là thứ tự đúng, và
   * lý do đáng ghi: trạng thái ngoài CSDL không tham gia được vào tính nguyên tử của
   * CSDL, nên nó phải đợi kết quả thay vì đoán trước.
   *
   * Không có lời gọi này thì cán bộ lưu xong, tải lại trang, và thấy icon cũ tới 30
   * giây. Trang cài đặt đã phải cảnh báo rằng **trình duyệt** đệm favicon rất lâu;
   * thêm một lớp đệm phía máy chủ vào đúng lúc đó là làm lời cảnh báo kia thành vô
   * ích — cán bộ không phân biệt được hai nguyên nhân, và cả hai đều đọc ra là
   * "không lưu được".
   */
  if (applied.includes('favicon_url')) clearFaviconSettingCache()

  return { ok: true }
})
