import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../../../../utils/db'
import {
  aiModerationQueue,
  articleComments,
  readerIpBans,
  activityLogs,
} from '../../../../../../db/schema'
import { requireResourcePermission } from '../../../../../../utils/permissions'

const VALID_ACTIONS = new Set(['approve', 'reject_delete', 'ban_ip'])

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const idParam = getRouterParam(event, 'id')
  const id = Number(idParam)
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'ID không hợp lệ.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const action = String(body?.action || '').trim().toLowerCase()
  if (!VALID_ACTIONS.has(action)) {
    throw createError({ statusCode: 400, statusMessage: 'Thao tác không hợp lệ. Chọn approve, reject_delete hoặc ban_ip.' })
  }

  const db = getDb()
  const [queueItem] = await db
    .select()
    .from(aiModerationQueue)
    .where(eq(aiModerationQueue.id, id))
    .limit(1)

  if (!queueItem) {
    throw createError({ statusCode: 404, statusMessage: 'Mục đối soát không tồn tại.' })
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    if (action === 'approve') {
      // Unhide the comment
      if (queueItem.targetType === 'comment' && queueItem.targetId) {
        await tx
          .update(articleComments)
          .set({ isHidden: false })
          .where(eq(articleComments.id, queueItem.targetId))
      }

      await tx
        .update(aiModerationQueue)
        .set({
          status: 'approved',
          reviewedBy: adminUser.id ?? null,
          reviewedAt: now,
        })
        .where(eq(aiModerationQueue.id, id))
    } else if (action === 'reject_delete') {
      // Delete target comment
      if (queueItem.targetType === 'comment' && queueItem.targetId) {
        await tx
          .delete(articleComments)
          .where(eq(articleComments.id, queueItem.targetId))
      }

      await tx
        .update(aiModerationQueue)
        .set({
          status: 'rejected',
          reviewedBy: adminUser.id ?? null,
          reviewedAt: now,
        })
        .where(eq(aiModerationQueue.id, id))
    } else if (action === 'ban_ip') {
      // Ban IP if available
      if (queueItem.authorIp) {
        const [existingBan] = await tx
          .select()
          .from(readerIpBans)
          .where(eq(readerIpBans.value, queueItem.authorIp))
          .limit(1)

        if (!existingBan) {
          await tx.insert(readerIpBans).values({
            value: queueItem.authorIp,
            reason: `AI An ninh phát hiện vi phạm: ${queueItem.flaggedReason.slice(0, 200)}`,
            createdBy: adminUser.id ?? null,
          })
        }
      }

      // Delete comment
      if (queueItem.targetType === 'comment' && queueItem.targetId) {
        await tx
          .delete(articleComments)
          .where(eq(articleComments.id, queueItem.targetId))
      }

      await tx
        .update(aiModerationQueue)
        .set({
          status: 'banned',
          reviewedBy: adminUser.id ?? null,
          reviewedAt: now,
        })
        .where(eq(aiModerationQueue.id, id))
    }

    // Audit
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: id,
      meta: JSON.stringify({
        type: 'resolve_moderation_queue',
        action,
        targetType: queueItem.targetType,
        targetId: queueItem.targetId,
      }),
    })
  })
  return { ok: true, action, id }
})
