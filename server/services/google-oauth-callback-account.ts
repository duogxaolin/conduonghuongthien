/**
 * The reader account statements of the Google sign-in callback (`GET /api/auth/google/callback`),
 * moved out of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself).
 *
 * The handler keeps the order that is the security of that endpoint: the `state` check and its
 * cookie cleared before anything else, the server-to-server code exchange with the redirect URI
 * derived from the request host, the `aud`/expiry checks of the ID token claims (`picture` read and
 * discarded), the IP ban re-checked after the exchange, the refusal of a banned account, the
 * reserved-name flag (`isReservedDisplayName`), and the reader cookie.
 *
 * The account is keyed on Google's `sub`, never on email. A read, then ONE write (an update of the
 * known account or the insert of a new one) — no transaction, as before.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { readerAccounts } from '../db/schema'

/** What a sign-in writes on the account row — refreshed on every sign-in. */
export interface ReaderSignInFields {
  email: string | null
  displayName: string | null
  displayNameReserved: boolean
  now: Date
  ip: string
  userAgent: string | null
}

/** The account Google's `sub` already names — or undefined. */
export async function findReaderBySub(sub: string) {
  const db = getDb()
  const [existing] = await db
    .select({
      id:           readerAccounts.id,
      isBanned:     readerAccounts.isBanned,
      tokenVersion: readerAccounts.tokenVersion,
    })
    .from(readerAccounts)
    .where(eq(readerAccounts.googleSub, sub))
    .limit(1)
  return existing
}

/** A returning reader: refresh the Google profile fields and the last-seen trail. */
export async function refreshReaderSignIn(readerId: number, fields: ReaderSignInFields) {
  const { email, displayName, displayNameReserved, now, ip, userAgent } = fields
  const db = getDb()
  await db
    .update(readerAccounts)
    .set({
      // Refreshed on every sign-in: a reader who changed their Google display
      // name should not keep appearing under the old one on a public page.
      email,
      displayName,
      // Recomputed with the name: a reader who renames themselves at Google
      // from "Admin" to a real name gets their name back on the next sign-in.
      displayNameReserved,
      lastSeenAt:    now,
      lastIp:        ip,
      lastUserAgent: userAgent,
    })
    .where(eq(readerAccounts.id, readerId))
}

/** A first sign-in: create the account. Returns its id — 0 when the driver reported none. */
export async function createReaderAccount(sub: string, fields: ReaderSignInFields): Promise<number> {
  const { email, displayName, displayNameReserved, now, ip, userAgent } = fields
  const db = getDb()
  const inserted = await db.insert(readerAccounts).values({
    googleSub:     sub,
    email,
    displayName,
    displayNameReserved,
    lastSeenAt:    now,
    lastIp:        ip,
    lastUserAgent: userAgent,
  })

  // `db.insert()` resolves to an ARRAY whose first element carries the header —
  // so `inserted.insertId` is `undefined` and `Number(undefined ?? 0)` is 0.
  // That read failed the guard in the handler *after the row had already been written*,
  // which is exactly the shape of the bug reported from production: the first
  // sign-in reported an error, and the second succeeded because it took the
  // `existing` branch (which never reads insertId). Destructuring is how every
  // other insert site in this project reads it.
  const [header] = inserted
  return Number(header?.insertId ?? 0)
}
