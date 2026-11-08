/**
 * Cancel a running inflation job.
 *
 * Already-delivered views stay. They were authorised when they were applied, and
 * a cancellation that also unwound them would leave the fabricated total lower
 * than the sum of what the audit trail says was applied — the audit trail is the
 * thing that must stay reconcilable.
 */
import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireResourcePermission } from '../../../../utils/permissions'
import { articleActionScope, articleResource } from '../../../../services/articles'
import { cancelBoostWithAudit, findArticleForBoostCancel, findRunningBoostForCancel } from '../../../../services/admin-article-boost'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
  }

  const actor = event.context.adminUser
  // Scoped to the types the caller may read OR update (CLAUDE.md's write-path scope, as
  // boost.post): an id of a type they may not touch at all is the same 404 as a missing
  // one. Looked up by id alone, it was 404 vs 403 — an oracle for which ids exist
  // (FINDING-R6-13); a type they can see but not change stays an honest 403 (verifier L2).
  const article = await findArticleForBoostCancel(id, articleActionScope(actor, ['read', 'update']))
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireResourcePermission(actor, articleResource(article.type), 'update')

  const running = await findRunningBoostForCancel(article.id)
  if (!running) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không có lượt tăng dần nào đang chạy.' })
  }

  // The guarded cancellation (409, nothing recorded, when the scheduler completed the job
  // first — FINDING-R6-15) and its audit row, in one transaction (services/admin-article-boost.ts).
  await cancelBoostWithAudit(actor.id, article, running)

  return { ok: true, cancelled: { id: running.id, appliedAmount: running.appliedAmount, totalAmount: running.totalAmount } }
})
