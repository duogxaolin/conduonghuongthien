/**
 * OAuth `state` — decision D5.
 *
 * The state parameter carries two things: a nonce that ties the callback to the
 * browser that started the flow (CSRF), and the path to return to afterwards.
 * Both travel through Google and come back through the user's browser, so
 * neither can be trusted on arrival without proof. The proof is an HMAC under a
 * key derived from JWT_SECRET, and the tie-to-this-browser is a cookie holding
 * the same state string — a signature alone would let an attacker replay a state
 * they obtained legitimately into someone else's session.
 *
 * Shape: `base64url(JSON.stringify({ s, r })) + '.' + hex(HMAC-SHA256(key, payload))`
 */

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { isSafeReturnPath } from './return-path'

const STATE_KEY_INFO = 'cdkt-google-oauth-state:v1'
const STATE_KEY_BYTES = 32

/**
 * Fixed, non-secret salt — same reasoning as the other HKDF call sites in this
 * codebase (server/utils/auth.ts, server/utils/mfa/key.ts): JWT_SECRET is
 * already high-entropy input keying material, so a stored per-row salt buys
 * nothing here.
 */
const STATE_KEY_SALT = Buffer.from('cdkt-google-oauth-hkdf-salt:v1', 'utf8')

function stateKeyMaterial(): string {
  const secret = (process.env.JWT_SECRET || '').trim()
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not configured (required to sign Google OAuth state).')
  }
  return 'cdkt_dev_only_insecure_jwt_secret_do_not_use_in_prod'
}

/**
 * Derive the state signing key from JWT_SECRET. Cryptographically unrelated to
 * jwtSecret() and to readerSigningKey(): a state signature can never be mistaken
 * for a session ticket, in either direction.
 */
export function stateSigningKey(): Buffer {
  const ikm = stateKeyMaterial()
  return Buffer.from(hkdfSync('sha256', Buffer.from(ikm, 'utf8'), STATE_KEY_SALT, Buffer.from(STATE_KEY_INFO, 'utf8'), STATE_KEY_BYTES))
}

function sign(payloadPart: string, key: Buffer | string): string {
  return createHmac('sha256', key).update(payloadPart).digest('hex')
}

function encodePayload(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

type StatePayload = { s: string, r: string }

function decodePayload(payloadPart: string): StatePayload | null {
  try {
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const { s, r } = parsed as Record<string, unknown>
    if (typeof s !== 'string' || !s) return null
    if (typeof r !== 'string') return null
    return { s, r }
  } catch {
    return null
  }
}

/** Equal-length constant-time comparison. timingSafeEqual throws otherwise. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Mint a state for a flow that should end at `returnPath`. The path is validated
 * here rather than trusted, so an unsafe value never reaches the signature —
 * signing it would make it look authoritative on the way back.
 */
export function issueState(returnPath: string, key: Buffer | string): string {
  const r = isSafeReturnPath(returnPath) ? returnPath : '/'
  const payloadPart = encodePayload({ s: randomBytes(32).toString('hex'), r })
  return `${payloadPart}.${sign(payloadPart, key)}`
}

export type VerifyStateInput = {
  /** The state string this browser was given, as stored in the flow cookie. */
  cookieValue: string | null | undefined
  /** The state string Google handed back on the callback URL. */
  presentedState: string | null | undefined
  key: Buffer | string
}

export type VerifyStateResult =
  | { ok: true, returnPath: string }
  | { ok: false, reason: string }

/** Pull the payload part out of a stored cookie value or a presented state. */
function payloadPartOf(value: string): string {
  const dot = value.indexOf('.')
  return dot === -1 ? value : value.slice(0, dot)
}

export function verifyState(input: VerifyStateInput): VerifyStateResult {
  const presented = typeof input.presentedState === 'string' ? input.presentedState.trim() : ''
  const cookie = typeof input.cookieValue === 'string' ? input.cookieValue.trim() : ''

  if (!presented) return { ok: false, reason: 'state-missing' }
  if (!cookie) return { ok: false, reason: 'cookie-missing' }

  const dot = presented.indexOf('.')
  if (dot <= 0 || dot === presented.length - 1) return { ok: false, reason: 'state-malformed' }

  const payloadPart = presented.slice(0, dot)
  const presentedMac = presented.slice(dot + 1)

  // Length guard first: timingSafeEqual throws on unequal lengths, and a thrown
  // error here would surface as a 500 on a merely malformed callback.
  if (!safeEqual(presentedMac, sign(payloadPart, input.key))) {
    return { ok: false, reason: 'state-signature-mismatch' }
  }

  const payload = decodePayload(payloadPart)
  if (!payload) return { ok: false, reason: 'state-payload-unreadable' }

  const cookiePayload = decodePayload(payloadPartOf(cookie))
  if (!cookiePayload) return { ok: false, reason: 'cookie-payload-unreadable' }

  if (!safeEqual(payload.s, cookiePayload.s)) {
    return { ok: false, reason: 'state-nonce-mismatch' }
  }

  // Re-validate the return path AFTER signature verification: a cookie is
  // client-writable even when HTTP-only, and signed input is still input.
  if (!isSafeReturnPath(payload.r)) {
    return { ok: false, reason: 'state-return-path-unsafe' }
  }

  return { ok: true, returnPath: payload.r }
}
