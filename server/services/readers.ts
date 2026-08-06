/**
 * Reader accounts, from the moderation side.
 *
 * Two things this module is responsible for keeping true:
 *
 *   1. **A ban is atomic.** Setting the flag, bumping `tokenVersion` and deleting
 *      the reader's comments happen in one transaction. Half of that is worse
 *      than none: a flag set without the deletion leaves the comments up under a
 *      banned name, and a deletion without the flag removes the record while the
 *      person keeps posting with the ticket already in their browser.
 *   2. **Deletion goes through one path.** Comment removal here calls
 *      `deleteReaderComments` from services/comments.ts rather than issuing its
 *      own DELETE, so ban, account deletion, bulk delete and the retention purge
 *      cannot drift apart on what "remove a reader's comments" means (design.md
 *      D8).
 *
 * Every read in this module is audited by its caller, not by the module: the
 * endpoints know which filters were used, and an audit row that records "someone
 * listed readers" without saying which ones is a row nobody can act on.
 */

import { and, desc, eq, like, or, sql } from 'drizzle-orm'

import { getDb } from '../utils/db'
import { activityLogs, articleComments, articles, readerAccounts, users } from '../db/schema'
import { countReaderCommentImpact, deleteReaderComments, type ReaderCommentImpact } from './comments'
import { effectiveDisplayName } from '../utils/display-name'

/** Server-enforced ceiling. A client-supplied page size is a request. */
export const READER_MAX_PER_PAGE = 100
const READER_DEFAULT_PER_PAGE = 25

// ─── Display name ────────────────────────────────────────────────────────────

/**
 * Re-exported from utils/display-name.ts, which is where the name logic actually
 * lives — this module cannot host it, because services/comments.ts needs the same
 * functions to render names on the public thread and already imports this file.
 *
 * Re-exported rather than moved silently so the existing call sites and
 * tests/reader-profile.test.ts keep one obvious import path.
 */
export {
  DISPLAY_NAME_FALLBACK,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  effectiveDisplayName,
  initialsFrom,
  validateDisplayName,
  type DisplayNameValidation,
} from '../utils/display-name'

export type ReaderBanFilter = 'all' | 'banned' | 'active'

/** Unrecognised values are refused by the endpoint rather than coerced here: a
 *  `?banned=1` silently read as "banned" shows a filtered list while the select
 *  on screen still says "Tất cả". */
export function isReaderBanFilter(value: unknown): value is ReaderBanFilter {
  return value === 'all' || value === 'banned' || value === 'active'
}

export type ReaderListRow = {
  id:           number
  displayName:  string | null
  email:        string | null
  isBanned:     boolean
  banReason:    string | null
  bannedAt:     Date | null
  createdAt:    Date | null
  lastSeenAt:   Date | null
  lastIp:       string | null
  commentCount: number
}

export type ReaderListResult = {
  readers:    ReaderListRow[]
  total:      number
  page:       number
  perPage:    number
  totalPages: number
}

export async function listReaders(params: {
  search:  string
  banned:  ReaderBanFilter
  page:    number
  perPage: number
}): Promise<ReaderListResult> {
  const db = getDb()

  const conditions = []
  if (params.search) {
    const needle = `%${params.search}%`
    // Email is searched but never used as a key (design.md D6) — it is mutable
    // and reassignable, so matching a reader on it would merge two people.
    conditions.push(or(like(readerAccounts.displayName, needle), like(readerAccounts.email, needle)))
  }
  if (params.banned === 'banned') conditions.push(eq(readerAccounts.isBanned, true))
  if (params.banned === 'active') conditions.push(eq(readerAccounts.isBanned, false))

  const where = conditions.length ? and(...conditions) : undefined

  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(readerAccounts)
    .where(where)

  const total = Number(countRow?.total ?? 0)
  const perPage = Math.min(Math.max(1, params.perPage), READER_MAX_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const page = Math.min(Math.max(1, params.page), totalPages)

  const rows = await db
    .select({
      id:          readerAccounts.id,
      displayName: readerAccounts.displayName,
      email:       readerAccounts.email,
      isBanned:    readerAccounts.isBanned,
      banReason:   readerAccounts.banReason,
      bannedAt:    readerAccounts.bannedAt,
      createdAt:   readerAccounts.createdAt,
      lastSeenAt:  readerAccounts.lastSeenAt,
      lastIp:      readerAccounts.lastIp,
      commentCount: sql<number>`(SELECT COUNT(*) FROM \`article_comments\` WHERE \`article_comments\`.\`reader_id\` = \`reader_accounts\`.\`id\`)`,
    })
    .from(readerAccounts)
    .where(where)
    .orderBy(desc(readerAccounts.lastSeenAt))
    .limit(perPage)
    .offset((page - 1) * perPage)

  return {
    readers: rows.map(row => ({ ...row, commentCount: Number(row.commentCount ?? 0) })),
    total,
    page,
    perPage,
    totalPages,
  }
}

export type ReaderCommentRow = {
  id:           number
  body:         string
  createdAt:    Date | null
  parentId:     number | null
  articleId:    number
  articleTitle: string | null
  articleSlug:  string | null
}

export type ReaderDetail = {
  reader: {
    id:           number
    displayName:  string | null
    email:        string | null
    isBanned:     boolean
    banReason:    string | null
    bannedAt:     Date | null
    bannedByName: string | null
    createdAt:    Date | null
    lastSeenAt:   Date | null
    lastIp:       string | null
    lastUserAgent: string | null
  }
  comments: ReaderCommentRow[]
  impact:   ReaderCommentImpact
}

export async function getReaderDetail(readerId: number): Promise<ReaderDetail | null> {
  const db = getDb()

  const [row] = await db
    .select({
      id:            readerAccounts.id,
      displayName:   readerAccounts.displayName,
      email:         readerAccounts.email,
      isBanned:      readerAccounts.isBanned,
      banReason:     readerAccounts.banReason,
      bannedAt:      readerAccounts.bannedAt,
      bannedByName:  users.username,
      createdAt:     readerAccounts.createdAt,
      lastSeenAt:    readerAccounts.lastSeenAt,
      lastIp:        readerAccounts.lastIp,
      lastUserAgent: readerAccounts.lastUserAgent,
    })
    .from(readerAccounts)
    // leftJoin so the row stays readable after the officer who issued the ban is
    // deleted — that is exactly the trace worth keeping.
    .leftJoin(users, eq(readerAccounts.bannedBy, users.id))
    .where(eq(readerAccounts.id, readerId))
    .limit(1)

  if (!row) return null

  const comments = await db
    .select({
      id:           articleComments.id,
      body:         articleComments.body,
      createdAt:    articleComments.createdAt,
      parentId:     articleComments.parentId,
      articleId:    articleComments.articleId,
      articleTitle: articles.title,
      articleSlug:  articles.slug,
    })
    .from(articleComments)
    .leftJoin(articles, eq(articleComments.articleId, articles.id))
    .where(eq(articleComments.readerId, readerId))
    .orderBy(desc(articleComments.createdAt))

  return { reader: row, comments, impact: await countReaderCommentImpact(readerId) }
}

export type ModerationResult =
  | { ok: true, impact: ReaderCommentImpact }
  | { ok: false, statusCode: number, message: string }

/**
 * Ban an account: flag, reason, actor, `tokenVersion` bump, and comment deletion
 * — all inside one transaction.
 *
 * The `tokenVersion` bump is what makes the ban take effect now rather than
 * whenever a 30-day ticket happens to expire: `resolveReader` compares the stored
 * version against the one in the ticket and refuses a mismatch.
 */
export async function banReader(params: { readerId: number, reason: string | null, actorId: number }): Promise<ModerationResult> {
  const db = getDb()

  const [existing] = await db
    .select({ id: readerAccounts.id, isBanned: readerAccounts.isBanned, tokenVersion: readerAccounts.tokenVersion, displayName: readerAccounts.displayName })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, params.readerId))
    .limit(1)

  if (!existing) return { ok: false, statusCode: 404, message: 'Không tìm thấy tài khoản người đọc.' }

  // Measured before the delete: afterwards there is nothing left to count, and a
  // successful ban would be indistinguishable from one that removed nothing.
  const impact = await countReaderCommentImpact(params.readerId)

  await db.transaction(async (tx) => {
    await tx
      .update(readerAccounts)
      .set({
        isBanned:     true,
        banReason:    params.reason?.trim() || null,
        bannedAt:     new Date(),
        bannedBy:     params.actorId,
        tokenVersion: existing.tokenVersion + 1,
      })
      .where(eq(readerAccounts.id, params.readerId))

    // The FK cascade on parent_id takes the administrator replies with the
    // top-level comments they sit under (design.md D8). The confirmation dialog
    // has already told the officer how many of those there were.
    await tx.delete(articleComments).where(eq(articleComments.readerId, params.readerId))

    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'update',
      resource:   'readers',
      resourceId: params.readerId,
      meta: {
        operation:      'ban',
        reason:         params.reason?.trim() || null,
        displayName:    existing.displayName,
        deletedComments: impact.comments,
        deletedAdminReplies: impact.adminReplies,
        deletedOtherReaderReplies: impact.otherReaderReplies,
      },
    })
  })

  return { ok: true, impact }
}

/**
 * Lift a ban. Clears the flag and nothing else.
 *
 * Deleted comments are NOT restored — they are gone, and the officer who banned
 * the account was told so. `tokenVersion` is left where the ban put it, so the
 * ticket the reader was holding stays dead and they sign in again; resurrecting
 * an old ticket would mean a ban could be undone into a session that was never
 * re-authenticated.
 */
export async function unbanReader(params: { readerId: number, actorId: number }): Promise<ModerationResult> {
  const db = getDb()

  const [existing] = await db
    .select({ id: readerAccounts.id, displayName: readerAccounts.displayName })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, params.readerId))
    .limit(1)

  if (!existing) return { ok: false, statusCode: 404, message: 'Không tìm thấy tài khoản người đọc.' }

  // Update and audit row in one transaction, same reasoning as banReader: a
  // second statement that fails must not leave the account unbanned with
  // nothing recording who did it or when.
  await db.transaction(async (tx) => {
    await tx
      .update(readerAccounts)
      .set({ isBanned: false, banReason: null, bannedAt: null, bannedBy: null })
      .where(eq(readerAccounts.id, params.readerId))

    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'update',
      resource:   'readers',
      resourceId: params.readerId,
      meta:       { operation: 'unban', displayName: existing.displayName },
    })
  })

  // Bỏ chặn không xoá gì, nên mọi số đều là 0.
  return { ok: true, impact: { comments: 0, adminReplies: 0, otherReaderReplies: 0 } }
}

/** Delete the account row; comments follow by FK cascade. */
export async function deleteReader(params: { readerId: number, actorId: number }): Promise<ModerationResult> {
  const db = getDb()

  const [existing] = await db
    .select({ id: readerAccounts.id, displayName: readerAccounts.displayName, email: readerAccounts.email })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, params.readerId))
    .limit(1)

  if (!existing) return { ok: false, statusCode: 404, message: 'Không tìm thấy tài khoản người đọc.' }

  const impact = await countReaderCommentImpact(params.readerId)

  await db.transaction(async (tx) => {
    await tx.delete(readerAccounts).where(eq(readerAccounts.id, params.readerId))
    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'delete',
      resource:   'readers',
      resourceId: params.readerId,
      meta: {
        // Kept because after the row is gone this is the only remaining record
        // of whose account was removed.
        displayName:              existing.displayName,
        deletedComments:          impact.comments,
        deletedAdminReplies:      impact.adminReplies,
        deletedOtherReaderReplies: impact.otherReaderReplies,
      },
    })
  })

  return { ok: true, impact }
}

/** Remove every comment a reader wrote, leaving the account active. */
export async function purgeReaderComments(params: { readerId: number, actorId: number }): Promise<ModerationResult> {
  const db = getDb()

  const [existing] = await db
    .select({ id: readerAccounts.id, displayName: readerAccounts.displayName })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, params.readerId))
    .limit(1)

  if (!existing) return { ok: false, statusCode: 404, message: 'Không tìm thấy tài khoản người đọc.' }

  // The shared deletion path, not a local DELETE (design.md D8) — and inside one
  // transaction with its audit row, for the same reason ban and account deletion
  // are: rows gone with no record of who removed them is precisely the loss the
  // audit log exists to prevent.
  let impact = { comments: 0, adminReplies: 0, otherReaderReplies: 0 }
  await db.transaction(async (tx) => {
    impact = await deleteReaderComments(params.readerId, tx)

    await tx.insert(activityLogs).values({
      userId:     params.actorId,
      action:     'delete',
      resource:   'comments',
      resourceId: params.readerId,
      meta: {
        operation:                'purge_reader_comments',
        displayName:              existing.displayName,
        deletedComments:          impact.comments,
        deletedAdminReplies:      impact.adminReplies,
        deletedOtherReaderReplies: impact.otherReaderReplies,
      },
    })
  })

  return { ok: true, impact }
}

/**
 * Record that somebody looked at reader personal data.
 *
 * On the same path as the read it describes, never a fire-and-forget helper: a
 * log of citizens' data that can be browsed without leaving a trace is a
 * surveillance tool, not an audit log (design.md D14). The filters go in because
 * "who looked at which readers" is the question this row has to answer.
 */
export async function auditReaderRead(params: { actorId: number, resourceId?: number, meta: Record<string, unknown> }): Promise<void> {
  await getDb().insert(activityLogs).values({
    userId:     params.actorId,
    action:     'read',
    resource:   'readers',
    resourceId: params.resourceId ?? null,
    meta:       params.meta,
  })
}

export type RenameReaderResult =
  | { ok: true, displayName: string }
  | { ok: false, statusCode: number, message: string }

/**
 * A reader renaming themselves.
 *
 * Writes `custom_display_name` and leaves `display_name` untouched — see
 * effectiveDisplayName above for why those are two columns.
 *
 * The audit row is inserted on the `tx` handle inside the same transaction as the
 * UPDATE (design.md D14, guarded by tests/reader-audit-atomicity.test.ts). A
 * `db.insert()` placed inside a transaction block still runs on the pool and
 * commits independently, which is the same bug wearing a transaction's clothes.
 *
 * `userId` is null: activity_logs.user_id references `users`, and a reader has no
 * row there. The actor is named in `meta.readerId` instead — writing a reader id
 * into a column that means "staff account id" would make every audit query that
 * joins `users` quietly attribute this to whichever officer holds that id.
 */
export async function renameReader(params: { readerId: number, name: string }): Promise<RenameReaderResult> {
  const db = getDb()

  const [existing] = await db
    .select({
      id:                readerAccounts.id,
      isBanned:          readerAccounts.isBanned,
      displayName:       readerAccounts.displayName,
      customDisplayName: readerAccounts.customDisplayName,
    })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, params.readerId))
    .limit(1)

  if (!existing) return { ok: false, statusCode: 404, message: 'Không tìm thấy tài khoản người đọc.' }

  // A banned reader keeps their ticket until it expires, so this path is
  // reachable. Letting them rename would let a banned account keep changing how
  // it appears on comments the moderator has already reviewed.
  if (existing.isBanned) {
    return { ok: false, statusCode: 403, message: 'Tài khoản của bạn đang bị hạn chế.' }
  }

  const previous = effectiveDisplayName(existing)

  await db.transaction(async (tx) => {
    await tx
      .update(readerAccounts)
      .set({ customDisplayName: params.name })
      .where(eq(readerAccounts.id, params.readerId))

    await tx.insert(activityLogs).values({
      userId:     null,
      action:     'update',
      resource:   'readers',
      resourceId: params.readerId,
      meta: {
        operation: 'rename_self',
        readerId:  params.readerId,
        before:    previous,
        after:     params.name,
      },
    })
  })

  return { ok: true, displayName: params.name }
}

export type EmailPreferenceResult =
  | { ok: true, emailNotifications: boolean }
  | { ok: false, statusCode: number, message: string }

/**
 * A reader turning reply emails on or off for themselves.
 *
 * Audited in the same transaction as the update, for the same reason
 * `renameReader` is: this is a write to a citizen's record, and "who changed
 * this, and when" has to stay answerable. `userId: null` because the actor is a
 * member of the public and `activityLogs.userId` is a FK to `users` — the reader
 * is identified in `meta`. Putting a reader id in the officer column would make
 * every audit query that joins `users` quietly attribute this to whichever
 * officer holds that id.
 *
 * A banned reader is refused, matching renameReader: they keep their ticket until
 * it expires, so this path is reachable, and there is nothing to email them about
 * once their comments are gone.
 */
export async function setReaderEmailPreference(params: {
  readerId: number
  enabled:  boolean
}): Promise<EmailPreferenceResult> {
  const db = getDb()

  const [existing] = await db
    .select({
      id:                 readerAccounts.id,
      isBanned:           readerAccounts.isBanned,
      emailNotifications: readerAccounts.emailNotifications,
    })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, params.readerId))
    .limit(1)

  if (!existing) return { ok: false, statusCode: 404, message: 'Không tìm thấy tài khoản người đọc.' }
  if (existing.isBanned) return { ok: false, statusCode: 403, message: 'Tài khoản của bạn đang bị hạn chế.' }

  // Already in the requested state: no write, no audit row. Recording a change
  // that did not happen makes the log harder to read, not more complete.
  if (Boolean(existing.emailNotifications) === params.enabled) {
    return { ok: true, emailNotifications: params.enabled }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(readerAccounts)
      .set({ emailNotifications: params.enabled })
      .where(eq(readerAccounts.id, params.readerId))

    await tx.insert(activityLogs).values({
      userId:     null,
      action:     'update',
      resource:   'readers',
      resourceId: params.readerId,
      meta: {
        operation: 'email_preference_self',
        readerId:  params.readerId,
        before:    Boolean(existing.emailNotifications),
        after:     params.enabled,
      },
    })
  })

  return { ok: true, emailNotifications: params.enabled }
}
