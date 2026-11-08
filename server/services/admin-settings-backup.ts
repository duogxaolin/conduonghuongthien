/**
 * The backup settings (`PUT /api/admin/settings/backup`) — the write, moved out of the handler
 * verbatim. Everything decided before it stays in the handler: the permission check, the
 * SuperAdmin-only keys (403 before any write), validation (400), sealing the service-account
 * key into its envelope, and the audit's `oldValues` (the key itself never written there). The
 * read of the stored values is `readAllSettingRows` (admin-settings-values.ts).
 */
import { getDb } from '../utils/db'
import { settings, activityLogs } from '../db/schema'

/** The validated entries (group `backup`) and their audit row, in one transaction. */
export async function saveBackupSettingsWithAudit(
  adminUser: { id: number },
  entries: Array<{ key: string, value: string }>,
  oldValues: Record<string, string | null>,
) {
  const db = getDb()

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      await tx.insert(settings).values({ key: entry.key, value: entry.value, group: 'backup' })
        .onDuplicateKeyUpdate({ set: { value: entry.value } })
    }
    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      resourceId: null,
      meta: { settingsGroup: 'backup', updated: entries.map(e => e.key), oldValues },
    })
  })
}
