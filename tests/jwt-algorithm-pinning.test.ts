/**
 * Every JWT this app issues is HS256, and every verify must accept HS256 ONLY.
 * Without `algorithms`, jsonwebtoken lets the token's own `alg` header choose
 * among the HMAC variants for a symmetric key; pinning it means the header never
 * decides how a token is checked. Tokens minted before the change (HS256 by
 * default) must keep verifying — nobody is logged out by this.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

process.env.JWT_SECRET = 'test-only-jwt-secret-for-algorithm-pinning'

const jwt = (await import('jsonwebtoken')).default
const {
  signToken,
  verifyToken,
  signMfaChallenge,
  verifyMfaChallenge,
  signReaderToken,
  verifyReaderToken,
  readerSigningKey,
} = await import('../server/utils/auth.ts')

const admin = { userId: 7, username: 'editor', roleId: 3, roleName: 'Biên tập', tokenVersion: 0 }
const header = (token: string) => JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as { alg: string }

test('issued tokens are HS256 and verify', () => {
  const session = signToken(admin)
  assert.equal(header(session).alg, 'HS256')
  assert.equal(verifyToken(session)?.userId, 7)

  const challenge = signMfaChallenge({ userId: 7, username: 'editor', tokenVersion: 0 } as Parameters<typeof signMfaChallenge>[0])
  assert.equal(header(challenge).alg, 'HS256')
  assert.equal(verifyMfaChallenge(challenge)?.stage, 'mfa-challenge')

  const reader = signReaderToken({ readerId: 4, tokenVersion: 1 })
  assert.equal(header(reader).alg, 'HS256')
  assert.equal(verifyReaderToken(reader)?.readerId, 4)
})

test('a token minted before the change (library default, no algorithm option) still verifies', () => {
  const legacy = jwt.sign({ stage: 'session', ...admin }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  assert.equal(verifyToken(legacy)?.userId, 7)
  const legacyReader = jwt.sign({ readerId: 4, tokenVersion: 1, stage: 'reader' }, readerSigningKey(), { expiresIn: '1h' })
  assert.equal(verifyReaderToken(legacyReader)?.readerId, 4)
})

test('the same secret under another algorithm is refused everywhere', () => {
  for (const algorithm of ['HS384', 'HS512'] as const) {
    const session = jwt.sign({ stage: 'session', ...admin }, process.env.JWT_SECRET!, { algorithm, expiresIn: '1h' })
    assert.equal(verifyToken(session), null, `session ${algorithm}`)
    const challenge = jwt.sign({ stage: 'mfa-challenge', userId: 7 }, process.env.JWT_SECRET!, { algorithm, expiresIn: '1h' })
    assert.equal(verifyMfaChallenge(challenge), null, `challenge ${algorithm}`)
    const reader = jwt.sign({ readerId: 4, tokenVersion: 1, stage: 'reader' }, readerSigningKey(), { algorithm, expiresIn: '1h' })
    assert.equal(verifyReaderToken(reader), null, `reader ${algorithm}`)
  }
})

test('an unsigned (alg none) token is refused', () => {
  const none = jwt.sign({ stage: 'session', ...admin }, '', { algorithm: 'none' })
  assert.equal(verifyToken(none), null)
})
