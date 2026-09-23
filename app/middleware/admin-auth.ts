export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchUser } = useAdminAuth()

  // Trang login: nếu đã đăng nhập → redirect /admin, không cho vào lại.
  if (to.path === '/admin/login') {
    if (!user.value) await fetchUser()
    if (user.value) return navigateTo('/admin')
    return
  }

  if (!user.value) {
    await fetchUser()
  }

  if (!user.value) {
    return navigateTo('/admin/login')
  }
})
