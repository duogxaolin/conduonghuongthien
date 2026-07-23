import { getDb } from '../../../utils/db'
import { pages, pageBlocks } from '../../../db/schema'
import { and, eq, asc } from 'drizzle-orm'

// Public, unauthenticated, read-only. Returns only VISIBLE blocks sorted by order.
// Unknown slug → { ok: false } with 2xx (never a 500) so the page can degrade gracefully.
export default defineEventHandler(async (event) => {
  const slug = String(getRouterParam(event, 'slug') || '').trim()
  if (!slug) return { ok: false }

  try {
    const db = getDb()
    const [page] = await db.select().from(pages).where(eq(pages.slug, slug)).limit(1)
    if (!page) return { ok: false }

    const blocks = await db
      .select({
        id: pageBlocks.id,
        blockType: pageBlocks.blockType,
        displayOrder: pageBlocks.displayOrder,
        data: pageBlocks.data,
      })
      .from(pageBlocks)
      .where(and(eq(pageBlocks.pageId, page.id), eq(pageBlocks.isVisible, true)))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

    return {
      ok: true,
      page: {
        slug: page.slug,
        title: page.title,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
      },
      blocks,
    }
  } catch (err) {
    console.error('[public/pages] error:', err)
    return { ok: false }
  }
})
