/**
 * How a ban, an account deletion and a comment purge (`readers.ts`) run their transaction —
 * `withDeadlockRetry(() => db.transaction(...))`, written out at each call site so the audit
 * and TDZ guards (which read `db.transaction(`) keep seeing them — and the lock order each keeps. Measured on MySQL 8 with the replay described in
 * docs/test-coverage-baseline-2026-10.md ("Lát R6", rounds 3–4).
 *
 * Two lock orders exist on the reader tables and cannot both be avoided:
 *   - a reply (admin or public) holds its parent comment (FK check of the insert), then the
 *     reader row (FK of the notification it creates): comment → reader;
 *   - the retention purge and an account deletion delete the reader row and let the FK
 *     cascade take the comments: reader → comment. Retention is not this module's.
 * So, per operation:
 *   - ban and account deletion keep the base order: the reader row first (ban: its guarded
 *     UPDATE; deletion: FOR UPDATE), then the comment rows;
 *   - a purge never locks the reader row (reader-first deadlocked purge ‖ reply 30/30 —
 *     verifier H1); it reads it only when it removed nothing (`readerExistsNow`);
 *   - all three lock the comment rows they will delete — own comments and the replies under
 *     them — in one statement, ascending id (`comments-deletion.ts`), so two readers who
 *     replied to each other no longer deadlock their purges (verifier H3);
 *   - every read runs on the transaction, never the pool (ten at once hung the pool — H2).
 *
 * What is left is a cycle no order removes — a ban or deletion next to a reply, or a row
 * added between the plain read and the ordered lock — and InnoDB resolves it by rolling one
 * transaction back. Each of these transactions has no effect outside itself (no e-mail, no
 * file, no cache), so `withDeadlockRetry` runs the victim again from the start. The deadlock
 * still happens at MySQL level: the HTTP status hides it, `INNODB_METRICS.lock_deadlocks`
 * does not.
 */
import { eq } from 'drizzle-orm'
import type { Database } from '../utils/db'
import { readerAccounts } from '../db/schema'

export type ModerationTx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Whether the reader row exists now — a locking (shared) read, so it sees a deletion that
 * committed while this transaction waited; a plain read would answer from a snapshot that
 * may predate it. Only for a purge that removed nothing: with comments locked, a shared lock
 * on the reader would wait on an account deletion that waits on those comments.
 */
export async function readerExistsNow(tx: ModerationTx, readerId: number): Promise<boolean> {
  const [row] = await tx.select({ id: readerAccounts.id }).from(readerAccounts).where(eq(readerAccounts.id, readerId)).for('share')
  return Boolean(row)
}
