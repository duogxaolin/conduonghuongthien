import { createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../../../utils/db'
import {
  aiModerationQueue,
  articleComments,
  readerIpBans,
  activityLogs,
} from '../../../../../../db/schema'
import { requireResourcePermission } from '../../../../../../utils/permissions'
import { readAffectedRows } from '../../../../../../utils/affected-rows'
import { validateBanValue } from '../../../../../../utils/ip-ban'
import {
  announceToLiveViewers,
  restoreAutoHidden,
  withdrawLivestreamMessage,
  type LivestreamAnnouncement,
  type RestoreOutcome,
} from '../../../../../../services/moderated-content'

const VALID_ACTIONS = new Set(['approve', 'reject_delete', 'ban_ip'])

/**
 * Resolve one row of the AI moderation queue: approve (show again the comment or livestream message
 * that this row's automatic hide still hides — `restore` in the answer says what happened, see
 * `moderated-content.ts`), reject (delete the comment; on an approved livestream row the message the
 * approve showed is removed again) or ban the author's address (ban + the same). The row, its target
 * and the audit row change together; live viewers are told after the commit.
 *
 * A contested transition (CLAUDE.md "Chuyển trạng thái có cạnh tranh"): the status read before
 * the transaction is only a guess. The queue UPDATE inside it is conditional on that status and
 * counted; a request that loses to another resolve of the same row (0 rows) is a 409 and its
 * transaction — the comment it unhid or deleted, the ban it inserted — rolls back with it
 * (FINDING-R7-1). The order is the base's — the target first, then the queue UPDATE (which gained
 * its `status = ?`), then the audit row — and nothing reads under a lock (slice R6 lesson): the
 * target is read with a plain read and changed only by a conditional UPDATE on its primary key.
 * The comment path locks a subset of what the base locked (the base UPDATEd the comment on every
 * approve — a deleted one's missing id took the X lock on the supremum, stalling every new comment
 * until the commit; now only when this row's mark still hides it). A livestream message is the one
 * row this adds (restore, or removal again after an approve) — X,REC_NOT_GAP on its PRIMARY key, no
 * gap lock. MySQL 8 (`mysql-restore-locks.sh` in the change's proof): a new message in the same
 * broadcast, an officer removing another message, the automatic hide of another message, another
 * row's approve and a new comment wait 0.01 s, as on the base; only the same message waits.
 *
 * KNOWN, kept as the base has it (FINDING-R7-3): two bans of one address at once — the second
 * INSERT hits the unique key, ER_DUP_ENTRY is a 500 and its whole resolve rolls back; clicking
 * again goes through (the read then finds the ban). Catching the 1062 and going on was tried in
 * slice R7 and reverted: the failed INSERT's locks (X on the PK supremum, S next-key on the
 * duplicate `value`) then lived until commit and stalled bans of unrelated addresses (verifier,
 * performance_schema.data_locks). Any change here is a lock-design change — its own change.
 */
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

  // A ban is validated before anything is written, like the ban list's own form (design D11):
  // `authorIp` is whatever the client-IP resolver produced — `unknown` when it had nothing — and a
  // stored value that matches nobody (or every visitor whose address could not be read) is a ban
  // the officer believes is in force. With no usable address there is nothing to ban: 400, no
  // row deleted, no "Đã cấm IP" on the queue (FINDING-R7-2).
  let banValue: string | null = null
  if (action === 'ban_ip') {
    const verdict = queueItem.authorIp ? validateBanValue(queueItem.authorIp) : null
    if (!verdict?.ok) {
      throw createError({ statusCode: 400, statusMessage: 'Mục này không có địa chỉ IP hợp lệ để chặn.' })
    }
    banValue = verdict.value
  }

  const now = new Date()
  const nextStatus = action === 'approve' ? 'approved' : action === 'reject_delete' ? 'rejected' : 'banned'

  const resolved = await db.transaction(async (tx) => {
    let restore: RestoreOutcome | null = null
    let announce: LivestreamAnnouncement | null = null
    if (action === 'approve') {
      // Show the content again — only what this row's own automatic hide still hides
      // (moderated-content.ts: not an officer's hide, not a deleted row, not a banned author).
      const shown = await restoreAutoHidden(tx, queueItem)
      restore = shown.outcome
      announce = shown.announce
    } else if (action === 'reject_delete') {
      // Delete target comment
      if (queueItem.targetType === 'comment' && queueItem.targetId) {
        await tx
          .delete(articleComments)
          .where(eq(articleComments.id, queueItem.targetId))
      }
      announce = await withdrawLivestreamMessage(tx, queueItem)
    } else if (action === 'ban_ip') {
      // Ban IP if available
      if (banValue) {
        const [existingBan] = await tx
          .select()
          .from(readerIpBans)
          .where(eq(readerIpBans.value, banValue))
          .limit(1)

        if (!existingBan) {
          await tx.insert(readerIpBans).values({
            value: banValue,
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
      announce = await withdrawLivestreamMessage(tx, queueItem)
    }

    const [header] = await tx
      .update(aiModerationQueue)
      .set({
        status: nextStatus,
        reviewedBy: adminUser.id ?? null,
        reviewedAt: now,
      })
      // The raw stored status, as read — the row must still be in the state this decision was
      // made on (submission-workflow.ts, the same rule).
      .where(and(eq(aiModerationQueue.id, id), eq(aiModerationQueue.status, queueItem.status)))
    const changed = readAffectedRows(header)
    if (changed === null) {
      // Not knowing whether this request won is not a win: roll back rather than log a resolution
      // that may not have happened.
      throw new Error('moderation resolve: could not read affectedRows from the conditional UPDATE')
    }
    if (changed === 0) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Mục đối soát vừa được người khác xử lý. Vui lòng tải lại danh sách.',
      })
    }

    // Audit
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'update',
      resource: 'ai',
      resourceId: id,
      meta: {
        type: 'resolve_moderation_queue',
        action,
        targetType: queueItem.targetType,
        targetId: queueItem.targetId,
        ...(restore === null ? {} : { restore }),
      },
    })
    return { restore, announce }
  })
  // Committed: only now tell the people watching the broadcast.
  announceToLiveViewers(resolved.announce)
  return { ok: true, action, id, restore: resolved.restore }
})
