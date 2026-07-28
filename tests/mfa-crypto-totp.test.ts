import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpFromKey,
  totpStep,
  verifyTotp,
} from '../server/utils/mfa/totp'
import jwt from 'jsonwebtoken'
import { mfaEncryptionKey, mfaKeyId } from '../server/utils/mfa/key'
import { sealTotpSecret, unsealTotpSecret } from '../server/utils/mfa/crypto'
import {
  MFA_CHALLENGE_TTL_SECONDS,
  isSessionStage,
  signMfaChallenge,
  signToken,
  verifyMfaChallenge,
  verifyToken,
} from '../server/utils/auth'

/**
 * TOTP here is hand-written on node:crypto, so it is only trustworthy to the
 * extent it reproduces the RFCs' published vectors. That is what the first two
 * blocks do. The rest covers the properties the login path depends on: drift
 * tolerance, replay refusal, an encryption envelope that can tell a key rotation
 * apart from tampering, and a challenge ticket that cannot be spent as a session.
 */

const withJwtSecret = <T>(secret: string, fn: () => T): T => {
  const previous = process.env.JWT_SECRET
  process.env.JWT_SECRET = secret
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previous
  }
}

// ─── RFC 4226 Appendix D — HOTP vectors ──────────────────────────────────────
test('HOTP matches every RFC 4226 Appendix D vector', () => {
  const key = Buffer.from('12345678901234567890', 'ascii')
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ]
  expected.forEach((code, counter) => {
    assert.equal(hotp(key, counter), code, `counter ${counter}`)
  })
})

// ─── RFC 6238 Appendix B — TOTP vectors (SHA-1, 8 digits) ────────────────────
test('TOTP matches the RFC 6238 Appendix B SHA-1 vectors', () => {
  const key = Buffer.from('12345678901234567890', 'ascii')
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]
  for (const [seconds, code] of vectors) {
    const step = Math.floor(seconds / TOTP_STEP_SECONDS)
    assert.equal(totpFromKey(key, step, 8), code, `T=${seconds}`)
  }
})

test('the counter is a full 64-bit big-endian value, not a wrapped 32-bit one', () => {
  // The RFC vectors all land below 2^32 once divided into 30s steps, so they do
  // not exercise the counter width. A 32-bit write would fold 2^32 + n onto n.
  const key = Buffer.from('12345678901234567890', 'ascii')
  assert.notEqual(hotp(key, 2 ** 32 + 1, 8), hotp(key, 1, 8))
  assert.notEqual(hotp(key, 2 ** 33, 8), hotp(key, 0, 8))
})

// ─── base32 ──────────────────────────────────────────────────────────────────
test('base32 round-trips and rejects characters outside the alphabet', () => {
  const raw = Buffer.from('12345678901234567890', 'ascii')
  assert.equal(base32Encode(raw), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.deepEqual(base32Decode(base32Encode(raw)), raw)
  // Typed by hand: lowercase, spaces, and padding must all be tolerated.
  assert.deepEqual(base32Decode('gezd gnbv gy3t qojq gezdgnbvgy3tqojq='), raw)
  assert.throws(() => base32Decode('GEZD1088'), /base32/)
})

test('a generated secret carries 160 bits and validates its own code', () => {
  const secret = generateTotpSecret()
  assert.match(secret, /^[A-Z2-7]+$/)
  assert.equal(base32Decode(secret).length, 20)
  const result = verifyTotp(secret, totpFromKey(base32Decode(secret), totpStep()))
  assert.equal(result.ok, true)
})

// ─── Drift and replay ────────────────────────────────────────────────────────
test('one step of drift is accepted either side and two steps is not', () => {
  const secret = generateTotpSecret()
  const key = base32Decode(secret)
  const now = 1_700_000_000_000
  const current = totpStep(now)

  for (const offset of [-1, 0, 1]) {
    const result = verifyTotp(secret, totpFromKey(key, current + offset), { atMs: now })
    assert.equal(result.ok, true, `offset ${offset} should be accepted`)
  }
  for (const offset of [-2, 2, 5]) {
    const result = verifyTotp(secret, totpFromKey(key, current + offset), { atMs: now })
    assert.equal(result.ok, false, `offset ${offset} must be refused`)
  }
})

test('a code already accepted is refused while the next step still works', () => {
  const secret = generateTotpSecret()
  const key = base32Decode(secret)
  const now = 1_700_000_000_000
  const current = totpStep(now)

  const first = verifyTotp(secret, totpFromKey(key, current), { atMs: now })
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.step, current)

  const replay = verifyTotp(secret, totpFromKey(key, current), { atMs: now, lastAcceptedStep: current })
  assert.equal(replay.ok, false)
  assert.equal(!replay.ok && replay.reason, 'replay')

  // The adjacent step is a different code and must not be caught by the guard.
  const next = verifyTotp(secret, totpFromKey(key, current + 1), { atMs: now, lastAcceptedStep: current })
  assert.equal(next.ok, true)
})

test('malformed submissions are rejected on shape, not compared', () => {
  const secret = generateTotpSecret()
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
    const result = verifyTotp(secret, bad)
    assert.equal(result.ok, false, `${bad} must be refused`)
    assert.equal(!result.ok && result.reason, 'format')
  }
})

test('the otpauth URI carries the parameters an authenticator app needs', () => {
  const uri = otpauthUri({ secret: 'GEZDGNBVGY3TQOJQ', account: 'admin', issuer: 'CDKT Admin' })
  assert.match(uri, /^otpauth:\/\/totp\/CDKT%20Admin:admin\?/)
  assert.match(uri, /secret=GEZDGNBVGY3TQOJQ/)
  assert.match(uri, /algorithm=SHA1/)
  assert.match(uri, new RegExp(`digits=${TOTP_DIGITS}`))
  assert.match(uri, new RegExp(`period=${TOTP_STEP_SECONDS}`))
})

// ─── Key derivation ──────────────────────────────────────────────────────────
test('the derived key is 32 bytes, deterministic, and not the signing secret', () => {
  const secret = 'a'.repeat(48)
  const first = withJwtSecret(secret, () => mfaEncryptionKey())
  const second = withJwtSecret(secret, () => mfaEncryptionKey())
  assert.equal(first.length, 32)
  assert.deepEqual(first, second)
  // Reusing the raw signing secret as an encryption key is the mistake HKDF exists to prevent.
  assert.notEqual(first.toString('utf8'), secret)
  assert.notEqual(first.toString('base64'), Buffer.from(secret, 'utf8').toString('base64'))
})

test('a different JWT_SECRET yields a different key and key id', () => {
  const a = withJwtSecret('a'.repeat(48), () => ({ key: mfaEncryptionKey(), id: mfaKeyId() }))
  const b = withJwtSecret('b'.repeat(48), () => ({ key: mfaEncryptionKey(), id: mfaKeyId() }))
  assert.notDeepEqual(a.key, b.key)
  assert.notEqual(a.id, b.id)
  assert.equal(a.id.length, 16)
})

test('a missing secret in production throws instead of falling back', () => {
  const previousEnv = process.env.NODE_ENV
  const previousSecret = process.env.JWT_SECRET
  try {
    process.env.NODE_ENV = 'production'
    delete process.env.JWT_SECRET
    assert.throws(() => mfaEncryptionKey(), /JWT_SECRET/)
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousEnv
    if (previousSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = previousSecret
  }
})

// ─── Encryption envelope ─────────────────────────────────────────────────────
test('a sealed secret round-trips under the same key', () => {
  withJwtSecret('c'.repeat(48), () => {
    const secret = generateTotpSecret()
    const sealed = sealTotpSecret(secret)
    // The plaintext must not be recoverable from the envelope by inspection.
    assert.ok(!sealed.ciphertext.includes(secret))
    const opened = unsealTotpSecret(sealed)
    assert.equal(opened.ok, true)
    assert.equal(opened.ok && opened.secret, secret)
  })
})

test('tampering with the ciphertext or authTag fails closed', () => {
  withJwtSecret('c'.repeat(48), () => {
    const sealed = sealTotpSecret(generateTotpSecret())

    const flip = (value: string) => {
      const buf = Buffer.from(value, 'base64')
      buf[0] = buf[0]! ^ 0xff
      return buf.toString('base64')
    }

    const badCipher = unsealTotpSecret({ ...sealed, ciphertext: flip(sealed.ciphertext) })
    assert.equal(badCipher.ok, false)
    assert.equal(!badCipher.ok && badCipher.reason, 'tampered')

    const badTag = unsealTotpSecret({ ...sealed, authTag: flip(sealed.authTag) })
    assert.equal(badTag.ok, false)
    assert.equal(!badTag.ok && badTag.reason, 'tampered')

    const badNonce = unsealTotpSecret({ ...sealed, nonce: flip(sealed.nonce) })
    assert.equal(badNonce.ok, false)
  })
})

test('a key rotation is reported as a mismatch, distinct from tampering', () => {
  // This distinction is the whole reason key_id is stored: after a JWT_SECRET
  // rotation the login path must degrade gracefully, not shout "tampered".
  const sealed = withJwtSecret('c'.repeat(48), () => sealTotpSecret(generateTotpSecret()))
  const result = withJwtSecret('d'.repeat(48), () => unsealTotpSecret(sealed))
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.reason, 'key-mismatch')
})

test('an incomplete envelope is malformed rather than throwing', () => {
  withJwtSecret('c'.repeat(48), () => {
    const sealed = sealTotpSecret(generateTotpSecret())
    for (const field of ['ciphertext', 'nonce', 'authTag', 'version', 'keyId'] as const) {
      const partial = { ...sealed, [field]: undefined }
      const result = unsealTotpSecret(partial)
      assert.equal(result.ok, false, `missing ${field}`)
    }
    assert.equal(unsealTotpSecret(null).ok, false)
    // An unknown envelope version must not be decrypted on a best-effort basis.
    const wrongVersion = unsealTotpSecret({ ...sealed, version: 99 })
    assert.equal(wrongVersion.ok, false)
    assert.equal(!wrongVersion.ok && wrongVersion.reason, 'malformed')
  })
})

test('nonces are not reused across seals', () => {
  withJwtSecret('c'.repeat(48), () => {
    const nonces = new Set(Array.from({ length: 50 }, () => sealTotpSecret('GEZDGNBVGY3TQOJQ').nonce))
    assert.equal(nonces.size, 50)
  })
})

// ─── Challenge ticket ────────────────────────────────────────────────────────
/**
 * The ticket and the session cookie are signed with the same key, so the stage
 * claim is the only thing standing between a half-authenticated ticket and full
 * admin access. These run for real rather than reading the source.
 */
const CHALLENGE = { userId: 42, username: 'someone', tokenVersion: 3 }

test('the challenge ticket carries the challenge stage and its own short lifetime', () => {
  withJwtSecret('d'.repeat(48), () => {
    const payload = verifyMfaChallenge(signMfaChallenge(CHALLENGE))
    assert.ok(payload, 'a freshly signed ticket must verify')
    assert.equal(payload!.stage, 'mfa-challenge')
    assert.equal(payload!.userId, CHALLENGE.userId)
    assert.equal(payload!.tokenVersion, CHALLENGE.tokenVersion)
    // Bounded, and far shorter than the 8h session.
    assert.equal(MFA_CHALLENGE_TTL_SECONDS, 5 * 60)
    const { exp, iat } = payload as unknown as { exp: number, iat: number }
    assert.equal(exp - iat, MFA_CHALLENGE_TTL_SECONDS)
  })
})

test('an expired ticket verifies as nothing at all', () => {
  withJwtSecret('d'.repeat(48), () => {
    // Signed as if issued one second before the window closed.
    const stale = jwt.sign(
      { ...CHALLENGE, stage: 'mfa-challenge' },
      'd'.repeat(48),
      { expiresIn: -(MFA_CHALLENGE_TTL_SECONDS + 1) },
    )
    assert.equal(verifyMfaChallenge(stale), null, 'an expired ticket must not verify')
  })
})

test('the two stages are not interchangeable in either direction', () => {
  withJwtSecret('d'.repeat(48), () => {
    // A session token presented as a ticket: rejected, or a live session would
    // skip the fresh password check the challenge exists to force.
    const session = signToken({ userId: 42, username: 'someone', roleId: 1, roleName: 'superadmin', tokenVersion: 3 })
    assert.equal(verifyMfaChallenge(session), null)
    assert.equal(isSessionStage(verifyToken(session)), true)

    // A ticket presented as a session: it verifies as a signed token — same key —
    // which is exactly why the middleware checks the stage rather than the signature.
    const ticket = signMfaChallenge(CHALLENGE)
    assert.ok(verifyToken(ticket), 'same key, so the signature alone cannot tell them apart')
    assert.equal(isSessionStage(verifyToken(ticket)), false, 'the stage must give it away')
  })
})

test('a token minted before the stage claim existed still reads as a session', () => {
  withJwtSecret('d'.repeat(48), () => {
    // Deployed sessions predate the claim; treating absence as a challenge would
    // log every administrator out on release.
    const legacy = jwt.sign({ userId: 42, username: 'someone', roleId: 1, roleName: 'superadmin', tokenVersion: 3 }, 'd'.repeat(48), { expiresIn: '8h' })
    assert.equal(isSessionStage(verifyToken(legacy)), true)
    assert.equal(verifyMfaChallenge(legacy), null, 'but it is still not a challenge ticket')
  })
})

test('a ticket signed under a different secret is refused', () => {
  const forged = withJwtSecret('e'.repeat(48), () => signMfaChallenge(CHALLENGE))
  withJwtSecret('d'.repeat(48), () => {
    assert.equal(verifyMfaChallenge(forged), null)
  })
})
