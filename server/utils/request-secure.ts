/**
 * Did this request reach the visitor over HTTPS — i.e. should a cookie set on
 * its response carry `Secure`? (spec session-cookies, design D5)
 *
 * ONE rule for the four cookie writers: the admin session and MFA ticket
 * (`mfa/session.ts`), the reader session (`reader-auth.ts`) and the two OAuth
 * state cookies (`auth/google/start.get.ts`, `admin/backup/drive/start.get.ts`).
 * Each used to decide on its own with `x-forwarded-proto === 'https'` from ANY
 * peer, or with `getRequestURL().protocol` — which h3 ALSO derives from that
 * header unless told not to. So:
 *  - a production proxy that did not send the header issued session cookies
 *    without `Secure`, silently;
 *  - any client talking to the app directly could claim `https` itself.
 *
 * The rule (same trust model as `google-oauth/config.ts` `requestBase`):
 *  1. A TLS socket in this process → secure.
 *  2. `x-forwarded-proto` counts only when the socket peer is a configured trusted
 *     proxy (`client-ip.ts`); its leftmost hop is the one facing the browser.
 *  3. Without such a signal: production → secure (the portal is only served over
 *     HTTPS, so "unknown" must not downgrade a session cookie); anything else →
 *     not secure, so plain-HTTP development keeps working.
 *
 * Only an explicit `http` from a trusted proxy turns `Secure` off in production —
 * the one case where the browser really is on plain HTTP and a `Secure` cookie
 * would never be sent back.
 *
 * Local E2E (production build on http://127.0.0.1:3123) still signs in: browsers
 * treat loopback as a potentially trustworthy origin and keep `Secure` cookies
 * there.
 */
import { getRequestHeader, getRequestURL, type H3Event } from 'h3'
import { peerIsTrustedProxy } from './client-ip'

/** The client-facing hop of a trusted proxy's `x-forwarded-proto`, lower-cased; '' when absent or untrusted. */
function trustedForwardedProto(event: H3Event): string {
  if (!peerIsTrustedProxy(event)) return ''
  return String(getRequestHeader(event, 'x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
}

export function isSecureRequest(event: H3Event): boolean {
  // `xForwardedProto: false`: the socket alone. h3's default reads the header.
  if (getRequestURL(event, { xForwardedProto: false }).protocol === 'https:') return true

  const forwarded = trustedForwardedProto(event)
  if (forwarded === 'https') return true
  if (forwarded === 'http') return false

  // Read at call time, not import time (tests switch it; Nitro inlines it at build).
  return process.env.NODE_ENV === 'production'
}
