import { createError } from 'h3'
import { issueSessionToken } from '../../../utils/chatbot/session-token'

/**
 * Mints a chat session token: `{ token: "<uuid>.<hmac>" }`.
 *
 * The browser cannot compute this itself — signing requires the analytics HMAC
 * secret, and shipping that to the client would make every signature forgeable.
 * The client treats the returned string as opaque, stores it on the
 * conversation, and echoes it back as `X-Chat-Session` on each chat POST.
 *
 * Handing out a token grants nothing on its own: it only lets the holder write
 * a transcript under one id. What it prevents is writing under *someone else's*
 * id.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event) as unknown as { analytics?: { hmacSecret?: string } }
  const secret = config.analytics?.hmacSecret

  if (!secret) {
    // No secret means no verifiable token, and an unverifiable token would let
    // anyone write under any id. Refusing is correct; the widget treats this as
    // "no transcript" and keeps chatting.
    throw createError({ statusCode: 503, statusMessage: 'Chat session tokens unavailable' })
  }

  const { token } = issueSessionToken(secret)
  return { ok: true, token }
})
