import { getDb } from '../utils/db'
import { logWarn, SECURITY_EVENTS } from '../utils/logger'
import { users, roles, permissions } from '../db/schema'
import { verifyToken } from '../utils/auth'
import { eq } from 'drizzle-orm'

// Server middleware: bảo vệ tất cả /api/admin/** routes
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event).pathname

  // Chỉ kiểm tra route /api/admin/** và bỏ qua login endpoint
  if (!url.startsWith('/api/admin/')) return
  if (url === '/api/admin/auth/login') return

  // Đọc JWT từ httpOnly cookie
  const token = getCookie(event, 'cdkt_admin')
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: No token' })
  }

  const payload = verifyToken(token)
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Invalid token' })
  }

  // Load user + role + permissions từ DB
  const db = getDb()
  const [user] = await db
    .select({
      id:       users.id,
      username: users.username,
      isActive: users.isActive,
      roleId:   users.roleId,
      roleName: roles.name,
      isSystem: roles.isSystem,
      tokenVersion: users.tokenVersion,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, payload.userId))
    .limit(1)

  if (!user || !user.isActive) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: User inactive or not found' })
  }

  // Reject sessions minted before the user's last logout / password change.
  // Tokens issued before this field existed carry no version and are treated as
  // generation 0, matching the column default.
  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
    logWarn({ event: SECURITY_EVENTS.sessionRevoked, userId: payload.userId, username: payload.username })
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized: Session revoked' })
  }

  const userPermissions = await db
    .select()
    .from(permissions)
    .where(eq(permissions.roleId, user.roleId!))

  // Attach vào event context
  event.context.adminUser = {
    ...user,
    permissions: userPermissions,
    isSuperAdmin: user.isSystem === true,
  }
})
