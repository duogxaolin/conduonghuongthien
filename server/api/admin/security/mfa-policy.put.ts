/**
 * PUT /api/admin/security/mfa-policy — `{ policy: 'off' | 'privileged' | 'all' }`.
 *
 * Chỉ SuperAdmin (spec admin-mfa-policy): chính sách quyết định ai bị khoá khỏi
 * trang quản trị, nên một vai trò được uỷ quyền `settings.update` không được đổi
 * nó. Ghi + audit cùng transaction trong `services/mfa-policy.ts`.
 *
 * Thân đọc qua `readValidated` (wave2 5.2, `utils/request-body.ts`), SAU hai chốt
 * quyền: chỉ JSON object với `Content-Type` JSON — form urlencoded, `text/plain`,
 * thân không `Content-Type` (thứ một trang khác site gửi được không cần preflight)
 * và JSON cụt đều 400 trước khi chạm chính sách. `setMfaPolicy` vẫn tự kiểm giá trị.
 */
import { z } from 'zod'
import { requireResourcePermission, requireSuperAdmin } from '../../../utils/permissions'
import { readValidated } from '../../../utils/request-body'
import { MFA_POLICIES, MFA_POLICY_INVALID_MESSAGE } from '../../../utils/mfa/policy'
import { setMfaPolicy } from '../../../services/mfa-policy'

const MfaPolicyBody = z.object({
  policy: z.enum(MFA_POLICIES, { error: MFA_POLICY_INVALID_MESSAGE }),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')
  requireSuperAdmin(adminUser)

  const { policy } = await readValidated(event, MfaPolicyBody)
  const result = await setMfaPolicy(adminUser, policy)
  return { ok: true, ...result }
})
