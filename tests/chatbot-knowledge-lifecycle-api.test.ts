import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const transitions: Array<{ actorId: number; id: number; target: string }> = []
const writes: Array<{ operation: string; actorId: number; id?: number; input: Record<string, unknown> }> = []
class ValidationError extends Error {}

function rejectInjectedStatus(input: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(input, 'status')) throw new ValidationError('status requires a lifecycle endpoint')
}

mock.module(new URL('../server/services/chatbot-knowledge.ts', import.meta.url), {
  namedExports: {
    ChatbotKnowledgeValidationError: ValidationError,
    adminKnowledge: (item: unknown) => item,
    createKnowledge: async (actorId: number, input: Record<string, unknown>) => {
      rejectInjectedStatus(input)
      writes.push({ operation: 'create', actorId, input })
      return { id: 43, status: 'draft' }
    },
    updateKnowledge: async (actorId: number, id: number, input: Record<string, unknown>) => {
      rejectInjectedStatus(input)
      writes.push({ operation: 'update', actorId, id, input })
      return { id, status: 'draft' }
    },
    transitionKnowledge: async (actorId: number, id: number, target: string) => {
      transitions.push({ actorId, id, target })
      return { id, status: target }
    },
  },
})

Object.assign(globalThis, {
  defineEventHandler: (handler: (event: any) => unknown) => handler,
  getRouterParam: (event: any, name: string) => event.context.params?.[name],
  createError: (input: { statusCode: number; statusMessage: string }) => Object.assign(new Error(input.statusMessage), input),
  readBody: async (event: any) => event.context.body,
})

const createHandler = (await import('../server/api/admin/chatbot/knowledge/index.post')).default
const updateHandler = (await import('../server/api/admin/chatbot/knowledge/[id].put')).default
const publishHandler = (await import('../server/api/admin/chatbot/knowledge/[id]/publish.post')).default
const archiveHandler = (await import('../server/api/admin/chatbot/knowledge/[id]/archive.post')).default

function permission(grants: Record<string, boolean> = {}) {
  return {
    resource: 'chatbot_knowledge',
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    canPublish: false,
    canArchive: false,
    ...grants,
  }
}

function event(adminUser?: unknown, body: Record<string, unknown> = {}) {
  return { context: { ...(adminUser ? { adminUser } : {}), params: { id: '42' }, body } } as any
}

function hasStatus(statusCode: number) {
  return (error: any) => error?.statusCode === statusCode
}

test('create and update endpoints reject injected lifecycle status without performing a write', async () => {
  writes.length = 0
  const createEditor = { id: 6, permissions: [permission({ canCreate: true })] }
  const updateEditor = { id: 7, permissions: [permission({ canUpdate: true })] }

  await assert.rejects(createHandler(event(createEditor, { canonicalQuestion: 'Q', status: 'published' })), hasStatus(400))
  await assert.rejects(updateHandler(event(updateEditor, { status: 'archived' })), hasStatus(400))
  assert.deepEqual(writes, [])
})

test('create and update endpoints preserve their independent authorization boundary', async () => {
  writes.length = 0
  await assert.rejects(createHandler(event()), hasStatus(401))
  await assert.rejects(createHandler(event({ id: 8, permissions: [permission({ canUpdate: true })] })), hasStatus(403))
  await assert.rejects(updateHandler(event({ id: 9, permissions: [permission({ canCreate: true })] })), hasStatus(403))

  assert.deepEqual(await createHandler(event({ id: 10, permissions: [permission({ canCreate: true })] }, { canonicalQuestion: 'Q' })), { ok: true, item: { id: 43, status: 'draft' } })
  assert.deepEqual(await updateHandler(event({ id: 11, permissions: [permission({ canUpdate: true })] }, { canonicalQuestion: 'Q2' })), { ok: true, item: { id: 42, status: 'draft' } })
  assert.equal(writes.length, 2)
})

test('publish endpoint separates unauthenticated, forbidden, and authorized callers', async () => {
  transitions.length = 0
  await assert.rejects(publishHandler(event()), hasStatus(401))
  await assert.rejects(publishHandler(event({ id: 1, permissions: [permission({ canCreate: true, canUpdate: true })] })), hasStatus(403))

  const response = await publishHandler(event({ id: 2, permissions: [permission({ canPublish: true })] }))
  assert.deepEqual(response, { ok: true, item: { id: 42, status: 'published' } })
  assert.deepEqual(transitions, [{ actorId: 2, id: 42, target: 'published' }])
})

test('archive endpoint separates unauthenticated, forbidden, and authorized callers', async () => {
  transitions.length = 0
  await assert.rejects(archiveHandler(event()), hasStatus(401))
  await assert.rejects(archiveHandler(event({ id: 3, permissions: [permission({ canPublish: true })] })), hasStatus(403))

  const response = await archiveHandler(event({ id: 4, permissions: [permission({ canArchive: true })] }))
  assert.deepEqual(response, { ok: true, item: { id: 42, status: 'archived' } })
  assert.deepEqual(transitions, [{ actorId: 4, id: 42, target: 'archived' }])
})

test('superadmin can call both lifecycle endpoints without delegated grants', async () => {
  transitions.length = 0
  await publishHandler(event({ id: 5, isSuperAdmin: true, permissions: [] }))
  await archiveHandler(event({ id: 5, isSuperAdmin: true, permissions: [] }))
  assert.deepEqual(transitions, [
    { actorId: 5, id: 42, target: 'published' },
    { actorId: 5, id: 42, target: 'archived' },
  ])
})
