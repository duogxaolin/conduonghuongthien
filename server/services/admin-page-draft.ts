/**
 * Saving or clearing a page's unpublished working copy (`PUT /api/admin/pages/:id/draft`) —
 * its two writes, moved out of the handler verbatim (2026-11-08: no `server/api` file calls
 * getDb() itself). The handler keeps the page lookup's 404, reading the body and
 * `normalizeBlocks` (link policy: an unsafe link is a 400 naming the field, before anything is
 * written; rich text sanitised before it is stored).
 *
 * As before the move, NOT in a transaction with the handler's existence read and NOT audited:
 * each request issues exactly one UPDATE (clear or save) after `findPageById`. A page deleted
 * between that read and the UPDATE makes the UPDATE match no row and the request still answers
 * 200 — nothing half-written, but nothing written either. Left as it was (a pure move); noted
 * for the owner, not changed here. Neither path touches `page_blocks` (live).
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { pages } from '../db/schema'
import type { BlockNode } from '../../shared/blocks/types'

/** No blocks array in the body → clear the draft (revert to live). */
export async function clearPageDraft(pageId: number) {
  const db = getDb()
  await db.update(pages).set({ draftBlocks: null, draftUpdatedAt: null, draftUpdatedBy: null }).where(eq(pages.id, pageId))
}

/** Store the normalised blocks as the page's draft. */
export async function savePageDraft(pageId: number, blocks: BlockNode[], adminUser: { id: number }) {
  const db = getDb()
  await db.update(pages).set({
    draftBlocks: blocks,
    draftUpdatedAt: new Date(),
    draftUpdatedBy: adminUser.id,
  }).where(eq(pages.id, pageId))
}
