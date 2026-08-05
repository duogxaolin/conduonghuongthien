/**
 * Article deletion and status changes, shared by the single-row and bulk routes.
 *
 * The guard that matters here is per-row and easy to miss: an article's delete
 * permission depends on its TYPE, so a lot containing a news item and a legal
 * document needs two different grants. A bulk endpoint that checked permission
 * once up front would let an editor who may only touch `news` delete documents.
 * Keeping the check inside the per-row function makes that impossible.
 */
import { createError } from 'h3'
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, articles } from '../db/schema'
import { requireResourcePermission, type ActorLike } from '../utils/permissions'

/** Article type → RBAC resource. Unknown types fall back to the strictest sane default. */
const TYPE_RESOURCE: Record<string, string> = {
  news: 'news',
  role_model: 'role_models',
  reintegration: 'reintegration',
  document: 'documents',
  faq: 'faq',
}

export function articleResource(type: string | null | undefined): string {
  return TYPE_RESOURCE[type ?? ''] || 'news'
}

export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const
export type ArticleStatus = typeof ARTICLE_STATUSES[number]

function requireArticlePermission(actor: ActorLike, type: string | null | undefined, action: 'update' | 'delete') {
  requireResourcePermission(actor, articleResource(type), action)
}

/**
 * Delete one article, checking the type-specific permission first.
 *
 * One activity log per article, exactly as the single-row route has always
 * written: switching to a bulk action must not thin out the audit trail.
 */
export async function deleteArticleById(actor: ActorLike, id: number): Promise<void> {
  const db = getDb()
  const [existing] = await db.select().from(articles).where(eq(articles.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireArticlePermission(actor, existing.type, 'delete')

  await db.delete(articles).where(eq(articles.id, id))
  await db.insert(activityLogs).values({
    userId: actor.id,
    action: 'delete',
    resource: 'articles',
    resourceId: id,
    meta: { title: existing.title },
  })
}

/**
 * Move one article to a status. Hiding an article is a status change to
 * `archived`, which is what the public read path already filters on — no new
 * column, and no chance of a "hidden" article staying visible.
 *
 * `publishedAt` is stamped on first publish only, matching [id].put.ts.
 */
export async function setArticleStatus(actor: ActorLike, id: number, status: ArticleStatus): Promise<void> {
  const db = getDb()
  const [existing] = await db.select().from(articles).where(eq(articles.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireArticlePermission(actor, existing.type, 'update')

  const fields: Record<string, unknown> = { status }
  if (status === 'published' && !existing.publishedAt) fields.publishedAt = new Date()

  await db.update(articles).set(fields).where(eq(articles.id, id))
  await db.insert(activityLogs).values({
    userId: actor.id,
    action: 'update',
    resource: 'articles',
    resourceId: id,
    meta: { fromStatus: existing.status, toStatus: status },
  })
}

/**
 * Open or close the comment thread on one article (design.md D9/D10).
 *
 * Gated by `update` on the article's own type resource — the same grant that
 * already lets this officer edit this article, following the view-boost
 * precedent. No new RBAC resource: deciding whether a piece of content accepts
 * replies is part of editing that content, and a separate permission would have
 * to be granted to every existing role before the toggle worked for anyone.
 *
 * The check is inside this per-row function for the same reason
 * `setArticleStatus`'s is: the bulk route calls it once per article, so an
 * officer holding `news.update` but not `documents.update` gets the news items
 * changed and the documents reported as refused, rather than either a silent
 * success or an all-or-nothing failure.
 *
 * Turning the switch off never deletes anything — the thread stops rendering and
 * stops accepting writes, and administrators keep seeing it in moderation.
 */
export async function setArticleCommentsEnabled(actor: ActorLike, id: number, enabled: boolean): Promise<void> {
  const db = getDb()
  const [existing] = await db.select().from(articles).where(eq(articles.id, id)).limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Bài viết không tồn tại.' })

  requireArticlePermission(actor, existing.type, 'update')

  if (existing.commentsEnabled === enabled) return

  // Toggle and audit row in one transaction. The two neighbouring functions above
  // (deleteArticleById, setArticleStatus) predate this change and still write the
  // pair unwrapped — deliberately left alone rather than widened into unrelated
  // code, but a new write path has no reason to copy that.
  await db.transaction(async (tx) => {
    await tx.update(articles).set({ commentsEnabled: enabled }).where(eq(articles.id, id))
    await tx.insert(activityLogs).values({
      userId: actor.id,
      action: 'update',
      resource: 'articles',
      resourceId: id,
      meta: { commentsEnabled: enabled, title: existing.title },
    })
  })
}
