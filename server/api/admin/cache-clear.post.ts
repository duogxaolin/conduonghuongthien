/**
 * Xoá bộ đệm SWR của trang công khai, ngay lập tức.
 *
 * Mọi tuyến công khai chạy `swr: 60` (nuxt.config.ts routeRules): cán bộ sửa
 * nội dung xong, khách vẫn thấy bản cũ tới 60 giây — và trên đúng những trang
 * ấy, "không thấy gì đổi" đọc ra là "không update được". Nút này là đường ra
 * tường minh: bấm là mọi bản cache route (nhóm `nitro/routes`) biến mất, lượt
 * truy cập sau dựng lại từ CSDL.
 *
 * Cách hoạt động: Nitro giữ các entry này trong unstorage dưới namespace
 * `cache:`, mỗi khoá có dạng `cache:nitro/routes:<tên>:<đường>.json`. Ta liệt kê
 * `getKeys('cache:nitro/routes')` rồi `removeItem` từng khoá — KHÔNG xoá cả
 * namespace `cache:` vì các entry `nitro/functions` (nếu sau này có) và các
 * nhóm khác không thuộc đường này. Chỉ có nhóm `nitro/routes` là chứa HTML
 * trang công khai, tức đúng thứ cán bộ muốn làm mới.
 *
 * Ba lớp canh giữ, cùng khuôn với `retention-run.post.ts`:
 *   • POST duy nhất — một lệnh xoá cache không bao giờ đạt được bằng cách bấm
 *     vào một liên kết hay bằng lượt prefetch của trình duyệt.
 *   • `confirm: true` trong thân request — một hành động tường minh, không phải
 *     cú bấm lướt.
 *   • RBAC `settings.update` — làm mới cache là thao tác vận hành cổng, cùng
 *     mức với sửa cấu hình; ai được sửa cài đặt thì được làm mới bộ đệm.
 *
 * Ghi `activity_logs` cùng khuôn: một lượt làm mới cache không truy được về
 * người thực hiện là đúng thứ log vận hành tồn tại để ngăn.
 */
import { getDb } from '../../utils/db'
import { activityLogs } from '../../db/schema'
import { requireResourcePermission } from '../../utils/permissions'

export default defineEventHandler(async (event) => {
  const admin = event.context.adminUser
  if (!admin) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  requireResourcePermission(admin, 'settings', 'update')

  const body = await readBody(event).catch(() => null)
  if (body?.confirm !== true) {
    throw createError({ statusCode: 400, statusMessage: 'Cần xác nhận trước khi xoá cache.' })
  }

  const storage = useStorage('cache')
  const keys = await storage.getKeys('nitro/routes')
  await Promise.all(keys.map(key => storage.removeItem(key)))

  const db = getDb()
  await db.insert(activityLogs).values({
    userId: admin.id,
    action: 'update',
    resource: 'settings',
    meta: {
      trigger: 'manual',
      operation: 'clear_swr_cache',
      clearedKeys: keys.length,
    },
  })

  return { ok: true, cleared: keys.length, message: `Đã xoá ${keys.length} mục cache. Trang công khai sẽ dựng lại từ dữ liệu mới.` }
})
