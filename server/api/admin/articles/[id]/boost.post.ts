/**
 * Administrator-authorised view inflation.
 *
 * Two facts hold on every path through this file, and both are load-bearing:
 *
 *   1. Every field is validated before anything is written. A rejected request
 *      leaves the counts exactly as it found them — a half-applied inflation
 *      followed by a 400 would be unattributable and uncorrectable.
 *   2. The audit row is written on the same path as the change, not after it as
 *      a best-effort call. An inflation nobody can trace back to a person is the
 *      one thing this feature must not produce.
 */
import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../../utils/db'
import { activityLogs, articles, articleViewBoost } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { articleResource } from '../../../../services/articles'
import { addFabricatedViews, validateBoostInput } from '../../../../services/article-views'

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

  const input = validateBoostInput(await readBody(event).catch(() => null))
  if (!input.ok) throw createError({ statusCode: 400, statusMessage: input.message })

  if (input.mode === 'instant') {
    // The fabricated total and its audit row commit together: an inflation
    // nobody can trace back to a person is the one thing this feature must not
    // produce, and a fabricated count is not something a rollback can "mostly"
    // undo — the row either carries the amount someone authorised, or it does
    // not exist at all.
    await db.transaction(async (tx) => {
      await addFabricatedViews({ articleId: article.id, amount: input.amount, executor: tx })
      await tx.insert(activityLogs).values({
        userId: actor.id,
        action: 'boost',
        resource: 'articles',
        resourceId: article.id,
        meta: { mode: input.mode, amount: input.amount, minutes: null, title: article.title },
      })
    })
    return { ok: true, mode: input.mode, amount: input.amount }
  }

  // One running job per article. Two overlapping schedules would both compute
  // their own share of elapsed time and the operator would have no single figure
  // to read progress from — the second request is refused rather than merged,
  // because merging would change an amount the first operator authorised.
  const [running] = await db
    .select({ id: articleViewBoost.id })
    .from(articleViewBoost)
    .where(and(eq(articleViewBoost.articleId, article.id), eq(articleViewBoost.status, 'running')))
    .limit(1)
  if (running) {
    throw createError({ statusCode: 409, statusMessage: 'Bài viết đang có một lượt tăng dần chạy dở. Vui lòng huỷ lượt đó trước.' })
  }

  const startedAt = new Date()
  const endsAt = new Date(startedAt.getTime() + input.minutes * 60_000)

  // The scheduled job and its audit row commit together. The id is RETURNED from
  // the transaction rather than read from a variable declared inside it: `const
  // boostId = await db.transaction(...)` leaves `boostId` in its temporal dead
  // zone for the whole callback, so referencing it in there throws at runtime —
  // the defect that made every article-create call return 500 (see CLAUDE.md).
  const boostId = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(articleViewBoost).values({
      articleId: article.id,
      totalAmount: input.amount,
      appliedAmount: 0,
      durationMinutes: input.minutes,
      startedAt,
      endsAt,
      status: 'running',
      createdBy: actor.id,
    })

    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'boost',
      resource: 'articles',
      resourceId: article.id,
      meta: { mode: input.mode, amount: input.amount, minutes: input.minutes, title: article.title },
    })

    // Destructured above, not read off the un-destructured result: `db.insert()`
    // resolves to an ARRAY, and `result.insertId` on it is silently `undefined`.
    return Number(inserted.insertId)
  })

  return {
    ok: true,
    mode: input.mode,
    amount: input.amount,
    minutes: input.minutes,
    boost: { id: boostId, totalAmount: input.amount, appliedAmount: 0, startedAt, endsAt },
  }
})
