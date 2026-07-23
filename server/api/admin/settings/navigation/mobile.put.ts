import { getDb } from '../../../../utils/db'
import { settings, activityLogs } from '../../../../db/schema'
import { checkPermission } from '../../../../utils/auth'

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

function isValidUrl(url: string): boolean {
  if (!url) return true // url optional for action items
  return url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#')
}

function sanitizeItem(item: unknown): BottomNavItem | null {
  if (!item || typeof item !== 'object') return null
  const m = item as Record<string, unknown>
  if (typeof m.label !== 'string' || !m.label.trim()) return null

  const type = (typeof m.type === 'string' && (VALID_TYPES as readonly string[]).includes(m.type))
    ? m.type as BottomNavItem['type']
    : 'link'

  const rawUrl = typeof m.url === 'string' ? m.url.trim() : ''
  if (!isValidUrl(rawUrl)) return null

  const label = m.label.trim().slice(0, MAX_LABEL)
  const icon = typeof m.icon === 'string' ? m.icon.trim().slice(0, MAX_ICON) : 'fa-regular fa-circle'
  const url = rawUrl.slice(0, MAX_URL)
  const id = typeof m.id === 'string' ? m.id.slice(0, 64) : crypto.randomUUID()
  const featured = Boolean(m.featured)

  return { id, label, icon, type, url: type === 'link' ? url : '', featured }
}

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'settings', 'update', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const body = await readBody(event).catch(() => ({}))
  if (!Array.isArray(body?.menu)) {
    throw createError({ statusCode: 400, statusMessage: 'menu phải là mảng các mục' })
  }

  const items = (body.menu as unknown[])
    .slice(0, MAX_ITEMS)
    .map(sanitizeItem)
    .filter((i): i is BottomNavItem => i !== null)

  const db = getDb()
  await db.insert(settings).values({
    key: 'nav_menu_mobile',
    value: JSON.stringify(items),
    type: 'json',
    group: 'general',
  }).onDuplicateKeyUpdate({ set: { value: JSON.stringify(items) } })

  await db.insert(activityLogs).values({
    userId: adminUser.id,
    action: 'update',
    resource: 'settings',
    meta: { keysUpdated: ['nav_menu_mobile'], itemCount: items.length },
  })

  return { ok: true, menu: items }
})
