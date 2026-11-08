/**
 * The general settings form (`PUT /api/admin/settings`) — its write, moved out of the handler
 * verbatim. The handler keeps the permission check, the body shape check, the read of the
 * current values, the credential-retarget rule (decided on the whole body before any write) and
 * every cache clear and purge after the commit.
 *
 * The allowlists and the per-key loop live here because the loop runs INSIDE the transaction:
 * a key outside the allowlist, a value too long, a secret that cannot be sealed or a
 * SuperAdmin-only key changed by someone else throws mid-loop and rolls back the keys written
 * before it (see `saveGeneralSettingsWithAudit`).
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { settings, activityLogs } from '../db/schema'
import { FAVICON_ICO_SETTING_KEY } from '../utils/favicon-setting'
import { isSettingsSecretKey, sealSettingsSecret, SettingsSecretError } from '../utils/settings-secrets'
import { MASKED_SECRET } from '../../shared/settings-credential-rules'

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
  'logo_url', 'main_logo_url', 'hero_banner_url', 'favicon_url', 'og_image_url',
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

/**
 * Write the submitted keys and their audit row. `current` is the table as read before the
 * transaction (by the handler, for the retarget rule): it tells "unchanged" from "modified" for
 * the gated keys and for `favicon_url`. Answers the keys applied, in body order.
 */
export async function saveGeneralSettingsWithAudit(
  adminUser: { id: number, isSuperAdmin?: boolean },
  newSettings: Record<string, unknown>,
  current: Map<string, string>,
): Promise<string[]> {
  const db = getDb()

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
      if ((key === 'r2_secret_key' || key === 'smtp_pass') && value === MASKED_SECRET) continue

      const typed = value === null || value === undefined ? '' : String(value)
      if (typed.length > MAX_VALUE_LENGTH) {
        throw createError({ statusCode: 400, statusMessage: `Giá trị cài đặt "${key}" quá dài.` })
      }
      // `smtp_pass` / `r2_secret_key` chỉ được lưu dạng envelope (spec
      // settings-secret-storage): rỗng = xoá, còn lại mã hoá. Thiếu khoá vật liệu thì
      // TỪ CHỐI lưu — không bao giờ rơi về lưu nguyên văn.
      let strValue = typed
      if (isSettingsSecretKey(key) && typed !== '') {
        try {
          strValue = sealSettingsSecret(key, typed)
        } catch (err: unknown) {
          if (!(err instanceof SettingsSecretError)) throw err
          throw createError({ statusCode: 500, statusMessage: 'Máy chủ chưa có khoá mã hoá (CHATBOT_ENCRYPTION_SECRET) nên không lưu được mật khẩu/khoá bí mật.' })
        }
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

  return applied
}
