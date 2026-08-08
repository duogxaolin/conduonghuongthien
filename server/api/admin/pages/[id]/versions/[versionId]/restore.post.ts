import { getDb } from '../../../../../../utils/db'
import { pages, pageVersions, activityLogs } from '../../../../../../db/schema'
import { normalizeBlocks } from '../../../../../../utils/page-versions'
import { and, eq } from 'drizzle-orm'
import { requireResourcePermission } from '../../../../../../utils/permissions'

// Restore a version INTO THE DRAFT (not live). The editor previews it; the user
// must Publish to make it live. This keeps restore non-destructive.
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'pages', 'update')

  const pageId = Number(getRouterParam(event, 'id'))
  const versionId = Number(getRouterParam(event, 'versionId'))
  if (!pageId || !versionId) throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })

  const db = getDb()
  const [version] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)))
    .limit(1)
  if (!version) throw createError({ statusCode: 404, statusMessage: 'Phiên bản không tồn tại.' })

  const blocks = normalizeBlocks(version.blocks)

  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.update(pages).set({
      draftBlocks: blocks,
      draftUpdatedAt: new Date(),
      draftUpdatedBy: adminUser.id,
    }).where(eq(pages.id, pageId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'pages',
      meta: { pageId, action: 'restore', versionId, kind: version.kind },
    })
  })

  return { ok: true, blocks }
})
