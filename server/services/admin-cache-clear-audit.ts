/**
 * The audit row of `POST /api/admin/cache-clear` — moved out of the handler verbatim (2026-11-08:
 * no `server/api` file calls getDb() itself). The handler keeps the `settings.update` gate, the
 * `confirm: true` check and the purge itself (`purgePublicPageCache`, which clears only the
 * `nitro/routes` group of the `cache` storage — no database row).
 *
 * Written on the pool AFTER the purge, as before: there is no row write to pair it with, and the
 * purge cannot be rolled back. A failed insert fails the request (500) with the cache already
 * cleared — then nothing records who cleared it.
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'

/** One row per manual purge: who, and how many cache entries went. */
export async function auditPublicCacheClear(adminId: number, cleared: number) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: adminId,
    action: 'update',
    resource: 'settings',
    meta: {
      trigger: 'manual',
      operation: 'clear_swr_cache',
      clearedKeys: cleared,
    },
  })
}
