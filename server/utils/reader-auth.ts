/**
 * Reader session helpers (design.md D2, reader-google-login-comments).
 *
 * There is deliberately NO global middleware for readers. server/middleware/
 * admin-auth.ts guards /api/admin/** and must stay the only place that mints an
 * admin identity; a second middleware attaching a *different* identity to every
 * request is how a public commenter ends up being read as a logged-in someone.
 * Reader endpoints call optionalReader/requireReader explicitly, so a route that
 * forgot to ask has no reader at all rather than an ambient one.
 *
 * Every rejection reason collapses to the same answer on purpose: a missing
 * cookie, an expired ticket, a deleted row and a stale tokenVersion are all just
 * "not signed in". Only a ban is distinguishable, because the UI has to say why
 * commenting is refused instead of silently bouncing the reader back to Google.
 */
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'

import { getDb } from './db'
import { readerAccounts } from '../db/schema'
import { verifyReaderToken } from './auth'
import { getClientIp } from './client-ip'
import { logWarn } from './logger'

/** Distinct from cdkt_admin and cdkt_mfa: no admin route reads this name. */
const READER_COOKIE = 'cdkt_reader'

/** 30 days — matches READER_TOKEN_TTL in server/utils/auth.ts. */
const READER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

export interface ReaderIdentity {
  id:           number
  googleSub:    string
  email:        string | null
  displayName:  string | null
  tokenVersion: number
}

/** Same detection as server/utils/mfa/session.ts — kept identical so the two
 *  cookie families cannot drift on the `secure` flag. */
function requestIsHttps(event: H3Event): boolean {
  return getRequestHeader(event, 'x-forwarded-proto') === 'https'
    || getRequestURL(event).protocol === 'https:'
}

export function setReaderCookie(event: H3Event, token: string): void {
  setCookie(event, READER_COOKIE, token, {
    httpOnly: true,
    secure:   requestIsHttps(event),
    // MANDATORY 'lax', never 'strict': the Google OAuth callback arrives as a
    // top-level navigation from accounts.google.com, so it is cross-site. Under
    // 'strict' the browser withholds the cookie on exactly that hop — the reader
    // would land back on the portal logged out, immediately after consenting,
    // with nothing to point at. 'lax' still withholds it on cross-site POSTs,
    // which is the case that matters for CSRF.
    sameSite: 'lax',
    maxAge:   READER_COOKIE_MAX_AGE,
    path:     '/',
  })
}

export function clearReaderCookie(event: H3Event): void {
  deleteCookie(event, READER_COOKIE, { path: '/' })
}

type ReaderLookup =
  | { reader: ReaderIdentity }
  | { reader: null, reason: 'anonymous' | 'banned' }

async function resolveReader(event: H3Event): Promise<ReaderLookup> {
  const raw = getCookie(event, READER_COOKIE)
  if (!raw) return { reader: null, reason: 'anonymous' }

  const payload = verifyReaderToken(raw)
  if (!payload) return { reader: null, reason: 'anonymous' }

  const [row] = await getDb()
    .select({
      id:           readerAccounts.id,
      googleSub:    readerAccounts.googleSub,
      email:        readerAccounts.email,
      displayName:  readerAccounts.displayName,
      isBanned:     readerAccounts.isBanned,
      tokenVersion: readerAccounts.tokenVersion,
    })
    .from(readerAccounts)
    .where(eq(readerAccounts.id, payload.readerId))
    .limit(1)

  if (!row) return { reader: null, reason: 'anonymous' }
  if (row.isBanned) return { reader: null, reason: 'banned' }
  // Bumped on ban (and on any future forced sign-out), so a ticket already in a
  // browser stops being accepted without waiting out its 30 days.
  if (row.tokenVersion !== payload.tokenVersion) return { reader: null, reason: 'anonymous' }

  return {
    reader: {
      id:           row.id,
      googleSub:    row.googleSub,
      email:        row.email,
      displayName:  row.displayName,
      tokenVersion: row.tokenVersion,
    },
  }
}

/**
 * Reader identity if there is one, null otherwise. Never throws — including on
 * a database failure: this is what public read paths (rendering a comment
 * thread) call, and a reader lookup has no business turning a readable page
 * into an error page.
 */
export async function optionalReader(event: H3Event): Promise<ReaderIdentity | null> {
  try {
    return (await resolveReader(event)).reader
  } catch {
    return null
  }
}

/**
 * Reader identity or a thrown error. 401 for "not signed in" (the UI reopens the
 * Google flow) and 403 for a ban (the UI must NOT reopen the flow — signing in
 * again would succeed and change nothing, which reads as the portal being
 * broken rather than as a decision someone made).
 */
export async function requireReader(event: H3Event): Promise<ReaderIdentity> {
  const result = await resolveReader(event)
  if (result.reader) return result.reader

  if (result.reason === 'banned') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Tài khoản của bạn đã bị hạn chế bình luận trên cổng thông tin.',
    })
  }
  throw createError({ statusCode: 401, statusMessage: 'Chưa đăng nhập' })
}

/**
 * Bookkeeping stamp for the retention scope and for the officer looking at an
 * account. Swallows its own errors: a write that only feeds a "last seen"
 * column has no standing to fail the request that triggered it.
 *
 * Goes through the Drizzle query builder, never pool.query (design.md D17):
 * last_seen_at is a timezone-less DATETIME, and Drizzle's writer/reader pair is
 * only self-inverse when both halves are used — a raw query would let mysql2's
 * pool timezone shift every stamp.
 */
export async function touchReader(event: H3Event, readerId: number): Promise<void> {
  try {
    await getDb()
      .update(readerAccounts)
      .set({
        lastSeenAt:    new Date(),
        lastIp:        getClientIp(event),
        lastUserAgent: (getRequestHeader(event, 'user-agent') || '').slice(0, 512),
      })
      .where(eq(readerAccounts.id, readerId))
  } catch (error) {
    logWarn({
      event: 'reader_account.touch_failed',
      readerId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
