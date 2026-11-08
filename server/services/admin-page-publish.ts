/**
 * Publishing a page (`POST /api/admin/pages/:id/publish`) — its transaction, moved out of the
 * handler verbatim (2026-11-08: no `server/api` file calls getDb() itself): snapshot the CURRENT
 * live state as an 'auto' version (ring buffer), write the new live state (tree JSON or the flat
 * `page_blocks` upsert), audit — one commit. The handler keeps the page lookup's 404, reading the
 * body, `normalizeBlocks` of the incoming tree (an unsafe link is a 400 naming the field, before
 * anything is written), the tree/flat decision, the public page cache purge after the commit and
 * the final read of the flat rows (`listPageBlockRows`, after the purge).
 */
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { pageBlocks, pages, pageVersions, activityLogs } from '../db/schema'
import { normalizeBlocks, VERSION_LIMITS } from '../utils/page-versions'
import type { BlockNode } from '../../shared/blocks/types'

/**
 * Snapshot the live state of page `pageId` (`page.publishedBlocks`, read by the handler before
 * the body), then publish `nextBlocks` — as the tree when `isTree`, else through the flat rows —
 * and write the audit row, all in one transaction.
 */
export async function publishPageWithAudit(
  adminUser: { id: number },
  pageId: number,
  page: { publishedBlocks: BlockNode[] | null },
  nextBlocks: BlockNode[],
  isTree: boolean,
) {
  const db = getDb()
  await db.transaction(async (tx) => {
    // 1. Snapshot the CURRENT live state as an 'auto' version (ring buffer).
    // Live state is the tree in published_blocks when present, else flat page_blocks.
    const prevTree = page.publishedBlocks
    const current = await tx
      .select()
      .from(pageBlocks)
      .where(eq(pageBlocks.pageId, pageId))
      .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

    let snapshot: BlockNode[] | null = null
    if (Array.isArray(prevTree) && prevTree.length) {
      // `links: 'keep'`: a snapshot of what is live, as it is. A legacy unsafe
      // link in the OLD tree must not 400 the publish that replaces it.
      snapshot = normalizeBlocks(prevTree, { links: 'keep' })
    } else if (current.length) {
      snapshot = current.map((b) => ({
        blockType: b.blockType,
        displayOrder: b.displayOrder,
        data: b.data ?? {},
        isVisible: b.isVisible !== false,
      }))
    }

    if (snapshot && snapshot.length) {
      await tx.insert(pageVersions).values({
        pageId,
        kind: 'auto',
        label: null,
        blocks: snapshot,
        createdBy: adminUser.id,
      })
      // Trim to the newest N auto versions.
      const autos = await tx
        .select({ id: pageVersions.id })
        .from(pageVersions)
        .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'auto')))
        .orderBy(asc(pageVersions.id))
      const excess = autos.length - VERSION_LIMITS.auto
      for (const stale of autos.slice(0, excess)) {
        await tx.delete(pageVersions).where(eq(pageVersions.id, stale.id))
      }
    }

    if (isTree) {
      // 2a. Tree publish: write the whole normalized tree as JSON. Leave the
      // flat page_blocks rows untouched (they remain the rollback fallback).
      await tx.update(pages).set({
        publishedBlocks: nextBlocks,
        draftBlocks: null,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
      }).where(eq(pages.id, pageId))
    } else {
      // 2b. Flat publish: upsert into page_blocks keeping ids stable, and clear
      // published_blocks so the public read falls back to the flat path.
      const existingIds = new Set(current.map((b) => Number(b.id)))
      const keepIds = new Set<number>()

      for (const b of nextBlocks) {
        const numericId = typeof b.id === 'number' ? b.id : Number(b.id)
        const isExisting = Number.isFinite(numericId) && existingIds.has(numericId)
        if (isExisting) {
          keepIds.add(numericId)
          await tx.update(pageBlocks).set({
            blockType: b.blockType,
            displayOrder: b.displayOrder,
            data: b.data,
            isVisible: b.isVisible,
            updatedBy: adminUser.id,
          }).where(and(eq(pageBlocks.id, numericId), eq(pageBlocks.pageId, pageId)))
        } else {
          const [res] = await tx.insert(pageBlocks).values({
            pageId,
            blockType: b.blockType,
            displayOrder: b.displayOrder,
            data: b.data,
            isVisible: b.isVisible,
            updatedBy: adminUser.id,
          })
          keepIds.add(Number(res.insertId))
        }
      }

      // Delete published blocks no longer present in the draft.
      for (const id of existingIds) {
        if (!keepIds.has(id)) {
          await tx.delete(pageBlocks).where(eq(pageBlocks.id, id))
        }
      }

      // Clear the draft AND any prior tree — published == live via the flat path.
      await tx.update(pages).set({
        publishedBlocks: null,
        draftBlocks: null,
        draftUpdatedAt: null,
        draftUpdatedBy: null,
      }).where(eq(pages.id, pageId))
    }

    // 3. Audit trên `tx`, cùng commit với lượt xuất bản.
    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'pages',
      meta: { pageId, action: 'publish', blockCount: nextBlocks.length, tree: isTree },
    })
  })
}
