import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModerationQueue } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'read')

  const query = getQuery(event)
  const statusFilter = typeof query.status === 'string' && query.status.trim() ? query.status.trim() : 'pending'

  const db = getDb()
  const rows = await db
    .select()
    .from(aiModerationQueue)
    .where(statusFilter === 'all' ? undefined : eq(aiModerationQueue.status, statusFilter))
    .orderBy(desc(aiModerationQueue.createdAt))
    .limit(50)

  return {
    ok: true,
    count: rows.length,
    items: rows,
  }
})
