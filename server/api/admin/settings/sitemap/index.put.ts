import { eq } from 'drizzle-orm'

import { getDb } from '../../../../utils/db'
import { settings, activityLogs } from '../../../../db/schema'
import { requireResourcePermission } from '../../../../utils/permissions'

/**
 * Lưu sitemap admin đã sửa. Cặp ghi + audit trong một transaction — tiền lệ
 * `navigation.put.ts`: `activity_logs.user_id` là FK tới `users` và `meta` là
 * cột JSON, nên viết rời có cách hỏng riêng (hàng đã xong, không còn gì ghi ai
 * đã làm). Chạy trên `tx`, không phải `db`.
 *
 * Không validate XML chặt: admin có thể chỉnh tay và muốn giữ lại những thứ
 * builder không sinh (ví dụ `priority` tuỳ chỉnh, comment XML). Chỉ chặn rỗng
 * và vượt giới hạn mềm 500KB (sitemap > 50MB bị Google từ chối — 500KB là ngưỡng
 * sớm cảnh báo, không phải hard limit).
 */
const MAX_XML = 500_000

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  const xml = typeof body?.xml === 'string' ? body.xml : ''

  if (!xml.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Sitemap không được để trống.' })
  }
  if (xml.length > MAX_XML) {
    throw createError({ statusCode: 400, statusMessage: `Sitemap quá lớn (> ${MAX_XML} ký tự). Google từ chối sitemap > 50MB.` })
  }

  const now = new Date().toISOString()
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

  return { ok: true, updatedAt: now }
})
