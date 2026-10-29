/**
 * Cancel a running inflation job.
 *
 * Already-delivered views stay. They were authorised when they were applied, and
 * a cancellation that also unwound them would leave the fabricated total lower
 * than the sum of what the audit trail says was applied — the audit trail is the
 * thing that must stay reconcilable.
 */
import { defineEventHandler, getRouterParam, createError } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { activityLogs, articles, articleViewBoost } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { readAffectedRows } from '../../../../utils/affected-rows'
import { articleActionScope, articleResource } from '../../../../services/articles'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
  }

  const db = getDb()
  const actor = event.context.adminUser
  // Scoped to the types the caller may update, as boost.post and stats.get are: an id
  // of a type they may not touch is the same 404 as a missing one. Looked up by id
  // alone, it was 404 vs 403 — an oracle for which ids exist (FINDING-R6-13).
  const [article] = await db
    .select({ id: articles.id, type: articles.type, title: articles.title })
    .from(articles)
    .where(and(eq(articles.id, id), articleActionScope(actor, 'update')))
    .limit(1)
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireResourcePermission(actor, articleResource(article.type), 'update')

  const [running] = await db
    .select({
      id: articleViewBoost.id,
      totalAmount: articleViewBoost.totalAmount,
      appliedAmount: articleViewBoost.appliedAmount,
      durationMinutes: articleViewBoost.durationMinutes,
    })
    .from(articleViewBoost)
    .where(and(eq(articleViewBoost.articleId, article.id), eq(articleViewBoost.status, 'running')))
    .orderBy(desc(articleViewBoost.id))
    .limit(1)
  if (!running) {
    throw createError({ statusCode: 404, statusMessage: 'Bài viết không có lượt tăng dần nào đang chạy.' })
  }

  // The cancellation and its audit row commit together. Already-delivered views
  // are deliberately kept (see the header), so this row is the only record that
  // the job was stopped early rather than running to completion — an audit trail
  // that has to stay reconcilable cannot afford to lose exactly that.
  await db.transaction(async (tx) => {
    // Guarded on `status = 'running'` so a scheduler pass landing in the same
    // moment cannot have its own completion overwritten by this cancellation —
    // and counted: when that pass won, nothing was cancelled, so there is no
    // "cancel" to record and the officer is told so (CLAUDE.md, state transitions
    // under contention). It used to log and answer a cancellation anyway, with the
    // applied amount of a job that had in fact run to the end (FINDING-R6-15).
    const cancelled = await tx
      .update(articleViewBoost)
      .set({ status: 'cancelled' })
      .where(and(eq(articleViewBoost.id, running.id), eq(articleViewBoost.status, 'running')))
    if (readAffectedRows(cancelled) !== 1) {
      throw createError({ statusCode: 409, statusMessage: 'Lượt tăng dần vừa kết thúc trước khi kịp huỷ. Vui lòng tải lại để xem số đã giao.' })
    }

    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'boost',
      resource: 'articles',
      resourceId: article.id,
      // Same shape as the creation entry, so the two read as one story: the amount
      // authorised, the amount that actually landed, and the mode it ran in.
      meta: {
        mode: 'cancel',
        amount: running.totalAmount,
        minutes: running.durationMinutes,
        appliedAmount: running.appliedAmount,
        title: article.title,
      },
    })
  })

  return { ok: true, cancelled: { id: running.id, appliedAmount: running.appliedAmount, totalAmount: running.totalAmount } }
})
