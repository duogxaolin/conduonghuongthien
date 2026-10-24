/**
 * GET /api/admin/security/mfa-policy — chính sách bắt buộc MFA hiện tại, mốc cưỡng
 * chế, công tắc `MFA_ENFORCEMENT`, và những tài khoản sẽ bị chặn (chưa có yếu tố)
 * ở từng mức. Chỉ SuperAdmin — cùng cổng với lượt ghi.
 */
import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { getMfaPolicyOverview } from '../../../services/mfa-policy'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')
  requireSuperAdmin(adminUser)
  return { ok: true, ...(await getMfaPolicyOverview(adminUser)) }
})
