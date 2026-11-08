/**
 * The AI moderation queue in the admin panel (`GET /api/admin/ai/moderation/queue`,
 * `POST /api/admin/ai/moderation/queue/:id/resolve`) — their queries, moved out of the handlers
 * verbatim. The permission checks, the input parsing, the 400/404 decided before anything is
 * written (the ban address included — `validateBanValue`), the response shaping and
 * `announceToLiveViewers` after the commit stay in the handlers.
 */
import { createError } from 'h3'
import { and, count, desc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { aiModerationQueue, articleComments, readerIpBans, activityLogs } from '../db/schema'
import { readAffectedRows } from '../utils/affected-rows'
import {
  restoreAutoHidden,
  withdrawLivestreamMessage,
  type LivestreamAnnouncement,
  type RestoreOutcome,
} from './moderated-content'

/** One page of the queue (`statusFilter` 'all' = every status), its total, and the banned addresses. */
export async function readModerationQueuePage(statusFilter: string, perPage: number, offset: number) {
  const db = getDb()
  const whereClause = statusFilter === 'all' ? undefined : eq(aiModerationQueue.status, statusFilter)

  // Đếm tổng trước khi áp LIMIT/OFFSET — tổng là số trang, không phải số hàng
  // trên trang này. Đếm sau khi slice thì totalPages luôn = 1.
  const [totalRow] = await db
    .select({ total: count() })
    .from(aiModerationQueue)
    .where(whereClause ?? undefined)

  const rows = await db
    .select()
    .from(aiModerationQueue)
    .where(whereClause ?? undefined)
    .orderBy(desc(aiModerationQueue.createdAt))
    .limit(perPage)
    .offset(offset)
  const bans = await db.select({ value: readerIpBans.value }).from(readerIpBans)
  return { totalRow, rows, bans }
}

/** The queue row with this id; undefined if absent. */
export async function findModerationQueueItem(id: number) {
  const db = getDb()
  const [queueItem] = await db
    .select()
    .from(aiModerationQueue)
    .where(eq(aiModerationQueue.id, id))
    .limit(1)
  return queueItem
}

/**
 * Resolve the row: its target, its new status and the audit row change together.
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
export async function resolveModerationQueueItemWithAudit(
  adminUser: { id?: number | null },
  id: number,
  action: string,
  queueItem: NonNullable<Awaited<ReturnType<typeof findModerationQueueItem>>>,
  banValue: string | null,
) {
  const db = getDb()
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

  return resolved
}
