import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHATBOT_RESOURCES,
  requireChatbotKnowledgePermission,
  requireChatbotSettingsPermission,
} from '../server/utils/permissions'
import {
  buildChatbotKnowledgeAudit,
  buildChatbotSettingsAudit,
} from '../server/utils/chatbot/audit'

function permission(resource: string, grants: Partial<Record<string, boolean>> = {}) {
  return {
    resource,
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    canPublish: false,
    canArchive: false,
    canTest: false,
    ...grants,
  }
}

function event(adminUser?: unknown) {
  return { context: adminUser ? { adminUser } : {} } as any
}

function hasStatus(statusCode: number) {
  return (error: any) => error?.statusCode === statusCode
}

test('chatbot authorization returns 401 without an authenticated admin', () => {
  assert.throws(() => requireChatbotSettingsPermission(event(), 'read'), hasStatus(401))
  assert.throws(() => requireChatbotKnowledgePermission(event(), 'read'), hasStatus(401))
})

test('chatbot authorization denies missing grants and separates resources and actions', () => {
  const settingsReader = event({
    id: 2,
    isSuperAdmin: false,
    permissions: [permission(CHATBOT_RESOURCES.settings, { canRead: true })],
  })
  assert.equal(requireChatbotSettingsPermission(settingsReader, 'read').id, 2)
  assert.throws(() => requireChatbotSettingsPermission(settingsReader, 'update'), hasStatus(403))
  assert.throws(() => requireChatbotSettingsPermission(settingsReader, 'test'), hasStatus(403))
  assert.throws(() => requireChatbotKnowledgePermission(settingsReader, 'read'), hasStatus(403))

  const knowledgeEditor = event({
    id: 3,
    isSuperAdmin: false,
    permissions: [permission(CHATBOT_RESOURCES.knowledge, { canRead: true, canUpdate: true, canPublish: true })],
  })
  assert.equal(requireChatbotKnowledgePermission(knowledgeEditor, 'update').id, 3)
  assert.equal(requireChatbotKnowledgePermission(knowledgeEditor, 'publish').id, 3)
  assert.throws(() => requireChatbotKnowledgePermission(knowledgeEditor, 'archive'), hasStatus(403))
  assert.throws(() => requireChatbotSettingsPermission(knowledgeEditor, 'read'), hasStatus(403))
})

test('knowledge lifecycle actions require independent dedicated grants', () => {
  assert.throws(() => requireChatbotKnowledgePermission(event(), 'publish'), hasStatus(401))
  assert.throws(() => requireChatbotKnowledgePermission(event(), 'archive'), hasStatus(401))

  const contentEditor = event({
    id: 11,
    isSuperAdmin: false,
    permissions: [permission(CHATBOT_RESOURCES.knowledge, { canCreate: true, canUpdate: true })],
  })
  assert.equal(requireChatbotKnowledgePermission(contentEditor, 'create').id, 11)
  assert.equal(requireChatbotKnowledgePermission(contentEditor, 'update').id, 11)
  assert.throws(() => requireChatbotKnowledgePermission(contentEditor, 'publish'), hasStatus(403))
  assert.throws(() => requireChatbotKnowledgePermission(contentEditor, 'archive'), hasStatus(403))

  const publisher = event({
    id: 12,
    isSuperAdmin: false,
    permissions: [permission(CHATBOT_RESOURCES.knowledge, { canPublish: true })],
  })
  assert.equal(requireChatbotKnowledgePermission(publisher, 'publish').id, 12)
  assert.throws(() => requireChatbotKnowledgePermission(publisher, 'update'), hasStatus(403))
  assert.throws(() => requireChatbotKnowledgePermission(publisher, 'archive'), hasStatus(403))

  const archiver = event({
    id: 13,
    isSuperAdmin: false,
    permissions: [permission(CHATBOT_RESOURCES.knowledge, { canArchive: true })],
  })
  assert.equal(requireChatbotKnowledgePermission(archiver, 'archive').id, 13)
  assert.throws(() => requireChatbotKnowledgePermission(archiver, 'update'), hasStatus(403))
  assert.throws(() => requireChatbotKnowledgePermission(archiver, 'publish'), hasStatus(403))
})

test('connection test is independently granted while key rotation and clear require superadmin', () => {
  const tester = event({
    id: 4,
    isSuperAdmin: false,
    permissions: [permission(CHATBOT_RESOURCES.settings, { canTest: true, canUpdate: true })],
  })
  assert.equal(requireChatbotSettingsPermission(tester, 'test').id, 4)
  assert.equal(requireChatbotSettingsPermission(tester, 'update').id, 4)
  assert.throws(() => requireChatbotSettingsPermission(tester, 'rotate_key'), hasStatus(403))
  assert.throws(() => requireChatbotSettingsPermission(tester, 'clear'), hasStatus(403))

  const superadmin = event({ id: 1, isSuperAdmin: true, permissions: [] })
  for (const action of ['read', 'update', 'clear', 'test', 'rotate_key'] as const) {
    assert.equal(requireChatbotSettingsPermission(superadmin, action).id, 1)
  }
  for (const action of ['read', 'create', 'update', 'delete', 'publish', 'archive'] as const) {
    assert.equal(requireChatbotKnowledgePermission(superadmin, action).id, 1)
  }
})

test('settings audit records only stable allowlisted metadata and field names', () => {
  const marker = 'SETTINGS-SECRET-MARKER'
  const malicious = {
    apiKey: marker,
    api_key_ciphertext: marker,
    systemPrompt: marker,
    baseUrl: `https://user:${marker}@provider.example/v1`,
    headers: { authorization: `Bearer ${marker}` },
    upstream: { response: { body: marker }, error: marker },
    publicChatHistory: [{ content: marker }],
  }
  const audit = buildChatbotSettingsAudit({
    actorId: 7,
    operation: 'rotate_key',
    requestId: 'req-safe_123',
    outcome: 'success',
    configured: true,
    changedFields: ['model', 'apiKey', 'systemPrompt', 'baseUrl', malicious, '__proto__'],
    ...malicious,
  } as any)

  assert.deepEqual(audit, {
    userId: 7,
    action: 'rotate_key',
    resource: 'chatbot_settings',
    resourceId: 1,
    meta: {
      outcome: 'success',
      requestId: 'req-safe_123',
      changedFields: ['api_key', 'base_url', 'model', 'system_prompt'],
      configured: true,
    },
  })
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(marker))
})

test('connection audit excludes provider URL, credentials, bodies, and raw errors', () => {
  const marker = 'UPSTREAM-SECRET-MARKER'
  const audit = buildChatbotSettingsAudit({
    actorId: 8,
    operation: 'test_connection',
    requestId: `bad request ${marker}`,
    outcome: 'failure',
    statusCode: 503,
    durationMs: 321,
    providerUrl: `https://${marker}:password@example.test`,
    rawError: { cause: { response: { body: marker } } },
    authorization: `Bearer ${marker}`,
  } as any)

  assert.deepEqual(audit.meta, { outcome: 'failure', statusCode: 503, durationMs: 321 })
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(marker))
})

test('knowledge audit rejects nested content and keeps lifecycle identifiers only', () => {
  const marker = 'KNOWLEDGE-CONTENT-MARKER'
  const audit = buildChatbotKnowledgeAudit({
    actorId: 9,
    operation: 'publish',
    knowledgeId: 42,
    requestId: 'req-publish-42',
    outcome: 'success',
    fromStatus: 'draft',
    toStatus: 'published',
    termCount: 4,
    approvedAnswer: marker,
    internalNotes: marker,
    retrievedAnswerBody: marker,
    chat: { history: [{ content: marker }] },
    upstream: { response: marker, error: marker },
  } as any)

  assert.deepEqual(audit, {
    userId: 9,
    action: 'publish',
    resource: 'chatbot_knowledge',
    resourceId: 42,
    meta: {
      outcome: 'success',
      requestId: 'req-publish-42',
      fromStatus: 'draft',
      toStatus: 'published',
      termCount: 4,
    },
  })
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(marker))
})

test('knowledge update logs allowlisted field labels without field values', () => {
  const marker = 'ANSWER-AND-NOTES-MARKER'
  const audit = buildChatbotKnowledgeAudit({
    actorId: 10,
    operation: 'update',
    knowledgeId: 43,
    changedFields: ['approvedAnswer', 'internalNotes', 'sourceUrl', { approvedAnswer: marker }, 'unknown'],
    payload: { approvedAnswer: marker, internalNotes: marker },
  } as any)

  assert.deepEqual(audit.meta, {
    outcome: 'success',
    changedFields: ['approved_answer', 'internal_notes', 'source_url'],
  })
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(marker))
})
