import { createError, type H3Event } from 'h3'
import { checkPermission } from './auth'

export const CHATBOT_RESOURCES = Object.freeze({
  settings: 'chatbot_settings',
  knowledge: 'chatbot_knowledge',
} as const)

export type ChatbotResource = typeof CHATBOT_RESOURCES[keyof typeof CHATBOT_RESOURCES]
export type ChatbotSettingsAction = 'read' | 'update' | 'clear' | 'test' | 'rotate_key'
export type ChatbotKnowledgeAction = 'read' | 'create' | 'update' | 'delete' | 'publish' | 'archive'
// The everyday-reply store shares the chatbot_knowledge resource on purpose
// (see design decision 3). It has no publish/archive lifecycle, so its actions
// are the CRUD subset only.
export type ChatbotSmallTalkAction = 'read' | 'create' | 'update' | 'delete'

// Canonical set of RBAC resources. Permission grants outside this set are rejected.
//
// `readers` and `comments` are deliberately NOT folded into an article resource
// (design.md D13, reader-google-login-comments). An officer who may publish news
// is not thereby authorized to read citizens' email addresses and posting
// histories — that is a different category of data. Both ship granted to no
// existing role, so an administrator has to hand them out after upgrading;
// seeding them onto current roles would silently widen access to personal data
// for whoever already held one.
export const VALID_RESOURCES = new Set<string>([
  'news', 'role_models', 'reintegration', 'documents', 'faq', 'categories',
  'home_sections', 'pages', 'users', 'roles', 'media', 'settings', 'submissions',
  'analytics', 'chatbot_settings', 'chatbot_knowledge', 'readers', 'comments',
])

const ACTION_FLAGS = [
  ['canCreate', 'create'], ['canRead', 'read'], ['canUpdate', 'update'], ['canDelete', 'delete'],
] as const

/**
 * The shape every admin handler already has on `event.context.adminUser`.
 * Exported so the delete/update services can take an actor without each one
 * restating this structural type — seven private copies would drift.
 */
export type ActorLike = { id?: number; isSuperAdmin?: boolean | null; permissions?: Array<{ resource: string; canCreate: boolean | null; canRead: boolean | null; canUpdate: boolean | null; canDelete: boolean | null }> | null }

/**
 * Throw 403 unless the actor holds `action` on `resource`.
 *
 * The shared services call this instead of inlining the `checkPermission` +
 * `createError` pair, so a bulk route cannot accidentally omit the check for
 * rows it processes after the first.
 */
export function requireResourcePermission(actor: ActorLike, resource: string, action: 'create' | 'read' | 'update' | 'delete'): void {
  if (!checkPermission(actor?.permissions || [], resource, action, actor?.isSuperAdmin === true)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
  }
}

/**
 * Guard against privilege escalation when writing role permissions: every
 * resource must be valid, and a non-superadmin may not grant a permission they
 * do not themselves hold ("no granting what you don't have").
 */
export function assertAssignablePermissions(actor: ActorLike, permsInput: unknown): void {
  if (!Array.isArray(permsInput)) return
  const isSuper = actor?.isSuperAdmin === true
  const actorPerms = actor?.permissions || []
  for (const raw of permsInput) {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const resource = String(p.resource || '')
    if (!VALID_RESOURCES.has(resource)) {
      throw createError({ statusCode: 400, statusMessage: `Tài nguyên phân quyền không hợp lệ: ${resource || '(trống)'}` })
    }
    if (isSuper) continue
    for (const [flag, action] of ACTION_FLAGS) {
      if (p[flag] === true && !checkPermission(actorPerms, resource, action, false)) {
        throw createError({ statusCode: 403, statusMessage: `Bạn không thể cấp quyền ${resource}:${action} mà chính bạn chưa có.` })
      }
    }
  }
}

/**
 * Guard against privilege escalation when assigning a role to a user: only a
 * superadmin may put a user into a system role (which confers superadmin).
 */
export function assertRoleAssignable(actor: ActorLike, targetRoleIsSystem: boolean | null | undefined): void {
  if (targetRoleIsSystem && actor?.isSuperAdmin !== true) {
    throw createError({ statusCode: 403, statusMessage: 'Chỉ SuperAdmin mới được gán vai trò hệ thống.' })
  }
}

type BasePermission = {
  resource: string
  canCreate: boolean | null
  canRead: boolean | null
  canUpdate: boolean | null
  canDelete: boolean | null
  canPublish?: boolean | null
  canArchive?: boolean | null
  canTest?: boolean | null
}

export type ChatbotAdminUser = {
  id: number
  isSuperAdmin?: boolean | null
  permissions?: BasePermission[] | null
}

function forbidden(): never {
  throw createError({ statusCode: 403, statusMessage: 'Forbidden: Insufficient permissions' })
}

function requireAdminUser(event: H3Event): ChatbotAdminUser {
  const adminUser = event.context.adminUser as ChatbotAdminUser | undefined
  if (!adminUser) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return adminUser
}

function findPermission(user: ChatbotAdminUser, resource: ChatbotResource): BasePermission | undefined {
  return (user.permissions || []).find(permission => permission.resource === resource)
}

export function requireChatbotSettingsPermission(event: H3Event, action: ChatbotSettingsAction): ChatbotAdminUser {
  const user = requireAdminUser(event)
  const isSuperAdmin = user.isSuperAdmin === true

  // Replacing or clearing provider credentials is deliberately restricted to the
  // system superadmin boundary even if a delegated role can edit ordinary settings.
  if (action === 'rotate_key' || action === 'clear') {
    if (!isSuperAdmin) forbidden()
    return user
  }

  if (action === 'test') {
    if (!isSuperAdmin && findPermission(user, CHATBOT_RESOURCES.settings)?.canTest !== true) forbidden()
    return user
  }

  if (!checkPermission(
    user.permissions || [],
    CHATBOT_RESOURCES.settings,
    action,
    isSuperAdmin,
  )) forbidden()

  return user
}

export function requireChatbotKnowledgePermission(event: H3Event, action: ChatbotKnowledgeAction): ChatbotAdminUser {
  const user = requireAdminUser(event)
  const isSuperAdmin = user.isSuperAdmin === true

  if (action === 'publish' || action === 'archive') {
    const permission = findPermission(user, CHATBOT_RESOURCES.knowledge)
    const allowed = action === 'publish' ? permission?.canPublish === true : permission?.canArchive === true
    if (!isSuperAdmin && !allowed) forbidden()
    return user
  }

  if (!checkPermission(
    user.permissions || [],
    CHATBOT_RESOURCES.knowledge,
    action,
    isSuperAdmin,
  )) forbidden()

  return user
}

/**
 * Gate the everyday-reply store. Shares the `chatbot_knowledge` resource — no
 * new RBAC resource is introduced (design decision 3), so a role that can edit
 * the knowledge bank can edit small talk. Plain CRUD; there is no publish flow.
 */
export function requireChatbotSmallTalkPermission(event: H3Event, action: ChatbotSmallTalkAction): ChatbotAdminUser {
  const user = requireAdminUser(event)
  const isSuperAdmin = user.isSuperAdmin === true
  if (!checkPermission(
    user.permissions || [],
    CHATBOT_RESOURCES.knowledge,
    action,
    isSuperAdmin,
  )) forbidden()
  return user
}
