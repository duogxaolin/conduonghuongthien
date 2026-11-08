/**
 * The site favicon (`POST` / `DELETE /api/admin/settings/favicon`) — the two writes, moved out
 * of the handlers verbatim. Reading and checking the upload, generating the set and writing the
 * files stay in `favicon.post.ts`; clearing the setting cache stays in both handlers, AFTER the
 * service returns (= after the commit).
 */
import { inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, settings } from '../db/schema'
import { FAVICON_ICO_SETTING_KEY } from '../utils/favicon-setting'

/** Point both favicon keys at the files just written, with the audit row, in one transaction. */
export async function setFaviconWithAudit(
  adminUser: { id: number },
  upload: { iconUrl: string, icoUrl: string, sourceMime: string, sourceBytes: number, generated: string[] },
) {
  const { iconUrl, icoUrl } = upload
  const db = getDb()

  /**
   * Hai khoá cài đặt và dòng audit commit **cùng nhau**, hoặc không cái nào.
   *
   * Viết rời thì `favicon_url` mới có thể nằm cạnh `favicon_ico_url` **cũ** — thẻ
   * `<link>` trỏ icon mới trong khi `/favicon.ico` phục vụ icon cũ, đúng kiểu lệch
   * mà bộ đọc dùng chung ra đời để chặn. Chạy trên `tx`, không phải `db`: một
   * `db.insert()` đặt trong khối transaction vẫn commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    for (const [key, value] of [['favicon_url', iconUrl], [FAVICON_ICO_SETTING_KEY, icoUrl]] as const) {
      await tx.insert(settings).values({ key, value, group: 'general' })
        .onDuplicateKeyUpdate({ set: { value } })
    }

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: {
        operation: 'set_favicon',
        sourceMime: upload.sourceMime,
        sourceBytes: upload.sourceBytes,
        generated: upload.generated,
        keysUpdated: ['favicon_url', FAVICON_ICO_SETTING_KEY],
      },
    })
  })
}

/** Delete both favicon keys (back to the bundled default), with the audit row, in one transaction. */
export async function resetFaviconWithAudit(adminUser: { id: number }) {
  const db = getDb()

  /**
   * Hai lượt xoá và dòng audit commit **cùng nhau**, hoặc không cái nào.
   *
   * Xoá `favicon_url` mà để `favicon_ico_url` nằm lại là thẻ `<link>` lùi về mặc
   * định trong khi `/favicon.ico` còn phục vụ icon cũ — hai địa chỉ của cùng một
   * cổng trả về hai logo khác nhau. Chạy trên `tx`, không phải `db`: một
   * `db.delete()` đặt trong khối transaction vẫn commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.delete(settings).where(inArray(settings.key, ['favicon_url', FAVICON_ICO_SETTING_KEY]))

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: {
        operation: 'reset_favicon',
        keysUpdated: ['favicon_url', FAVICON_ICO_SETTING_KEY],
      },
    })
  })
}
