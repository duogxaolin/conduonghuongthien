/**
 * ER_NO_REFERENCED_ROW_2 (1452): an insert named a parent row that is gone — on the error or
 * down its `cause` chain (Drizzle wraps the driver's error).
 *
 * The comment paths read the parent comment (and the article / video) before their
 * transaction, then insert under it. A ban, an account deletion or a purge that commits in
 * between removes that parent, and the insert's foreign-key check fails: a 500 for a reply to
 * something that no longer exists. With bans now retried after a deadlock instead of failing,
 * that interleaving became common under load (verifier round 4, M1: 4–7 of 12 admin replies
 * next to 12 bans). The callers answer it like the pre-check would have: the thing replied to
 * does not exist.
 */
export function isMissingReferencedRow(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const { code, errno, cause } = current as { code?: unknown, errno?: unknown, cause?: unknown }
    if (code === 'ER_NO_REFERENCED_ROW_2' || errno === 1452) return true
    current = cause
  }
  return false
}
