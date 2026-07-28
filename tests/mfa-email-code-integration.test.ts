/**
 * The email one-time code lifecycle, driven against a real MySQL.
 *
 * attemptEmailCode reaches for getDb() directly and its whole job is a sequence
 * of conditional writes — clear on expiry, increment on a miss, clear on the
 * ceiling, clear on success. None of that is observable without a database, and
 * a source-text assertion cannot tell a burned code from a reusable one. So this
 * suite follows the *-ddl-integration precedent: gated behind an env var,
 * against a throwaway schema it creates and drops itself.
 *
 *   MFA_DDL_INTEGRATION=1 MFA_DDL_PORT=33069 MFA_DDL_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'

const enabled = process.env.MFA_DDL_INTEGRATION === '1'
const host = process.env.MFA_DDL_HOST || '127.0.0.1'
const port = Number(process.env.MFA_DDL_PORT || 3306)
const user = process.env.MFA_DDL_USER || 'root'
const password = process.env.MFA_DDL_PASSWORD || 'rootpassword'
const database = `cdkt_mfa_email_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_mfa_email_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

test('an emailed code is single-use, expiring, attempt-capped, and replaced on reissue', {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  assertDisposableDatabase(database)

  const admin = await mysql.createConnection({ host, port, user, password })
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
  await admin.end()

  // getDb() caches its pool on first call, so the env has to be in place before
  // anything imports a module that touches it.
  const previous = { ...process.env }
  Object.assign(process.env, {
    DB_HOST: host,
    DB_PORT: String(port),
    DB_USER: user,
    DB_PASSWORD: password,
    DB_NAME: database,
  })

  try {
    const { initDb } = await import('../server/db/init')
    await initDb()

    const { getDb } = await import('../server/utils/db')
    const { userMfaFactors, users } = await import('../server/db/schema')
    const { eq } = await import('drizzle-orm')
    const { attemptEmailCode } = await import('../server/utils/mfa/factors')
    const { issueEmailCode } = await import('../server/utils/mfa/email-code')
    const {
      EMAIL_CODE_MAX_ATTEMPTS,
      EMAIL_CODE_TTL_MS,
      hashOneTimeCode,
    } = await import('../server/utils/mfa/codes')

    const db = getDb()
    await db.insert(users).values({
      username: 'mfa_email_probe',
      email: 'probe@example.test',
      // Never used here; the login password is not part of this factor's path.
      passwordHash: '$2b$12$0000000000000000000000000000000000000000000000000000',
      isActive: true,
      tokenVersion: 0,
    })
    const [account] = await db.select().from(users).where(eq(users.username, 'mfa_email_probe')).limit(1)
    const userId = account!.id

    await db.insert(userMfaFactors).values({ userId, factorType: 'email_otp', state: 'pending' })
    const factorRow = async () => {
      const [row] = await db
        .select()
        .from(userMfaFactors)
        .where(eq(userMfaFactors.userId, userId))
        .limit(1)
      return row!
    }
    const factorId = (await factorRow()).id

    /** Store a code we know the plaintext of. issueEmailCode only ever mails it. */
    const plant = async (code: string, expiresAt: Date) => {
      await db
        .update(userMfaFactors)
        .set({
          pendingCodeHash: await hashOneTimeCode(code),
          pendingCodeExpiresAt: expiresAt,
          pendingCodeAttempts: 0,
        })
        .where(eq(userMfaFactors.id, factorId))
    }
    const live = () => new Date(Date.now() + EMAIL_CODE_TTL_MS)

    // ── A pending factor cannot answer a challenge ───────────────────────────
    await plant('111111', live())
    assert.deepEqual(
      await attemptEmailCode(userId, '111111'),
      { ok: false, reason: 'no-factor' },
      'an unconfirmed factor must not satisfy a login even with a valid code',
    )

    await db.update(userMfaFactors).set({ state: 'active' }).where(eq(userMfaFactors.id, factorId))

    // ── The correct code ────────────────────────────────────────────────────
    await plant('222222', live())
    assert.deepEqual(await attemptEmailCode(userId, '222222'), { ok: true, method: 'email_otp' })
    let row = await factorRow()
    assert.equal(row.pendingCodeHash, null, 'a spent code must not stay on the row')
    assert.equal(row.pendingCodeExpiresAt, null)
    assert.equal(row.pendingCodeAttempts, 0)
    assert.ok(row.lastUsedAt, 'a successful use is stamped')

    // Single-use: the same code again has nothing left to match against.
    assert.deepEqual(await attemptEmailCode(userId, '222222'), { ok: false, reason: 'expired' })

    // Surrounding whitespace is what a paste from an email client produces.
    await plant('333333', live())
    assert.deepEqual(await attemptEmailCode(userId, '  333333 '), { ok: true, method: 'email_otp' })

    // ── A wrong code ────────────────────────────────────────────────────────
    await plant('444444', live())
    assert.deepEqual(await attemptEmailCode(userId, '444443'), { ok: false, reason: 'mismatch' })
    row = await factorRow()
    assert.equal(row.pendingCodeAttempts, 1, 'a miss is counted')
    assert.ok(row.pendingCodeHash, 'but the code survives a single typo')
    // And the real code still works afterwards.
    assert.deepEqual(await attemptEmailCode(userId, '444444'), { ok: true, method: 'email_otp' })

    // ── An expired code ─────────────────────────────────────────────────────
    await plant('555555', new Date(Date.now() - 1000))
    assert.deepEqual(await attemptEmailCode(userId, '555555'), { ok: false, reason: 'expired' })
    row = await factorRow()
    assert.equal(row.pendingCodeHash, null, 'an expired code is cleared, not left to be ground down')
    assert.equal(row.pendingCodeExpiresAt, null)

    // A row with no outstanding code reports expired rather than mismatch, so a
    // caller cannot distinguish "never issued" from "wrong".
    assert.deepEqual(await attemptEmailCode(userId, '555555'), { ok: false, reason: 'expired' })

    // ── The attempt ceiling ─────────────────────────────────────────────────
    await plant('666666', live())
    for (let i = 1; i <= EMAIL_CODE_MAX_ATTEMPTS; i++) {
      assert.deepEqual(
        await attemptEmailCode(userId, '000000'),
        { ok: false, reason: 'mismatch' },
        `attempt ${i} of ${EMAIL_CODE_MAX_ATTEMPTS} is still a plain miss`,
      )
    }
    assert.equal((await factorRow()).pendingCodeAttempts, EMAIL_CODE_MAX_ATTEMPTS)

    // The next submission is refused on the ceiling — and crucially, the *correct*
    // code is refused too: the code is burned, not merely rate limited.
    assert.deepEqual(await attemptEmailCode(userId, '666666'), { ok: false, reason: 'attempts' })
    row = await factorRow()
    assert.equal(row.pendingCodeHash, null, 'hitting the ceiling clears the code')
    assert.equal(row.pendingCodeAttempts, 0, 'and resets the counter for the next issue')
    assert.deepEqual(await attemptEmailCode(userId, '666666'), { ok: false, reason: 'expired' })

    // ── A reissue invalidates the previous code ─────────────────────────────
    await plant('777777', live())
    // Half-consume the allowance, so the reset is visible.
    await attemptEmailCode(userId, '000000')
    assert.equal((await factorRow()).pendingCodeAttempts, 1)

    // No SMTP in this schema, so the send fails — deliberately. The store-then-send
    // order means the new code has already replaced the old one by then, which is
    // exactly the property under test.
    const issued = await issueEmailCode({
      factorId,
      email: account!.email,
      username: account!.username,
      purpose: 'login',
    })
    assert.deepEqual(issued, { ok: false, reason: 'smtp' }, 'unconfigured SMTP is reported, not thrown')

    row = await factorRow()
    assert.ok(row.pendingCodeHash, 'a fresh code is stored even when the mail fails')
    assert.equal(row.pendingCodeAttempts, 0, 'the allowance resets with the new code')
    assert.ok(row.pendingCodeExpiresAt && row.pendingCodeExpiresAt.getTime() > Date.now())
    assert.deepEqual(
      await attemptEmailCode(userId, '777777'),
      { ok: false, reason: 'mismatch' },
      'the superseded code must no longer verify',
    )

    // An account with no address gets no code at all, rather than a silent no-op.
    assert.deepEqual(
      await issueEmailCode({ factorId, email: null, username: account!.username, purpose: 'login' }),
      { ok: false, reason: 'no-email' },
    )
  } finally {
    // getDb() caches a pool with no exported teardown; left open it holds the
    // test runner's event loop past the last assertion.
    const { getPool } = await import('../server/utils/db')
    await getPool()?.end()
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    const cleanup = await mysql.createConnection({ host, port, user, password })
    await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await cleanup.end()
  }
})
