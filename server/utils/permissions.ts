import { createError, type H3Event } from 'h3'
import { checkPermission } from './auth'

export const CHATBOT_RESOURCES = Object.freeze({
  settings: 'chatbot_settings',
  knowledge: 'chatbot_knowledge',
} as const)

export type ChatbotResource = typeof CHATBOT_RESOURCES[keyof typeof CHATBOT_RESOURCES]
export type ChatbotSettingsAction = 'read' | 'update' | 'clear' | 'test' | 'rotate_key'
export type ChatbotKnowledgeAction = 'read' | 'create' | 'update' | 'delete' | 'publish' | 'archive'

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
