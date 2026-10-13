import { createError } from 'h3'
import { issueSessionToken } from '../../../utils/chatbot/session-token'
import { analyticsHmacSecret } from '../../../utils/runtime-config'

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
 *
 * It is also unmetered on purpose — signing is stateless and costs nothing — which
 * is why a token must never carry an allowance that a fresh token resets: the AI
 * quota has a per-address ceiling next to the per-session one
 * (`AI_IP_CEILING_RULE` in chat-policy.ts), so minting tokens in a loop buys
 * nothing.
 */
export default defineEventHandler(async (event) => {
  const secret = analyticsHmacSecret(event)

  if (!secret) {
    // No secret means no verifiable token, and an unverifiable token would let
    // anyone write under any id. Refusing is correct; the widget treats this as
    // "no transcript" and keeps chatting.
    throw createError({ statusCode: 503, statusMessage: 'Chat session tokens unavailable' })
  }

  const { token } = issueSessionToken(secret)
  return { ok: true, token }
})
