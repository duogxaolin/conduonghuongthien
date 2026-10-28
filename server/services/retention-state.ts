import { getDb } from '../utils/db'
import { dataRetentionState } from '../db/schema'
import { RETENTION_SCOPES, type RetentionScope } from './retention-policy'

/**
 * The purge's bookkeeping — `data_retention_state`: how much each scope has
 * deleted over its lifetime and how its last run went.
 *
 * Split out of `retention-policy.ts`, which holds the policy itself (the
 * `retention_*` settings keys, their validation and the audited save). Two tables,
 * two modules; the policy file had reached the 400-line ceiling.
 */

export type ScopeState = {
  scope: RetentionScope
  purgedTotal: number
  lastRunAt: Date | null
  lastDeleted: number
  lastTrigger: string | null
  lastStatus: string | null
  lastMessage: string | null
}

export async function loadRetentionState(): Promise<ScopeState[]> {
  const db = getDb()
  const rows = await db.select().from(dataRetentionState)
  const byScope = new Map(rows.map(row => [row.scope, row]))
  return RETENTION_SCOPES.map((scope) => {
    const row = byScope.get(scope)
    return {
      scope,
      purgedTotal: Number(row?.purgedTotal ?? 0),
      lastRunAt: row?.lastRunAt ?? null,
      lastDeleted: Number(row?.lastDeleted ?? 0),
      lastTrigger: row?.lastTrigger ?? null,
      lastStatus: row?.lastStatus ?? null,
      lastMessage: row?.lastMessage ?? null,
    }
  })
}

/** The most recent run across all scopes — what the scheduler checks. */
export async function lastRetentionRunAt(): Promise<Date | null> {
  const db = getDb()
  const rows = await db.select({ lastRunAt: dataRetentionState.lastRunAt }).from(dataRetentionState)
  let latest: Date | null = null
  for (const row of rows) {
    if (row.lastRunAt && (!latest || row.lastRunAt > latest)) latest = row.lastRunAt
  }
  return latest
}
