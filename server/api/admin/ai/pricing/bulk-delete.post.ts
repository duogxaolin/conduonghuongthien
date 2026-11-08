import { requireResourcePermission } from '../../../../utils/permissions'
import { bulkDeletePricingWithAudit } from '../../../../services/admin-ai-pricing'

/**
 * Bulk delete AI model pricing rows.
 * Accepts `{ models: string[] }`.
 * Writes activity_logs in the same transaction.
 */
export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'ai', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object' || !Array.isArray(body.models)) {
    throw createError({ statusCode: 400, statusMessage: 'Danh sách models không hợp lệ.' })
  }

  const requested: string[] = [...new Set<string>(body.models
    .filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0)
    .map((m: string) => m.trim()))]

  if (requested.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Vui lòng chọn ít nhất 1 model để xoá.' })
  }
  // Refused, not cut: `model` is VARCHAR(64), so a longer name names no row — cut to 64
  // it would name ANOTHER model whose name is exactly its first 64 characters.
  if (requested.some(name => name.length > 64)) {
    throw createError({ statusCode: 400, statusMessage: 'Tên model dài quá 64 ký tự.' })
  }

  // What was deleted, not what was asked — found, locked, deleted and audited in one
  // transaction (in the service).
  const deleted = await bulkDeletePricingWithAudit(adminUser, requested)

  return { ok: true, deleted: deleted.length }
})
