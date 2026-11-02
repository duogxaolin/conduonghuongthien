import { getDb } from '../../../utils/db'
import { roles, permissions, activityLogs } from '../../../db/schema'
import { assertAssignablePermissions, requireResourcePermission } from '../../../utils/permissions'
import { driverMessage, isDuplicateEntry } from '../../../utils/mysql-errors'
import { logError } from '../../../utils/logger'

/** `roles.name VARCHAR(64)` / `roles.description VARCHAR(255)` — utf8mb4 counts code points. */
const NAME_MAX = 64
const DESCRIPTION_MAX = 255

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'roles', 'create')

  const body = await readBody(event).catch(() => ({}))
  const name = String(body?.name || '').trim()
  const description = String(body?.description || '').trim() || null
  const permsInput = assertAssignablePermissions(adminUser, body?.permissions === undefined ? [] : body.permissions)

  if (!name || name.length < 2) {
    throw createError({ statusCode: 400, statusMessage: 'Tên vai trò phải từ 2 ký tự trở lên.' })
  }
  // Checked here, not left to MySQL: an over-long value used to end as an unhandled
  // 500 whose message is Drizzle's "Failed query: <SQL> params: …".
  if ([...name].length > NAME_MAX) {
    throw createError({ statusCode: 400, statusMessage: `Tên vai trò tối đa ${NAME_MAX} ký tự.` })
  }
  if (description && [...description].length > DESCRIPTION_MAX) {
    throw createError({ statusCode: 400, statusMessage: `Mô tả vai trò tối đa ${DESCRIPTION_MAX} ký tự.` })
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
  try {
    const newRoleId = await db.transaction(async (tx) => {
      const [res] = await tx.insert(roles).values({
        name,
        description,
        isSystem: false,
      })

      const created = res.insertId

      if (permsInput.length > 0) {
        // Reject invalid resources and block granting permissions the actor lacks.
        const permValues = permsInput.map(p => ({ ...p, roleId: created }))
        await tx.insert(permissions).values(permValues)
      }

      await tx.insert(activityLogs).values({
        userId: adminUser.id,
        action: 'create',
        resource: 'roles',
        resourceId: created,
        meta: { name },
      })

      return created
    })

    return { ok: true, id: newRoleId }
  } catch (err: unknown) {
    // `roles.name` is UNIQUE under a case-insensitive collation: MySQL is the one that
    // knows "Biên tập" and "biên tập" collide, so its answer is read rather than guessed
    // with a lookup first (which a concurrent create would race anyway). Down the
    // `cause` chain — Drizzle wraps the driver's error (`mysql-errors.ts`).
    if (isDuplicateEntry(err)) {
      throw createError({ statusCode: 400, statusMessage: 'Tên vai trò đã tồn tại. Vui lòng chọn tên khác.' })
    }
    // Never the error's own message ("Failed query: <SQL> params: …"); the driver's goes to the log.
    logError({ event: 'admin_roles.create_failed', error: driverMessage(err) })
    throw createError({ statusCode: 500, statusMessage: 'Lỗi hệ thống' })
  }
})
