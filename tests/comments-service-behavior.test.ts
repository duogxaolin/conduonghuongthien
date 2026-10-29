import assert from 'node:assert/strict'
import { beforeEach, describe, it, mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * Behaviour of the comment-service functions that, until this file, were only
 * covered by source-text guards or by a MySQL-only integration suite:
 * `deleteComment`, `countReaderCommentImpact`, `deleteReaderComments`,
 * `listCommentsForAdmin`, `auditCommentRead`, `createAdminReply` and
 * `loadCommentThread`.
 *
 * Written BEFORE `server/services/comments.ts` was split into sub-files (wave2
 * D-SPLIT, task 5.5) and run green against the original single file, so the
 * split is checked against behaviour rather than against its own text. Imported
 * through the public path on purpose: callers keep that path after the split.
 *
 * The pool, the transaction handle and a caller-supplied executor are three
 * DIFFERENT objects, so "the audit row is on the transaction" and "the delete
 * runs on the executor, not the pool" are asserted, not assumed. `where` clauses
 * are compiled to MySQL text with Drizzle's own dialect.
 */

type Row = Record<string, unknown>
type Handle = 'pool' | 'tx' | 'executor'

const dialect = new MySqlDialect()
const compile = (where: unknown) => (where === undefined ? null : dialect.sqlToQuery(where as never))

const schema = await import('../server/db/schema')
const { activityLogs, articleComments, articles, mediaItems, readerAccounts, users } = schema

// ─── Recorder ─────────────────────────────────────────────────────────────────

type SelectCall = {
  handle: Handle
  projection: Row | undefined
  table: unknown
  joins: unknown[]
  where: unknown
  limit?: number
  offset?: number
  /** `.for('update')` — a locking read. */
  lock?: string
}
type WriteCall = { handle: Handle, op: 'insert' | 'delete', table: unknown, values?: Row, where?: unknown }

/** Rows each successive `select` resolves to, in call order. */
let selectQueue: Row[][] = []
let selects: SelectCall[] = []
let writes: WriteCall[] = []
/** Ordered trace: writes, transaction boundaries, notification and e-mail. */
let events: string[] = []
let nextInsertId = 500

function selectOn(handle: Handle) {
  return (projection?: Row) => {
    const call: SelectCall = { handle, projection, table: undefined, joins: [], where: undefined }
    selects.push(call)
    const rows = selectQueue.shift() ?? []
    const chain = {
      from(table: unknown) { call.table = table; return chain },
      leftJoin(table: unknown) { call.joins.push(table); return chain },
      where(where: unknown) { call.where = where; return chain },
      orderBy() { return chain },
      limit(limit: number) { call.limit = limit; return chain },
      offset(offset: number) { call.offset = offset; return chain },
      for(strength: string) { call.lock = strength; return chain },
      then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject)
      },
    }
    return chain
  }
}

/** The next insert on the transaction throws an error carrying these fields (e.g. errno 1452). */
let failNextTxInsert: Row | null = null

function insertOn(handle: Handle) {
  return (table: unknown) => ({
    values: async (values: Row) => {
      if (handle === 'tx' && failNextTxInsert) {
        const fields = failNextTxInsert
        failNextTxInsert = null
        throw Object.assign(new Error('Cannot add or update a child row: a foreign key constraint fails'), fields)
      }
      writes.push({ handle, op: 'insert', table, values })
      events.push(`${handle}:insert:${table === activityLogs ? 'activity_logs' : table === articleComments ? 'article_comments' : 'other'}`)
      return [{ insertId: nextInsertId }]
    },
  })
}

function deleteOn(handle: Handle) {
  return (table: unknown) => ({
    where: async (where: unknown) => {
      writes.push({ handle, op: 'delete', table, where })
      events.push(`${handle}:delete`)
      return [{ affectedRows: 1 }]
    },
  })
}

const txHandle = { select: selectOn('tx'), insert: insertOn('tx'), delete: deleteOn('tx') }
const executorHandle = { select: selectOn('executor'), delete: deleteOn('executor') }
const fakeDb = {
  select: selectOn('pool'),
  insert: insertOn('pool'),
  delete: deleteOn('pool'),
  transaction: async (callback: (tx: typeof txHandle) => Promise<unknown>) => {
    events.push('tx:begin')
    const result = await callback(txHandle)
    events.push('tx:commit')
    return result
  },
}

mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => null } })

// ─── Notification + e-mail recorders (both mocked: notification-email imports notifications) ──

let notifyResult: number | null = 77
const notifyCalls: Row[] = []
const mailCalls: Row[] = []
mock.module('../server/services/notifications', {
  namedExports: {
    createReplyNotification: async (args: Row) => {
      notifyCalls.push(args)
      events.push(args.tx === txHandle ? 'notify:tx' : 'notify:not-tx')
      return notifyResult
    },
  },
})
mock.module('../server/services/notification-email', {
  namedExports: {
    sendReplyEmail: async (args: Row) => {
      mailCalls.push(args)
      events.push('mail')
    },
  },
})
// Not exercised by these functions; stubbed so loading the service touches no real moderation.
mock.module('../server/services/moderation-worker', {
  namedExports: {
    fastPreModerate: async () => ({ blocked: false, action: 'allow', severity: 'low', reason: '', matchedRule: '' }),
    checkAndModerateContent: async () => ({ flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] }),
  },
})

const {
  auditCommentRead,
  COMMENT_MAX_PER_PAGE,
  countReaderCommentImpact,
  createAdminReply,
  deleteComment,
  deleteReaderComments,
  listCommentsForAdmin,
  loadCommentThread,
  ADMIN_REPLY_DISPLAY_NAME,
} = await import('../server/services/comments.ts')

beforeEach(() => {
  selectQueue = []
  selects = []
  writes = []
  events = []
  nextInsertId = 500
  notifyResult = 77
  failNextTxInsert = null
  notifyCalls.length = 0
  mailCalls.length = 0
})

const fakeEvent = { tag: 'request' } as never

// ─── deleteComment ────────────────────────────────────────────────────────────

describe('deleteComment — the single deletion path', () => {
  const stored = { id: 10, articleId: 3, mediaItemId: null, readerId: 42, adminUserId: null, parentId: null }

  it('a missing comment is a 404 and nothing is written', async () => {
    selectQueue = [[]]
    const result = await deleteComment({ id: 10, actor: { kind: 'admin', userId: 1 } })
    assert.deepEqual(result, { ok: false, statusCode: 404, message: 'Bình luận không tồn tại.' })
    assert.equal(writes.length, 0)
    assert.ok(!events.includes('tx:begin'), 'no transaction for a refusal')
  })

  it('a reader can never delete an administrator reply', async () => {
    selectQueue = [[{ ...stored, readerId: null, adminUserId: 9, parentId: 4 }]]
    const result = await deleteComment({ id: 10, actor: { kind: 'reader', readerId: 42 } })
    assert.deepEqual(result, { ok: false, statusCode: 403, message: 'Không thể xoá phản hồi của Ban quản trị.' })
    assert.equal(writes.length, 0)
  })

  it('a reader can only delete their own comment', async () => {
    selectQueue = [[stored]]
    const result = await deleteComment({ id: 10, actor: { kind: 'reader', readerId: 43 } })
    assert.deepEqual(result, { ok: false, statusCode: 403, message: 'Bạn chỉ có thể xoá bình luận của chính mình.' })
    assert.equal(writes.length, 0)
  })

  it('a reader deleting their own comment deletes on the transaction and writes no audit row', async () => {
    selectQueue = [[stored]]
    const result = await deleteComment({ id: 10, actor: { kind: 'reader', readerId: 42 } })
    assert.deepEqual(result, { ok: true, deleted: 1 })
    assert.deepEqual(writes.map(w => [w.handle, w.op, w.table === articleComments]), [['tx', 'delete', true]])
    const where = compile(writes[0]!.where)!
    assert.match(where.sql, /`article_comments`\.`id` = \?/)
    assert.deepEqual(where.params, [10])
  })

  it('an administrator delete writes the delete AND its audit row on the same transaction', async () => {
    selectQueue = [[{ ...stored, articleId: null, mediaItemId: 9, parentId: 4 }]]
    const result = await deleteComment({ id: 10, actor: { kind: 'admin', userId: 5 } })
    assert.deepEqual(result, { ok: true, deleted: 1 })
    assert.deepEqual(events, ['tx:begin', 'tx:delete', 'tx:insert:activity_logs', 'tx:commit'])
    const audit = writes.find(w => w.table === activityLogs)!
    assert.equal(audit.handle, 'tx', 'the audit row must ride the transaction handle')
    assert.deepEqual(audit.values, {
      userId: 5,
      action: 'delete',
      resource: 'article_comments',
      resourceId: 10,
      meta: { articleId: null, mediaItemId: 9, wasReply: true },
    })
  })

  it('a system deletion (retention, ban) deletes without an officer audit row', async () => {
    selectQueue = [[stored]]
    const result = await deleteComment({ id: 10, actor: { kind: 'system', reason: 'retention' } })
    assert.deepEqual(result, { ok: true, deleted: 1 })
    assert.deepEqual(writes.map(w => [w.handle, w.op]), [['tx', 'delete']])
  })
})

// ─── countReaderCommentImpact / deleteReaderComments ─────────────────────────

describe('the reader comment impact, measured before anything is removed', () => {
  const owned = [{ id: 1, parentId: null }, { id: 2, parentId: 99 }, { id: 3, parentId: null }]
  const under = [
    { id: 20, adminUserId: 9, readerId: null },
    { id: 21, adminUserId: null, readerId: 55 },
    { id: 22, adminUserId: null, readerId: 56 },
    // This reader's own reply under their own question — already inside `owned`.
    { id: 23, adminUserId: null, readerId: 42 },
  ]

  it('splits the cascade by author and never double-counts the reader\'s own reply', async () => {
    selectQueue = [owned, under]
    const impact = await countReaderCommentImpact(42)
    assert.deepEqual(impact, { comments: 3, adminReplies: 1, otherReaderReplies: 2 })

    assert.equal(selects.length, 2)
    const first = compile(selects[0]!.where)!
    assert.match(first.sql, /`article_comments`\.`reader_id` = \?/)
    assert.deepEqual(first.params, [42])
    // The second pass is scoped to this reader's TOP-LEVEL comments only.
    const second = compile(selects[1]!.where)!
    assert.match(second.sql, /`article_comments`\.`parent_id` in \(\?, \?\)/)
    assert.deepEqual(second.params, [1, 3])
  })

  it('a reader with no top-level comment issues no reply query', async () => {
    selectQueue = [[{ id: 2, parentId: 99 }]]
    const impact = await countReaderCommentImpact(42)
    assert.deepEqual(impact, { comments: 1, adminReplies: 0, otherReaderReplies: 0 })
    assert.equal(selects.length, 1)
  })

  it('deleteReaderComments deletes nothing for a reader who wrote nothing', async () => {
    selectQueue = [[]]
    const impact = await deleteReaderComments(42, executorHandle as never)
    assert.deepEqual(impact, { comments: 0, adminReplies: 0, otherReaderReplies: 0 })
    assert.equal(writes.length, 0)
  })

  it('deleteReaderComments runs its one DELETE on the caller executor and returns the counts taken before it', async () => {
    // Plain reads of the rows to lock, the ordered lock, then the locking reads the counts come from.
    selectQueue = [owned, under, [], owned, under]
    const impact = await deleteReaderComments(42, executorHandle as never)
    assert.deepEqual(impact, { comments: 3, adminReplies: 1, otherReaderReplies: 2 })
    assert.deepEqual(writes.map(w => [w.handle, w.op, w.table === articleComments]), [['executor', 'delete', true]])
    // Everything on the executor (never a second pool connection inside a transaction —
    // verifier H2): every row the deletion touches is locked in ONE statement, ascending id
    // (verifier H3), and the counts come from locking reads.
    assert.deepEqual(selects.map(s => [s.handle, s.lock ?? null]), [['executor', null], ['executor', null], ['executor', 'update'], ['executor', 'update'], ['executor', 'update']])
    const lock = compile(selects[2]!.where)!
    assert.match(lock.sql, /`article_comments`\.`id` in \(\?, \?, \?, \?, \?, \?, \?\)/)
    assert.deepEqual(lock.params, [1, 2, 3, 20, 21, 22, 23])
    const where = compile(writes[0]!.where)!
    assert.match(where.sql, /`article_comments`\.`reader_id` = \?/)
    assert.deepEqual(where.params, [42])
  })

  it('deleteReaderComments falls back to the pool when the caller owns no transaction', async () => {
    selectQueue = [[{ id: 1, parentId: null }], []]
    await deleteReaderComments(42)
    assert.deepEqual(writes.map(w => [w.handle, w.op]), [['pool', 'delete']])
    // On the pool (no transaction to hold them) nothing is locked.
    assert.deepEqual(selects.map(s => [s.handle, s.lock ?? null]), [['pool', null], ['pool', null]])
  })
})

// ─── listCommentsForAdmin ─────────────────────────────────────────────────────

describe('listCommentsForAdmin — the moderation list', () => {
  const listRow = (overrides: Row = {}) => ({
    id: 1,
    body: 'Nội dung',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    parentId: null,
    articleId: 3,
    articleTitle: 'Bài viết',
    articleSlug: 'bai-viet',
    mediaItemId: null,
    mediaItemTitle: null,
    mediaItemSlug: null,
    mediaItemShortId: null,
    readerId: 42,
    readerName: 'Admin',
    readerCustomName: null,
    readerNameReserved: true,
    readerEmail: 'reader@example.vn',
    adminUserId: null,
    adminName: null,
    ip: '203.0.113.9',
    isHidden: false,
    flagReason: null,
    ...overrides,
  })

  const run = async (params: Partial<Parameters<typeof listCommentsForAdmin>[0]>, total = 1, rows: Row[] = [listRow()]) => {
    selectQueue = [[{ total }], rows]
    return listCommentsForAdmin({ articleId: null, page: 1, perPage: 20, ...params })
  }

  it('defaults to visible comments only — the count and the page share one filter', async () => {
    await run({})
    const count = compile(selects[0]!.where)!
    const page = compile(selects[1]!.where)!
    assert.match(count.sql, /`article_comments`\.`is_hidden` = \?/)
    assert.deepEqual(count.params, [false])
    assert.deepEqual(page, count, 'the page query must use the same filter as its count')
  })

  it('the hidden tab asks for hidden rows, and "all" filters nothing', async () => {
    await run({ visibility: 'hidden' })
    assert.deepEqual(compile(selects[0]!.where)!.params, [true])

    selects = []
    await run({ visibility: 'all' })
    assert.equal(selects[0]!.where, undefined, '"all" with no other narrowing has no WHERE')
  })

  it('source filters test the identifier being SET, and compose with articleId', async () => {
    await run({ source: 'media', visibility: 'all' })
    assert.match(compile(selects[0]!.where)!.sql, /`article_comments`\.`media_item_id` is not null/)

    selects = []
    await run({ source: 'article', articleId: 3 })
    const both = compile(selects[0]!.where)!
    assert.match(both.sql, /`article_comments`\.`article_id` = \?/)
    assert.match(both.sql, /`article_comments`\.`article_id` is not null/)
    assert.match(both.sql, /`article_comments`\.`is_hidden` = \?/)
    assert.deepEqual(both.params, [3, false])
  })

  it('keeps every row: four left joins, including the deleted-officer and deleted-item cases', async () => {
    await run({})
    assert.deepEqual(selects[1]!.joins, [articles, mediaItems, readerAccounts, users])
  })

  it('clamps perPage to the server ceiling and the page into range', async () => {
    const result = await run({ perPage: 500, page: 9 }, 120, [])
    assert.equal(result.perPage, COMMENT_MAX_PER_PAGE)
    assert.equal(result.totalPages, 3)
    assert.equal(result.page, 3)
    assert.equal(selects[1]!.limit, COMMENT_MAX_PER_PAGE)
    assert.equal(selects[1]!.offset, 2 * COMMENT_MAX_PER_PAGE)

    selects = []
    const low = await run({ perPage: 0, page: 0 }, 0, [])
    assert.equal(low.perPage, 1)
    assert.equal(low.page, 1)
    assert.equal(low.totalPages, 1)
    assert.equal(selects[1]!.offset, 0)
  })

  it('shows the name the PUBLIC sees: a reserved Google name reads "Bạn đọc", a chosen name wins, an officer row has none', async () => {
    const result = await run({}, 3, [
      listRow({ id: 1 }),
      listRow({ id: 2, readerCustomName: 'Bác Ba' }),
      listRow({ id: 3, readerId: null, readerName: null, readerNameReserved: null, readerEmail: null, adminUserId: 7, adminName: 'canbo' }),
    ])
    assert.deepEqual(result.comments.map(row => row.readerName), ['Bạn đọc', 'Bác Ba', null])
    // The raw columns stay on the row for /admin/readers/[id]; the email is part of a moderation surface.
    assert.equal(result.comments[0]!.readerEmail, 'reader@example.vn')
    assert.equal(result.comments[1]!.readerCustomName, 'Bác Ba')
    assert.equal(result.comments[2]!.adminName, 'canbo')
    assert.equal(result.total, 3)
  })
})

// ─── auditCommentRead ─────────────────────────────────────────────────────────

describe('auditCommentRead', () => {
  it('writes one read row on activity_logs naming the officer and the filter', async () => {
    await auditCommentRead({ actorId: 5, meta: { page: 2, source: 'media' } })
    assert.deepEqual(writes.map(w => [w.handle, w.op, w.table === activityLogs]), [['pool', 'insert', true]])
    assert.deepEqual(writes[0]!.values, { userId: 5, action: 'read', resource: 'comments', meta: { page: 2, source: 'media' } })
  })
})

// ─── createAdminReply ─────────────────────────────────────────────────────────

describe('createAdminReply — the portal replying in public', () => {
  const base = { parentId: 30, body: 'Câu trả lời chính thức', actorId: 5, ip: '198.51.100.4', userAgent: 'x'.repeat(600), event: fakeEvent }

  it('a missing parent is a 404 and nothing is written', async () => {
    selectQueue = [[]]
    assert.deepEqual(await createAdminReply(base), { ok: false, statusCode: 404, message: 'Bình luận gốc không tồn tại.' })
    assert.equal(writes.length, 0)
    assert.equal(mailCalls.length, 0)
  })

  it('a parent removed between the read and the insert (FK 1452) is the same 404, not a 500; other errors still throw', async () => {
    // A ban / purge / account deletion committed in between (verifier round 4, M1: 4–7 of 12
    // admin replies next to 12 bans on MySQL answered 500).
    selectQueue = [[{ id: 30, articleId: 3, mediaItemId: null, parentId: null }]]
    failNextTxInsert = { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2' }
    assert.deepEqual(await createAdminReply(base), { ok: false, statusCode: 404, message: 'Bình luận gốc không tồn tại.' })
    assert.deepEqual([writes.length, mailCalls.length, notifyCalls.length], [0, 0, 0])

    selectQueue = [[{ id: 30, articleId: 3, mediaItemId: null, parentId: null }]]
    failNextTxInsert = { errno: 1213, code: 'ER_LOCK_DEADLOCK' }
    await assert.rejects(createAdminReply(base), /foreign key constraint fails/)
  })

  it('a parent belonging to no item is refused (409) rather than producing an orphan', async () => {
    selectQueue = [[{ id: 30, articleId: null, mediaItemId: null, parentId: null }]]
    assert.deepEqual(await createAdminReply(base), { ok: false, statusCode: 409, message: 'Bình luận gốc không thuộc nội dung nào.' })
    assert.equal(writes.length, 0)
  })

  it('the one-level rule holds for officers too', async () => {
    selectQueue = [[{ id: 30, articleId: 3, mediaItemId: null, parentId: 12 }]]
    assert.deepEqual(await createAdminReply(base), {
      ok: false,
      statusCode: 400,
      message: 'Chỉ có thể trả lời bình luận gốc, không trả lời một phản hồi.',
    })
    assert.equal(writes.length, 0)
  })

  it('a reply under a video inherits the media item; reply, audit and notification commit together, the e-mail after', async () => {
    selectQueue = [[{ id: 30, articleId: null, mediaItemId: 9, parentId: null }]]
    nextInsertId = 811
    const result = await createAdminReply(base)
    assert.deepEqual(result, { ok: true, id: 811 })

    assert.deepEqual(events, ['tx:begin', 'tx:insert:article_comments', 'tx:insert:activity_logs', 'notify:tx', 'tx:commit', 'mail'])

    const reply = writes.find(w => w.table === articleComments)!
    assert.equal(reply.handle, 'tx')
    const { createdAt, ...replyValues } = reply.values!
    assert.ok(createdAt instanceof Date, 'createdAt goes through the Drizzle builder as a Date')
    assert.deepEqual(replyValues, {
      articleId: null,
      mediaItemId: 9,
      readerId: null,
      adminUserId: 5,
      parentId: 30,
      body: 'Câu trả lời chính thức',
      ip: '198.51.100.4',
      userAgent: 'x'.repeat(512),
    })

    const audit = writes.find(w => w.table === activityLogs)!
    assert.equal(audit.handle, 'tx')
    assert.deepEqual(audit.values, {
      userId: 5,
      action: 'create',
      resource: 'comments',
      resourceId: 811,
      meta: { operation: 'admin_reply', articleId: null, mediaItemId: 9, parentId: 30 },
    })

    assert.equal(notifyCalls.length, 1)
    const { tx, ...notifyArgs } = notifyCalls[0]!
    assert.equal(tx, txHandle)
    assert.deepEqual(notifyArgs, { commentId: 811, parentId: 30, actorReaderId: null })

    assert.deepEqual(mailCalls, [{ commentId: 811, parentId: 30, recipientId: 77, event: fakeEvent }])
  })

  it('a reply under an article inherits the article', async () => {
    selectQueue = [[{ id: 30, articleId: 3, mediaItemId: null, parentId: null }]]
    await createAdminReply({ ...base, userAgent: null })
    const reply = writes.find(w => w.table === articleComments)!
    assert.equal(reply.values!.articleId, 3)
    assert.equal(reply.values!.mediaItemId, null)
    assert.equal(reply.values!.userAgent, null)
    assert.deepEqual((writes.find(w => w.table === activityLogs)!.values!.meta as Row), { operation: 'admin_reply', articleId: 3, mediaItemId: null, parentId: 30 })
  })

  it('no recipient to notify (e-mail off, author gone) → no e-mail', async () => {
    selectQueue = [[{ id: 30, articleId: 3, mediaItemId: null, parentId: null }]]
    notifyResult = null
    const result = await createAdminReply(base)
    assert.equal(result.ok, true)
    assert.equal(mailCalls.length, 0)
  })
})

// ─── loadCommentThread ────────────────────────────────────────────────────────

describe('loadCommentThread — one page of top-level comments with their replies', () => {
  const threadRow = (overrides: Row = {}) => ({
    id: 1,
    articleId: 3,
    readerId: 42,
    adminUserId: null,
    parentId: null,
    body: 'Câu hỏi',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    readerName: 'Nguyễn Văn An',
    readerCustomName: null,
    readerNameReserved: false,
    ...overrides,
  })

  it('no item, or both, reads nothing and returns the empty page', async () => {
    for (const ids of [{}, { articleId: 3, mediaItemId: 9 }]) {
      const page = await loadCommentThread({ ...ids, page: 4, perPage: 10, viewerReaderId: null })
      assert.deepEqual(page, { comments: [], total: 0, page: 1, perPage: 10, totalPages: 1 })
    }
    assert.equal(selects.length, 0)
  })

  it('scopes BOTH passes to the article and excludes media rows, hidden rows and replies from the count', async () => {
    selectQueue = [
      [{ total: 3 }],
      [threadRow({ id: 1 }), threadRow({ id: 2, readerId: 50, readerName: 'Admin', readerNameReserved: true })],
      [
        threadRow({ id: 10, parentId: 1, readerId: null, adminUserId: 7, readerName: null }),
        threadRow({ id: 11, parentId: 2, readerId: 42 }),
        // A reply whose parent is not on this page is dropped, never misattached.
        threadRow({ id: 12, parentId: 99 }),
      ],
    ]
    const page = await loadCommentThread({ articleId: 3, page: 1, perPage: 2, viewerReaderId: 42 })

    const count = compile(selects[0]!.where)!
    assert.equal(
      count.sql,
      '((`article_comments`.`article_id` = ? and `article_comments`.`media_item_id` is null) and `article_comments`.`parent_id` is null and `article_comments`.`is_hidden` = ?)',
    )
    assert.deepEqual(count.params, [3, false])
    assert.deepEqual(compile(selects[1]!.where), count, 'the page of parents uses the counted filter')
    const replies = compile(selects[2]!.where)!
    assert.match(replies.sql, /`article_comments`\.`article_id` = \? and `article_comments`\.`media_item_id` is null/)
    assert.match(replies.sql, /`article_comments`\.`parent_id` in \(\?, \?\)/)
    assert.deepEqual(replies.params, [3, 1, 2, false])

    assert.equal(page.total, 3)
    assert.equal(page.totalPages, 2)
    assert.deepEqual(page.comments.map(c => [c.id, c.authorName, c.canDelete, c.replies?.map(r => r.id)]), [
      [1, 'Nguyễn Văn An', true, [10]],
      [2, 'Bạn đọc', false, [11]],
    ])
    const officer = page.comments[0]!.replies![0]!
    assert.equal(officer.authorName, ADMIN_REPLY_DISPLAY_NAME)
    assert.equal(officer.isAdminReply, true)
    assert.equal(officer.canDelete, false)
    assert.equal(page.comments[1]!.replies![0]!.canDelete, true, 'the viewer may delete their own reply')
  })

  it('a media thread is scoped by the media column and pins the article column to NULL', async () => {
    selectQueue = [[{ total: 0 }], []]
    await loadCommentThread({ mediaItemId: 9, page: 1, perPage: 10, viewerReaderId: null })
    const count = compile(selects[0]!.where)!
    assert.match(count.sql, /`article_comments`\.`media_item_id` = \? and `article_comments`\.`article_id` is null/)
    assert.deepEqual(count.params, [9, false])
    assert.equal(selects.length, 2, 'no parents on the page → no reply query')
  })

  it('clamps the requested page into range and offsets by it', async () => {
    selectQueue = [[{ total: 5 }], [], []]
    const page = await loadCommentThread({ articleId: 3, page: 9, perPage: 2, viewerReaderId: null })
    assert.equal(page.totalPages, 3)
    assert.equal(page.page, 3)
    assert.equal(selects[1]!.limit, 2)
    assert.equal(selects[1]!.offset, 4)
  })
})
