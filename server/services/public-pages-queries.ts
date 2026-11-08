/**
 * Queries of `GET /api/public/pages/:slug` (`pages/[slug].get.ts`), moved out of the handler
 * verbatim: the page row by slug, then — only for a legacy page whose published tree is empty —
 * its flat visible `page_blocks` rows.
 *
 * The handler keeps everything that decides what leaves the server: which of the two shapes is
 * served, the language overlay, `sanitizeBlockData` on read, `blankUnsafeBlockLinks` (link
 * policy), the removal of every `recipientEmail`, the "unknown slug → `{ ok: false }` 200" rule
 * and `reportPublicReadFailure()` (503 + `no-store`) around both calls.
 */
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { pageBlocks, pages } from '../db/schema'

/** The `pages` row of `slug` (every column — the handler projects it), or undefined. */
export async function findPageBySlug(slug: string) {
  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.slug, slug)).limit(1)
  return page
}

/**
 * The visible `page_blocks` rows of a legacy page (`published_blocks` null or empty), by display
 * order then id.
 *
 * `displayOrder` is read for the ORDER BY but deliberately NOT returned by the handler: no client
 * code reads it (only the admin builder does), and the order it encodes is already carried by
 * the array order.
 */
export async function listVisiblePageBlockRows(pageId: number) {
  const db = getDb()
  const rows = await db
    .select({
      id: pageBlocks.id,
      blockType: pageBlocks.blockType,
      displayOrder: pageBlocks.displayOrder,
      data: pageBlocks.data,
    })
    .from(pageBlocks)
    .where(and(eq(pageBlocks.pageId, pageId), eq(pageBlocks.isVisible, true)))
    .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

  return rows
}
