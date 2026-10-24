/**
 * PUT /api/admin/security/mfa-policy — `{ policy: 'off' | 'privileged' | 'all' }`.
 *
 * Chỉ SuperAdmin (spec admin-mfa-policy): chính sách quyết định ai bị khoá khỏi
 * trang quản trị, nên một vai trò được uỷ quyền `settings.update` không được đổi
 * nó. Ghi + audit cùng transaction trong `services/mfa-policy.ts`.
 */
import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { setMfaPolicy } from '../../../services/mfa-policy'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  requireSuperAdmin(adminUser)

  const body = await readBody(event).catch(() => null)
  const policy = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).policy : undefined
  const result = await setMfaPolicy(adminUser, policy)
  return { ok: true, ...result }
})
