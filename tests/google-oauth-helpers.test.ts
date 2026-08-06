/**
 * Pure helpers behind reader Google login: return-path safety, OAuth state, and
 * the reader IP ban list.
 *
 * Every assertion here is about a value that crosses a trust boundary — a query
 * string, a cookie, an officer's keystrokes — so the tests are written as "what
 * must be refused" first. The one shape that would be easiest to get wrong is
 * the return path: it is checked twice on purpose (before signing, and after
 * signature verification), and the second check is exercised below by signing a
 * hostile path by hand with the real key.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { isSafeReturnPath, safeReturnPathOr } from '../server/utils/google-oauth/return-path.ts'
import { issueState, verifyState, stateSigningKey } from '../server/utils/google-oauth/state.ts'
import { decodeIdTokenClaims, validateIdTokenClaims } from '../server/utils/google-oauth/id-token.ts'
import { validateBanValue, isIpBanned } from '../server/utils/ip-ban.ts'
import { matchesIpList, isTrustedProxy } from '../server/utils/client-ip.ts'

const KEY = Buffer.from('a'.repeat(64), 'hex')

describe('isSafeReturnPath', () => {
  it('accepts a site-relative path with query and fragment', () => {
    assert.equal(isSafeReturnPath('/news/abc?x=1#y'), true)
    assert.equal(isSafeReturnPath('/'), true)
  })

  it('refuses a protocol-relative URL — browsers treat it as absolute', () => {
    assert.equal(isSafeReturnPath('//evil.com'), false)
    assert.equal(isSafeReturnPath('///evil.com'), false)
  })

  it('refuses anything carrying a scheme', () => {
    assert.equal(isSafeReturnPath('https://evil.com'), false)
    assert.equal(isSafeReturnPath('http://x'), false)
    assert.equal(isSafeReturnPath('javascript:alert(1)'), false)
  })

  it('refuses a backslash, which some browsers normalize to a slash', () => {
    assert.equal(isSafeReturnPath('/\\evil'), false)
  })

  it('refuses `@`, which becomes a userinfo separator once a scheme appears', () => {
    assert.equal(isSafeReturnPath('/x@y.com'), false)
  })

  it('refuses raw spaces and control characters', () => {
    assert.equal(isSafeReturnPath('/a b'), false)
    assert.equal(isSafeReturnPath('/a\nLocation: /b'), false)
    assert.equal(isSafeReturnPath('/a\r\nx'), false)
    assert.equal(isSafeReturnPath('/a\x7fb'), false)
  })

  it('refuses the empty string and non-strings', () => {
    assert.equal(isSafeReturnPath(''), false)
    assert.equal(isSafeReturnPath(undefined), false)
    assert.equal(isSafeReturnPath(null), false)
    assert.equal(isSafeReturnPath(42), false)
    assert.equal(isSafeReturnPath({}), false)
    assert.equal(isSafeReturnPath(['/a']), false)
  })

  it('caps the length', () => {
    assert.equal(isSafeReturnPath(`/${'a'.repeat(600)}`), false)
  })

  it('safeReturnPathOr never returns hostile input', () => {
    assert.equal(safeReturnPathOr('/news/1'), '/news/1')
    assert.equal(safeReturnPathOr('//evil.com'), '/')
    assert.equal(safeReturnPathOr(undefined, '/assistant'), '/assistant')
  })
})

describe('issueState / verifyState', () => {
  it('round-trips the original return path', () => {
    const state = issueState('/news/abc?x=1', KEY)
    const result = verifyState({ cookieValue: state, presentedState: state, key: KEY })
    assert.deepEqual(result, { ok: true, returnPath: '/news/abc?x=1' })
  })

  it('falls back to `/` when asked to sign an unsafe path', () => {
    const state = issueState('//evil.com', KEY)
    const result = verifyState({ cookieValue: state, presentedState: state, key: KEY })
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.returnPath, '/')
  })

  it('rejects a tampered payload', () => {
    const state = issueState('/news/1', KEY)
    const [payload, mac] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ s: 'x'.repeat(64), r: '/evil' }), 'utf8').toString('base64url')
    assert.notEqual(forged, payload)
    const result = verifyState({ cookieValue: state, presentedState: `${forged}.${mac}`, key: KEY })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'state-signature-mismatch')
  })

  it('rejects a tampered hmac', () => {
    const state = issueState('/news/1', KEY)
    const [payload] = state.split('.')
    const result = verifyState({ cookieValue: state, presentedState: `${payload}.${'0'.repeat(64)}`, key: KEY })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'state-signature-mismatch')
  })

  it('rejects a validly signed state replayed against a different cookie', () => {
    const mine = issueState('/news/1', KEY)
    const theirs = issueState('/news/2', KEY)
    const result = verifyState({ cookieValue: mine, presentedState: theirs, key: KEY })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'state-nonce-mismatch')
  })

  it('rejects a missing state or a missing cookie distinctly', () => {
    const state = issueState('/news/1', KEY)
    assert.equal(verifyState({ cookieValue: state, presentedState: '', key: KEY }).ok, false)
    const noState = verifyState({ cookieValue: state, presentedState: undefined, key: KEY })
    assert.equal(noState.ok === false && noState.reason, 'state-missing')
    const noCookie = verifyState({ cookieValue: null, presentedState: state, key: KEY })
    assert.equal(noCookie.ok === false && noCookie.reason, 'cookie-missing')
  })

  it('rejects a malformed state shape', () => {
    const bad = verifyState({ cookieValue: 'x.y', presentedState: 'nodothere', key: KEY })
    assert.equal(bad.ok === false && bad.reason, 'state-malformed')
  })

  /**
   * The check that matters most: a state whose `r` is hostile but whose
   * signature is genuine. Crafted by signing with the same key, exactly as an
   * attacker with cookie write access (HTTP-only is not write protection) or a
   * future refactor that forgot the pre-signing check would produce.
   */
  it('rejects a genuinely signed but unsafe return path, and never echoes it', () => {
    const payload = Buffer.from(JSON.stringify({ s: 'b'.repeat(64), r: '//evil.com' }), 'utf8').toString('base64url')
    const mac = createHmac('sha256', KEY).update(payload).digest('hex')
    const state = `${payload}.${mac}`

    const result = verifyState({ cookieValue: state, presentedState: state, key: KEY })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'state-return-path-unsafe')
    assert.notEqual((result as { returnPath?: string }).returnPath, '//evil.com')
  })

  it('stateSigningKey is deterministic, 32 bytes, and follows JWT_SECRET', () => {
    const previous = process.env.JWT_SECRET
    try {
      process.env.JWT_SECRET = 'secret-one'
      const a = stateSigningKey()
      const b = stateSigningKey()
      assert.equal(a.length, 32)
      assert.deepEqual(a, b)

      process.env.JWT_SECRET = 'secret-two'
      assert.notDeepEqual(stateSigningKey(), a)
    } finally {
      if (previous === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = previous
    }
  })
})

describe('validateBanValue', () => {
  it('accepts a bare IPv4 and normalizes it', () => {
    assert.deepEqual(validateBanValue(' 203.0.113.5 '), { ok: true, value: '203.0.113.5' })
    assert.deepEqual(validateBanValue('::ffff:203.0.113.5'), { ok: true, value: '203.0.113.5' })
  })

  it('accepts IPv4 CIDR at both boundaries', () => {
    assert.deepEqual(validateBanValue('10.0.0.0/8'), { ok: true, value: '10.0.0.0/8' })
    assert.deepEqual(validateBanValue('203.0.113.5/32'), { ok: true, value: '203.0.113.5/32' })
    assert.deepEqual(validateBanValue('0.0.0.0/0'), { ok: true, value: '0.0.0.0/0' })
  })

  it('accepts a bare IPv6 literal, which is matched exactly', () => {
    const result = validateBanValue('2001:DB8::1')
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.value, '2001:db8::1')
  })

  it('refuses an IPv6 range and says so explicitly', () => {
    const result = validateBanValue('2001:db8::/32')
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.error, 'Chưa hỗ trợ dải IPv6, hãy nhập địa chỉ đầy đủ.')
  })

  it('refuses empty and malformed input', () => {
    assert.equal(validateBanValue('').ok, false)
    assert.equal(validateBanValue('   ').ok, false)
    assert.equal(validateBanValue('not-an-ip').ok, false)
    assert.equal(validateBanValue('999.1.1.1').ok, false)
    assert.equal(validateBanValue('10.0.0.1/33').ok, false)
    assert.equal(validateBanValue('10.0.0.1/abc').ok, false)
    assert.equal(validateBanValue('10.0.0.1/').ok, false)
    assert.equal(validateBanValue(`1.1.1.${'1'.repeat(80)}`).ok, false)
  })

  it('every rejection carries a Vietnamese message', () => {
    for (const bad of ['', 'not-an-ip', '10.0.0.1/33', '2001:db8::/32']) {
      const result = validateBanValue(bad)
      assert.equal(result.ok, false)
      assert.equal(result.ok === false && typeof result.error === 'string' && result.error.length > 0, true)
    }
  })
})

describe('isIpBanned', () => {
  it('is false for an empty list', () => {
    assert.equal(isIpBanned('203.0.113.5', []), false)
  })

  it('is false for an empty or unreadable address', () => {
    assert.equal(isIpBanned('', ['203.0.113.5']), false)
    assert.equal(isIpBanned(null, ['203.0.113.5']), false)
    assert.equal(isIpBanned('nonsense', ['203.0.113.5']), false)
  })

  it('matches an exact address and a containing block', () => {
    assert.equal(isIpBanned('203.0.113.5', ['203.0.113.5']), true)
    assert.equal(isIpBanned('10.1.2.3', ['10.0.0.0/8']), true)
    assert.equal(isIpBanned('11.1.2.3', ['10.0.0.0/8']), false)
  })

  it('honours the /32 and /0 boundaries', () => {
    assert.equal(isIpBanned('203.0.113.5', ['203.0.113.5/32']), true)
    assert.equal(isIpBanned('203.0.113.6', ['203.0.113.5/32']), false)
    assert.equal(isIpBanned('8.8.8.8', ['0.0.0.0/0']), true)
  })

  it('matches an IPv6 literal exactly', () => {
    assert.equal(isIpBanned('2001:db8::1', ['2001:DB8::1']), true)
    assert.equal(isIpBanned('2001:db8::2', ['2001:db8::1']), false)
  })
})

describe('matchesIpList backs isTrustedProxy without changing it', () => {
  const cases: Array<[string, string[]]> = [
    ['127.0.0.1', ['127.0.0.1', '::1']],
    ['::1', ['127.0.0.1', '::1']],
    ['172.17.0.1', ['10.0.0.0/8']],
    ['10.255.255.255', ['10.0.0.0/8']],
    ['203.0.113.5', ['203.0.113.0/24']],
    ['203.0.114.5', ['203.0.113.0/24']],
    ['::ffff:127.0.0.1', ['127.0.0.1']],
    ['nonsense', ['127.0.0.1']],
    ['127.0.0.1', []],
    ['127.0.0.1', ['', '  ', '127.0.0.1']],
    ['1.2.3.4', ['1.2.3.4/33']],
    ['1.2.3.4', ['0.0.0.0/0']],
  ]

  for (const [ip, list] of cases) {
    it(`${ip} against [${list.join(', ')}]`, () => {
      assert.equal(matchesIpList(ip, list), isTrustedProxy(ip, list))
    })
  }
})

/**
 * `id_token` claims — the ONLY thing standing between a real Google token and a
 * reader identity on this portal.
 *
 * The signature is deliberately not verified (design.md D6), which makes `aud`
 * load-bearing in a way it usually is not: it is the single check that refuses a
 * token genuinely issued by Google **but minted for somebody else's
 * application**. That token would carry a valid signature, a valid issuer, a
 * future expiry and a real `sub`; only `aud` says it does not belong here.
 *
 * The module was written to be testable — the docstring says so, and `nowMs` is a
 * parameter specifically "so the expiry branch is testable" — and then no test was
 * ever written. So until now the five rejection branches were guarded by nothing
 * but the prose describing them, and a refactor that loosened `aud` (a `!=` for a
 * `!==`, an empty `expectedClientId` slipping through) would have turned nothing
 * red.
 */
const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com'
const NOW = 1_760_000_000_000 // fixed; the module takes `nowMs` so no clock is stubbed

/** Encode a payload the way Google's compact JWS does, without a real signature. */
function tokenWith(payload: Record<string, unknown>): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${head}.${body}.not-a-real-signature`
}

/** A token that must pass every branch, so each test can spoil exactly one field. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '110248495921238986420',
    exp: Math.floor(NOW / 1000) + 3600,
    email: 'nguoidoc@example.com',
    name: 'Nguyễn Văn A',
    ...overrides,
  }
}

describe('decodeIdTokenClaims', () => {
  it('reads the payload of a well-formed compact JWS', () => {
    const claims = decodeIdTokenClaims(tokenWith(validPayload()))
    assert.equal(claims?.sub, '110248495921238986420')
    assert.equal(claims?.aud, CLIENT_ID)
  })

  /**
   * Each of these must be `null`, not a partial object: a caller that receives
   * `{}` for a malformed token would run the claim checks against absent fields
   * and produce a rejection reason describing the wrong problem.
   */
  const UNREADABLE: Array<[string, unknown]> = [
    ['not a string', 12345],
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['two segments instead of three', 'aaa.bbb'],
    ['four segments', 'a.b.c.d'],
    ['payload is not base64url JSON', 'aaa.@@@@.ccc'],
    ['payload is a JSON array', `x.${Buffer.from('[1,2]').toString('base64url')}.y`],
    ['payload is a JSON string', `x.${Buffer.from('"hello"').toString('base64url')}.y`],
    ['payload is JSON null', `x.${Buffer.from('null').toString('base64url')}.y`],
  ]

  for (const [label, raw] of UNREADABLE) {
    it(`${label} → null`, () => {
      assert.equal(decodeIdTokenClaims(raw), null, `${label} decoded to something usable`)
    })
  }
})

describe('validateIdTokenClaims', () => {
  it('accepts a token that satisfies every branch', () => {
    const result = validateIdTokenClaims(validPayload(), CLIENT_ID, NOW)
    assert.equal(result.ok, true)
    assert.ok(result.ok)
    assert.equal(result.claims.sub, '110248495921238986420')
    assert.equal(result.claims.email, 'nguoidoc@example.com')
    assert.equal(result.claims.name, 'Nguyễn Văn A')
  })

  it('null claims → unreadable', () => {
    const result = validateIdTokenClaims(null, CLIENT_ID, NOW)
    assert.deepEqual(result, { ok: false, reason: 'unreadable' })
  })

  /**
   * THE check. A token minted for another application is otherwise entirely
   * valid — real signature, real issuer, real subject, future expiry — so this is
   * the only branch that refuses it, and the signature check that would normally
   * back it up is deliberately absent here.
   */
  describe('aud is the load-bearing check', () => {
    it("refuses another application's client id", () => {
      const result = validateIdTokenClaims(
        validPayload({ aud: '9999999999-someoneelse.apps.googleusercontent.com' }),
        CLIENT_ID,
        NOW,
      )
      assert.deepEqual(result, { ok: false, reason: 'audience-mismatch' },
        'a token minted for another application was accepted as an identity on this portal')
    })

    it('refuses an EMPTY expectedClientId rather than matching everything', () => {
      // A deployment with no client id configured must fail closed. Were the
      // `!expectedClientId` guard dropped, `'' !== ''` is false and a token
      // carrying `aud: ''` would be accepted.
      const result = validateIdTokenClaims(validPayload({ aud: '' }), '', NOW)
      assert.deepEqual(result, { ok: false, reason: 'audience-mismatch' },
        'an unconfigured client id accepted a token — this must fail closed')
    })

    it('refuses a non-string aud', () => {
      assert.deepEqual(
        validateIdTokenClaims(validPayload({ aud: [CLIENT_ID] }), CLIENT_ID, NOW),
        { ok: false, reason: 'audience-mismatch' },
      )
    })

    it('is exact, not a prefix or substring match', () => {
      for (const aud of [CLIENT_ID + 'x', 'x' + CLIENT_ID, CLIENT_ID.toUpperCase(), CLIENT_ID.slice(0, -1)]) {
        assert.deepEqual(
          validateIdTokenClaims(validPayload({ aud }), CLIENT_ID, NOW),
          { ok: false, reason: 'audience-mismatch' },
          `\`${aud}\` was treated as our client id`,
        )
      }
    })
  })

  describe('issuer', () => {
    // Both spellings are real; tokens carry either, so refusing one would break
    // sign-in for an arbitrary subset of users.
    for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
      it(`accepts \`${iss}\``, () => {
        assert.equal(validateIdTokenClaims(validPayload({ iss }), CLIENT_ID, NOW).ok, true)
      })
    }

    for (const [label, iss] of [
      ['a lookalike host', 'accounts.google.com.evil.test'],
      ['http instead of https', 'http://accounts.google.com'],
      ['a trailing slash', 'https://accounts.google.com/'],
      ['missing', undefined],
      ['not a string', 42],
    ] as Array<[string, unknown]>) {
      it(`refuses ${label}`, () => {
        assert.deepEqual(
          validateIdTokenClaims(validPayload({ iss }), CLIENT_ID, NOW),
          { ok: false, reason: 'issuer-mismatch' },
        )
      })
    }
  })

  describe('expiry', () => {
    it('refuses a token that expired one second ago', () => {
      const exp = Math.floor(NOW / 1000) - 1
      assert.deepEqual(
        validateIdTokenClaims(validPayload({ exp }), CLIENT_ID, NOW),
        { ok: false, reason: 'expired' },
      )
    })

    it('refuses a token expiring exactly now — the boundary is closed', () => {
      // `exp * 1000 <= nowMs`. A `<` here would accept a token in the same
      // millisecond it lapses; harmless in practice, but the boundary should be
      // pinned so a later edit cannot widen it unnoticed.
      const exp = NOW / 1000
      assert.deepEqual(
        validateIdTokenClaims(validPayload({ exp }), CLIENT_ID, NOW),
        { ok: false, reason: 'expired' },
      )
    })

    for (const [label, exp] of [
      ['missing', undefined],
      ['a string', '1760000000'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ] as Array<[string, unknown]>) {
      it(`${label} → expiry-missing`, () => {
        assert.deepEqual(
          validateIdTokenClaims(validPayload({ exp }), CLIENT_ID, NOW),
          { ok: false, reason: 'expiry-missing' },
        )
      })
    }
  })

  describe('subject', () => {
    // `sub` is the account key (never email — design.md D6), so a token without
    // one has nothing to key an account on.
    for (const [label, sub] of [
      ['missing', undefined],
      ['empty', ''],
      ['whitespace only', '   '],
      ['a number', 12345],
    ] as Array<[string, unknown]>) {
      it(`${label} → subject-missing`, () => {
        assert.deepEqual(
          validateIdTokenClaims(validPayload({ sub }), CLIENT_ID, NOW),
          { ok: false, reason: 'subject-missing' },
        )
      })
    }
  })

  describe('email and name are labels, and absence is not a failure', () => {
    it('a token with no email still signs in', () => {
      const result = validateIdTokenClaims(validPayload({ email: undefined }), CLIENT_ID, NOW)
      assert.ok(result.ok, 'a Google account without an email was refused')
      assert.equal(result.claims.email, null)
    })

    it('blank and non-string values become null, not empty strings', () => {
      const result = validateIdTokenClaims(validPayload({ email: '   ', name: 99 }), CLIENT_ID, NOW)
      assert.ok(result.ok)
      assert.equal(result.claims.email, null, 'a blank email stored as "" reads as an address nobody has')
      assert.equal(result.claims.name, null)
    })

    it('caps both at the column width (255)', () => {
      const long = 'a'.repeat(400)
      const result = validateIdTokenClaims(validPayload({ email: long, name: long }), CLIENT_ID, NOW)
      assert.ok(result.ok)
      assert.equal(result.claims.email!.length, 255)
      assert.equal(result.claims.name!.length, 255)
    })
  })

  /**
   * `picture` must not survive into the returned shape.
   *
   * Not a style point: embedding `lh3.googleusercontent.com` would send every
   * visitor's IP and referrer to Google on exactly the pages citizens read — the
   * reason this project self-hosts Inter. The claim is read and discarded inside
   * the pure function precisely so no later caller can store it by reaching for a
   * field left quietly available (design.md D7).
   */
  it('discards `picture` — it never reaches the caller', () => {
    const result = validateIdTokenClaims(
      validPayload({ picture: 'https://lh3.googleusercontent.com/a/whatever' }),
      CLIENT_ID,
      NOW,
    )
    assert.ok(result.ok)
    assert.deepEqual(
      Object.keys(result.claims).sort(),
      ['email', 'name', 'sub'],
      'a field beyond sub/email/name is reachable — if it is `picture`, storing it '
      + 'leaks every reader\'s IP to Google on the pages they read',
    )
    assert.ok(!('picture' in result.claims))
  })

  /**
   * Order matters for the REASON, and the reason is what reaches the logs.
   *
   * A token that is wrong in several ways at once should report the most
   * fundamental problem, so an operator reading `google_oauth.login_failed` is
   * pointed at the actual cause rather than at whichever check happens to run
   * first after a reordering.
   */
  it('reports issuer before audience when both are wrong', () => {
    const result = validateIdTokenClaims(
      validPayload({ iss: 'https://evil.test', aud: 'someone-else' }),
      CLIENT_ID,
      NOW,
    )
    assert.deepEqual(result, { ok: false, reason: 'issuer-mismatch' })
  })

  it('end to end: a decoded real-shaped token validates', () => {
    // The two functions are always used as a pair in `callback.get.ts`, so the
    // pairing is exercised rather than each half in isolation.
    const claims = decodeIdTokenClaims(tokenWith(validPayload()))
    const result = validateIdTokenClaims(claims, CLIENT_ID, NOW)
    assert.ok(result.ok)
    assert.equal(result.claims.sub, '110248495921238986420')
  })
})
