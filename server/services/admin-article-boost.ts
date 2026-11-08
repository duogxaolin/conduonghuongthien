/**
 * `GET /api/admin/articles/:id/stats` and `DELETE /api/admin/articles/:id/boost` — their database
 * statements, moved out of the handlers verbatim (2026-11-08: no `server/api` file calls getDb() itself).
 * `POST …/:id/boost` (boost.post.ts) is not here: it stays as it is (named exception of the move).
 *
 * The handlers keep the article lookup's scope (`articleActionScope` throws 403 itself), the 404s,
 * `requireResourcePermission(…, 'update' | 'read')` and `getArticleViewStats` between the two stats
 * queries. Only `article-views.ts` writes view counts or totals; nothing here does.
 *
 * Imports are deliberately few: `tests/article-stats-boost-existence-oracle.test.ts` replaces `h3`
 * with five names (`createError` among them) and `services/article-views` with three.
 */
import { createError } from 'h3'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, articles, articleViewBoost } from '../db/schema'
import { readAffectedRows } from '../utils/affected-rows'

/** stats.get: article `id`, if it is inside `scope` (`articleActionScope(…, 'read')`). */
export async function findArticleForStats(id: number, scope: SQL) {
  const db = getDb()
  const [article] = await db
    .select({ id: articles.id, type: articles.type, title: articles.title })
    .from(articles)
    .where(and(eq(articles.id, id), scope))
    .limit(1)
  return article
}

/** stats.get: the running inflation job of the article, if any. */
export async function findRunningBoostForStats(articleId: number) {
  const db = getDb()
  // Only `running`. A completed or cancelled job is already reflected in the
  // fabricated total; surfacing it again would read as a second, pending one.
  const [boost] = await db
    .select({
      id:              articleViewBoost.id,
      totalAmount:     articleViewBoost.totalAmount,
      appliedAmount:   articleViewBoost.appliedAmount,
      durationMinutes: articleViewBoost.durationMinutes,
      startedAt:       articleViewBoost.startedAt,
      endsAt:          articleViewBoost.endsAt,
    })
    .from(articleViewBoost)
    .where(and(eq(articleViewBoost.articleId, articleId), eq(articleViewBoost.status, 'running')))
    .orderBy(desc(articleViewBoost.id))
    .limit(1)
  return boost
}

/** boost.delete: article `id`, if it is inside `scope` (`articleActionScope(…, ['read', 'update'])`). */
export async function findArticleForBoostCancel(id: number, scope: SQL) {
  const db = getDb()
  const [article] = await db
    .select({ id: articles.id, type: articles.type, title: articles.title })
    .from(articles)
    .where(and(eq(articles.id, id), scope))
    .limit(1)
  return article
}

/** boost.delete: the running job to cancel, if any. */
export async function findRunningBoostForCancel(articleId: number) {
  const db = getDb()
  const [running] = await db
    .select({
      id: articleViewBoost.id,
      totalAmount: articleViewBoost.totalAmount,
      appliedAmount: articleViewBoost.appliedAmount,
      durationMinutes: articleViewBoost.durationMinutes,
    })
    .from(articleViewBoost)
    .where(and(eq(articleViewBoost.articleId, articleId), eq(articleViewBoost.status, 'running')))
    .orderBy(desc(articleViewBoost.id))
    .limit(1)
  return running
}

/**
 * Cancel job `running` of `article` and write its audit row, in one transaction; 409 (rolled back,
 * nothing recorded) when the scheduler completed the job first.
 */
export async function cancelBoostWithAudit(
  actorId: number,
  article: NonNullable<Awaited<ReturnType<typeof findArticleForBoostCancel>>>,
  running: NonNullable<Awaited<ReturnType<typeof findRunningBoostForCancel>>>,
) {
  const db = getDb()

  // The cancellation and its audit row commit together. Already-delivered views
  // are deliberately kept (see the header of boost.delete.ts), so this row is the only
  // record that the job was stopped early rather than running to completion — an audit
  // trail that has to stay reconcilable cannot afford to lose exactly that.
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
      userId: actorId,
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
}
