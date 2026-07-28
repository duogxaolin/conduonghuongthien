export interface AdminUser {
  id: number
  username: string
  email: string | null
  roleName: string
  isSuperAdmin: boolean
  permissions: Array<{
    resource: string
    canCreate: boolean
    canRead: boolean
    canUpdate: boolean
    canDelete: boolean
  }>
}

export type MfaMethod = 'totp' | 'email_otp' | 'second_password' | 'recovery_code'

export interface LoginResponse {
  ok: boolean
  user?: AdminUser
  mfaRequired?: boolean
  methods?: MfaMethod[]
  recoveryCodesAvailable?: boolean
}

export const useAdminAuth = () => {
  const user = useState<AdminUser | null>('admin_user', () => null)
  const loading = useState<boolean>('admin_auth_loading', () => false)

  const fetchUser = async () => {
    loading.value = true
    try {
      const headers = useRequestHeaders(['cookie']) as Record<string, string>
      const res = await $fetch<{ ok: boolean; user: AdminUser }>('/api/admin/auth/me', { headers })
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
   * challenge (`mfaRequired`). The caller must branch, so `user` is optional in
   * the response type — an account with a factor enabled never gets one here.
   */
  const login = async (username: string, password: string) => {
    const res = await $fetch<LoginResponse>('/api/admin/auth/login', {
      method: 'POST',
      body: { username, password }
    })
    if (res.ok && res.user) {
      user.value = res.user
    }
    return res
  }

  /** Second step of a challenged login: the ticket travels in the `cdkt_mfa` cookie. */
  const verifyMfa = async (method: MfaMethod, code: string) => {
    const res = await $fetch<LoginResponse>('/api/admin/auth/mfa/verify', {
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
      await $fetch('/api/admin/auth/logout', { method: 'POST' })
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
    verifyMfa,
    logout,
    hasPermission,
  }
}
