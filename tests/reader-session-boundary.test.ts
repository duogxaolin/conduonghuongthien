/**
 * The reader/admin session boundary (design.md D1, reader-google-login-comments).
 *
 * Two INDEPENDENT barriers separate a public reader ticket from an admin session,
 * and this file exists to prove neither one is load-bearing on its own:
 *
 *   1. The `stage` claim — verifyToken's callers (server/middleware/admin-auth.ts
 *      via isSessionStage) reject anything not stage 'session'; verifyReaderToken
 *      rejects anything not stage 'reader'.
 *   2. The signing key — reader tickets are signed with readerSigningKey(), an
 *      HKDF derivation of JWT_SECRET, never JWT_SECRET itself.
 *
 * Either barrier alone is a single point of failure. A claim check alone dies to
 * one refactor that forgets isSessionStage — so the key barrier is asserted with
 * a hand-forged token that DOES carry stage:'session' but is signed with the
 * reader key. A key separation alone dies the day someone "simplifies" the two
 * keys back into one — so the claim barrier is asserted separately. Both tests
 * must be able to fail for different reasons; that is the point.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it, mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { getTableColumns, getTableName, is, SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

// Must be set before importing auth.ts: jwtSecret()/readerKeyMaterial() read
// process.env at call time, but a stray production-shaped env would change which
// branch they take. A fixed value also keeps the derived key deterministic.
process.env.JWT_SECRET = 'test-only-jwt-secret-for-reader-session-boundary'

const jwt = (await import('jsonwebtoken')).default
const {
  signToken,
  verifyToken,
  isSessionStage,
  signReaderToken,
  verifyReaderToken,
  readerSigningKey,
} = await import('../server/utils/auth.ts')

const adminPayload = {
  userId: 7,
  username: 'admin',
  roleId: 1,
  roleName: 'SuperAdmin',
  tokenVersion: 3,
} as const

describe('reader ↔ admin session boundary', () => {
  it('a reader ticket is not a valid admin token', () => {
    const readerTicket = signReaderToken({ readerId: 42, tokenVersion: 0 })
    assert.equal(verifyToken(readerTicket), null)
  })

  it('an admin session token is not a valid reader ticket', () => {
    const adminToken = signToken({ ...adminPayload })
    assert.equal(verifyReaderToken(adminToken), null)
  })

  it('isSessionStage() reads a reader stage as not-a-session', () => {
    assert.equal(isSessionStage({ stage: 'reader' }), false)
    // Contrast: the two stages that ARE sessions, so a future change that makes
    // everything false does not pass this test by accident.
    assert.equal(isSessionStage({ stage: 'session' }), true)
    assert.equal(isSessionStage({}), true)
  })

  it('the key barrier holds even when the stage claim says session', () => {
    // Barrier 1 deliberately bypassed: this token claims stage 'session', so a
    // verifier that only checked the claim would accept it. It is signed with the
    // reader key, so verifyToken (jwtSecret()) must still reject it on signature.
    const forged = jwt.sign(
      { ...adminPayload, stage: 'session' },
      readerSigningKey(),
      { expiresIn: '8h' },
    )
    assert.equal(verifyToken(forged), null)
  })

  it('the key barrier holds in the other direction too', () => {
    // A well-formed reader payload signed with the raw JWT_SECRET instead of the
    // derived key — i.e. what an admin-side signer would produce if the two key
    // paths were ever collapsed into one.
    const forged = jwt.sign(
      { readerId: 42, tokenVersion: 0, stage: 'reader' },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' },
    )
    assert.equal(verifyReaderToken(forged), null)
  })

  it('each verifier still accepts its own token (guards against a vacuous pass)', () => {
    const readerTicket = signReaderToken({ readerId: 42, tokenVersion: 5 })
    const decoded = verifyReaderToken(readerTicket)
    assert.equal(decoded?.readerId, 42)
    assert.equal(decoded?.tokenVersion, 5)
    assert.equal(decoded?.stage, 'reader')

    const adminToken = signToken({ ...adminPayload })
    assert.equal(verifyToken(adminToken)?.username, 'admin')
  })
})

/**
 * The admin boundary itself (task 3.5).
 *
 * The two tests above prove the PRIMITIVES refuse each other. This one proves the
 * middleware that guards /api/admin/** actually applies them — a correct
 * `verifyToken` is worth nothing if the middleware stopped calling it.
 *
 * It reads source text rather than mounting an H3 app, and that limit is worth
 * stating plainly: it proves the gate is still written, not that it fires. What
 * makes it useful anyway is the failure it is aimed at — a refactor deleting the
 * `isSessionStage` call, which is exactly the "future refactor that stops
 * checking the claim" design.md D1 names as the reason the second barrier exists.
 * Deleting either line below turns this test red.
 */
describe('server/middleware/admin-auth.ts keeps both gates', () => {
  const source = readFileSync(new URL('../server/middleware/admin-auth.ts', import.meta.url), 'utf8')

  it('verifies the signature through verifyToken (the key barrier)', () => {
    assert.match(
      source,
      /verifyToken\(token\)/,
      'admin-auth.ts no longer verifies the token — a reader ticket would be read as an admin session',
    )
  })

  it('refuses any stage that is not a session (the claim barrier)', () => {
    assert.match(
      source,
      /if\s*\(!isSessionStage\(payload\)\)/,
      'admin-auth.ts no longer checks the stage claim — an mfa-challenge or reader ticket would pass',
    )
  })

  it('does not fall back to accepting an unverified payload', () => {
    // `jwt.decode` reads a payload WITHOUT checking the signature. Its presence
    // in this file would mean an identity was established from something anyone
    // can write, so the barrier would be decorative.
    assert.ok(
      !/jwt\s*\.\s*decode\s*\(/.test(source),
      'admin-auth.ts decodes a token without verifying it',
    )
  })
})

/**
 * Reader sign-out revokes the session server-side (spec reader-session, design D4).
 *
 * Clearing the cookie only removes the ticket from THIS browser. A copy of it —
 * from a shared computer, a proxy log, a stolen profile — stayed valid for the rest
 * of its 30 days, because the ticket is self-contained and nothing on the server
 * said it had ended. Sign-out now bumps `reader_accounts.token_version`, the same
 * column a ban bumps, so every ticket issued before it fails `resolveReader`.
 *
 * Runs the REAL logout handler and the REAL `optionalReader` against an in-memory
 * SQLite `reader_accounts` table; the WHERE and SET clauses are compiled by the
 * MySQL dialect, so a write aimed at the wrong row or column fails here.
 */
const { readerAccounts } = await import('../server/db/schema')
const sqlite = new DatabaseSync(':memory:')
const dialect = new MySqlDialect()
const readerColumns = getTableColumns(readerAccounts) as Record<string, { name: string }>
sqlite.exec(`CREATE TABLE ${getTableName(readerAccounts)} (${Object.values(readerColumns).map(c => `\`${c.name}\``).join(', ')})`)
const writes: string[] = []

type Row = Record<string, unknown>
function readerRows(where: SQL, projection: Row): Row[] {
  const query = dialect.sqlToQuery(where)
  const raw = sqlite.prepare(`SELECT * FROM reader_accounts WHERE ${query.sql}`).all(...query.params as never[]) as Row[]
  return raw.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[readerColumns[key]!.name] ?? null])))
}
const fakeDb = {
  select: (projection: Row) => ({
    from: () => ({
      where: (where: SQL) => ({ limit: async () => readerRows(where, projection) }),
    }),
  }),
  update: () => ({
    set: (values: Row) => ({
      where: async (where: SQL) => {
        const params: unknown[] = []
        const assignments = Object.entries(values).map(([key, value]) => {
          if (is(value, SQL)) {
            const compiled = dialect.sqlToQuery(value)
            params.push(...compiled.params)
            return `\`${readerColumns[key]!.name}\` = ${compiled.sql}`
          }
          params.push(value)
          return `\`${readerColumns[key]!.name}\` = ?`
        })
        const condition = dialect.sqlToQuery(where)
        const statement = `UPDATE reader_accounts SET ${assignments.join(', ')} WHERE ${condition.sql}`
        writes.push(statement)
        sqlite.prepare(statement).run(...[...params, ...condition.params] as never[])
        return [{ affectedRows: 1 }]
      },
    }),
  }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })

type ReaderEvent = { cookies: Record<string, string>, cleared: string[] }
const nitroGlobals = globalThis as unknown as Record<string, unknown>
nitroGlobals.defineEventHandler = (handler: unknown) => handler
nitroGlobals.getCookie = (event: ReaderEvent, name: string) => event.cookies[name]
nitroGlobals.deleteCookie = (event: ReaderEvent, name: string) => { event.cleared.push(name) }

const { optionalReader } = await import('../server/utils/reader-auth.ts')
const logout = (await import('../server/api/public/reader/logout.post.ts')).default as unknown as (event: ReaderEvent) => Promise<{ ok: boolean }>

const withTicket = (ticket?: string): ReaderEvent => ({ cookies: ticket ? { cdkt_reader: ticket } : {}, cleared: [] })
const tokenVersionOf = (id: number) => (sqlite.prepare('SELECT token_version FROM reader_accounts WHERE id = ?').get(id) as { token_version: number }).token_version

describe('reader sign-out revokes the session (spec reader-session)', () => {
  const insert = sqlite.prepare('INSERT INTO reader_accounts (`id`, `google_sub`, `email`, `display_name`, `email_notifications`, `is_banned`, `token_version`) VALUES (?, ?, ?, ?, 1, 0, ?)')
  insert.run(42, 'sub-42', 'a@example.vn', 'Người đọc A', 0)
  insert.run(43, 'sub-43', 'b@example.vn', 'Người đọc B', 7)

  it('a ticket copied before sign-out is anonymous after it', async () => {
    const ticket = signReaderToken({ readerId: 42, tokenVersion: 0 })
    assert.equal((await optionalReader(withTicket(ticket) as never))?.id, 42, 'precondition: the ticket is a live session')

    const event = withTicket(ticket)
    assert.deepEqual(await logout(event), { ok: true })
    assert.deepEqual(event.cleared, ['cdkt_reader'], 'the cookie is still cleared')

    assert.equal(await optionalReader(withTicket(ticket) as never), null, 'the replayed ticket must not resolve to the reader')
    assert.equal(tokenVersionOf(42), 1)
    assert.equal(tokenVersionOf(43), 7, 'only the signed-out reader is touched')
  })

  it('a sign-out without a valid reader session only clears the cookie', async () => {
    writes.length = 0
    for (const event of [
      withTicket(),
      withTicket('not-a-ticket'),
      // A real ticket whose version is already stale: not a session any more.
      withTicket(signReaderToken({ readerId: 43, tokenVersion: 6 })),
    ]) {
      assert.deepEqual(await logout(event), { ok: true })
      assert.deepEqual(event.cleared, ['cdkt_reader'])
    }
    assert.deepEqual(writes, [], 'no reader account may be modified')
    assert.equal(tokenVersionOf(43), 7)
  })
})
