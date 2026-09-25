import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { reorderLanguages } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || !Array.isArray(body.orders)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu thứ tự không hợp lệ.' })
  }

  const orders = body.orders.filter(
    (o: unknown): o is { code: string; displayOrder: number } =>
      typeof o === 'object' && o !== null &&
      'code' in o && typeof (o as { code: unknown }).code === 'string' &&
      'displayOrder' in o && typeof (o as { displayOrder: unknown }).displayOrder === 'number',
  )

  if (orders.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Không có dữ liệu sắp xếp.' })
  }

  await reorderLanguages(adminUser, orders)

  return { ok: true, message: 'Đã cập nhật thứ tự ngôn ngữ thành công.' }
})
