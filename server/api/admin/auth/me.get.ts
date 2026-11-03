import { mfaEnrollmentFields, NO_ENROLLMENT_REQUIRED, type MfaEnrollmentStatus } from '../../../utils/mfa/policy'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  if (!adminUser) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  // Tính bởi middleware `admin-auth` trên đúng request này (chính sách MFA).
  const enrollment = (event.context.mfaEnrollment as MfaEnrollmentStatus | undefined) ?? NO_ENROLLMENT_REQUIRED

  return {
    ok: true,
    user: {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      roleName: adminUser.roleName,
      isSuperAdmin: adminUser.isSuperAdmin,
      permissions: adminUser.permissions,
      // `mfaEnrollmentRequired`: request ngoài trang bật MFA đang bị 403 — giao diện
      // chuyển về /admin/profile#security. `mfaEnforceAfter`: mốc (ISO) khi tài
      // khoản thuộc diện mà chưa có yếu tố — banner báo ngày trong thời hạn ân hạn.
      ...mfaEnrollmentFields(enrollment),
    }
  }
})
