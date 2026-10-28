import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * The AI model price list — `server/api/admin/ai/pricing/**`: list, create,
 * update, delete one, delete many. `ai_model_pricing` turns the tokens every AI
 * call reports into the VND that `ai_usage_logs` records and `checkBudget` sums,
 * so these rows are money.
 *
 * The invariants:
 *   - reading takes `ai.read`; every write takes `ai.update` — `ai.read` with
 *     create/delete changes nothing;
 *   - a price is a finite, non-negative number the column can hold (DECIMAL(8,4):
 *     at most 9 999.9999 USD per million tokens) — anything else on create is a
 *     400 before the database (FINDING-R4-6); on update, junk is ignored, never
 *     coerced; a model name is unique;
 *   - each write and its audit line commit together (if the audit fails, the price
 *     list is what it was), and the audit `meta` is an object;
 *   - a model is addressed by its own name, whatever characters it has: the admin
 *     page sends `encodeURIComponent(model)`, so `org/flash` arrives as
 *     `org%2Fflash` (FINDING-R4-4);
 *   - clearing a label clears it — the edit form sends `label: null`
 *     (FINDING-R4-7);
 *   - a bulk delete reports and audits what it deleted, not what was asked
 *     (FINDING-R4-5).
 *
 * Real h3 app with the real `admin-auth` middleware; Drizzle's SQL on SQLite
 * (`_sqlite-mysql-db.ts`, real transaction).
 */

process.env.JWT_SECRET = 'ai-pricing-config-behavior-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { roles, permissions, users, settings, userMfaFactors, activityLogs, aiModelPricing } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([roles, permissions, users, settings, userMfaFactors, activityLogs, aiModelPricing])

mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const adminAuth = (await import('../server/middleware/admin-auth')).default
const listPricing = (await import('../server/api/admin/ai/pricing/index.get')).default
const createPricing = (await import('../server/api/admin/ai/pricing/index.post')).default
const updatePricing = (await import('../server/api/admin/ai/pricing/[model].put')).default
const deletePricing = (await import('../server/api/admin/ai/pricing/[model].delete')).default
const bulkDeletePricing = (await import('../server/api/admin/ai/pricing/bulk-delete.post')).default
const { signToken } = await import('../server/utils/auth')
const policy = await import('../server/utils/mfa/policy')

const server = await startHandlerServer([
  { method: 'get', path: '/api/admin/ai/pricing', handler: listPricing },
  { method: 'post', path: '/api/admin/ai/pricing', handler: createPricing },
  { method: 'post', path: '/api/admin/ai/pricing/bulk-delete', handler: bulkDeletePricing },
  { method: 'put', path: '/api/admin/ai/pricing/:model', handler: updatePricing },
  { method: 'delete', path: '/api/admin/ai/pricing/:model', handler: deletePricing },
], [adminAuth])
after(() => server.close())

type Account = { id: number, username: string, roleId: number, roleName: string }
const AI_ADMIN: Account = { id: 4, username: 'quanlyai', roleId: 3, roleName: 'Quản lý AI' }
const AI_READER: Account = { id: 5, username: 'xemai', roleId: 4, roleName: 'Xem AI' }
const EDITOR: Account = { id: 6, username: 'bientap', roleId: 5, roleName: 'Biên tập' }
const cookieFor = (account: Account) =>
  `cdkt_admin=${signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: 0 })}`
const send = (method: string, path: string, body?: unknown, account: Account | null = AI_ADMIN) =>
  server.request(method, path, { ...(account ? { cookie: cookieFor(account) } : {}), ...(body === undefined ? {} : { body }) })
const at = (model: string) => `/api/admin/ai/pricing/${encodeURIComponent(model)}`

const prices = () => harness.rows(aiModelPricing)
  .map(row => ({ model: row.model, provider: row.provider, label: row.label, isActive: row.isActive, prompt: Number(row.promptCostPerMillion), completion: Number(row.completionCostPerMillion) }))
  .sort((a, b) => String(a.model).localeCompare(String(b.model)))
const audit = () => harness.rows(activityLogs).map(row => ({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId, meta: row.meta }))
const snapshot = () => ({ prices: prices(), audit: audit() })

beforeEach(async () => {
  harness.reset()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
  await harness.db.insert(roles).values([AI_ADMIN, AI_READER, EDITOR].map(account => ({ id: account.roleId, name: account.roleName, isSystem: false })))
  await harness.db.insert(permissions).values([
    { roleId: AI_ADMIN.roleId, resource: 'ai', canRead: true, canUpdate: true },
    { roleId: AI_READER.roleId, resource: 'ai', canRead: true, canCreate: true, canDelete: true },
    { roleId: EDITOR.roleId, resource: 'news', canRead: true, canCreate: true, canUpdate: true, canDelete: true },
  ])
  await harness.db.insert(users).values([AI_ADMIN, AI_READER, EDITOR].map(account => ({
    id: account.id, username: account.username, email: `${account.username}@example.vn`, passwordHash: 'x', roleId: account.roleId,
  })))
  await harness.db.insert(aiModelPricing).values([
    { model: 'gpt-4o-mini', provider: 'openai', label: 'GPT-4o mini', isActive: true, promptCostPerMillion: '0.15', completionCostPerMillion: '0.6' },
    { model: 'delify-5.5', provider: 'delify', label: null, isActive: true, promptCostPerMillion: '2', completionCostPerMillion: '10' },
    { model: 'delify-old', provider: 'delify', label: null, isActive: false, promptCostPerMillion: '1', completionCostPerMillion: '5' },
  ])
})

test('reading takes ai.read; writing takes ai.update — ai.read with create/delete changes nothing', async () => {
  assert.equal((await send('GET', '/api/admin/ai/pricing', undefined, null)).status, 401)
  assert.equal((await send('GET', '/api/admin/ai/pricing', undefined, EDITOR)).status, 403)
  assert.equal((await send('GET', '/api/admin/ai/pricing', undefined, AI_READER)).status, 200)

  const before = snapshot()
  for (const account of [AI_READER, EDITOR]) {
    assert.equal((await send('POST', '/api/admin/ai/pricing', { model: 'x', provider: 'openai', promptCostPerMillion: 1, completionCostPerMillion: 1 }, account)).status, 403)
    assert.equal((await send('PUT', at('gpt-4o-mini'), { promptCostPerMillion: 0 }, account)).status, 403)
    assert.equal((await send('DELETE', at('gpt-4o-mini'), undefined, account)).status, 403)
    assert.equal((await send('POST', '/api/admin/ai/pricing/bulk-delete', { models: ['gpt-4o-mini'] }, account)).status, 403)
  }
  assert.equal((await send('PUT', at('gpt-4o-mini'), { promptCostPerMillion: 0 }, null)).status, 401)
  assert.deepEqual(snapshot(), before)
})

test('the list returns prices as numbers and filters by provider and active status', async () => {
  const all = await send('GET', '/api/admin/ai/pricing', undefined, AI_READER)
  assert.deepEqual((all.body.pricing as Array<Record<string, unknown>>).map(row => [row.model, row.promptCostPerMillion, row.completionCostPerMillion]).sort(), [
    ['delify-5.5', 2, 10], ['delify-old', 1, 5], ['gpt-4o-mini', 0.15, 0.6],
  ])
  const names = async (query: string) => ((await send('GET', `/api/admin/ai/pricing${query}`, undefined, AI_READER)).body.pricing as Array<{ model: string }>).map(row => row.model).sort()
  assert.deepEqual(await names('?provider=delify'), ['delify-5.5', 'delify-old'])
  assert.deepEqual(await names('?provider=delify&activeOnly=true'), ['delify-5.5'])
  assert.deepEqual(await names('?activeOnly=1'), ['delify-5.5', 'gpt-4o-mini'])
  assert.deepEqual(await names('?activeOnly=yes&provider=%20'), ['delify-5.5', 'delify-old', 'gpt-4o-mini'])
})

test('create: a new row and its audit line, defaults applied; the name is unique', async () => {
  const response = await send('POST', '/api/admin/ai/pricing', { model: '  gpt-4o  ', provider: ' openai ', label: '  ', promptCostPerMillion: 2.5, completionCostPerMillion: 10 })
  assert.equal(response.status, 200)
  assert.deepEqual(prices().find(row => row.model === 'gpt-4o'), { model: 'gpt-4o', provider: 'openai', label: null, isActive: true, prompt: 2.5, completion: 10 })
  assert.deepEqual(audit(), [{
    userId: AI_ADMIN.id, action: 'create', resource: 'ai', resourceId: null,
    meta: { type: 'pricing_create', model: 'gpt-4o', provider: 'openai', promptCostPerMillion: 2.5, completionCostPerMillion: 10 },
  }])

  const before = snapshot()
  assert.equal((await send('POST', '/api/admin/ai/pricing', { model: 'gpt-4o', provider: 'openai', promptCostPerMillion: 1, completionCostPerMillion: 1 })).status, 409)
  assert.deepEqual(snapshot(), before)
})

test('create: a missing name or provider, or a price that is not a non-negative number, is a 400 and writes nothing', async () => {
  const before = snapshot()
  const valid = { model: 'm1', provider: 'openai', promptCostPerMillion: 1, completionCostPerMillion: 1 }
  for (const body of [
    'not json', { ...valid, model: '' }, { ...valid, model: 7 }, { ...valid, provider: '  ' },
    { ...valid, promptCostPerMillion: '1' }, { ...valid, promptCostPerMillion: -0.01 }, { ...valid, completionCostPerMillion: null }, { ...valid, completionCostPerMillion: -1 },
  ]) {
    assert.equal((await send('POST', '/api/admin/ai/pricing', body)).status, 400, JSON.stringify(body))
  }
  assert.deepEqual(snapshot(), before)
})

test('create: the row and its audit line commit together — audit fails → 500, no row', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await send('POST', '/api/admin/ai/pricing', { model: 'm1', provider: 'openai', promptCostPerMillion: 1, completionCostPerMillion: 1, isActive: false })).status, 500)
  assert.deepEqual(snapshot(), before)
})

test('update: only valid fields change, junk is ignored (never coerced), and the change is audited', async () => {
  const before = snapshot()
  for (const body of [{}, { promptCostPerMillion: -1 }, { completionCostPerMillion: '3' }, { isActive: 'false' }, { label: 5 }]) {
    const response = await send('PUT', at('gpt-4o-mini'), body)
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(response.body.message, 'Không có thay đổi.', JSON.stringify(body))
  }
  assert.deepEqual(snapshot(), before)

  assert.equal((await send('PUT', at('gpt-4o-mini'), { label: '  Nhỏ  ', isActive: false, promptCostPerMillion: 0.2, completionCostPerMillion: -4 })).status, 200)
  assert.deepEqual(prices().find(row => row.model === 'gpt-4o-mini'), { model: 'gpt-4o-mini', provider: 'openai', label: 'Nhỏ', isActive: false, prompt: 0.2, completion: 0.6 })
  assert.deepEqual(audit(), [{
    userId: AI_ADMIN.id, action: 'update', resource: 'ai', resourceId: null,
    meta: { type: 'pricing_update', model: 'gpt-4o-mini', changedFields: ['label', 'isActive', 'promptCostPerMillion'] },
  }])
  assert.equal((await send('PUT', at('no-such-model'), { isActive: true })).status, 404)
})

test('update: the change and its audit line commit together — audit fails → 500, the price is what it was', async () => {
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await send('PUT', at('gpt-4o-mini'), { promptCostPerMillion: 99 })).status, 500)
  assert.deepEqual(snapshot(), before)
})

test('delete one: the row goes with an audit line naming it; unknown → 404; audit fails → the row stays', async () => {
  assert.equal((await send('DELETE', at('no-such-model'))).status, 404)
  const before = snapshot()
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await send('DELETE', at('delify-old'))).status, 500)
  assert.deepEqual(snapshot(), before)

  assert.equal((await send('DELETE', at('delify-old'))).status, 200)
  assert.deepEqual(prices().map(row => row.model), ['delify-5.5', 'gpt-4o-mini'])
  assert.deepEqual(audit(), [{ userId: AI_ADMIN.id, action: 'delete', resource: 'ai', resourceId: null, meta: { type: 'pricing_delete', model: 'delify-old', provider: 'delify' } }])
})

test('bulk delete: a list is required; the deletion and its audit line commit together', async () => {
  const before = snapshot()
  for (const body of [{}, { models: 'gpt-4o-mini' }, { models: [] }, { models: ['', '  ', 7, null] }]) {
    assert.equal((await send('POST', '/api/admin/ai/pricing/bulk-delete', body)).status, 400, JSON.stringify(body))
  }
  harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await send('POST', '/api/admin/ai/pricing/bulk-delete', { models: ['gpt-4o-mini', 'delify-old'] })).status, 500)
  assert.deepEqual(snapshot(), before)

  const response = await send('POST', '/api/admin/ai/pricing/bulk-delete', { models: [' gpt-4o-mini ', 'delify-old'] })
  assert.deepEqual(response.body, { ok: true, deleted: 2 })
  assert.deepEqual(prices().map(row => row.model), ['delify-5.5'])
  const [line] = audit()
  assert.deepEqual({ ...line, meta: null }, { userId: AI_ADMIN.id, action: 'delete', resource: 'ai', resourceId: null, meta: null })
  const meta = line!.meta as { type: string, count: number, models: string[] }
  assert.deepEqual({ ...meta, models: [...meta.models].sort() }, { type: 'pricing_bulk_delete', count: 2, models: ['delify-old', 'gpt-4o-mini'] })
  assert.equal(audit().length, 1)
})

/**
 * FINDING-R4-4 — severity medium. The two `/:model` routes read the route
 * parameter raw. h3 decodes the path before routing but keeps an encoded slash
 * (`%2F`) encoded so it cannot split a segment; the decode is the handler's to do
 * (`getRouterParam(event, 'model', { decode: true })`). The admin page sends
 * `encodeURIComponent(model)` (pinned in `admin-fetch-rollout`, model `org/flash`),
 * so a model whose name has a `/` — the vendor/model form routers use — or a `%`
 * was looked up as `org%2Fflash` and answered 404: it could be created and listed
 * but never edited, switched off or deleted one by one.
 */
test('FINDING-R4-4: a model whose name has a slash or a percent sign can be edited and deleted by its own name', async () => {
  for (const model of ['org/flash', 'vendor/model:free', '50%off']) {
    assert.equal((await send('POST', '/api/admin/ai/pricing', { model, provider: 'delify', promptCostPerMillion: 1, completionCostPerMillion: 4 })).status, 200, model)
    const updated = await send('PUT', at(model), { isActive: false })
    assert.equal(updated.status, 200, `PUT ${model}`)
    assert.equal(prices().find(row => row.model === model)?.isActive, false, model)
    assert.equal((await send('DELETE', at(model))).status, 200, `DELETE ${model}`)
    assert.equal(prices().find(row => row.model === model), undefined, model)
  }
  // The decoded name is the whole name: `org%2Fflash` does not reach `org`.
  await send('POST', '/api/admin/ai/pricing', { model: 'org', provider: 'delify', promptCostPerMillion: 1, completionCostPerMillion: 1 })
  assert.equal((await send('DELETE', at('org/flash'))).status, 404)
  assert.ok(prices().some(row => row.model === 'org'))
})

/**
 * FINDING-R4-5 — severity low. Bulk delete answered `deleted: <number of names
 * sent>` and audited the names sent: duplicates and names that were never in the
 * list counted as deleted, and the audit trail named deletions that did not
 * happen. CLAUDE.md: a count shown to a user is measured, not claimed.
 */
test('FINDING-R4-5: bulk delete reports and audits what it deleted, not what was asked', async () => {
  const response = await send('POST', '/api/admin/ai/pricing/bulk-delete', { models: ['delify-old', 'delify-old', 'never-existed'] })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { ok: true, deleted: 1 })
  assert.deepEqual(audit(), [{ userId: AI_ADMIN.id, action: 'delete', resource: 'ai', resourceId: null, meta: { type: 'pricing_bulk_delete', count: 1, models: ['delify-old'] } }])

  // Nothing matched: nothing deleted, nothing audited.
  const none = await send('POST', '/api/admin/ai/pricing/bulk-delete', { models: ['never-existed'] })
  assert.deepEqual(none.body, { ok: true, deleted: 0 })
  assert.equal(audit().length, 1)
})

/**
 * FINDING-R4-11 — severity low (found by the independent check of this slice). Bulk
 * delete cut every name to 64 characters. The column is VARCHAR(64), so a longer name
 * names no row — but cut, it named the model whose name is exactly its first 64
 * characters, and deleted it. A name too long for the column is now a 400.
 */
test('FINDING-R4-11: a name longer than the column is refused, not cut into the name of another model', async () => {
  const exact = 'x'.repeat(64)
  await harness.db.insert(aiModelPricing).values({ model: exact, provider: 'delify', isActive: true, promptCostPerMillion: '1', completionCostPerMillion: '1' })
  const before = snapshot()
  const response = await send('POST', '/api/admin/ai/pricing/bulk-delete', { models: [`${exact}-variant`, 'delify-old'] })
  assert.equal(response.status, 400)
  assert.deepEqual(snapshot(), before, 'nothing deleted, nothing audited — not even the valid name beside it')
})

/**
 * FINDING-R4-6 — severity low. The cost columns are DECIMAL(8,4). A price above
 * 9 999.9999 passed the handler's check (finite, non-negative) and reached MySQL,
 * which under strict sql_mode refuses it (ERROR 1264 "Out of range value", shown
 * on the dev container's MySQL 8.0.46): the officer saw a 500, not a message.
 * SQLite stores it, so this test pins the 400 the handler now answers before the
 * database is touched.
 */
test('FINDING-R4-6: a price the column cannot hold is a 400 before the database, on create and on update', async () => {
  const before = snapshot()
  for (const body of [{ promptCostPerMillion: 10_000, completionCostPerMillion: 1 }, { promptCostPerMillion: 1, completionCostPerMillion: 9999.99995 }]) {
    assert.equal((await send('POST', '/api/admin/ai/pricing', { model: 'm1', provider: 'openai', ...body })).status, 400, JSON.stringify(body))
    assert.equal((await send('PUT', at('gpt-4o-mini'), body)).status, 400, JSON.stringify(body))
  }
  assert.deepEqual(snapshot(), before)

  assert.equal((await send('POST', '/api/admin/ai/pricing', { model: 'm1', provider: 'openai', promptCostPerMillion: 9999.9999, completionCostPerMillion: 0 })).status, 200)
  assert.equal((await send('PUT', at('gpt-4o-mini'), { completionCostPerMillion: 9999.9999 })).status, 200)
})

/**
 * FINDING-R4-7 — severity low. The edit form sends `label: null` when the label
 * box is emptied (`AiProvidersTab.vue` `saveEditModel`); the handler only took a
 * string, so the label stayed while the page said "saved".
 */
test('FINDING-R4-7: clearing a label clears it', async () => {
  const response = await send('PUT', at('gpt-4o-mini'), { label: null, isActive: true })
  assert.equal(response.status, 200)
  assert.equal(prices().find(row => row.model === 'gpt-4o-mini')?.label, null)
  assert.deepEqual(audit()[0]!.meta, { type: 'pricing_update', model: 'gpt-4o-mini', changedFields: ['label', 'isActive'] })
})
