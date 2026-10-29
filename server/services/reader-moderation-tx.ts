/**
 * How a ban, an account deletion and a comment purge (`readers.ts`) run their transaction —
 * `withDeadlockRetry(() => db.transaction(...))`, written out at each call site so the audit
 * and TDZ guards (which read `db.transaction(`) keep seeing them.
 *
 * Lock shape: exactly the base's (`52d7b527`), on purpose. Per operation, in order:
 *   - ban: plain-read counts, `UPDATE reader_accounts` (0 rows → 404, no audit), `DELETE` the
 *     reader's comments (the FK cascade takes the replies under them), audit row;
 *   - account deletion: plain-read counts, `DELETE reader_accounts` (0 rows → 404), audit row;
 *   - purge: plain-read counts, `DELETE` the reader's comments, a plain read of the reader row
 *     only when nothing was removed (gone → 404), audit row.
 * The counts are the first statements, so no row lock is held while they scan. Every read is
 * a plain one on the transaction — never a locking read, never the pool (a pool read inside a
 * transaction took a second connection: ten at once hung the pool — verifier H2).
 *
 * Rounds 3–4 changed this shape (FOR UPDATE counts, an ordered `id IN (…)` lock, a FOR SHARE
 * probe) to make the counts exact under concurrency; each change moved deadlocks somewhere new
 * — the last one onto unrelated readers' comments (verifier round 4, H-A). The counts are back
 * to the base's accuracy (FINDING-R6-10, docs). What remains of a deadlock is a victim of the
 * base's own lock orders (a reply holds comment → reader; these hold reader → comment):
 * `withDeadlockRetry` runs it again from the start — safe, the transaction has no effect
 * outside itself — and MySQL still counts the deadlock (`INNODB_METRICS.lock_deadlocks`).
 */
import { eq } from 'drizzle-orm'
import type { Database } from '../utils/db'
import { readerAccounts } from '../db/schema'

export type ModerationTx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Whether the reader row is there, read on the transaction with a plain (non-locking) read: an
 * account removed before this transaction's first read (retention, another officer) is a 404
 * with no audit row. One deleted later, while we waited, is not seen — the base's accuracy.
 */
export async function readerStillExists(tx: ModerationTx, readerId: number): Promise<boolean> {
  const [row] = await tx.select({ id: readerAccounts.id }).from(readerAccounts)
    .where(eq(readerAccounts.id, readerId)).limit(1)
  return Boolean(row)
}
