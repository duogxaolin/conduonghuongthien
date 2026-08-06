import { getDb } from '../../../utils/db'
import { roles, permissions, activityLogs } from '../../../db/schema'
import { assertAssignablePermissions, requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const description = String(body?.description || '').trim() || null
  const permsInput = Array.isArray(body?.permissions) ? body.permissions : []

  if (!name || name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Tên vai trò phải từ 2 ký tự trở lên.' })
  }

  const db = getDb()

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  const newRoleId = await db.transaction(async (tx) => {
    const [res] = await tx.insert(roles).values({
      name,
      description,
      isSystem: false,
    })

    const created = res.insertId

    if (permsInput.length > 0) {
      // Reject invalid resources and block granting permissions the actor lacks.
      assertAssignablePermissions(adminUser, permsInput)
      const permValues = (permsInput as Array<Record<string, unknown>>).map(p => ({
        roleId: newRoleId,
        resource: String(p.resource),
        canCreate: Boolean(p.canCreate),
        canRead: Boolean(p.canRead),
        canUpdate: Boolean(p.canUpdate),
        canDelete: Boolean(p.canDelete),
      }))
      await tx.insert(permissions).values(permValues)
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'roles',
      resourceId: newRoleId,
      meta: { name },
    })

    return created
  })

  return { ok: true, id: newRoleId }
})
