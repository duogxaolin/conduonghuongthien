import { getDb } from '../../../../utils/db'
import { pages, pageBlocks, pageVersions, activityLogs } from '../../../../db/schema'
import { checkPermission } from '../../../../utils/auth'
import { normalizeBlocks, VERSION_LIMITS } from '../../../../utils/page-versions'
import type { BlockNode } from '../../../../../app/utils/blocks/types'
import { and, asc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'pages', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }

  const pageId = Number(getRouterParam(event, 'id'))
  if (!pageId) throw createError({ statusCode: 400, statusMessage: 'Invalid page ID' })

  const db = getDb()
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Trang không tồn tại.' })

  // Prefer explicit body blocks (latest client state); fall back to saved draft.
  const body = await readBody(event).catch(() => ({}))
  const incoming = Array.isArray(body?.blocks) ? body.blocks : page.draftBlocks
  const nextBlocks = normalizeBlocks(incoming)

  // A tree payload = any node carries `children`. Tree pages persist the whole
  // node tree as JSON in pages.published_blocks and skip the flat page_blocks
  // upsert; legacy flat payloads keep the historical page_blocks upsert path.
  const isTree = nextBlocks.some((n) => Array.isArray(n.children))

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
      snapshot = normalizeBlocks(prevTree)
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
          keepIds.add(Number((res as any).insertId))
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
  })

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'pages',
    meta: { pageId, action: 'publish', blockCount: nextBlocks.length, tree: isTree },
  })

  // Return the freshly-published state so the client can re-key.
  // Tree pages return the normalized tree (tmp ids preserved — the builder always
  // reads/writes the whole page); flat pages return the real-id rows.
  if (isTree) {
    return { ok: true, blocks: nextBlocks, tree: true }
  }
  const blocks = await db
    .select()
    .from(pageBlocks)
    .where(eq(pageBlocks.pageId, pageId))
    .orderBy(asc(pageBlocks.displayOrder), asc(pageBlocks.id))

  return { ok: true, blocks, tree: false }
})
