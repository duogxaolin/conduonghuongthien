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

export const useAdminAuth = () => {
  const user = useState<AdminUser | null>('admin_user', () => null)
  const loading = useState<boolean>('admin_auth_loading', () => false)

  const fetchUser = async () => {
    loading.value = true
    try {
      const res = await $fetch<{ ok: boolean; user: AdminUser }>('/api/admin/auth/me')
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

  const login = async (username: string, password: string) => {
    const res = await $fetch<{ ok: boolean; user: AdminUser }>('/api/admin/auth/login', {
      method: 'POST',
      body: { username, password }
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
    logout,
    hasPermission,
  }
}
