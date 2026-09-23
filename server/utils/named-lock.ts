import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'

/**
 * Run an action while holding a MySQL named lock, on the one connection that
 * holds it.
 *
 * Three schedulers in this codebase ran the same twenty lines — `GET_LOCK`, an
 * `acquired` check, a `held` flag, `RELEASE_LOCK` in a `finally`, then
 * `connection.release()`. Two of them were byte-identical copies; the third
 * (`analytics-maintenance.ts`) had grown a fourth job inside the same block: it
 * emits a NOC event on the lock-held connection when the lock is *busy*. That
 * fourth job is why a naive "return the value instead of the connection" helper
 * would be a regression rather than a cleanup — the NOC event is the only signal
 * that analytics maintenance runs at all, and it fires on the branch where the
 * action never runs. A helper that hid the connection inside itself would drop
 * it silently.
 *
 * So the shape is deliberately two-sided:
 *
 *   • `action` receives the CONNECTION, not a bare callback. A caller that needs
 *     to write on the same connection the lock was taken from — all three do —
 *     can, and it cannot accidentally use the pool instead.
 *   • `onBusy` is a separate hook that also receives that connection, so the
 *     busy branch can still write. It is the reason this is not just
 *     `runWithLock(pool, name, () => {...})`.
 *
 * The return type is a discriminated union rather than `T | null`. `null` is a
 * sentinel a caller can forget to check — and the failure it hides is the bad
 * one: a scheduler that runs its purge body thinking it holds a lock it does not
 * hold, so two replicas delete at once. To read the value a caller must write
 * `outcome.value`, which only exists on the `acquired: true` branch, so the
 * compiler makes it read `acquired` on the way past.
 *
 * The lock is advisory and released when the connection drops, so a killed
 * container does not wedge it.
 */

export type NamedLockOutcome<T> = { acquired: true; value: T } | { acquired: false }

/** Called with the pooled connection when the lock was NOT taken. */
export type NamedLockBusyHandler = (connection: PoolConnection) => Promise<void>

/**
 * Named locks are held by a connection rather than a pool, which is why this
 * takes a `Pool` and leases a connection for the duration.
 *
 * `timeoutSeconds` is validated rather than passed through: MySQL reads a
 * NEGATIVE timeout as "wait forever", so a caller computing `-1` from a
 * misconfigured value would not skip the run — it would block a scheduler tick
 * on a pooled connection until the holder finished, which is the queueing
 * behaviour every one of these call sites exists to avoid. Refusing the value is
 * the only outcome that cannot be mistaken for success.
 */
export async function withNamedLock<T>(
  pool: Pool,
  name: string,
  timeoutSeconds: number,
  action: (connection: PoolConnection) => Promise<T>,
  onBusy?: NamedLockBusyHandler,
): Promise<NamedLockOutcome<T>> {
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 0) {
    throw new Error(`named lock "${name}" needs a non-negative integer timeout, got ${String(timeoutSeconds)}`)
  }

  const connection = await pool.getConnection()
  let held = false
  try {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [name, timeoutSeconds])
    held = Number(rows[0]?.acquired) === 1
    if (!held) {
      await onBusy?.(connection)
      return { acquired: false }
    }
    return { acquired: true, value: await action(connection) }
  } finally {
    if (held) await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined)
    connection.release()
  }
}
