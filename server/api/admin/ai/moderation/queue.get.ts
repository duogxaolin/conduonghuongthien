import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { aiModerationQueue, readerIpBans } from '../../../../db/schema'
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
  const bans = await db.select({ value: readerIpBans.value }).from(readerIpBans)
  const bannedSet = new Set(bans.map(b => b.value))

  const items = rows.map(r => ({
    ...r,
    isIpBanned: Boolean(r.authorIp && bannedSet.has(r.authorIp)),
  }))

  return {
    ok: true,
    count: items.length,
    items,
  }
})
