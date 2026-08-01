import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

/**
 * Chat session tokens: `<uuid>.<hmac>`.
 *
 * The token exists to *correlate* rows in `chat_sessions`, not to authenticate
 * anyone — the portal chat requires no login and never will. What the signature
 * buys is narrower and still worth having: a visitor cannot append messages to
 * a session id they did not receive, so one transcript cannot be polluted with
 * another visitor's turns and the admin viewer cannot be seeded with forged
 * conversations by anyone who guesses a uuid.
 *
 * The server mints the token. A browser holding the secret in order to sign its
 * own ids would make the signature worthless — anyone could then sign anything.
 */

const SIGNATURE_LENGTH = 32

/** UUID v4 as produced by `randomUUID()`. Rejects anything else outright. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('hex').slice(0, SIGNATURE_LENGTH)
}

/** Mints a fresh `<uuid>.<hmac>` pair. */
export function issueSessionToken(secret: string): { sessionId: string, token: string } {
  const sessionId = randomUUID()
  return { sessionId, token: `${sessionId}.${sign(sessionId, secret)}` }
}

/**
 * Returns the session id when the token carries a valid signature, else null.
 *
 * Pure function of (header, secret) so it is testable without an HTTP server.
 * A null return is never fatal to the caller: the chat reply still goes out, we
 * just skip the database write.
 */
export function verifySessionToken(rawHeader: unknown, secret: string): string | null {
  if (typeof rawHeader !== 'string' || !secret) return null

  const trimmed = rawHeader.trim()
  // Bound the input before any parsing: a valid token is 36 + 1 + 32 chars.
  if (trimmed.length !== 36 + 1 + SIGNATURE_LENGTH) return null

  const separator = trimmed.indexOf('.')
  if (separator !== 36) return null

  const sessionId = trimmed.slice(0, separator)
  const signature = trimmed.slice(separator + 1)
  if (!UUID_PATTERN.test(sessionId)) return null
  if (signature.length !== SIGNATURE_LENGTH) return null

  const expected = Buffer.from(sign(sessionId, secret), 'utf8')
  const provided = Buffer.from(signature, 'utf8')
  // Lengths are already equal by the checks above, but timingSafeEqual throws
  // on a mismatch rather than returning false, so guard it anyway.
  if (expected.length !== provided.length) return null
  return timingSafeEqual(expected, provided) ? sessionId : null
}
