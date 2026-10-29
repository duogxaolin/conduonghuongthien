import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * Reader moderation in the admin: `server/services/readers.ts` and
 * `server/services/ip-bans.ts` through their routes —
 *   GET    /api/admin/readers                (readers.read, audited with its filters)
 *   GET    /api/admin/readers/:id            (readers.read, audited with the reader's id)
 *   GET    /api/admin/readers/:id/impact     (readers.read, not audited — the dialog's labels)
 *   POST   /api/admin/readers/:id/ban        (readers.update)
 *   POST   /api/admin/readers/:id/unban      (readers.update)
 *   DELETE /api/admin/readers/:id            (readers.delete)
 *   DELETE /api/admin/readers/:id/comments   (comments.delete — not readers.delete)
 *   GET    /api/admin/ip-bans                (readers.read)
 *   POST   /api/admin/ip-bans                (readers.update)
 *   DELETE /api/admin/ip-bans/:id            (readers.update)
 *
 * The invariants: each route's permission, nothing written and nothing audited on a
 * refusal; every write and its audit row commit together (a failed audit insert leaves
 * nothing behind); a ban flags the account, bumps `tokenVersion` (the reader's ticket
 * dies now) and removes the reader's comments, with the counts measured before; the
 * list searches display name and e-mail for the text as typed — `_` and `%` are not
 * wildcards (FINDING-R6-8) — in a defined order, so two pages never share or skip a
 * row (FINDING-R6-9), and its audit row names the page shown, not the page asked for
 * (FINDING-R6-12); lifting a ban that is not there records nothing (FINDING-R6-10);
 * the address-ban list is newest first, as the module says (FINDING-R6-11).
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`; LIKE escapes with
 * `\` as on MySQL — `_sqlite-mysql-db.ts`). SQLite has no foreign keys here, so the
 * cascades (replies under a deleted comment, comments of a deleted account) are the
 * schema's job and not observed.
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.readerAccounts, s.articleComments, s.articles, s.mediaItems, s.readerIpBans, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/readers', handler: await load('../server/api/admin/readers/index.get') },
    { method: 'get', path: '/api/admin/readers/:id', handler: await load('../server/api/admin/readers/[id].get') },
    { method: 'get', path: '/api/admin/readers/:id/impact', handler: await load('../server/api/admin/readers/[id]/impact.get') },
    { method: 'post', path: '/api/admin/readers/:id/ban', handler: await load('../server/api/admin/readers/[id]/ban.post') },
    { method: 'post', path: '/api/admin/readers/:id/unban', handler: await load('../server/api/admin/readers/[id]/unban.post') },
    { method: 'delete', path: '/api/admin/readers/:id', handler: await load('../server/api/admin/readers/[id].delete') },
    { method: 'delete', path: '/api/admin/readers/:id/comments', handler: await load('../server/api/admin/readers/[id]/comments.delete') },
    { method: 'get', path: '/api/admin/ip-bans', handler: await load('../server/api/admin/ip-bans/index.get') },
    { method: 'post', path: '/api/admin/ip-bans', handler: await load('../server/api/admin/ip-bans/index.post') },
    { method: 'delete', path: '/api/admin/ip-bans/:id', handler: await load('../server/api/admin/ip-bans/[id].delete') },
  ],
})
after(() => h.server.close())
const { readerAccounts, articleComments, articles, mediaItems, readerIpBans, activityLogs, users } = h.schema

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let moderator: Account // readers: read + update + delete
let viewer: Account // readers: read
let commentsOfficer: Account // comments: delete

beforeEach(async () => {
  h.reset()
  moderator = await h.account([{ resource: 'readers', canRead: true, canUpdate: true, canDelete: true }], 'kiemduyet')
  viewer = await h.account([{ resource: 'readers', canRead: true }], 'xem')
  commentsOfficer = await h.account([{ resource: 'comments', canRead: true, canDelete: true }], 'binhluan')
})

let sub = 0
async function reader(fields: Json = {}) {
  sub += 1
  const [row] = await h.harness.db.insert(readerAccounts).values({
    googleSub: `g-${sub}`, email: `ban${sub}@gmail.com`, displayName: `Người đọc ${sub}`,
    lastSeenAt: new Date(Date.UTC(2026, 9, 1, 0, 0, sub)), ...fields,
  } as typeof readerAccounts.$inferInsert)
  return Number(row.insertId)
}
async function comment(fields: Json) {
  const [row] = await h.harness.db.insert(articleComments).values({ body: 'Câu hỏi', createdAt: new Date(Date.UTC(2026, 9, 2)), ...fields } as typeof articleComments.$inferInsert)
  return Number(row.insertId)
}
const readerRow = (id: number) => h.harness.rows(readerAccounts).find(row => row.id === id)
const audits = () => h.harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta as Json }))
const list = async (query: string, who: Account = viewer) => {
  const response = await h.request('GET', `/api/admin/readers${query}`, who)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return response.body as { readers: Json[], total: number, page: number, perPage: number, totalPages: number }
}

/** A reader with two top-level comments: one with an admin reply and another reader's reply under it. */
async function readerWithThread() {
  const id = await reader({ displayName: 'Nguyễn Văn A', lastIp: '203.0.113.7' })
  const other = await reader({ displayName: 'Trần Thị B' })
  const [art] = await h.harness.db.insert(articles).values({ type: 'news', title: 'Hỏi đáp pháp luật', slug: 'hoi-dap', status: 'published' })
  const [item] = await h.harness.db.insert(mediaItems).values({ title: 'Video hướng dẫn', slug: 'video-huong-dan', shortId: 'AbCdEfGhIjK' })
  const top = await comment({ articleId: Number(art.insertId), readerId: id, body: 'Câu hỏi 1', createdAt: new Date(Date.UTC(2026, 9, 3)) })
  await comment({ mediaItemId: Number(item.insertId), readerId: id, body: 'Câu hỏi 2', createdAt: new Date(Date.UTC(2026, 9, 4)) })
  await comment({ articleId: Number(art.insertId), adminUserId: moderator.id, parentId: top, body: 'Trả lời của cổng' })
  await comment({ articleId: Number(art.insertId), readerId: other, parentId: top, body: 'Tôi cũng hỏi vậy' })
  return { id, other }
}

// ─── Permissions ─────────────────────────────────────────────────────────────

test('each route needs its own permission; a refusal writes nothing and audits nothing', async () => {
  const id = await reader()
  await h.harness.db.insert(readerIpBans).values({ value: '198.51.100.9', createdBy: moderator.id })
  const outsider = await h.account([{ resource: 'news', canRead: true, canUpdate: true, canDelete: true }], 'tintuc')
  const routes: Array<[string, string, Account, unknown?]> = [
    ['GET', '/api/admin/readers', outsider], ['GET', `/api/admin/readers/${id}`, outsider], ['GET', `/api/admin/readers/${id}/impact`, outsider],
    ['POST', `/api/admin/readers/${id}/ban`, viewer, { reason: 'x' }], ['POST', `/api/admin/readers/${id}/unban`, viewer],
    ['DELETE', `/api/admin/readers/${id}`, viewer],
    // Deleting a reader's comments is a comments decision: readers.delete alone is not enough.
    ['DELETE', `/api/admin/readers/${id}/comments`, moderator],
    ['GET', '/api/admin/ip-bans', outsider], ['POST', '/api/admin/ip-bans', viewer, { value: '192.0.2.1' }], ['DELETE', '/api/admin/ip-bans/1', viewer],
  ]
  for (const [method, path, who, body] of routes) {
    assert.equal((await h.request(method, path, null, body)).status, 401, `${method} ${path}`)
    assert.equal((await h.request(method, path, who, body)).status, 403, `${method} ${path}`)
  }
  assert.equal(readerRow(id)!.isBanned, false)
  assert.equal(h.harness.rows(readerIpBans).length, 1)
  assert.deepEqual(audits(), [])
})

// ─── The list ────────────────────────────────────────────────────────────────

test('list: the ban filter, page and size clamped, comment counts; one audit row with the filters used', async () => {
  const a = await reader({ displayName: 'An', isBanned: true })
  const b = await reader({ displayName: 'Bình' })
  await reader({ displayName: 'Cường' })
  await comment({ readerId: b, articleId: 1 })
  await comment({ readerId: b, articleId: 1 })

  const banned = await list('?banned=banned')
  assert.deepEqual(banned.readers.map(row => row.id), [a])
  const active = await list('?banned=active&perPage=500')
  assert.deepEqual([active.total, active.perPage, active.page, active.totalPages], [2, 100, 1, 1])
  assert.equal(active.readers.find(row => row.id === b)!.commentCount, 2)
  assert.deepEqual(Object.keys(active.readers[0]!).sort(), ['banReason', 'bannedAt', 'commentCount', 'createdAt', 'displayName', 'email', 'id', 'isBanned', 'lastIp', 'lastSeenAt'])
  assert.equal((await list('?perPage=abc&page=-3')).perPage, 25)

  const rows = audits()
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[1], { userId: viewer.id, action: 'read', resource: 'readers', resourceId: null, meta: { operation: 'list', search: null, banned: 'active', page: 1, perPage: 100, returned: 2 } })

  // An unknown filter is refused, not read as "banned" — and not audited.
  assert.equal((await h.request('GET', '/api/admin/readers?banned=1', viewer)).status, 400)
  assert.equal(audits().length, 3)
})

test('FINDING-R6-12: the audit row of a list read names the page that was shown, not the page asked for', async () => {
  await reader()
  await reader()
  const shown = await list('?page=9&perPage=1')
  assert.deepEqual([shown.page, shown.totalPages, shown.readers.length], [2, 2, 1])
  // Before: `page: 9` — a page that does not exist, while the officer was shown page 2.
  assert.deepEqual(audits()[0]!.meta, { operation: 'list', search: null, banned: 'all', page: 2, perPage: 1, returned: 1 })
})

test('list: the search matches display name and e-mail', async () => {
  const byName = await reader({ displayName: 'Lê Hoàng Nam', email: 'x1@gmail.com' })
  const byEmail = await reader({ displayName: 'Khách', email: 'hoangnam.le@gmail.com' })
  await reader({ displayName: 'Phạm Thu', email: 'thu@gmail.com' })
  assert.deepEqual((await list(`?q=${encodeURIComponent('Hoàng Nam')}`)).readers.map(row => row.id), [byName])
  assert.deepEqual((await list('?q=hoangnam')).readers.map(row => row.id), [byEmail])
  assert.equal(audits().at(-1)!.meta.search, 'hoangnam')
})

test('FINDING-R6-8: `_` and `%` in the search are the characters typed, not wildcards', async () => {
  const underscore = await reader({ displayName: 'Khách', email: 'nguyen_van@gmail.com' })
  await reader({ displayName: 'Khách', email: 'nguyenxvan@gmail.com' })
  await reader({ displayName: 'Giảm 50% học phí' })
  await reader({ displayName: 'Bạn đọc' })
  // Before: `_` matched any character (both e-mails), `%` matched every reader.
  assert.deepEqual((await list('?q=nguyen_van')).readers.map(row => row.id), [underscore])
  assert.deepEqual((await list(`?q=${encodeURIComponent('%')}`)).readers.map(row => row.displayName), ['Giảm 50% học phí'])
})

test('FINDING-R6-9: the list has one defined order — last seen first, then the newest account — so pages never share a row', async () => {
  // Five readers seen at the same second, two never back since sign-up day (same value too).
  const sameSecond = new Date(Date.UTC(2026, 9, 10, 8, 0, 0))
  const ids: number[] = []
  for (let n = 0; n < 5; n += 1) ids.push(await reader({ lastSeenAt: sameSecond }))
  const latest = await reader({ lastSeenAt: new Date(Date.UTC(2026, 9, 11)) })
  const page1 = await list('?perPage=3&page=1')
  const page2 = await list('?perPage=3&page=2')
  // Before: no tie-break — MySQL may return tied rows in any order on each query
  // ("If multiple rows have identical values in the ORDER BY columns, the server is
  // free to return those rows in any order", MySQL 8.0 manual, LIMIT optimization),
  // so a reader could appear on both pages and another on neither.
  assert.deepEqual([...page1.readers, ...page2.readers].map(row => row.id), [latest, ...ids.slice().reverse()])
})

// ─── Detail and impact ───────────────────────────────────────────────────────

test('detail: the reader, every comment newest first with its article or media item, the impact; audited with the reader id', async () => {
  const { id } = await readerWithThread()
  await h.harness.sqlite.prepare('UPDATE reader_accounts SET banned_by = ? WHERE id = ?').run(moderator.id, id)
  const response = await h.request('GET', `/api/admin/readers/${id}`, viewer)
  assert.equal(response.status, 200)
  const body = response.body as { reader: Json, comments: Json[], impact: Json }
  assert.deepEqual([body.reader.displayName, body.reader.lastIp, body.reader.bannedByName], ['Nguyễn Văn A', '203.0.113.7', moderator.username])
  assert.deepEqual(body.comments.map(row => [row.body, row.articleTitle, row.mediaItemTitle]), [
    ['Câu hỏi 2', null, 'Video hướng dẫn'], ['Câu hỏi 1', 'Hỏi đáp pháp luật', null],
  ])
  assert.deepEqual(body.impact, { comments: 2, adminReplies: 1, otherReaderReplies: 1 })
  assert.deepEqual(audits(), [{ userId: viewer.id, action: 'read', resource: 'readers', resourceId: id, meta: { operation: 'detail', commentCount: 2 } }])

  // The ban stays readable after the officer who issued it is gone (leftJoin).
  h.harness.sqlite.prepare('DELETE FROM users WHERE id = ?').run(moderator.id)
  const again = await h.request('GET', `/api/admin/readers/${id}`, viewer)
  assert.deepEqual([again.status, (again.body.reader as Json).bannedByName], [200, null])
  assert.ok(h.harness.rows(users).every(row => row.id !== moderator.id))
})

test('detail and impact: a missing reader is a 404, a malformed id a 400 — no audit row either way; impact is never audited', async () => {
  const { id } = await readerWithThread()
  assert.equal((await h.request('GET', '/api/admin/readers/999', viewer)).status, 404)
  for (const bad of ['0', 'abc', '-4']) assert.equal((await h.request('GET', `/api/admin/readers/${bad}`, viewer)).status, 400, bad)
  const impact = await h.request('GET', `/api/admin/readers/${id}/impact`, viewer)
  assert.deepEqual([impact.status, impact.body.impact], [200, { comments: 2, adminReplies: 1, otherReaderReplies: 1 }])
  assert.deepEqual(audits(), [])
})

// ─── Ban, unban, delete, purge ───────────────────────────────────────────────

test('ban: flag, trimmed reason, who and when, tokenVersion + 1, the reader\'s comments gone; the audit row carries the counts measured before', async () => {
  const { id, other } = await readerWithThread()
  await h.harness.sqlite.prepare('UPDATE reader_accounts SET token_version = 4 WHERE id = ?').run(id)
  const response = await h.request('POST', `/api/admin/readers/${id}/ban`, moderator, { reason: `  Spam quảng cáo ${'x'.repeat(600)}` })
  assert.deepEqual([response.status, response.body.impact], [200, { comments: 2, adminReplies: 1, otherReaderReplies: 1 }])
  const row = readerRow(id)!
  assert.deepEqual([row.isBanned, row.bannedBy, row.tokenVersion, String(row.banReason).length], [true, moderator.id, 5, 500])
  assert.ok(row.bannedAt instanceof Date)
  // The reader's own rows; the replies under them go by the FK cascade on MySQL.
  assert.deepEqual(h.harness.rows(articleComments).filter(c => c.readerId === id), [])
  assert.equal(h.harness.rows(articleComments).filter(c => c.readerId === other).length, 1)
  const [audit] = audits()
  assert.deepEqual([audit!.action, audit!.resource, audit!.resourceId, audit!.meta.operation, audit!.meta.displayName, audit!.meta.deletedComments, audit!.meta.deletedAdminReplies, audit!.meta.deletedOtherReaderReplies],
    ['update', 'readers', id, 'ban', 'Nguyễn Văn A', 2, 1, 1])

  assert.equal((await h.request('POST', '/api/admin/readers/999/ban', moderator, {})).status, 404)
  assert.equal(audits().length, 1)
})

test('ban is all or nothing: a failed audit insert leaves the account, its ticket and its comments as they were', async () => {
  const { id } = await readerWithThread()
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('POST', `/api/admin/readers/${id}/ban`, moderator, { reason: 'x' })).status, 500)
  const row = readerRow(id)!
  assert.deepEqual([row.isBanned, row.tokenVersion, row.bannedBy], [false, 0, null])
  assert.equal(h.harness.rows(articleComments).filter(c => c.readerId === id).length, 2)
  assert.deepEqual(audits(), [])
})

test('unban: the flag and its details cleared, tokenVersion left where the ban put it, audited', async () => {
  const id = await reader({ isBanned: true, banReason: 'Spam', bannedAt: new Date(), bannedBy: moderator.id, tokenVersion: 3 })
  const response = await h.request('POST', `/api/admin/readers/${id}/unban`, moderator)
  assert.deepEqual([response.status, response.body], [200, { ok: true }])
  const row = readerRow(id)!
  assert.deepEqual([row.isBanned, row.banReason, row.bannedAt, row.bannedBy, row.tokenVersion], [false, null, null, null, 3])
  assert.deepEqual(audits().map(a => [a.action, a.resourceId, a.meta.operation]), [['update', id, 'unban']])
  assert.equal((await h.request('POST', '/api/admin/readers/999/unban', moderator)).status, 404)
})

test('FINDING-R6-10: lifting a ban that is not there changes nothing and records nothing', async () => {
  const id = await reader()
  const response = await h.request('POST', `/api/admin/readers/${id}/unban`, moderator)
  assert.equal(response.status, 200)
  // Before: an "unban" audit row for an account that was never banned — a change that
  // did not happen, which `setReaderEmailPreference` in the same module refuses to log.
  assert.deepEqual(audits(), [])
})

test('delete: the account row goes, the audit row keeps who it was and what went with it', async () => {
  const { id } = await readerWithThread()
  const response = await h.request('DELETE', `/api/admin/readers/${id}`, moderator)
  assert.deepEqual([response.status, response.body.impact], [200, { comments: 2, adminReplies: 1, otherReaderReplies: 1 }])
  assert.equal(readerRow(id), undefined)
  assert.deepEqual(audits().map(a => [a.action, a.resource, a.resourceId, a.meta.displayName, a.meta.deletedComments]), [['delete', 'readers', id, 'Nguyễn Văn A', 2]])
  assert.equal((await h.request('DELETE', '/api/admin/readers/999', moderator)).status, 404)

  const kept = await reader()
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('DELETE', `/api/admin/readers/${kept}`, moderator)).status, 500)
  assert.ok(readerRow(kept), 'a failed audit insert rolls the delete back')
})

test('purge comments: the reader\'s comments go, the account stays able to post; audited under comments; all or nothing', async () => {
  const { id } = await readerWithThread()
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('DELETE', `/api/admin/readers/${id}/comments`, commentsOfficer)).status, 500)
  assert.equal(h.harness.rows(articleComments).filter(c => c.readerId === id).length, 2)

  const response = await h.request('DELETE', `/api/admin/readers/${id}/comments`, commentsOfficer)
  assert.deepEqual([response.status, response.body.impact], [200, { comments: 2, adminReplies: 1, otherReaderReplies: 1 }])
  assert.equal(h.harness.rows(articleComments).filter(c => c.readerId === id).length, 0)
  assert.equal(readerRow(id)!.isBanned, false)
  assert.deepEqual(audits().map(a => [a.userId, a.action, a.resource, a.resourceId, a.meta.operation, a.meta.deletedComments]),
    [[commentsOfficer.id, 'delete', 'comments', id, 'purge_reader_comments', 2]])
  assert.equal((await h.request('DELETE', '/api/admin/readers/999/comments', commentsOfficer)).status, 404)
})

// ─── Address bans ────────────────────────────────────────────────────────────

test('ip-bans: a valid address or IPv4 range is stored as normalised, with its audit row; anything else is refused before the insert', async () => {
  const created = await h.request('POST', '/api/admin/ip-bans', moderator, { value: ' 203.0.113.0/24 ', reason: '  Spam bình luận  ' })
  assert.equal(created.status, 201)
  const id = created.body.id as number
  assert.deepEqual(h.harness.rows(readerIpBans).map(row => [row.id, row.value, row.reason, row.createdBy]), [[id, '203.0.113.0/24', 'Spam bình luận', moderator.id]])
  assert.deepEqual(audits(), [{ userId: moderator.id, action: 'create', resource: 'reader_ip_bans', resourceId: id, meta: { value: '203.0.113.0/24', reason: 'Spam bình luận' } }])

  const refused: Array<[unknown, number, string]> = [
    [{ value: '203.0.113.0/24' }, 409, 'Địa chỉ này đã có trong danh sách chặn.'],
    [{ value: '2001:db8::/32' }, 400, 'Chưa hỗ trợ dải IPv6, hãy nhập địa chỉ đầy đủ.'],
    [{ value: '999.1.1.1' }, 400, 'Địa chỉ IP không hợp lệ.'],
    [{ value: '10.0.0.0/33' }, 400, 'Độ dài dải (prefix) phải là số từ 0 đến 32.'],
    [{ value: 42 }, 400, 'Hãy nhập địa chỉ IP cần chặn.'],
    [['198.51.100.1'], 400, 'Dữ liệu không hợp lệ.'],
  ]
  for (const [body, status, message] of refused) {
    const response = await h.request('POST', '/api/admin/ip-bans', moderator, body)
    assert.deepEqual([response.status, response.body.statusMessage], [status, message], JSON.stringify(body))
  }
  assert.equal(h.harness.rows(readerIpBans).length, 1)
  assert.equal(audits().length, 1)

  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('POST', '/api/admin/ip-bans', moderator, { value: '192.0.2.10' })).status, 500)
  assert.equal(h.harness.rows(readerIpBans).length, 1, 'no ban in force that no log accounts for')
})

test('FINDING-R6-11: the address-ban list is newest first, and a ban stays readable after its author account is deleted', async () => {
  // Values that sort the other way round from their ids: newest first is not "highest address first".
  const first = await h.request('POST', '/api/admin/ip-bans', moderator, { value: '198.51.100.9' })
  const second = await h.request('POST', '/api/admin/ip-bans', moderator, { value: '192.0.2.2', reason: 'Lặp lại' })
  const third = await h.request('POST', '/api/admin/ip-bans', moderator, { value: '10.0.0.0/8' })
  h.harness.sqlite.prepare('DELETE FROM users WHERE id = ?').run(moderator.id)
  const response = await h.request('GET', '/api/admin/ip-bans', viewer)
  assert.equal(response.status, 200)
  // Before: oldest first, while the module promised "newest first — the officer
  // reviewing bans cares about recent decisions" (the page does not re-sort).
  assert.deepEqual((response.body.bans as Json[]).map(ban => [ban.id, ban.value, ban.reason, ban.createdByName]), [
    [third.body.id, '10.0.0.0/8', null, null], [second.body.id, '192.0.2.2', 'Lặp lại', null], [first.body.id, '198.51.100.9', null, null],
  ])
})

// ─── Two identical requests at once (verifier M1) ────────────────────────────
// `beforeNext` commits what the OTHER request did just before this one's first write in
// its transaction — the interleaving two officers' clicks produce on MySQL (replayed on
// MySQL 8 in /home/ray/orca/cdht-wave3-tests-r6-proof/mysql-reader-race-*.log).

test('FINDING-R6-10 (M1): two unbans at once — the one that finds the ban already lifted records nothing', async () => {
  const id = await reader({ isBanned: true, banReason: 'Spam', bannedAt: new Date(), bannedBy: moderator.id })
  h.harness.beforeNext(/^update `reader_accounts`/, () => h.harness.sqlite.exec(
    `COMMIT; UPDATE reader_accounts SET is_banned = 0, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE id = ${id};
     INSERT INTO activity_logs (user_id, action, resource, resource_id, meta) VALUES (${viewer.id}, 'update', 'readers', ${id}, '{"operation":"unban"}'); BEGIN`,
  ))
  const response = await h.request('POST', `/api/admin/readers/${id}/unban`, moderator)
  // Same answer as for a reader who is not banned; before: a second "unban" row (30/30 on MySQL).
  assert.deepEqual([response.status, response.body], [200, { ok: true }])
  assert.deepEqual(audits().map(a => [a.userId, a.meta.operation]), [[viewer.id, 'unban']])
  assert.equal(readerRow(id)!.isBanned, false)
})

test('FINDING-R6-10 (M1): two bans at once — the second counts only what it deleted, and both bump the ticket version', async () => {
  const { id } = await readerWithThread()
  // The other ban commits first: flag, version + 1, the reader's two comments gone.
  h.harness.beforeNext(/^(select .* from `reader_accounts` .*for update|update `reader_accounts`)/s, () => h.harness.sqlite.exec(
    `COMMIT; UPDATE reader_accounts SET is_banned = 1, ban_reason = 'Khác', banned_by = ${viewer.id}, token_version = token_version + 1 WHERE id = ${id};
     DELETE FROM article_comments WHERE reader_id = ${id};
     INSERT INTO activity_logs (user_id, action, resource, resource_id, meta) VALUES (${viewer.id}, 'update', 'readers', ${id}, '{"operation":"ban","deletedComments":2}'); BEGIN`,
  ))
  const response = await h.request('POST', `/api/admin/readers/${id}/ban`, moderator, { reason: 'Spam' })
  assert.deepEqual([response.status, response.body.impact], [200, { comments: 0, adminReplies: 0, otherReaderReplies: 0 }])
  // Before: this audit row also claimed the 2 comments (4 claimed for 2 deleted — 30/30 on
  // MySQL), and `tokenVersion` was written from the stale read: 1 after two bans.
  assert.deepEqual(audits().map(a => [a.userId, a.meta.deletedComments]), [[viewer.id, 2], [moderator.id, 0]])
  assert.equal(readerRow(id)!.tokenVersion, 2)
})

test('FINDING-R6-10 (M1): two deletions of one account at once — the loser is the 404 of a missing account, with no audit row', async () => {
  const id = await reader()
  h.harness.beforeNext(/^delete from `reader_accounts`/, () => h.harness.sqlite.exec(
    `COMMIT; DELETE FROM reader_accounts WHERE id = ${id};
     INSERT INTO activity_logs (user_id, action, resource, resource_id, meta) VALUES (${viewer.id}, 'delete', 'readers', ${id}, '{"deletedComments":0}'); BEGIN`,
  ))
  const response = await h.request('DELETE', `/api/admin/readers/${id}`, moderator)
  // Before: 200 and a second "delete" row for one deletion (30/30 on MySQL).
  assert.deepEqual([response.status, response.body.statusMessage], [404, 'Không tìm thấy tài khoản người đọc.'])
  assert.deepEqual(audits().map(a => [a.userId, a.action]), [[viewer.id, 'delete']])
})

test('FINDING-R6-10 (M1): two purges of one reader\'s comments at once — the second counts only what it deleted', async () => {
  const { id } = await readerWithThread()
  h.harness.beforeNext(/^(select .* from `reader_accounts` .*for update|delete from `article_comments`)/s, () => h.harness.sqlite.exec(
    `COMMIT; DELETE FROM article_comments WHERE reader_id = ${id};
     INSERT INTO activity_logs (user_id, action, resource, resource_id, meta) VALUES (${viewer.id}, 'delete', 'comments', ${id}, '{"operation":"purge_reader_comments","deletedComments":2}'); BEGIN`,
  ))
  const response = await h.request('DELETE', `/api/admin/readers/${id}/comments`, commentsOfficer)
  assert.deepEqual([response.status, response.body.impact], [200, { comments: 0, adminReplies: 0, otherReaderReplies: 0 }])
  // Before: this row claimed the same 2 comments again (4 claimed for 2 — 30/30 on MySQL).
  assert.deepEqual(audits().map(a => [a.userId, a.meta.deletedComments]), [[viewer.id, 2], [commentsOfficer.id, 0]])
})

test('FINDING-R6-10 (M1): two lifts of one address ban at once — the loser is the 404 of a missing ban, with no audit row', async () => {
  const id = (await h.request('POST', '/api/admin/ip-bans', moderator, { value: '192.0.2.88' })).body.id as number
  h.harness.beforeNext(/^delete from `reader_ip_bans`/, () => h.harness.sqlite.exec(
    `COMMIT; DELETE FROM reader_ip_bans WHERE id = ${id};
     INSERT INTO activity_logs (user_id, action, resource, resource_id, meta) VALUES (${viewer.id}, 'delete', 'reader_ip_bans', ${id}, '{"value":"192.0.2.88"}'); BEGIN`,
  ))
  const response = await h.request('DELETE', `/api/admin/ip-bans/${id}`, moderator)
  // Before: 200 and a second "delete" row for one lift (30/30 on MySQL).
  assert.deepEqual([response.status, response.body.statusMessage], [404, 'Không tìm thấy mục chặn này.'])
  assert.deepEqual(audits().map(a => [a.userId, a.action]), [[moderator.id, 'create'], [viewer.id, 'delete']])
})

test('FINDING-R6-10 (M1): two bans of one address at once — the loser is the 409 of a duplicate, not a 500', async () => {
  // The schema's UNIQUE(value), which the harness leaves out.
  h.harness.sqlite.exec('CREATE UNIQUE INDEX test_reader_ip_bans_value ON reader_ip_bans (value)')
  try {
    h.harness.beforeNext(/^insert (?:ignore )?into `reader_ip_bans`/, () => h.harness.sqlite.exec(
      `COMMIT; INSERT INTO reader_ip_bans (value, created_by) VALUES ('192.0.2.99', ${viewer.id}); BEGIN`,
    ))
    const response = await h.request('POST', '/api/admin/ip-bans', moderator, { value: '192.0.2.99' })
    // Before: ER_DUP_ENTRY → 500 (30/30 on MySQL).
    assert.deepEqual([response.status, response.body.statusMessage], [409, 'Địa chỉ này đã có trong danh sách chặn.'])
    assert.equal(h.harness.rows(readerIpBans).length, 1)
    assert.deepEqual(audits(), [])
  } finally {
    h.harness.sqlite.exec('DROP INDEX test_reader_ip_bans_value')
  }
})

test('an address-ban insert skipped for another reason than a duplicate (IGNORE hides a foreign-key error too) is an error, not "already listed"', async () => {
  // RAISE(IGNORE) skips the row the way MySQL's INSERT IGNORE skips one whose created_by is gone.
  h.harness.sqlite.exec('CREATE TRIGGER test_skip_ip_ban BEFORE INSERT ON reader_ip_bans BEGIN SELECT RAISE(IGNORE); END')
  try {
    const response = await h.request('POST', '/api/admin/ip-bans', moderator, { value: '192.0.2.123' })
    assert.equal(response.status, 500)
    assert.deepEqual([h.harness.rows(readerIpBans), audits()], [[], []])
  } finally {
    h.harness.sqlite.exec('DROP TRIGGER test_skip_ip_ban')
  }
})

test('ip-bans delete: the row goes and the audit row keeps the value; 404 for a missing one; all or nothing', async () => {
  const created = await h.request('POST', '/api/admin/ip-bans', moderator, { value: '192.0.2.77' })
  const id = created.body.id as number
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await h.request('DELETE', `/api/admin/ip-bans/${id}`, moderator)).status, 500)
  assert.equal(h.harness.rows(readerIpBans).length, 1, 'an address is never silently un-banned')

  assert.deepEqual((await h.request('DELETE', `/api/admin/ip-bans/${id}`, moderator)).body, { ok: true })
  assert.deepEqual(h.harness.rows(readerIpBans), [])
  assert.deepEqual(audits().map(a => [a.action, a.resourceId, a.meta]), [['create', id, { value: '192.0.2.77', reason: null }], ['delete', id, { value: '192.0.2.77' }]])
  assert.equal((await h.request('DELETE', `/api/admin/ip-bans/${id}`, moderator)).status, 404)
  assert.equal((await h.request('DELETE', '/api/admin/ip-bans/abc', moderator)).status, 400)
})
