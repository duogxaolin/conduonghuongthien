/**
 * Google OAuth endpoints and the redirect URI.
 *
 * The redirect URI is the one string in this flow that has to match, byte for
 * byte, a value registered in the Google Cloud console. That is why it is
 * DERIVED — from PUBLIC_BASE_URL, or failing that from the request itself — and
 * never accepted from an operator field or stored in the database: an
 * operator-entered value that differs by a trailing slash or a `www.` produces
 * `redirect_uri_mismatch` at Google, a failure whose cause is invisible from
 * inside the app.
 */

import { getRequestHeader, getRequestIP, type H3Event } from 'h3'
import { isTrustedProxy, trustedProxies } from '../client-ip'
import { tryRuntimeConfig } from '../runtime-config'

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_SCOPE = 'openid email profile'

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback'

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Is the peer that sent this request one of our own proxies? Only then do the
 * forwarded headers mean anything — they are request headers, so any client can
 * set them, and honouring them unconditionally would let a visitor choose the
 * redirect URI we send to Google.
 */
function forwardedTrusted(event: H3Event): boolean {
  const peer = getRequestIP(event, { xForwardedFor: false })
  return isTrustedProxy(peer ?? null, trustedProxies())
}

/** Scheme + host of this deployment, as the browser sees it. */
function requestBase(event: H3Event): string {
  const trusted = forwardedTrusted(event)

  const forwardedProto = trusted ? getRequestHeader(event, 'x-forwarded-proto') : null
  const forwardedHost = trusted ? getRequestHeader(event, 'x-forwarded-host') : null

  // `x-forwarded-proto: https,http` — the leftmost hop is the one facing the client.
  const proto = String(forwardedProto ?? '').split(',')[0]?.trim().toLowerCase()

  const encrypted = Boolean((event.node?.req?.socket as { encrypted?: boolean } | undefined)?.encrypted)
  const scheme = proto === 'https' || proto === 'http'
    ? proto
    : (encrypted ? 'https' : 'http')

  const host = String(forwardedHost ?? '').split(',')[0]?.trim()
    || getRequestHeader(event, 'host')
    || 'localhost:3000'

  return `${scheme}://${host}`
}

/**
 * The configured public base URL, or an empty string.
 *
 * runtimeConfig first, then the bare environment variable — the same order
 * `trustedProxies()` uses, and for the same reason: Nitro resolves NUXT_-prefixed
 * variables at runtime, so a value set only as `NUXT_PUBLIC_BASE_URL` in the
 * container arrives through runtimeConfig and is invisible to `process.env`
 * alone. Reading only one of the two would make the setting work in exactly one
 * of the two supported deployment shapes (Docker vs. PM2/aaPanel).
 */
export function configuredBaseUrl(): string {
  const config = tryRuntimeConfig()
  const raw = config?.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? ''
  return stripTrailingSlashes(String(raw).trim())
}

export function resolveRedirectUri(event: H3Event): string {
  const base = configuredBaseUrl() || stripTrailingSlashes(requestBase(event))
  return `${base}${GOOGLE_CALLBACK_PATH}`
}
