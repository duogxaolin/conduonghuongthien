/**
 * `GET /api/admin/articles/:id/stats`, `POST /api/admin/articles/:id/boost` and `DELETE …/:id/boost` —
 * their database statements, moved out of the handlers verbatim (2026-11-08: no `server/api` file calls
 * getDb() itself).
 *
 * The handlers keep the article lookup's scope (`articleActionScope` throws 403 itself), the 404s,
 * `requireResourcePermission(…, 'update' | 'read')`, `validateBoostInput` (every field validated before
 * anything is written), the job's `startedAt`/`endsAt`, and `getArticleViewStats` between the two stats
 * queries. Only `article-views.ts` writes view counts or totals: the instant boost below delivers through
 * its `addFabricatedViews`, handed this transaction as the executor; nothing here writes them itself.
 *
 * Imports are deliberately few: `tests/article-stats-boost-existence-oracle.test.ts` replaces `h3`
 * with five names (`createError` among them) and `services/article-views` with three
 * (`addFabricatedViews` among them).
 */
import { createError } from 'h3'
import { and, desc, eq, type SQL } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, articles, articleViewBoost } from '../db/schema'
import { readAffectedRows } from '../utils/affected-rows'
import { addFabricatedViews } from './article-views'

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

/** boost.post: article `id`, if it is inside `scope` (`articleActionScope(…, ['read', 'update'])`). */
export async function findArticleForBoostStart(id: number, scope: SQL) {
  const db = getDb()
  const [article] = await db
    .select({ id: articles.id, type: articles.type, title: articles.title })
    .from(articles)
    .where(and(eq(articles.id, id), scope))
    .limit(1)
  return article
}

/**
 * boost.post, `instant`: deliver `input.amount` fabricated views to `article` and write the audit
 * row, in one transaction.
 */
export async function startInstantBoostWithAudit(
  actorId: number,
  article: NonNullable<Awaited<ReturnType<typeof findArticleForBoostStart>>>,
  input: { mode: 'instant', amount: number },
) {
  const db = getDb()
  // The fabricated total and its audit row commit together: an inflation
  // nobody can trace back to a person is the one thing this feature must not
  // produce, and a fabricated count is not something a rollback can "mostly"
  // undo — the row either carries the amount someone authorised, or it does
  // not exist at all.
  await db.transaction(async (tx) => {
    await addFabricatedViews({ articleId: article.id, amount: input.amount, executor: tx })
    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'boost',
      resource: 'articles',
      resourceId: article.id,
      meta: { mode: input.mode, amount: input.amount, minutes: null, title: article.title },
    })
  })
}

/**
 * boost.post, `gradual`: schedule a job of `input.amount` views over `input.minutes` and write its
 * audit row, in one transaction; 409 (rolled back, nothing recorded) when the article already has a
 * running job. Returns the new job's id.
 */
export async function startGradualBoostWithAudit(
  actorId: number,
  article: NonNullable<Awaited<ReturnType<typeof findArticleForBoostStart>>>,
  input: { mode: 'gradual', amount: number, minutes: number },
  startedAt: Date,
  endsAt: Date,
) {
  const db = getDb()

  // The scheduled job and its audit row commit together. The id is RETURNED from
  // the transaction rather than read from a variable declared inside it: `const
  // boostId = await db.transaction(...)` leaves `boostId` in its temporal dead
  // zone for the whole callback, so referencing it in there throws at runtime —
  // the defect that made every article-create call return 500 (see CLAUDE.md).
  const boostId = await db.transaction(async (tx) => {
    // One running job per article. Two overlapping schedules would both compute
    // their own share of elapsed time and the operator would have no single figure
    // to read progress from — the second request is refused rather than merged,
    // because merging would change an amount the first operator authorised.
    // Checked HERE, under the article row's lock: two requests for one article queue
    // on the lock and the second sees the first one's job. Read before the
    // transaction, both saw none and both inserted (FINDING-R6-14).
    await tx.select({ id: articles.id }).from(articles).where(eq(articles.id, article.id)).for('update')
    const [running] = await tx
      .select({ id: articleViewBoost.id })
      .from(articleViewBoost)
      .where(and(eq(articleViewBoost.articleId, article.id), eq(articleViewBoost.status, 'running')))
      .limit(1)
    if (running) {
      throw createError({ statusCode: 409, statusMessage: 'Bài viết đang có một lượt tăng dần chạy dở. Vui lòng huỷ lượt đó trước.' })
    }

    const [inserted] = await tx.insert(articleViewBoost).values({
      articleId: article.id,
      totalAmount: input.amount,
      appliedAmount: 0,
      durationMinutes: input.minutes,
      startedAt,
      endsAt,
      status: 'running',
      createdBy: actorId,
    })

    await tx.insert(activityLogs).values({
      userId: actorId,
      action: 'boost',
      resource: 'articles',
      resourceId: article.id,
      meta: { mode: input.mode, amount: input.amount, minutes: input.minutes, title: article.title },
    })

    // Destructured above, not read off the un-destructured result: `db.insert()`
    // resolves to an ARRAY, and `result.insertId` on it is silently `undefined`.
    return Number(inserted.insertId)
  })

  return boostId
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
