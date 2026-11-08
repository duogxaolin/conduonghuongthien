/**
 * A page's saved versions (`/api/admin/pages/:id/versions/**`): listing them, saving a manual
 * backup or the origin baseline, deleting one, restoring one into the draft — their statements,
 * moved out of the handlers verbatim (2026-11-08: no `server/api` file calls getDb() itself).
 * Each write and its audit row stay in one transaction. The handlers keep the id checks, the
 * page / version lookups' 404s, the "origin cannot be deleted" 400, reading the body and
 * `normalizeBlocks` (link policy: an unsafe link is a 400 naming the field, before anything is
 * written). The manual-backup cap is checked INSIDE the transaction (a 400 thrown there rolls it
 * back), so it moved here with it.
 */
import { createError } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { pages, pageVersions, activityLogs } from '../db/schema'
import { VERSION_LIMITS } from '../utils/page-versions'
import type { BlockNode } from '../../shared/blocks/types'

/** versions/index.get: the versions of a page, newest first (blocks JSON included — the handler reduces it to a count). */
export async function listPageVersionsMeta(pageId: number) {
  const db = getDb()
  const versions = await db
    .select({
      id: pageVersions.id,
      kind: pageVersions.kind,
      label: pageVersions.label,
      createdAt: pageVersions.createdAt,
      createdBy: pageVersions.createdBy,
      blockCount: pageVersions.blocks,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.id))
  return versions
}

/** Version `versionId` of page `pageId`, if it exists (a version of another page does not). */
export async function findPageVersion(pageId: number, versionId: number) {
  const db = getDb()
  const [version] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)))
    .limit(1)
  return version
}

/**
 * versions/index.post: save `cleanBlocks` as a 'manual' backup (max 4 — a 400 when full) or as
 * the page's 'origin' baseline (replaces the previous origin), with its audit row.
 */
export async function savePageVersionWithAudit(
  adminUser: { id: number },
  pageId: number,
  kind: 'manual' | 'origin',
  label: string | null,
  cleanBlocks: Omit<BlockNode, 'id'>[],
) {
  const db = getDb()
  /**
   * One commit for the write and its audit line — and, on the origin path, for
   * the delete-then-insert pair as well.
   *
   * The origin branch is the one with a real data-loss window rather than just
   * an audit-loss one: it removes the existing baseline and then writes its
   * replacement. Unwrapped, a failure between those two statements leaves the
   * page with NO origin at all — the baseline an editor would reach for to undo
   * a bad edit is simply gone, and the audit line that would have explained it
   * never ran either.
   *
   * Everything runs on `tx`, not `db`: a `db.insert()` inside a transaction
   * block still commits independently on the pool, which is the same bug wearing
   * a transaction's clothes.
   */
  await db.transaction(async (tx) => {
    if (kind === 'manual') {
      /**
       * Counted inside the transaction, not before it. Read on the pool first,
       * two editors saving a backup at the same moment both see three and both
       * insert, landing five rows under a cap of four.
       */
      const existing = await tx
        .select({ id: pageVersions.id })
        .from(pageVersions)
        .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'manual')))
      if (existing.length >= VERSION_LIMITS.manual) {
        throw createError({ statusCode: 400, statusMessage: `Đã đạt tối đa ${VERSION_LIMITS.manual} bản sao lưu. Vui lòng xóa bớt trước khi lưu mới.` })
      }
      await tx.insert(pageVersions).values({ pageId, kind: 'manual', label, blocks: cleanBlocks, createdBy: adminUser.id })
    } else {
      // origin: replace any previous origin (keep exactly 1).
      await tx.delete(pageVersions).where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.kind, 'origin')))
      await tx.insert(pageVersions).values({ pageId, kind: 'origin', label: label || 'Bản gốc', blocks: cleanBlocks, createdBy: adminUser.id })
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'create',
      resource: 'pages',
      meta: { pageId, action: 'version', kind },
    })
  })
}

/** versions/[versionId].delete: delete a (non-origin) version and write its audit row together. */
export async function deletePageVersionWithAudit(adminUser: { id: number }, pageId: number, versionId: number, existing: { kind: string }) {
  const db = getDb()
  /**
   * The version and its audit line commit together, or neither does. A saved
   * backup vanishing with no record of who discarded it defeats the purpose of
   * keeping versions at all. Runs on `tx`, not `db`: a `db.insert()` inside a
   * transaction block still commits independently on the pool.
   */
  await db.transaction(async (tx) => {
    await tx.delete(pageVersions).where(eq(pageVersions.id, versionId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'delete',
      resource: 'pages',
      meta: { pageId, versionId, kind: existing.kind },
    })
  })
}

/** versions/[versionId]/restore.post: write the normalised version INTO THE DRAFT (not live) and its audit row together. */
export async function restorePageVersionWithAudit(adminUser: { id: number }, pageId: number, versionId: number, version: { kind: string }, blocks: BlockNode[]) {
  const db = getDb()
  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.update(pages).set({
      draftBlocks: blocks,
      draftUpdatedAt: new Date(),
      draftUpdatedBy: adminUser.id,
    }).where(eq(pages.id, pageId))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'pages',
      meta: { pageId, action: 'restore', versionId, kind: version.kind },
    })
  })
}
