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
 *      one thing this feature must not produce. Each mode writes its change and
 *      its audit row in one transaction (services/admin-article-boost.ts).
 */
import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireResourcePermission } from '../../../../utils/permissions'
import { articleActionScope, articleResource } from '../../../../services/articles'
import { validateBoostInput } from '../../../../services/article-views'
import { findArticleForBoostStart, startGradualBoostWithAudit, startInstantBoostWithAudit } from '../../../../services/admin-article-boost'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Mã bài viết không hợp lệ.' })
  }

  const actor = event.context.adminUser
  // The lookup is scoped to the types the caller may read OR update — the write-path
  // scope of CLAUDE.md (`['read', <action>]`), as `[id].put.ts`: an id of a type they may
  // not touch at all is the same 404 as a missing one (no existence oracle), a type they
  // can see but not change is an honest 403 below (it was 404 — verifier L2).
  const article = await findArticleForBoostStart(id, articleActionScope(actor, ['read', 'update']))
  if (!article) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireResourcePermission(actor, articleResource(article.type), 'update')

  const input = validateBoostInput(await readBody(event).catch(() => null))
  if (!input.ok) throw createError({ statusCode: 400, statusMessage: input.message })

  if (input.mode === 'instant') {
    // The fabricated total and its audit row commit together (one transaction).
    await startInstantBoostWithAudit(actor.id, article, input)
    return { ok: true, mode: input.mode, amount: input.amount }
  }

  const startedAt = new Date()
  const endsAt = new Date(startedAt.getTime() + input.minutes * 60_000)

  // The scheduled job and its audit row commit together; a running job of this
  // article is a 409 decided inside that transaction, under the article row's lock.
  const boostId = await startGradualBoostWithAudit(actor.id, article, input, startedAt, endsAt)

  return {
    ok: true,
    mode: input.mode,
    amount: input.amount,
    minutes: input.minutes,
    boost: { id: boostId, totalAmount: input.amount, appliedAmount: 0, startedAt, endsAt },
  }
})
