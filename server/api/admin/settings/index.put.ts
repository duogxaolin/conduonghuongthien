import { requireResourcePermission } from '../../../utils/permissions'
import { clearFaviconSettingCache } from '../../../utils/favicon-setting'
import { clearOgImageSettingCache } from '../../../utils/og-image-setting'
import { TRACKING_KEYS, clearTrackingSettingsCache } from '../../../utils/tracking-settings'
import { purgePublicPageCacheAfterWrite } from '../../../utils/public-page-cache'
import { credentialRetargetViolation } from '../../../utils/settings-credential-guard'
import { readAllSettingValues } from '../../../services/admin-settings-values'
import { saveGeneralSettingsWithAudit } from '../../../services/admin-settings-general'

/**
 * Which keys this endpoint writes (`ALLOWED_SETTING_KEYS`), which of them only a
 * SuperAdmin may change (`SUPERADMIN_ONLY_KEYS`) and the value length cap live with
 * the write in `services/admin-settings-general.ts`: they are checked key by key
 * inside its transaction, so a refused key rolls back the keys written before it.
 */

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const newSettings = body?.settings

  if (!newSettings || typeof newSettings !== 'object' || Array.isArray(newSettings)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu cài đặt không hợp lệ.' })
  }

  // Current values — used to tell "unchanged" from "modified" for gated keys.
  const currentRows = await readAllSettingValues()
  const current = new Map(currentRows.map(row => [row.key, row.value ?? '']))

  // Đổi đích của một bí mật đã lưu (SMTP host/cổng/user/secure, R2 account id)
  // mà không gõ lại bí mật đó → 400. Quyết định trên TOÀN BỘ thân, trước vòng ghi,
  // để thứ tự khoá trong JSON không đổi được kết quả. Xem `settings-credential-guard.ts`.
  const retargetViolation = credentialRetargetViolation(newSettings as Record<string, unknown>, current)
  if (retargetViolation) {
    throw createError({ statusCode: 400, statusMessage: retargetViolation })
  }

  // Every key, its audit row — one transaction (in the service).
  const applied = await saveGeneralSettingsWithAudit(adminUser, newSettings as Record<string, unknown>, current)

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

  // Cùng lý do `clearFaviconSettingCache`: plugin `og-image.ts` đệm 30s, không
  // xoá thì admin lưu xong vẫn thấy og:image cũ tới nửa phút.
  if (applied.includes('og_image_url')) clearOgImageSettingCache()

  // Lớp thứ ba cùng kiểu: mã theo dõi đệm 30 s. Không xoá thì lượt dựng kế tiếp (sau khi xoá đệm `swr` ngay bên
  // dưới) chèn lại đoạn mã CŨ, và `swr` giữ nó thêm 60 s — gỡ một script tự viết vẫn chạy tới ~90 s.
  if (applied.some(key => (TRACKING_KEYS as readonly string[]).includes(key))) clearTrackingSettingsCache()

  // Cùng thứ tự, lớp đệm thứ ba: tên cổng, logo, hotline, địa chỉ… nằm trong HTML đã đệm
  // `swr` của mọi trang công khai (`server/utils/public-page-cache.ts`).
  await purgePublicPageCacheAfterWrite('settings.update')

  return { ok: true }
})
