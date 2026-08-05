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
import { describe, it } from 'node:test'

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
