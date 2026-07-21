export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser

  if (!adminUser) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  return {
    ok: true,
    user: {
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      roleName: adminUser.roleName,
      isSuperAdmin: adminUser.isSuperAdmin,
      permissions: adminUser.permissions,
    }
  }
})
