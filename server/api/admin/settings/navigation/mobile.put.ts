import { getDb } from '../../../../utils/db'
import { settings, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'
import { UnsafeLinkError, assertSafeLink } from '../../../../../shared/link-policy'

// Bottom-nav item. `type` decides behaviour:
//  - 'link'    → navigate to `url`
//  - 'chatbot' → open the AI assistant widget
//  - 'drawer'  → open the hamburger side drawer
// `featured` renders as the raised circular center button.
type BottomNavItem = {
  id: string
  label: string
  icon: string
  type: 'link' | 'chatbot' | 'drawer'
  url: string
  featured: boolean
}

const MAX_ITEMS = 5
const MAX_LABEL = 40
const MAX_URL = 512
const MAX_ICON = 60
const VALID_TYPES = ['link', 'chatbot', 'drawer'] as const

/**
 * The endpoint `/admin/content/navigation/mobile.vue` saves through.
 *
 * Only a `link` tab navigates, so only its URL is checked and stored: a non-empty
 * URL that is not an allowed link (shared/link-policy.ts — `/path` but not
 * `//host`, `#…`, `http(s):`, `mailto:`, `tel:`) is a 400 naming the field (spec
 * page-builder-links). `chatbot`/`drawer` tabs store `''` whatever was sent, so a
 * stale value left in a tab switched away from `link` can neither block the save
 * nor be stored. An empty URL stays allowed (the public reader drops a `link` tab
 * without one).
 */
function sanitizeItem(item: unknown, field: string): BottomNavItem | null {
  if (!item || typeof item !== 'object') return null
  const m = item as Record<string, unknown>
  if (typeof m.label !== 'string' || !m.label.trim()) return null

  const type = (typeof m.type === 'string' && (VALID_TYPES as readonly string[]).includes(m.type))
    ? m.type as BottomNavItem['type']
    : 'link'

  const url = type === 'link' && typeof m.url === 'string' ? m.url.trim().slice(0, MAX_URL) : ''
  assertSafeLink(url, `${field}.url`)

  const label = m.label.trim().slice(0, MAX_LABEL)
  const icon = typeof m.icon === 'string' ? m.icon.trim().slice(0, MAX_ICON) : 'fa-regular fa-circle'
  const id = typeof m.id === 'string' ? m.id.slice(0, 64) : crypto.randomUUID()
  const featured = Boolean(m.featured)

  return { id, label, icon, type, url, featured }
}

function sanitizeMenu(menu: unknown[]): BottomNavItem[] {
  try {
    return menu
      .slice(0, MAX_ITEMS)
      .map((item, index) => sanitizeItem(item, `menu[${index}]`))
      .filter((i): i is BottomNavItem => i !== null)
  } catch (error) {
    if (error instanceof UnsafeLinkError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!Array.isArray(body?.menu)) {
    throw createError({ statusCode: 400, statusMessage: 'menu phải là mảng các mục' })
  }

  const items = sanitizeMenu(body.menu as unknown[])

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

  return { ok: true, menu: items }
})
