/**
 * The admin-edited sitemap (`PUT /api/admin/settings/sitemap`) — its write, moved out of the
 * handler verbatim. The emptiness and size checks and the save time (`now`, answered back to
 * the page) stay in the handler; the read of the saved copy is `readSettingValues`
 * (admin-settings-values.ts).
 */
import { getDb } from '../utils/db'
import { settings, activityLogs } from '../db/schema'

/**
 * The sitemap, its save time and the audit row, in one transaction — tiền lệ
 * `navigation/navbar.put.ts`: `activity_logs.user_id` là FK tới `users` và `meta` là
 * cột JSON, nên viết rời có cách hỏng riêng (hàng đã xong, không còn gì ghi ai đã làm).
 * Chạy trên `tx`, không phải `db`.
 */
export async function saveSitemapWithAudit(adminUser: { id: number }, xml: string, now: string) {
  const db = getDb()

  await db.transaction(async (tx) => {
    await tx.insert(settings).values({
      key: 'sitemap_xml',
      value: xml,
      type: 'string',
      group: 'general',
    }).onDuplicateKeyUpdate({ set: { value: xml } })

    await tx.insert(settings).values({
      key: 'sitemap_updated_at',
      value: now,
      type: 'string',
      group: 'general',
    }).onDuplicateKeyUpdate({ set: { value: now } })

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: { keysUpdated: ['sitemap_xml'], bytes: xml.length },
    })
  })
}
