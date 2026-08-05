/**
 * Google `id_token` claims — decoding and validation, both pure.
 *
 * The signature is deliberately NOT verified here (design.md D6). This token
 * arrived as the body of the portal's own server-to-server POST to
 * oauth2.googleapis.com, over TLS, authenticated with the client secret. Google
 * documents that a token obtained that way can be trusted without local
 * verification, and a JWKS fetch would add a network dependency, a key cache and
 * a rotation path to the sign-in flow — all of which can fail, and none of which
 * would help unless TLS or the client secret were already compromised, in which
 * case an attacker can mint whatever they like anyway.
 *
 * The CLAIMS are checked, because they defend against a different failure: a
 * token that genuinely came from Google but was minted for somebody else's
 * application. `aud` is the check that stops that, and it is the reason this file
 * exists as a separate pure function rather than four inline `if`s in the
 * callback — every rejection case is then testable without an HTTP server or a
 * Google account.
 */

/** Both spellings Google uses. Neither is more correct; tokens carry either. */
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

export type IdTokenClaims = {
  iss?: unknown
  aud?: unknown
  sub?: unknown
  exp?: unknown
  email?: unknown
  name?: unknown
  /** Read so it is visibly discarded rather than silently absent — design.md D7. */
  picture?: unknown
}

/**
 * Pulls the payload out of a compact JWS without verifying it. Returns null for
 * anything that is not three dot-separated parts with a decodable JSON payload.
 */
export function decodeIdTokenClaims(raw: unknown): IdTokenClaims | null {
  if (typeof raw !== 'string') return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null

  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as IdTokenClaims
  } catch {
    return null
  }
}

export type ValidatedClaims = {
  sub:   string
  email: string | null
  name:  string | null
}

export type IdTokenValidation =
  | { ok: true, claims: ValidatedClaims }
  | { ok: false, reason: string }

/**
 * `aud` must equal our client id, `iss` must be Google, `exp` must be in the
 * future, `sub` must be present.
 *
 * `nowMs` is a parameter rather than a `Date.now()` call so the expiry branch is
 * testable without waiting or stubbing the clock.
 */
export function validateIdTokenClaims(claims: IdTokenClaims | null, expectedClientId: string, nowMs: number): IdTokenValidation {
  if (!claims) return { ok: false, reason: 'unreadable' }

  if (typeof claims.iss !== 'string' || !VALID_ISSUERS.has(claims.iss)) {
    return { ok: false, reason: 'issuer-mismatch' }
  }

  // The check that stops a token minted for another application being accepted
  // as an identity here.
  if (typeof claims.aud !== 'string' || !expectedClientId || claims.aud !== expectedClientId) {
    return { ok: false, reason: 'audience-mismatch' }
  }

  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return { ok: false, reason: 'expiry-missing' }
  }
  // exp is in seconds.
  if (claims.exp * 1000 <= nowMs) {
    return { ok: false, reason: 'expired' }
  }

  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : ''
  if (!sub) return { ok: false, reason: 'subject-missing' }

  return {
    ok: true,
    claims: {
      sub,
      // Stored as labels only. `sub` is the account key, so an email that turns
      // out to be wrong or reassigned costs nothing (design.md D6).
      email: typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim().slice(0, 255) : null,
      name:  typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 255) : null,
      // `picture` is intentionally absent from the returned shape. Discarding it
      // here rather than at the call site means no future caller can store it by
      // reaching for a field that was quietly left available.
    },
  }
}
