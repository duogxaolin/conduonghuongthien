import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { BackupDeleteError, deleteBackup } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  // Xoá bản backup là xoá đường lui — chỉ SuperAdmin.
  requireSuperAdmin(adminUser)

  const filename = getRouterParam(event, 'filename')
  if (!filename) throw createError({ statusCode: 400, statusMessage: 'Thiếu tên file.' })

  // `?id=` — xoá đúng MỘT hàng (trang admin gửi kèm). Kiểm chặt: số nguyên dương, không
  // làm tròn hay kẹp — một id sai mà bị "sửa" thành id khác là xoá nhầm bản backup.
  const rawId = getQuery(event).id
  let rowId: number | undefined
  if (rawId !== undefined) {
    const text = String(rawId)
    if (!/^[1-9]\d{0,14}$/.test(text)) throw createError({ statusCode: 400, statusMessage: 'Mã bản backup không hợp lệ.' })
    rowId = Number(text)
  }

  try {
    await deleteBackup(filename, adminUser.id ?? null, rowId)
    return { ok: true }
  } catch (err) {
    const statusCode = err instanceof BackupDeleteError ? err.statusCode : 500
    throw createError({ statusCode, statusMessage: err instanceof Error ? err.message : String(err) })
  }
})
