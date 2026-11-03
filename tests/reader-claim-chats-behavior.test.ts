import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * `POST /api/public/reader/claim-chats` (server/api/public/reader/claim-chats.post.ts)
 * — attach the chat sessions a browser held before signing in to the reader who
 * just signed in.
 *
 * A transcript can hold a phone number and an account of somebody's criminal
 * record, so the claim must be PROVED, not asserted. Pinned:
 *   - only a session whose `<uuid>.<hmac>` ticket verifies under the server's
 *     secret is attached; an id on its own, a forged or foreign-key signature, and
 *     an `id` field that disagrees with the ticket attach nothing;
 *   - a session that already belongs to another reader is never taken, even with
 *     a valid (leaked) ticket — the `reader_id IS NULL` condition in the UPDATE;
 *   - re-claiming is harmless, duplicates count once, the batch is capped at 50;
 *   - no secret configured → claim nothing; a malformed body → 400; not signed in
 *     → 401. None of those writes.
 *
 * Real h3 app; the real `requireReader` (signed reader cookie, `reader_accounts`
 * row) and the real `verifySessionToken`; Drizzle's SQL on SQLite
 * (`_sqlite-mysql-db.ts`) so the UPDATE's WHERE is the one that decides.
 */

process.env.JWT_SECRET = 'reader-claim-chats-behavior-test-secret-0123456789'
const SECRET = 'claim-chats-hmac-secret-0123456789abcdef0123456789abcdef'
let hmacSecret = SECRET
;(globalThis as unknown as Record<string, unknown>).useRuntimeConfig = () => ({ analytics: { hmacSecret } })

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { readerAccounts, chatSessions } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([readerAccounts, chatSessions])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const claimChats = (await import('../server/api/public/reader/claim-chats.post')).default
const { issueSessionToken } = await import('../server/utils/chatbot/session-token')
const { signReaderToken, signToken } = await import('../server/utils/auth')

const server = await startHandlerServer([{ method: 'post', path: '/api/public/reader/claim-chats', handler: claimChats }])
after(() => server.close())

const ALICE = 11
const BOB = 12
const readerCookie = (readerId: number) => `cdkt_reader=${signReaderToken({ readerId, tokenVersion: 0 })}`
const claim = (body: unknown, readerId: number | null = ALICE) =>
  server.request('POST', '/api/public/reader/claim-chats', { cookie: readerId === null ? undefined : readerCookie(readerId), body })

/** A chat session row plus its ticket, minted the way the chat endpoint mints it. */
async function chat(owner: number | null = null, secret = SECRET): Promise<{ id: string, token: string }> {
  const { sessionId, token } = issueSessionToken(secret)
  const now = new Date()
  await harness.db.insert(chatSessions).values({ id: sessionId, readerId: owner, startedAt: now, lastMessageAt: now })
  return { id: sessionId, token }
}
const ownerOf = (id: string) => harness.rows(chatSessions).find(row => row.id === id)?.readerId ?? null
const owners = () => harness.rows(chatSessions).map(row => row.readerId)

beforeEach(async () => {
  harness.reset()
  hmacSecret = SECRET
  await harness.db.insert(readerAccounts).values([
    { id: ALICE, googleSub: 'google-alice' },
    { id: BOB, googleSub: 'google-bob' },
  ])
})

test('a session with a valid ticket is attached to the signed-in reader', async () => {
  const session = await chat()
  const response = await claim({ sessions: [session] })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, claimed: 1, verified: 1 })
  assert.equal(ownerOf(session.id), ALICE)
})

test('the claim is proved, not asserted: ids, forged and foreign signatures attach nothing', async () => {
  const target = await chat()
  const otherSecret = await chat(null, 'a-different-secret-0123456789abcdef0123456789')
  const forgedSignature = `${target.id}.${'0'.repeat(32)}`
  const response = await claim({
    sessions: [
      { id: target.id },
      { id: target.id, token: forgedSignature },
      { id: target.id, token: target.id },
      { token: otherSecret.token },
      { token: `${target.token}x` },
      { token: target.token.toUpperCase() },
      null, 'just-a-string', 42,
    ],
  })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, claimed: 0, verified: 0 })
  assert.deepEqual(owners(), [null, null])
})

test('the ticket decides which session, never the id beside it', async () => {
  const mine = await chat()
  const stranger = await chat()
  const response = await claim({ sessions: [{ id: stranger.id, token: mine.token }] })
  assert.deepEqual(response.body, { ok: true, claimed: 1, verified: 1 })
  assert.equal(ownerOf(mine.id), ALICE)
  assert.equal(ownerOf(stranger.id), null, 'the id field was trusted over the ticket')
})

test('a session that already belongs to another reader is not taken, even with its valid ticket', async () => {
  const bobs = await chat(BOB)
  const response = await claim({ sessions: [bobs] })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, claimed: 0, verified: 1 })
  assert.equal(ownerOf(bobs.id), BOB)
})

test('re-claiming is harmless and still counted; the same ticket twice counts once', async () => {
  const session = await chat()
  await claim({ sessions: [session] })
  const again = await claim({ sessions: [session, session, { token: session.token }] })
  assert.deepEqual(again.body, { ok: true, claimed: 1, verified: 1 })
  assert.equal(ownerOf(session.id), ALICE)
})

test('at most 50 tickets are looked at per call', async () => {
  const sessions = []
  for (let index = 0; index < 51; index += 1) sessions.push(await chat())
  const response = await claim({ sessions })
  assert.deepEqual(response.body, { ok: true, claimed: 50, verified: 50 })
  assert.equal(ownerOf(sessions[50]!.id), null, 'the 51st ticket was processed')
})

test('with no secret configured nothing can be verified, so nothing is claimed', async () => {
  const session = await chat()
  hmacSecret = ''
  harness.statements.length = 0
  const response = await claim({ sessions: [session] })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, claimed: 0, verified: 0 })
  assert.equal(ownerOf(session.id), null)
  assert.ok(!harness.statements.some(sql => sql.startsWith('update')), 'claimed on the client\'s word')
})

test('a malformed body is a 400 and writes nothing', async () => {
  const session = await chat()
  for (const body of ['not json', '[]', JSON.stringify([session]), '{}', JSON.stringify({ sessions: session }), JSON.stringify({ sessions: session.token })]) {
    const response = await server.request('POST', '/api/public/reader/claim-chats', { cookie: readerCookie(ALICE), body })
    assert.equal(response.status, 400, body)
  }
  assert.deepEqual(owners(), [null])
})

test('without a reader session (or with a stale or admin one) the claim is refused and nothing is written', async () => {
  const session = await chat()
  assert.equal((await claim({ sessions: [session] }, null)).status, 401)
  const stale = `cdkt_reader=${signReaderToken({ readerId: ALICE, tokenVersion: 3 })}`
  assert.equal((await server.request('POST', '/api/public/reader/claim-chats', { cookie: stale, body: { sessions: [session] } })).status, 401)
  assert.equal((await claim({ sessions: [session] }, 999)).status, 401)
  const adminToken = signToken({ userId: ALICE, username: 'admin', roleId: 1, roleName: 'Quản trị hệ thống', tokenVersion: 0 })
  for (const cookie of [`cdkt_reader=${adminToken}`, `cdkt_admin=${adminToken}`]) {
    assert.equal((await server.request('POST', '/api/public/reader/claim-chats', { cookie, body: { sessions: [session] } })).status, 401, cookie.split('=')[0])
  }
  assert.deepEqual(owners(), [null])
})
