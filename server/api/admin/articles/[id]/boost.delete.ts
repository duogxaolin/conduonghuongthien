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
import { articleResource } from '../../../../services/articles'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
  }

  const db = getDb()
  const [article] = await db
    .select({ id: articles.id, type: articles.type, title: articles.title })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1)
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  const actor = event.context.adminUser
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

  // Guarded on `status = 'running'` so a scheduler pass landing in the same
  // moment cannot have its own completion overwritten by this cancellation.
  await db
    .update(articleViewBoost)
    .set({ status: 'cancelled' })
    .where(and(eq(articleViewBoost.id, running.id), eq(articleViewBoost.status, 'running')))

  await db.insert(activityLogs).values({
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

  return { ok: true, cancelled: { id: running.id, appliedAmount: running.appliedAmount, totalAmount: running.totalAmount } }
})
