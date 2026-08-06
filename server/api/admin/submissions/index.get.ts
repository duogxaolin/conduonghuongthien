import { getDb } from '../../../utils/db'
import { submissions } from '../../../db/schema'
import { desc } from 'drizzle-orm'
import { requireResourcePermission } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'submissions', 'read')

  const db = getDb()
  const rows = await db
    .select()
    .from(submissions)
    .orderBy(desc(submissions.createdAt))

  return { ok: true, submissions: rows }
})
