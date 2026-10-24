/**
 * Signs the reader out: revokes every ticket issued to them, then clears only
 * `cdkt_reader`.
 *
 * Revocation, not just the cookie (spec reader-session, design D4). A reader
 * ticket is self-contained and lives 30 days; clearing the cookie removes it from
 * THIS browser only, and a copy taken earlier (shared computer, a proxy log, a
 * stolen profile) went on working until it expired. Bumping
 * `reader_accounts.token_version` — the column a ban already bumps — makes
 * `resolveReader` refuse every ticket minted before this request. Like the admin
 * logout, that means "sign me out everywhere".
 *
 * A request without a valid reader session (no cookie, a forged or stale ticket,
 * a banned account) modifies nothing: `optionalReader` resolves it to `null`, and
 * the response is the same — there is no oracle here for whether a ticket was live.
 *
 * Deliberately touches no other cookie. An officer who is signed into the admin
 * panel in the same browser and also signed in as a reader to check how a thread
 * looks must not be logged out of the admin panel by clicking "Đăng xuất" in the
 * public header.
 *
 * POST, not GET: a sign-out reachable by navigation can be triggered by an image
 * tag on any other site.
 */
import { eq, sql } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { readerAccounts } from '../../../db/schema'
import { clearReaderCookie, optionalReader } from '../../../utils/reader-auth'
import { logError } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  const reader = await optionalReader(event)

  if (reader) {
    // An increment in SQL, not `reader.tokenVersion + 1`: whatever version a
    // concurrent request just wrote, every ticket minted before this point stops
    // matching.
    try {
      await getDb()
        .update(readerAccounts)
        .set({ tokenVersion: sql`${readerAccounts.tokenVersion} + 1` })
        .where(eq(readerAccounts.id, reader.id))
    } catch (error) {
      // Same stance as the admin logout: the cookie still goes, and the failure is
      // visible rather than reading as a completed sign-out.
      logError({
        event: 'reader_auth.logout_token_invalidation_failed',
        readerId: reader.id,
        error,
        consequence: 'tickets issued before this sign-out stay valid until they expire',
      })
    }
  }

  clearReaderCookie(event)
  return { ok: true }
})
