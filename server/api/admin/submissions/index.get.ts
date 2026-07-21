import { getDb } from '../../../utils/db'
import { submissions } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'submissions', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(submissions)
    .orderBy(desc(submissions.createdAt))

  return { ok: true, submissions: rows }
})
