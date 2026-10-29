import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import { createEvent, type H3Event } from 'h3'

/**
 * A reply e-mail goes out only after the reply has passed moderation, and its
 * subject never carries the reader-chosen name (spec comment-notifications,
 * design D6).
 *
 * `createComment` mailed the parent's author first and only then fired the full
 * (AI) moderation with `void`. A reply that moderation hid a second later had
 * already been delivered — abuse, scam links, whatever got past the instant
 * word list — into a citizen's inbox, under a subject that read
 * "[Con Đường Hướng Thiện] <any name the replier chose> đã trả lời…", so a reader
 * calling themselves "Ban quản trị" mailed as the portal.
 *
 * The REAL `createComment`, `createReplyNotification` and `sendReplyEmail` run
 * here; the database, the moderation verdict and the SMTP transport are faked.
 */

type Row = Record<string, unknown>
const REPLIER_NAME = 'Ban quản trị'

// ─── Database: rows chosen by table + projection ──────────────────────────────
const { articles, articleComments, mediaItems, readerAccounts } = await import('../server/db/schema')
function rowsFor(table: unknown, projection: Row): Row[] {
  const keys = Object.keys(projection)
  if (table === articles) return [{ id: 1, title: 'Bài viết', slug: 'bai-viet', status: 'published', commentsEnabled: true }]
  if (table === mediaItems) return [{ id: 9, title: 'Video', slug: 'video', shortId: 'AbCdEfGhIjK', status: 'published', commentsEnabled: true }]
  if (table === readerAccounts) {
    return keys.includes('email')
      ? [{ email: 'parent-author@example.vn', emailNotifications: true, isBanned: false }]
      : [{ id: 5, isBanned: false, displayName: REPLIER_NAME, customDisplayName: REPLIER_NAME }]
  }
  if (table === articleComments) {
    if (keys.includes('olderCount')) return [{ olderCount: 0 }]
    if (keys.includes('body')) return [{ body: 'Nội dung trả lời', adminUserId: null, articleId: 1, mediaItemId: null, readerName: REPLIER_NAME, readerCustomName: REPLIER_NAME }]
    if (keys.length === 1 && keys[0] === 'readerId') return [{ readerId: 7 }]
    return [{ id: 3, articleId: 1, mediaItemId: null, parentId: null }]
  }
  return []
}
const select = (projection: Row) => ({
  from: (table: unknown) => {
    const chain = {
      leftJoin: () => chain,
      where: () => ({ limit: async () => rowsFor(table, projection) }),
    }
    return chain
  },
})
/** Errors the next inserts throw, in order — each into one table (the comment, or the notification). */
const insertFailures: Array<{ table: unknown, error: unknown }> = []
let transactionsBegun = 0
const insert = (table: unknown) => ({
  values: () => {
    const at = insertFailures.findIndex(failure => failure.table === table)
    const result = at >= 0 ? Promise.reject(insertFailures.splice(at, 1)[0]!.error) : Promise.resolve([{ insertId: 99 }])
    result.catch(() => {}) // rejected only once awaited, as a Drizzle query is
    return Object.assign(result, { onDuplicateKeyUpdate: () => result })
  },
})
const fakeDb = {
  select,
  insert,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => { transactionsBegun += 1; return fn({ select, insert }) },
}

/** As on MySQL: Drizzle's "Failed query" error, the driver's error as its `cause` (verbatim message shape, MySQL 8.0.46). */
const { DrizzleQueryError } = await import('drizzle-orm')
const { readerNotifications } = await import('../server/db/schema')
function fkError(table: string, constraint: string, column: string, references: string) {
  const sqlMessage = `Cannot add or update a child row: a foreign key constraint fails (\`db\`.\`${table}\`, CONSTRAINT \`${constraint}\` FOREIGN KEY (\`${column}\`) REFERENCES \`${references}\` (\`id\`) ON DELETE CASCADE)`
  return new DrizzleQueryError(`insert into \`${table}\` …`, [], Object.assign(new Error(sqlMessage), { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2', sqlState: '23000', sqlMessage }))
}
const deadlockError = () => new DrizzleQueryError('insert into `article_comments` …', [],
  Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { errno: 1213, code: 'ER_LOCK_DEADLOCK' }))
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => null } })

// ─── Transport, limits, bans ──────────────────────────────────────────────────
const mails: Array<{ to: string, subject: string, text: string }> = []
mock.module('../server/utils/mailer', {
  namedExports: {
    getSmtpConfig: async () => ({ host: 'smtp.example.vn', port: 587, secure: false, user: 'u', pass: 'p', from: 'noreply@example.vn' }),
    sendMail: async (args: { to: string, subject: string, text: string }) => { mails.push(args) },
  },
})
let rateLimitHits = 0
mock.module('../server/utils/rate-limit-store', { namedExports: { recordRateLimitHit: async () => { rateLimitHits += 1; return { blocked: false, retryAfterSeconds: 0 } } } })
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({}) } })
mock.module('../server/services/ip-bans', { namedExports: { loadIpBanValues: async () => [] } })

// ─── Moderation: the verdict each test wants ──────────────────────────────────
type Behaviour = 'clean' | 'hide' | 'hide-write-failed' | 'flag-only' | 'ai-failed' | 'throw' | 'slow-clean' | 'slow-ai-failed' | 'deferred'
let behaviour: Behaviour = 'clean'
let preModerations = 0
const moderationCalls: Array<{ targetId?: number }> = []
/** What each moderation call was given besides the text — the request's regex budget. */
const budgetsSeen = { instant: [] as unknown[], full: [] as unknown[] }
mock.module('../server/services/moderation-worker', {
  namedExports: {
    fastPreModerate: async (_body: string, context?: { regexBudget?: unknown }) => {
      preModerations += 1
      budgetsSeen.instant.push(context?.regexBudget)
      return { blocked: false, action: 'allow', severity: 'low', reason: '', matchedRule: '' }
    },
    checkAndModerateContent: (input: { targetId?: number }, options?: { regexBudget?: unknown }) => {
      moderationCalls.push(input)
      budgetsSeen.full.push(options?.regexBudget)
      switch (behaviour) {
        case 'clean': return Promise.resolve({ flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] })
        case 'hide': return Promise.resolve({ flagged: true, action: 'auto_hide', severity: 'high', reasons: ['x'], matchedRules: [], hidden: true, failures: [] })
        // The verdict was "hide" but the hide write failed: the reply is still on
        // the page. The e-mail is held on the VERDICT, not on whether hiding worked.
        case 'hide-write-failed': return Promise.resolve({ flagged: true, action: 'auto_hide', severity: 'high', reasons: ['x'], matchedRules: [], hidden: false, failures: ['hide'] })
        // AI not configured: queued for a human, left visible — not hidden or blocked.
        case 'flag-only': return Promise.resolve({ flagged: true, action: 'flag_only', severity: 'medium', reasons: ['x'], matchedRules: [], hidden: false, failures: [] })
        // The AI was asked and did not answer usably: the verdict reads "allow",
        // but moderation did not complete (moderation-worker reports `aiFailed`).
        case 'ai-failed': return Promise.resolve({ flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [], aiFailed: true, aiFailure: 'provider_error' })
        case 'throw': return Promise.reject(new Error('moderation exploded'))
        // The model answers late — 30 s, past any 10 s timer, inside the gateway's 35 s.
        case 'slow-clean': return new Promise((resolve) => { setTimeout(() => resolve(CLEAN), 30_000) })
        // The gateway gives up at its own limit and reports the failure.
        case 'slow-ai-failed': return new Promise((resolve) => { setTimeout(() => resolve({ ...CLEAN, aiFailed: true, aiFailure: 'provider_error' }), 35_000) })
        // Resolved by the test, with whatever verdict it wants, when it wants.
        case 'deferred': return new Promise((resolve) => { release = resolve })
      }
    },
  },
})
let release: (verdict: unknown) => void = () => {}
const CLEAN = { flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] }
const HIDE = { flagged: true, action: 'auto_hide', severity: 'high', reasons: ['x'], matchedRules: [], hidden: true, failures: [] }

// ─── Log capture ──────────────────────────────────────────────────────────────
const logged: Row[] = []
for (const method of ['log', 'error'] as const) {
  mock.method(console, method, (line: unknown) => {
    try { logged.push(JSON.parse(String(line))) } catch { /* not a logger line */ }
  })
}

const { createComment } = await import('../server/services/comments.ts')

function requestEvent(): H3Event {
  const req = new IncomingMessage(new Socket())
  req.url = '/api/public/articles/bai-viet/comments'
  req.method = 'POST'
  req.headers = { host: 'localhost' }
  return createEvent(req, new ServerResponse(req))
}

/** Let the background "moderate → mail" chain run to its end (all fakes are promise-based). */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setImmediate(resolve))
}

const replyInput = (body: string) => ({ readerId: 5, articleId: 1, parentId: 3, body, ip: '203.0.113.9', userAgent: 'test', event: requestEvent() })

/** Post a reply; the handler's result is checked, then the background chain is let finish. */
async function reply(body = 'Một câu trả lời'): Promise<void> {
  mails.length = 0
  moderationCalls.length = 0
  logged.length = 0
  const result = await createComment(replyInput(body))
  assert.deepEqual(result, { ok: true, id: 99 }, 'the reply itself is always stored')
  assert.equal(moderationCalls.length, 1, 'moderation runs exactly once per comment')
  assert.equal(moderationCalls[0]!.targetId, 99)
  await settle()
}
const held = () => logged.filter(entry => entry.event === 'comment.reply_email_held')

/**
 * Design D6: "The comment insert and in-app notification still commit first.
 * Only the e-mail waits." The reader's POST answers as soon as the reply is
 * stored; moderation and the e-mail run behind it.
 */
test('the handler answers before moderation finishes; the e-mail goes only once a clean verdict arrives', async () => {
  for (const [verdict, mailed] of [[CLEAN, 1], [HIDE, 0]] as const) {
    behaviour = 'deferred'
    mails.length = 0
    logged.length = 0
    const handler = createComment(replyInput('Một câu trả lời')).then(result => ({ result }))
    const outcome = await Promise.race([handler, settle().then(() => 'still waiting' as const)])
    try {
      assert.notEqual(outcome, 'still waiting', 'the reply POST waited for moderation')
      assert.deepEqual((outcome as { result: unknown }).result, { ok: true, id: 99 })
      assert.equal(mails.length, 0, 'mailed before the verdict')
    } finally {
      release(verdict)
      await handler
      await settle()
    }
    assert.equal(mails.length, mailed, `verdict ${verdict.action}: wrong number of e-mails`)
    assert.equal(held().length, 1 - mailed)
  }
})

test('a reply that moderation hides is never mailed', async () => {
  for (const verdict of ['hide', 'hide-write-failed'] as const) {
    behaviour = verdict
    await reply()
    assert.equal(mails.length, 0, `${verdict}: the parent's author received the hidden reply`)
    assert.equal(held().length, 1, `${verdict}: the hold is logged`)
    assert.equal(held()[0]!.reason, 'moderation_hidden')
  }
})

test('a clean reply is mailed to the parent comment author', async () => {
  behaviour = 'clean'
  await reply()
  assert.equal(mails.length, 1)
  assert.equal(mails[0]!.to, 'parent-author@example.vn')
  assert.equal(held().length, 0)
})

test('a reply left visible for human review (flag_only) is mailed — it is neither hidden nor blocked', async () => {
  behaviour = 'flag-only'
  await reply()
  assert.equal(mails.length, 1)
})

test('a moderation error holds the e-mail and logs comment.reply_email_held', async () => {
  behaviour = 'throw'
  await reply()
  assert.equal(mails.length, 0)
  assert.equal(held().length, 1)
  assert.equal(held()[0]!.reason, 'moderation_error')
})

test('an AI that failed (allow verdict + aiFailed) holds the e-mail — moderation did not complete', async () => {
  behaviour = 'ai-failed'
  await reply()
  assert.equal(mails.length, 0, 'mailed although the AI never judged the reply')
  assert.equal(held().length, 1)
  assert.equal(held()[0]!.reason, 'moderation_ai_failed')
  assert.equal(held()[0]!.aiFailure, 'provider_error')
})

/**
 * Design D6: moderation is "bounded by its existing timeout" — the AI gateway's
 * own ~35 s request limit, which turns a slow provider into a failed call
 * (`aiFailed` → held). A shorter timer of our own on top of it only dropped the
 * e-mail of clean replies the model judged in 10–35 s, and a held e-mail is never
 * retried. So the chain waits for the verdict itself.
 */
test('a slow but clean verdict (well past 10 s, inside the gateway limit) still sends the e-mail', async () => {
  behaviour = 'slow-clean'
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await reply()
    assert.equal(mails.length, 0, 'mailed before the verdict')
    mock.timers.tick(30_000)
    await settle()
  } finally {
    mock.timers.reset()
  }
  assert.equal(held().length, 0, `held: ${JSON.stringify(held())}`)
  assert.equal(mails.length, 1)
})

test('a slow verdict that ends in a gateway failure is held (the gateway timeout is the bound)', async () => {
  behaviour = 'slow-ai-failed'
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await reply()
    mock.timers.tick(35_000)
    await settle()
  } finally {
    mock.timers.reset()
  }
  assert.equal(mails.length, 0)
  assert.equal(held().length, 1)
  assert.equal(held()[0]!.reason, 'moderation_ai_failed')
})

test('the subject of a reader reply is fixed and never carries the replier\'s chosen name', async () => {
  behaviour = 'clean'
  await reply()
  const subject = mails[0]!.subject
  assert.doesNotMatch(subject, /Ban quản trị/i, `subject: ${subject}`)
  assert.match(subject, /Có người trả lời bình luận của bạn/)
  // The name is still in the body, as text.
  assert.match(mails[0]!.text, /Ban quản trị đã trả lời bình luận của bạn/)
})

test('what the comment hangs on removed between the checks and the insert (FK 1452) is the checks\' own answer, not a 500', async (t) => {
  t.after(() => { insertFailures.length = 0 }) // a failure here must not leave queued errors to the next test
  behaviour = 'clean'
  mails.length = 0
  moderationCalls.length = 0
  // A reply whose parent a ban / purge / account deletion removed meanwhile (verifier round 4, M1).
  // On MySQL the 1452 is the `cause` of Drizzle's error (V4-08: without walking it, still a 500).
  insertFailures.push({ table: articleComments, error: fkError('article_comments', 'fk_article_comments_parent', 'parent_id', 'article_comments') })
  assert.deepEqual(await createComment(replyInput('Một câu trả lời')), { ok: false, statusCode: 400, message: 'Bình luận gốc không tồn tại.' })
  // A top-level comment whose article was deleted meanwhile.
  insertFailures.push({ table: articleComments, error: fkError('article_comments', 'fk_article_comments_article', 'article_id', 'articles') })
  assert.deepEqual(await createComment({ readerId: 5, articleId: 1, parentId: null, body: 'Bình luận gốc', ip: '203.0.113.9', userAgent: 'test', event: requestEvent() }),
    { ok: false, statusCode: 404, message: 'Bài viết không tồn tại.' })
  // A comment under a video whose video was deleted meanwhile (verifier round 5, L-2) — the media key,
  // wrapped in Drizzle's error as on MySQL: the video's own 404, not the article's and not a 500.
  insertFailures.push({ table: articleComments, error: fkError('article_comments', 'fk_article_comments_media', 'media_item_id', 'media_items') })
  assert.deepEqual(await createComment({ readerId: 5, mediaItemId: 9, parentId: null, body: 'Bình luận dưới video', ip: '203.0.113.9', userAgent: 'test', event: requestEvent() }),
    { ok: false, statusCode: 404, message: 'Video không tồn tại.' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([moderationCalls.length, mails.length], [0, 0])
  // Only the keys the comment hangs on (verifier L-3): the author's own row gone, or the
  // notification's keys, are not "the thing replied to" — thrown, nothing mailed.
  for (const error of [
    fkError('article_comments', 'fk_article_comments_reader', 'reader_id', 'reader_accounts'),
    Object.assign(new Error('Cannot add or update a child row'), { errno: 1452 }), // names no key
  ]) {
    insertFailures.push({ table: articleComments, error })
    await assert.rejects(createComment(replyInput('Một câu trả lời')), (thrown: unknown) => thrown === error)
  }
  // V4-20: the comment insert went through, the NOTIFICATION's insert broke a key — thrown, not
  // answered as a missing parent; the transaction rolls back and nobody is mailed.
  const notifyFailure = fkError('reader_notifications', 'fk_reader_notifications_reader', 'reader_id', 'reader_accounts')
  insertFailures.push({ table: readerNotifications, error: notifyFailure })
  await assert.rejects(createComment(replyInput('Một câu trả lời')), (thrown: unknown) => thrown === notifyFailure)
  await settle()
  assert.deepEqual([moderationCalls.length, mails.length], [0, 0])
  // Any other failure is still thrown.
  const timeout = Object.assign(new Error('Lock wait timeout exceeded'), { errno: 1205 })
  insertFailures.push({ table: articleComments, error: timeout })
  await assert.rejects(createComment(replyInput('Một câu trả lời')), (thrown: unknown) => thrown === timeout)
})

test('a reply chosen as a deadlock victim is written again in a new transaction — the limits, checks, moderation and e-mail happen once', async (t) => {
  // A reply holds its parent comment, then the parent author's reader row; a ban or an account
  // deletion holds them the other way round. InnoDB rolls the victim back whole: before, a 500
  // (verifier round 4, H-B — 10 of 10 next to a reader with 200–1000 comments).
  behaviour = 'clean'
  mails.length = 0
  moderationCalls.length = 0
  insertFailures.length = 0
  t.after(() => { insertFailures.length = 0 }) // a failure here must not leave queued errors to the next test
  insertFailures.push({ table: articleComments, error: deadlockError() }, { table: readerNotifications, error: deadlockError() })
  const [hits, pre, begun] = [rateLimitHits, preModerations, transactionsBegun]
  assert.deepEqual(await createComment(replyInput('Một câu trả lời')), { ok: true, id: 99 })
  await settle()
  // Exactly three attempts, each its own transaction (V4-10: a retry inside the rolled-back one;
  // V4-17: two attempts) — and everything outside the transaction once.
  assert.deepEqual([transactionsBegun - begun, rateLimitHits - hits, preModerations - pre, moderationCalls.length, mails.length], [3, 2, 1, 1, 1])

  // Three in a row: the deadlock is the answer, nothing moderated, nothing mailed.
  mails.length = 0
  moderationCalls.length = 0
  for (let n = 0; n < 3; n += 1) insertFailures.push({ table: articleComments, error: deadlockError() })
  const before = transactionsBegun
  await assert.rejects(createComment(replyInput('Một câu trả lời')), /Failed query/)
  await settle()
  assert.deepEqual([transactionsBegun - before, moderationCalls.length, mails.length, insertFailures.length], [3, 0, 0, 0])
})

test('a top-level comment (nobody to notify) is still moderated, and nothing is mailed', async () => {
  behaviour = 'clean'
  mails.length = 0
  moderationCalls.length = 0
  const result = await createComment({ readerId: 5, articleId: 1, parentId: null, body: 'Bình luận gốc', ip: '203.0.113.9', userAgent: 'test', event: requestEvent() })
  assert.deepEqual(result, { ok: true, id: 99 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(moderationCalls.length, 1)
  assert.equal(mails.length, 0)
})

/**
 * The regex matching of one comment — the instant check in the request AND the full moderation
 * that runs behind it, on the same event loop — shares ONE budget (wave3 4.3c follow-up, C1:
 * a sub-budget cubic rule cost 0.42–0.50 s per comment, every comment). The bound itself is
 * proven in `moderation-regex-budget.test.ts`; this pins that the posting path passes it.
 */
test('one regex budget per comment, shared by the instant check and the full moderation; a new comment gets a new one', async () => {
  const { MODERATION_REQUEST_BUDGET_MS } = await import('../server/services/moderation-regex.ts')
  behaviour = 'clean'
  budgetsSeen.instant.length = 0
  budgetsSeen.full.length = 0
  await reply('Bình luận thứ nhất')
  await reply('Bình luận thứ hai')
  assert.equal(budgetsSeen.instant.length, 2)
  assert.equal(budgetsSeen.full.length, 2)
  const [first, second] = budgetsSeen.instant as Array<{ limitMs: number }>
  assert.equal(first!.limitMs, MODERATION_REQUEST_BUDGET_MS)
  // By IDENTITY: every budget is a frozen `{ limitMs: 250 }`, so a structural comparison
  // (`deepEqual`) also passes when the full moderation is handed a NEW budget — another
  // 250 ms for the same comment (verify of 4.3c follow-up, W1: that mutant stayed green).
  assert.strictEqual(budgetsSeen.full[0], first, 'the full moderation of comment 1 runs on comment 1\'s budget object')
  assert.strictEqual(budgetsSeen.full[1], second, 'the full moderation of comment 2 runs on comment 2\'s budget object')
  assert.notStrictEqual(first, second, 'each comment has its own')
})
