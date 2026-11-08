import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../../utils/permissions'
import { validateBanValue } from '../../../../../../utils/ip-ban'
import { announceToLiveViewers } from '../../../../../../services/moderated-content'
import { findModerationQueueItem, resolveModerationQueueItemWithAudit } from '../../../../../../services/admin-ai-moderation-queue'

const VALID_ACTIONS = new Set(['approve', 'reject_delete', 'ban_ip'])

/**
 * Resolve one row of the AI moderation queue: approve (show again the comment or livestream message
 * that this row's automatic hide still hides — `restore` in the answer says what happened, see
 * `moderated-content.ts`), reject (delete the comment; on an approved livestream row the message the
 * approve showed is removed again) or ban the author's address (ban + the same). The row, its target
 * and the audit row change together; live viewers are told after the commit.
 *
 * The transaction — a contested transition (409 for the loser, rolled back), its statement order
 * and lock scope, and the known double-ban case (FINDING-R7-3) — is documented where it now lives:
 * `resolveModerationQueueItemWithAudit` (server/services/admin-ai-moderation-queue.ts).
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

  const queueItem = await findModerationQueueItem(id)

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

  // The target, the conditional status UPDATE (409 when another resolve won) and the audit row,
  // in one transaction (in the service).
  const resolved = await resolveModerationQueueItemWithAudit(adminUser, id, action, queueItem, banValue)
  // Committed: only now tell the people watching the broadcast.
  announceToLiveViewers(resolved.announce)
  return { ok: true, action, id, restore: resolved.restore }
})
