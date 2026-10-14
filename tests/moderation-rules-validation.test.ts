/**
 * Endpoint tạo/sửa luật kiểm duyệt từ chối mẫu nguy hiểm NGAY LÚC LƯU: quá dài,
 * regex hỏng (với đúng cờ `iu` lúc chạy) và hình dạng lùi vô hạn — mẫu của cán bộ
 * chạy trên mọi tin nhắn công khai. Chạy handler thật với DB giả.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

type Row = Record<string, unknown>
const state = { existing: null as Row | null, inserted: [] as Row[], updated: [] as Row[] }

const tx = {
  insert: () => ({ values: async (v: Row) => { state.inserted.push(v); return [{ insertId: 11 }] } }),
  update: () => ({ set: (v: Row) => ({ where: async () => { state.updated.push(v) } }) }),
}
const fakeDb = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.existing ? [state.existing] : []) }) }) }),
  transaction: async <T>(cb: (t: typeof tx) => Promise<T>) => cb(tx),
}
// `getPool: null` — the import graph reaches moderation-instant.ts → rate-limit-deps.ts
// (review-queue cap), which imports getPool; these tests never opt in to the cap.
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })

Object.assign(globalThis, {
  defineEventHandler: (h: unknown) => h,
  readBody: async (event: { body: unknown }) => event.body,
  getRouterParam: (event: { params: Record<string, string> }, name: string) => event.params[name],
})

type Handler = (event: unknown) => Promise<Row>
const create = (await import('../server/api/admin/ai/moderation/rules.post.ts')).default as unknown as Handler
const update = (await import('../server/api/admin/ai/moderation/rules/[id].put.ts')).default as unknown as Handler

const adminUser = { id: 1, isSuperAdmin: true, permissions: [] }
const createEvent = (body: Row) => ({ body, params: {}, context: { adminUser } })
const updateEvent = (id: number, body: Row) => ({ body, params: { id: String(id) }, context: { adminUser } })

function reset(existing: Row | null = null) {
  state.existing = existing
  state.inserted = []
  state.updated = []
}

const refuses = async (run: () => Promise<unknown>, pattern: RegExp) => {
  await assert.rejects(run, (err: unknown) => {
    const e = err as { statusCode?: number; statusMessage?: string }
    assert.equal(e.statusCode, 400)
    assert.match(String(e.statusMessage), pattern)
    return true
  })
}

test('create: catastrophic regex, invalid regex and oversized pattern are refused; nothing is written', async () => {
  reset()
  await refuses(() => create(createEvent({ pattern: '(a+)+$', ruleType: 'pattern' })), /nguy cơ treo/)
  await refuses(() => create(createEvent({ pattern: '(abc', ruleType: 'pattern' })), /không hợp lệ/)
  await refuses(() => create(createEvent({ pattern: 'x'.repeat(201), ruleType: 'keyword' })), /quá dài/)
  assert.deepEqual(state.inserted, [])
})

test('create: a safe regex and a keyword that only looks like a regex are accepted', async () => {
  reset()
  const out = await create(createEvent({ pattern: '\\b(tài|tai)\\s*xỉu\\b', ruleType: 'pattern' }))
  assert.equal(out.ok, true)
  await create(createEvent({ pattern: '(a+)+', ruleType: 'keyword' }))
  assert.equal(state.inserted.filter(r => 'pattern' in r).length, 2)
})

test('update: a new pattern is checked against the STORED rule type', async () => {
  reset({ id: 5, ruleType: 'pattern', pattern: 'abc' })
  await refuses(() => update(updateEvent(5, { pattern: '(x|xy)*' })), /nguy cơ treo/)
  assert.deepEqual(state.updated, [])

  reset({ id: 6, ruleType: 'keyword', pattern: 'abc' })
  const out = await update(updateEvent(6, { pattern: '(x|xy)*' }))
  assert.equal(out.ok, true, 'a keyword rule is a literal substring, never compiled')

  reset({ id: 7, ruleType: 'pattern', pattern: 'abc' })
  await update(updateEvent(7, { isEnabled: false }))
  assert.deepEqual(state.updated, [{ isEnabled: false }], 'toggling a rule does not re-validate an untouched pattern')
})
