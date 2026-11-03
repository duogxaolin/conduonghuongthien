// Explicit imports (not auto-imports): tests/use-admin-auth-behavior.test.ts runs this
// composable for real with only the Nuxt runtime pieces stood in.
import { adminFetch } from './adminFetch'
import type {
  AdminCaptchaResponse, AdminLoginResponse, AdminLogoutResponse, AdminMeResponse, AdminMfaVerifyResponse, AdminSessionUser,
} from '../types/admin-auth-api'

/**
 * The signed-in admin account — derived from what the server sends (a completed login,
 * and `auth/me`, which sends the same object): app/types/admin-auth-api.ts. Permission
 * flags are `boolean | null`; `mfaEnrollmentRequired` means requests outside the MFA
 * enrollment page are refused (403 `mfa_enrollment_required`), `mfaEnforceAfter` is the
 * enforcement date (ISO) while the account is covered but has no factor yet.
 */
export type AdminUser = AdminSessionUser

export type MfaMethod = 'totp' | 'email_otp' | 'second_password' | 'recovery_code'

/** A session (`user`) or a second-factor challenge (`mfaRequired`) — narrow with `in`. */
export type LoginResponse = AdminLoginResponse

/** Dữ liệu lỗi trả về khi login yêu captcha (sau 3 lần sai). */
export interface CaptchaRequiredError {
  captchaRequired?: boolean
  captchaInvalid?: boolean
}

export const useAdminAuth = () => {
  const user = useState<AdminUser | null>('admin_user', () => null)
  const loading = useState<boolean>('admin_auth_loading', () => false)

  const fetchUser = async () => {
    loading.value = true
    try {
      const headers = useRequestHeaders(['cookie']) as Record<string, string>
      const res = await adminFetch<AdminMeResponse>(`/api/admin/auth/me`, { headers })
      if (res.ok && res.user) {
        user.value = res.user
      } else {
        user.value = null
      }
    } catch {
      user.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Two possible outcomes now: a session (`user` present) or a second-factor
   * challenge (`mfaRequired`). The caller must branch, so the response type is a
   * union — an account with a factor enabled never gets a `user` here.
   */
  const login = async (username: string, password: string, captcha?: { captchaId: string; captchaCode: string }) => {
    const res = await adminFetch<LoginResponse>('/api/admin/auth/login', {
      method: 'POST',
      body: { username, password, ...(captcha ? { captchaId: captcha.captchaId, captchaCode: captcha.captchaCode } : {}) }
    })
    if (res.ok && 'user' in res && res.user) {
      user.value = res.user
    }
    return res
  }

  /** Lấy captcha image mới (SVG) sau khi server yêu cầu. */
  const fetchCaptcha = async () => {
    return await adminFetch<AdminCaptchaResponse>(`/api/admin/auth/captcha`)
  }

  /** Second step of a challenged login: the ticket travels in the `cdkt_mfa` cookie. */
  const verifyMfa = async (method: MfaMethod, code: string) => {
    const res = await adminFetch<AdminMfaVerifyResponse>('/api/admin/auth/mfa/verify', {
      method: 'POST',
      body: { method, code }
    })
    if (res.ok && res.user) {
      user.value = res.user
    }
    return res
  }

  const logout = async () => {
    try {
      await adminFetch<AdminLogoutResponse>('/api/admin/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      navigateTo('/admin/login')
    }
  }

  const hasPermission = (resource: string, action: 'create' | 'read' | 'update' | 'delete'): boolean => {
    if (!user.value) return false
    if (user.value.isSuperAdmin) return true
    const perm = user.value.permissions.find(p => p.resource === resource)
    if (!perm) return false
    const map = { create: perm.canCreate, read: perm.canRead, update: perm.canUpdate, delete: perm.canDelete }
    return map[action] === true
  }

  return {
    user,
    loading,
    fetchUser,
    login,
    fetchCaptcha,
    verifyMfa,
    logout,
    hasPermission,
  }
}
