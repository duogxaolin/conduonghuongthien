/**
 * RFC 4226 (HOTP) + RFC 6238 (TOTP) on node:crypto alone.
 *
 * Written rather than imported for one reason that matters: both RFCs publish
 * test vectors, so correctness here is *verifiable* instead of assumed, and the
 * project rule is not to add a runtime dependency for forty lines of HMAC.
 * The primitives (createHmac, timingSafeEqual) are not hand-rolled.
 *
 * SHA-1 is specified, not chosen: every authenticator app implements SHA-1 TOTP,
 * and the construction's security does not rest on SHA-1 collision resistance.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
/** ±1 step of tolerance: ~30s either side of the server clock. */
export const TOTP_DRIFT_STEPS = 1

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, unpadded — what authenticator apps expect in a QR payload. */
export function base32Encode(input: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Tolerates lowercase, spaces, and '=' padding, since users retype secrets by hand. */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Chuỗi base32 không hợp lệ.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** 160 bits, per RFC 4226's recommendation for HOTP shared secrets. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function counterBuffer(counter: number): Buffer {
  // BigInt so large T values (RFC 6238 tests go past 2^32) stay exact.
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(Math.floor(counter)))
  return buf
}

/** RFC 4226 §5.3 — HMAC, dynamic truncation, modulo 10^digits. */
export function hotp(key: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const digest = createHmac('sha1', key).update(counterBuffer(counter)).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** Current step number for a given time. Exported so callers can record it. */
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS)
}

/** Raw-key entry point — the form the RFC 6238 test vectors are stated in. */
export function totpFromKey(key: Buffer, step: number, digits: number = TOTP_DIGITS): string {
  return hotp(key, step, digits)
}

export function totpCode(
  base32Secret: string,
  step: number = totpStep(),
  digits: number = TOTP_DIGITS,
): string {
  return totpFromKey(base32Decode(base32Secret), step, digits)
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export type TotpVerification =
  | { ok: true; step: number }
  | { ok: false; reason: 'format' | 'mismatch' | 'replay' }

/**
 * Verify a submitted code across the drift window.
 *
 * `lastAcceptedStep` suppresses replay: a code observed in transit and resubmitted
 * inside its own window is refused, while the adjacent step still works. The
 * caller persists the returned step.
 */
export function verifyTotp(
  base32Secret: string,
  submitted: string,
  options: { atMs?: number; lastAcceptedStep?: number | null; digits?: number } = {},
): TotpVerification {
  const digits = options.digits ?? TOTP_DIGITS
  const code = submitted.replace(/\s/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { ok: false, reason: 'format' }

  let key: Buffer
  try {
    key = base32Decode(base32Secret)
  } catch {
    return { ok: false, reason: 'format' }
  }

  const current = totpStep(options.atMs ?? Date.now())
  for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset++) {
    const step = current + offset
    if (!constantTimeEqual(totpFromKey(key, step, digits), code)) continue
    if (options.lastAcceptedStep != null && step <= options.lastAcceptedStep) {
      return { ok: false, reason: 'replay' }
    }
    return { ok: true, step }
  }
  return { ok: false, reason: 'mismatch' }
}

/** otpauth:// payload for a QR code. Label and issuer are percent-encoded. */
export function otpauthUri(params: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${query.toString()}`
}
