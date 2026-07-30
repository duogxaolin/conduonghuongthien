/**
 * The shared bulk plumbing and the routes built on it.
 *
 * Two properties matter more than the rest and both are asserted here:
 *
 *   PARTIAL SUCCESS. One blocked row must not cancel the lot, and the response
 *   has to say which rows went through and why the others did not. A bulk delete
 *   that reports "ok" while silently skipping rows is worse than no bulk delete.
 *
 *   PER-ROW PERMISSION. The guards live in the services, so a lot is checked row
 *   by row. The knowledge routes are the visible case: publishing and archiving
 *   are separate grants, so which permission a request needs depends on the
 *   target status, not on the route.
 *
 * The services are mocked here — this file is about the wiring. The guards
 * themselves are exercised against a fake database in bulk-delete-guards.test.ts.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

// ─── Recorded calls ──────────────────────────────────────────────────────────
const calls: Array<{ op: string; id?: number; actorId?: number; extra?: unknown }> = []
let r2Reads = 0
/** Ids the fake services refuse, keyed by the message an operator should see. */
const blocked = new Map<number, string>()

class KnowledgeValidationError extends Error {}

function record(op: string, actorId: number | undefined, id: number, extra?: unknown) {
  const problem = blocked.get(id)
  if (problem) throw Object.assign(new Error(problem), { statusCode: 400, statusMessage: problem })
  calls.push({ op, id, actorId, extra })
}

mock.module(new URL('../server/services/users.ts', import.meta.url), {
  namedExports: {
    deleteUserById: async (actor: any, id: number) => record('user.delete', actor?.id, id),
    setUserActive: async (actor: any, id: number, isActive: boolean) => record('user.active', actor?.id, id, isActive),
  },
})

mock.module(new URL('../server/services/media.ts', import.meta.url), {
  namedExports: {
    loadR2Config: async () => { r2Reads++; return { bucket: 'test' } },
    deleteMediaById: async (actor: any, id: number, config: unknown) => record('media.delete', actor?.id, id, config),
  },
})

mock.module(new URL('../server/services/articles.ts', import.meta.url), {
  namedExports: {
    ARTICLE_STATUSES: ['draft', 'published', 'archived'],
    deleteArticleById: async (actor: any, id: number) => record('article.delete', actor?.id, id),
    setArticleStatus: async (actor: any, id: number, status: string) => record('article.status', actor?.id, id, status),
  },
})

mock.module(new URL('../server/services/categories.ts', import.meta.url), {
  namedExports: {
    deleteCategoryById: async (actor: any, id: number) => record('category.delete', actor?.id, id),
  },
})

mock.module(new URL('../server/services/submissions.ts', import.meta.url), {
  namedExports: {
    deleteSubmissionById: async (actor: any, id: number) => record('submission.delete', actor?.id, id),
  },
})

mock.module(new URL('../server/services/chatbot-knowledge.ts', import.meta.url), {
  namedExports: {
    ChatbotKnowledgeValidationError: KnowledgeValidationError,
    deleteKnowledge: async (actorId: number, id: number) => { record('knowledge.delete', actorId, id); return true },
    updateKnowledge: async (actorId: number, id: number, patch: any) => {
      // Same shape as the real service: a lifecycle rule is a validation error,
      // and a missing row is a null return rather than a throw.
      if (id === 999) throw new KnowledgeValidationError('Cần nguồn tham khảo trước khi xuất bản.')
      if (id === 404) return null
      record('knowledge.quick', actorId, id, String(patch?.isQuickQuestion))
      return { id, isQuickQuestion: patch?.isQuickQuestion }
    },
    transitionKnowledge: async (actorId: number, id: number, target: string) => {
      // A lifecycle rule surfaces as a validation error, which the route has to
      // translate into a 400 rather than letting it escape as a 500.
      if (id === 999) throw new KnowledgeValidationError('Cần nguồn tham khảo trước khi xuất bản.')
      record('knowledge.status', actorId, id, target)
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

const { parseBulkIds, runBulk, BULK_MAX_IDS } = await import('../server/utils/bulk')

const usersDelete = (await import('../server/api/admin/users/bulk-delete.post')).default
const usersActive = (await import('../server/api/admin/users/bulk-active.post')).default
const mediaDelete = (await import('../server/api/admin/media/bulk-delete.post')).default
const articlesDelete = (await import('../server/api/admin/articles/bulk-delete.post')).default
const articlesStatus = (await import('../server/api/admin/articles/bulk-status.post')).default
const categoriesDelete = (await import('../server/api/admin/categories/bulk-delete.post')).default
const submissionsDelete = (await import('../server/api/admin/submissions/bulk-delete.post')).default
const knowledgeDelete = (await import('../server/api/admin/chatbot/knowledge/bulk-delete.post')).default
const knowledgeStatus = (await import('../server/api/admin/chatbot/knowledge/bulk-status.post')).default
const knowledgeQuick = (await import('../server/api/admin/chatbot/knowledge/bulk-quick-question.post')).default

function event(adminUser: unknown, body: Record<string, unknown>) {
  return { context: { adminUser, body } } as any
}

/** A knowledge permission row with every flag off unless granted. */
function knowledgePermission(grants: Record<string, boolean> = {}) {
  return {
    resource: 'chatbot_knowledge',
    canCreate: false, canRead: false, canUpdate: false, canDelete: false,
    canPublish: false, canArchive: false,
    ...grants,
  }
}

function reset() {
  calls.length = 0
  r2Reads = 0
  blocked.clear()
}

// ─── parseBulkIds ────────────────────────────────────────────────────────────

test('parseBulkIds refuses anything that is not a list of positive integers', () => {
  const rejected: Array<[string, unknown]> = [
    ['missing body', undefined],
    ['no ids key', {}],
    ['not an array', { ids: 5 }],
    ['empty selection', { ids: [] }],
    ['a string id', { ids: ['3'] }],
    ['a float', { ids: [1.5] }],
    ['zero', { ids: [0] }],
    ['a negative id', { ids: [-2] }],
    ['null among valid ids', { ids: [1, null, 3] }],
    ['NaN', { ids: [Number.NaN] }],
    ['over the cap', { ids: Array.from({ length: BULK_MAX_IDS + 1 }, (_, i) => i + 1) }],
  ]

  for (const [label, body] of rejected) {
    assert.throws(
      () => parseBulkIds(body),
      (error: any) => error?.statusCode === 400,
      `${label} must be a 400, not a partial run`,
    )
  }
})

test('parseBulkIds collapses duplicates but keeps order, and accepts a full lot', () => {
  // A row ticked twice is a UI artefact, not an error worth failing the request.
  assert.deepEqual(parseBulkIds({ ids: [4, 2, 4, 9, 2] }), [4, 2, 9])
  assert.equal(parseBulkIds({ ids: Array.from({ length: BULK_MAX_IDS }, (_, i) => i + 1) }).length, BULK_MAX_IDS)
})

// ─── runBulk ─────────────────────────────────────────────────────────────────

test('runBulk finishes the lot when a row is blocked and reports each reason', async () => {
  const seen: number[] = []
  const result = await runBulk([1, 2, 3, 4], async (id) => {
    seen.push(id)
    if (id === 2) throw Object.assign(new Error('ignored'), { statusCode: 400, statusMessage: 'Còn 3 bài viết.' })
    if (id === 3) throw new Error('Lỗi không xác định.')
  })

  assert.deepEqual(seen, [1, 2, 3, 4], 'a blocked row must not abort the rows after it')
  assert.deepEqual(result, {
    ok: true,
    requested: 4,
    succeeded: 2,
    succeededIds: [1, 4],
    failed: [
      { id: 2, message: 'Còn 3 bài viết.' },
      { id: 3, message: 'Lỗi không xác định.' },
    ],
  })
})

test('runBulk falls back to the caller message when an error carries none', async () => {
  const result = await runBulk([7], async () => { throw {} }, 'Không thể xóa mục này.')
  assert.deepEqual(result.failed, [{ id: 7, message: 'Không thể xóa mục này.' }])
})

test('runBulk applies the operation one row at a time', async () => {
  // Sequential on purpose: media deletion does network I/O and the relational
  // guards count rows that earlier iterations may already have removed.
  let inFlight = 0
  let maxInFlight = 0
  await runBulk([1, 2, 3], async () => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(resolve => setTimeout(resolve, 1))
    inFlight--
  })
  assert.equal(maxInFlight, 1)
})

// ─── Routes ──────────────────────────────────────────────────────────────────

test('a bulk route passes the acting admin and every id to the service', async () => {
  reset()
  const actor = { id: 4, permissions: [] }
  const result: any = await usersDelete(event(actor, { ids: [11, 12] }))

  assert.deepEqual(calls, [
    { op: 'user.delete', id: 11, actorId: 4, extra: undefined },
    { op: 'user.delete', id: 12, actorId: 4, extra: undefined },
  ])
  assert.equal(result.succeeded, 2)
  assert.deepEqual(result.failed, [])
})

test('a route reports the rows the service refused without losing the rest', async () => {
  reset()
  blocked.set(12, 'Không thể xóa tài khoản hệ thống SuperAdmin.')
  const result: any = await categoriesDelete(event({ id: 4 }, { ids: [11, 12, 13] }))

  assert.equal(result.requested, 3)
  assert.equal(result.succeeded, 2)
  assert.deepEqual(result.succeededIds, [11, 13])
  assert.deepEqual(result.failed, [{ id: 12, message: 'Không thể xóa tài khoản hệ thống SuperAdmin.' }])
})

test('bulk media delete reads the storage credentials once for the whole lot', async () => {
  reset()
  const ids = [1, 2, 3, 4, 5]
  const result: any = await mediaDelete(event({ id: 9 }, { ids }))

  assert.equal(r2Reads, 1, 'reading settings per file would add one query per row')
  assert.equal(result.succeeded, ids.length)
  // Every row got the same config object rather than one fetched per row.
  const configs = new Set(calls.map(call => call.extra))
  assert.equal(configs.size, 1)
})

test('bulk article status passes the requested status through and rejects unknown ones', async () => {
  reset()
  const result: any = await articlesStatus(event({ id: 3 }, { ids: [5, 6], status: 'archived' }))
  assert.deepEqual(result.succeededIds, [5, 6])
  assert.deepEqual(calls.map(call => call.extra), ['archived', 'archived'])

  for (const status of ['deleted', '', undefined, 'PUBLISHED']) {
    await assert.rejects(
      () => articlesStatus(event({ id: 3 }, { ids: [5], status })),
      (error: any) => error?.statusCode === 400,
      `status "${status}" must be refused`,
    )
  }
})

test('bulk delete still runs for articles and submissions', async () => {
  reset()
  const articles: any = await articlesDelete(event({ id: 1 }, { ids: [2] }))
  const submissions: any = await submissionsDelete(event({ id: 1 }, { ids: [3] }))
  assert.equal(articles.succeeded, 1)
  assert.equal(submissions.succeeded, 1)
  assert.deepEqual(calls.map(call => call.op), ['article.delete', 'submission.delete'])
})

test('bulk user activation carries the requested flag', async () => {
  reset()
  const locked: any = await usersActive(event({ id: 1 }, { ids: [8], isActive: false }))
  const unlocked: any = await usersActive(event({ id: 1 }, { ids: [9], isActive: true }))
  assert.equal(locked.succeeded, 1)
  assert.equal(unlocked.succeeded, 1)
  assert.deepEqual(calls.map(call => call.extra), [false, true])
})

// ─── Knowledge: permission depends on the target status ──────────────────────

test('bulk knowledge status requires the grant matching the target, and does no work without it', async () => {
  reset()
  const archiver = { id: 5, permissions: [knowledgePermission({ canArchive: true })] }

  // Archiving is granted.
  const archived: any = await knowledgeStatus(event(archiver, { ids: [1, 2], status: 'archived' }))
  assert.equal(archived.succeeded, 2)
  assert.deepEqual(calls.map(call => call.extra), ['archived', 'archived'])

  // Publishing is a different grant, and must fail before touching any row.
  reset()
  await assert.rejects(
    () => knowledgeStatus(event(archiver, { ids: [1, 2], status: 'published' })),
    (error: any) => error?.statusCode === 403,
  )
  assert.deepEqual(calls, [], 'a refused request must not have transitioned anything')
})

test('bulk knowledge delete requires the delete grant', async () => {
  reset()
  const reader = { id: 6, permissions: [knowledgePermission({ canRead: true })] }
  await assert.rejects(
    () => knowledgeDelete(event(reader, { ids: [1] })),
    (error: any) => error?.statusCode === 403,
  )
  assert.deepEqual(calls, [])

  const remover = { id: 7, permissions: [knowledgePermission({ canDelete: true })] }
  const result: any = await knowledgeDelete(event(remover, { ids: [1, 2] }))
  assert.equal(result.succeeded, 2)
})

test('bulk quick-question needs the update grant and refuses a non-boolean target', async () => {
  reset()
  // The flag decides what the widget shows, so it rides on `update` — not on
  // publish/archive. A reader must not be able to change the strip.
  const reader = { id: 6, permissions: [knowledgePermission({ canRead: true })] }
  await assert.rejects(
    () => knowledgeQuick(event(reader, { ids: [1], isQuickQuestion: true })),
    (error: any) => error?.statusCode === 403,
  )
  assert.deepEqual(calls, [])

  const editor = { id: 8, permissions: [knowledgePermission({ canUpdate: true })] }
  for (const value of ['true', 1, null, undefined]) {
    reset()
    await assert.rejects(
      () => knowledgeQuick(event(editor, { ids: [1], isQuickQuestion: value })),
      (error: any) => error?.statusCode === 400,
      `isQuickQuestion "${String(value)}" must be refused rather than coerced`,
    )
    assert.deepEqual(calls, [])
  }
})

test('bulk quick-question sets both directions and reports blocked rows per row', async () => {
  reset()
  const editor = { id: 8, permissions: [knowledgePermission({ canUpdate: true })] }

  const added: any = await knowledgeQuick(event(editor, { ids: [1, 2], isQuickQuestion: true }))
  assert.equal(added.succeeded, 2)
  assert.deepEqual(calls.map(call => call.extra), ['true', 'true'])

  reset()
  const removed: any = await knowledgeQuick(event(editor, { ids: [3], isQuickQuestion: false }))
  assert.equal(removed.succeeded, 1)
  assert.deepEqual(calls.map(call => call.extra), ['false'])

  // 999 breaks a lifecycle rule, 404 does not exist: both are per-row failures
  // and neither cancels the rows around them.
  reset()
  const mixed: any = await knowledgeQuick(event(editor, { ids: [1, 999, 404, 2], isQuickQuestion: true }))
  assert.equal(mixed.succeeded, 2)
  assert.deepEqual(mixed.succeededIds, [1, 2])
  assert.deepEqual(mixed.failed, [
    { id: 999, message: 'Cần nguồn tham khảo trước khi xuất bản.' },
    { id: 404, message: 'Mục kiến thức không tồn tại.' },
  ])
})

test('bulk knowledge status rejects a target outside the lifecycle', async () => {
  reset()
  const superAdmin = { id: 1, isSuperAdmin: true, permissions: [] }
  for (const status of ['draft', 'deleted', '', undefined]) {
    await assert.rejects(
      () => knowledgeStatus(event(superAdmin, { ids: [1], status })),
      (error: any) => error?.statusCode === 400,
      `status "${status}" must be refused`,
    )
  }
  assert.deepEqual(calls, [])
})

test('a lifecycle rule is reported as a per-row 400, not a failed request', async () => {
  reset()
  const superAdmin = { id: 1, isSuperAdmin: true, permissions: [] }
  const result: any = await knowledgeStatus(event(superAdmin, { ids: [1, 999, 2], status: 'published' }))

  assert.equal(result.succeeded, 2)
  assert.deepEqual(result.failed, [{ id: 999, message: 'Cần nguồn tham khảo trước khi xuất bản.' }])
})

test('every bulk route validates its ids before doing any work', async () => {
  const superAdmin = { id: 1, isSuperAdmin: true, permissions: [] }
  const routes: Array<[string, (e: any) => unknown, Record<string, unknown>]> = [
    ['users/bulk-delete', usersDelete, {}],
    ['users/bulk-active', usersActive, { isActive: false }],
    ['media/bulk-delete', mediaDelete, {}],
    ['articles/bulk-delete', articlesDelete, {}],
    ['articles/bulk-status', articlesStatus, { status: 'archived' }],
    ['categories/bulk-delete', categoriesDelete, {}],
    ['submissions/bulk-delete', submissionsDelete, {}],
    ['knowledge/bulk-delete', knowledgeDelete, {}],
    ['knowledge/bulk-status', knowledgeStatus, { status: 'archived' }],
    ['knowledge/bulk-quick-question', knowledgeQuick, { isQuickQuestion: true }],
  ]

  for (const [name, handler, extra] of routes) {
    reset()
    await assert.rejects(
      () => Promise.resolve(handler(event(superAdmin, { ...extra, ids: [] }))),
      (error: any) => error?.statusCode === 400,
      `${name} must reject an empty selection`,
    )
    assert.deepEqual(calls, [], `${name} must not act on an invalid request`)
  }
})
