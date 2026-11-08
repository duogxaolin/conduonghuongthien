/**
 * The navigation menus in the admin panel (`GET` / `PUT /api/admin/settings/navigation/navbar`
 * and `…/mobile`) — their queries, moved out of the handlers verbatim. Sanitising the items
 * (link policy, 400 naming the field), parsing the stored JSON and the public page cache purge
 * after the commit stay in the handlers.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { settings, activityLogs } from '../db/schema'

/** The desktop menu row: `nav_menu_navbar`, else (only when it is absent) the legacy `nav_menu`. */
export async function readNavbarMenuRows() {
  const db = getDb()

  // Try navbar-specific key first, fallback to shared nav_menu
  const navbarRow = await db.select().from(settings).where(eq(settings.key, 'nav_menu_navbar')).limit(1)
  const fallbackRow = navbarRow.length ? null : await db.select().from(settings).where(eq(settings.key, 'nav_menu')).limit(1)
  return { navbarRow, fallbackRow }
}

/** The bottom-nav row, `nav_menu_mobile`. */
export async function readMobileMenuRow() {
  const db = getDb()

  // Bottom-nav config has its own shape — no fallback to nav_menu (different structure)
  const row = await db.select().from(settings).where(eq(settings.key, 'nav_menu_mobile')).limit(1)
  return row
}

/** Store the sanitised desktop menu and its audit row, in one transaction. */
export async function saveNavbarMenuWithAudit(adminUser: { id: number }, items: unknown[]) {
  const db = getDb()
  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.insert(settings).values({
      key: 'nav_menu_navbar',
      value: JSON.stringify(items),
      type: 'json',
      group: 'general',
    }).onDuplicateKeyUpdate({ set: { value: JSON.stringify(items) } })

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: { keysUpdated: ['nav_menu_navbar'], itemCount: items.length },
    })
  })
}

/** Store the sanitised bottom-nav tabs and their audit row, in one transaction. */
export async function saveMobileMenuWithAudit(adminUser: { id: number }, items: unknown[]) {
  const db = getDb()
  /**
   * Lượt ghi và dòng audit của nó commit cùng nhau, hoặc không cái nào.
   *
   * Viết rời, câu audit có cách hỏng riêng của nó — `activity_logs.user_id`
   * là khoá ngoại tới `users` và `meta` là cột JSON — nên một lượt ghi đã
   * xong có thể còn lại mà không có gì ghi lại ai đã làm. Chạy trên `tx`,
   * không phải `db`: một `db.insert()` đặt trong khối transaction vẫn
   * commit độc lập trên pool.
   */
  await db.transaction(async (tx) => {
    await tx.insert(settings).values({
      key: 'nav_menu_mobile',
      value: JSON.stringify(items),
      type: 'json',
      group: 'general',
    }).onDuplicateKeyUpdate({ set: { value: JSON.stringify(items) } })

    await tx.insert(activityLogs).values({
      userId: adminUser.id,
      action: 'update',
      resource: 'settings',
      meta: { keysUpdated: ['nav_menu_mobile'], itemCount: items.length },
    })
  })
}
