import { getDb } from '../../../../utils/db'
import { settings, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

type MenuItem = {
  id: string
  label: string
  url: string
  openNewTab?: boolean
  children?: Array<{ id: string; label: string; url: string; openNewTab?: boolean }>
}

const MAX_ITEMS = 20
const MAX_CHILDREN = 10
const MAX_LABEL = 80
const MAX_URL = 512

function isValidUrl(url: string): boolean {
  if (!url) return false
  return url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#')
}

function sanitizeItem(item: unknown): MenuItem | null {
  if (!item || typeof item !== 'object') return null
  const m = item as Record<string, unknown>
  if (typeof m.label !== 'string' || !m.label.trim()) return null
  if (typeof m.url !== 'string' || !isValidUrl(m.url.trim())) return null
  const label = m.label.trim().slice(0, MAX_LABEL)
  const url = m.url.trim().slice(0, MAX_URL)
  const id = typeof m.id === 'string' ? m.id.slice(0, 64) : crypto.randomUUID()
  const openNewTab = Boolean(m.openNewTab)
  const rawChildren = Array.isArray(m.children) ? m.children : []
  const children = rawChildren
    .slice(0, MAX_CHILDREN)
    .map(c => sanitizeItem(c))
    .filter((c): c is MenuItem => c !== null)
    .map(({ id, label, url, openNewTab }) => ({ id, label, url, openNewTab }))
  return { id, label, url, openNewTab, ...(children.length ? { children } : {}) }
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!Array.isArray(body?.menu)) {
    throw createError({ statusCode: 400, statusMessage: 'menu phải là mảng các mục' })
  }

  const items = (body.menu as unknown[])
    .slice(0, MAX_ITEMS)
    .map(sanitizeItem)
    .filter((i): i is MenuItem => i !== null)

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

  return { ok: true, menu: items }
})
