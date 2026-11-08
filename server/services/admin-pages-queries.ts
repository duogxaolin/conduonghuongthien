/**
 * The page builder's admin reads (`/api/admin/pages/**`) — their queries, moved out of the
 * handlers verbatim (2026-11-08: no `server/api` file calls getDb() itself). The 400/404s,
 * reading the body, `normalizeBlocks` and shaping the responses stay in the handlers.
 *
 * Deliberately not in `services/pages.ts`: `tests/public-page-cache-write-paths.test.ts`
 * replaces that module with one name (`deletePageById`), and the handlers of `[id].put.ts` /
 * `publish.post.ts` it loads would fail to import any other.
 */
import { asc, eq, sql } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { pages, pageBlocks } from '../db/schema'
import { uniquePageSlug } from '../utils/slug'

/** index.get: every page (custom pages first, by id), and the flat block count of each page that has blocks. */
export async function listPagesWithBlockCounts() {
  const db = getDb()

  const all = await db.select().from(pages).orderBy(asc(pages.isSystem), asc(pages.id))

  // Block counts per page
  const counts = await db
    .select({ pageId: pageBlocks.pageId, count: sql<number>`count(*)` })
    .from(pageBlocks)
    .groupBy(pageBlocks.pageId)
  return { all, counts }
}

/** The page row with this id, if any. */
export async function findPageById(id: number) {
  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, id)).limit(1)
  return page
}

/** The flat `page_blocks` rows of a page (the legacy live state), in display order. */
export async function listPageBlockRows(pageId: number) {
  const db = getDb()
  const rows = await db
    .select()
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, pageId))
    .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))
  return rows
}

/** `uniquePageSlug` on the pool: `base` slugified, suffixed until no other page (`excludeId` aside) holds it. */
export async function pickUniquePageSlug(base: string, excludeId?: number) {
  const db = getDb()
  return uniquePageSlug(db, base, excludeId)
}
