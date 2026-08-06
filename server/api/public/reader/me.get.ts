/**
 * Who the browser is signed in as, from the browser's own point of view.
 *
 * Only ever the caller's own record — there is no id parameter and no way to ask
 * about another reader. The email is returned because it is the reader's own and
 * the header shows it; it is never present in any comment-thread response, which
 * is the surface other people read.
 *
 * Called after mount, never during SSR: public article routes are SWR-cached
 * (design.md constraint 1), so identity that entered server-rendered HTML would
 * be served to the next visitor from cache.
 */
import { optionalReader, touchReader } from '../../../utils/reader-auth'
import { initialsFrom } from '../../../services/comments'
import { effectiveDisplayName } from '../../../services/readers'

export default defineEventHandler(async (event) => {
  const reader = await optionalReader(event)
  if (!reader) return { ok: true, reader: null }

  /**
   * Stamp `last_seen_at` on every identity read.
   *
   * The comment write path stamps too, but this is the one that catches a reader
   * who browses without commenting: `last_seen_at` is what the retention scope
   * ages accounts against (design.md D16), and a 30-day ticket means the OAuth
   * callback alone could leave the column a month stale. Someone who reads the
   * portal weekly for a year but never posts is an active reader, and their
   * account should not age out under them.
   *
   * This endpoint is called once per page load from useReaderAuth, so the write
   * is one UPDATE per visit rather than per request. touchReader swallows its own
   * errors, so a failed stamp cannot break the header.
   */
  await touchReader(event, reader.id)

  // The one place the two name columns are reconciled. Reading `displayName`
  // directly here would make the header ignore a name the reader chose on
  // /profile — visible only to them, and only on the one page where their own
  // name appears twice.
  const displayName = effectiveDisplayName(reader)

  return {
    ok: true,
    reader: {
      displayName,
      email:    reader.email,
      // Returned so the rename form can tell "no custom name yet, the Google one
      // is showing" from "a custom name that happens to match Google's". Without
      // it the form cannot offer to clear a name it cannot see.
      customDisplayName: reader.customDisplayName,
      // Rendered locally in a tinted circle — no request to a Google image host
      // ever leaves a visitor's browser (design.md D7).
      initials: initialsFrom(displayName),
      // So the profile toggle renders in the state the server actually holds.
      // Without it the switch would default to "on" for a reader who turned it
      // off, and turning it off again would be a no-op they cannot see.
      emailNotifications: Boolean(reader.emailNotifications),
    },
  }
})
