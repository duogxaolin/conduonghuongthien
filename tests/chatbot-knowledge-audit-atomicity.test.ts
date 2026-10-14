/**
 * Xuất bản / lưu trữ / xoá một mục kho chatbot: thay đổi và dòng `activity_logs`
 * phải commit CÙNG NHAU.
 *
 * `createKnowledge`/`updateKnowledge` đã bọc từ trước, nên guard theo tệp trong
 * `reader-audit-atomicity.test.ts` (đòi tệp có `db.transaction(`) xanh dù
 * `transitionKnowledge`/`deleteKnowledge` vẫn ghi rời trên pool. Test này kiểm
 * theo TỪNG HÀM và bằng hành vi: một DB giả mà mọi lệnh GHI ở mức pool đều ném,
 * còn handle `tx` thì ghi lại — và chỉ "commit" khi callback transaction kết thúc
 * không lỗi. Một lượt ghi còn sót trên pool làm hàm ném; một dòng audit hỏng làm
 * transaction lùi và không để lại thay đổi nào.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { activityLogs, chatbotKnowledge, chatbotKnowledgeTerms } from '../server/db/schema.ts'

type Row = Record<string, unknown>
type Write = { op: 'insert' | 'update' | 'delete'; table: unknown; values?: Row }

const state = {
  entry: null as Row | null,
  committed: [] as Write[],
  failAuditInsert: false,
}

const baseEntry = (): Row => ({
  id: 7,
  canonicalQuestion: 'Thủ tục xin xác nhận?',
  approvedAnswer: 'Liên hệ Công an xã nơi cư trú.',
  topic: 'general',
  sourceLabel: 'Luật Thi hành án hình sự',
  sourceUrl: null,
  sourceReference: null,
  internalNotes: null,
  status: 'draft',
  priority: 0,
  isQuickQuestion: false,
  publishedAt: null,
  archivedAt: null,
})

/** A thenable query result that also answers `.limit()`, like Drizzle's builder. */
function rows(result: Row[]) {
  const promise = Promise.resolve(result)
  return Object.assign(promise, { limit: async () => result.slice(0, 1) })
}

function selectFor(table: unknown) {
  if (table === chatbotKnowledge) return state.entry ? [state.entry] : []
  if (table === chatbotKnowledgeTerms) return [{ kind: 'alias', value: 'xác nhận' }]
  return []
}

const reader = {
  select: () => ({ from: (table: unknown) => ({ where: () => rows(selectFor(table)) }) }),
}

const poolWrite = (op: string) => () => {
  throw new Error(`pool-level ${op} — this write is not on the transaction handle`)
}

const fakeDb = {
  ...reader,
  insert: poolWrite('insert'),
  update: poolWrite('update'),
  delete: poolWrite('delete'),
  async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    const pending: Write[] = []
    const tx = {
      ...reader,
      insert: (table: unknown) => ({
        values: async (values: Row) => {
          if (table === activityLogs && state.failAuditInsert) throw new Error('FK violation on activity_logs.user_id')
          pending.push({ op: 'insert', table, values })
        },
      }),
      update: (table: unknown) => ({
        set: (values: Row) => ({ where: async () => { pending.push({ op: 'update', table, values }) } }),
      }),
      delete: (table: unknown) => ({ where: async () => { pending.push({ op: 'delete', table }) } }),
    }
    // Rollback = the pending writes are simply dropped when the callback throws.
    const result = await callback(tx)
    state.committed.push(...pending)
    return result
  },
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb } })

const { transitionKnowledge, deleteKnowledge } = await import('../server/services/chatbot-knowledge.ts')

function reset(entry: Row | null = baseEntry()) {
  state.entry = entry
  state.committed = []
  state.failAuditInsert = false
}

const auditRows = () => state.committed.filter(w => w.table === activityLogs)

for (const target of ['published', 'archived'] as const) {
  const operation = target === 'published' ? 'publish' : 'archive'

  test(`transitionKnowledge(${target}): status change and audit row commit on the same transaction`, async () => {
    reset()
    const item = await transitionKnowledge(5, 7, target)
    assert.ok(item, 'an existing entry must be returned')
    assert.deepEqual(state.committed.map(w => [w.op, w.table === chatbotKnowledge ? 'chatbot_knowledge' : w.table === activityLogs ? 'activity_logs' : '?']), [
      ['update', 'chatbot_knowledge'],
      ['insert', 'activity_logs'],
    ])
    assert.equal(state.committed[0]!.values!.status, target)
    const audit = auditRows()[0]!.values!
    assert.equal(audit.action, operation)
    assert.equal(audit.userId, 5)
    assert.equal(audit.resourceId, 7)
    assert.deepEqual((audit.meta as Row).fromStatus, 'draft')
    assert.deepEqual((audit.meta as Row).toStatus, target)
  })

  test(`transitionKnowledge(${target}): a failing audit insert rolls the status change back`, async () => {
    reset()
    state.failAuditInsert = true
    await assert.rejects(() => transitionKnowledge(5, 7, target), /FK violation/)
    assert.deepEqual(state.committed, [], 'the status change committed without its audit row')
  })
}

test('transitionKnowledge: publish validation still refuses before anything is written', async () => {
  reset({ ...baseEntry(), sourceLabel: null, sourceUrl: null, sourceReference: null })
  await assert.rejects(() => transitionKnowledge(5, 7, 'published'), /source metadata/)
  assert.deepEqual(state.committed, [])
})

test('transitionKnowledge: a missing entry returns null and writes nothing', async () => {
  reset(null)
  assert.equal(await transitionKnowledge(5, 7, 'archived'), null)
  assert.deepEqual(state.committed, [])
})

test('deleteKnowledge: the delete and its audit row commit on the same transaction', async () => {
  reset()
  assert.equal(await deleteKnowledge(5, 7), true)
  assert.deepEqual(state.committed.map(w => [w.op, w.table === chatbotKnowledge ? 'chatbot_knowledge' : w.table === activityLogs ? 'activity_logs' : '?']), [
    ['delete', 'chatbot_knowledge'],
    ['insert', 'activity_logs'],
  ])
  const audit = auditRows()[0]!.values!
  assert.equal(audit.action, 'delete')
  assert.equal(audit.resourceId, 7)
})

test('deleteKnowledge: a failing audit insert rolls the delete back (delete-then-log)', async () => {
  reset()
  state.failAuditInsert = true
  await assert.rejects(() => deleteKnowledge(5, 7), /FK violation/)
  assert.deepEqual(state.committed, [], 'the entry was deleted with no record of who deleted it')
})

test('deleteKnowledge: a missing entry returns false and writes nothing', async () => {
  reset(null)
  assert.equal(await deleteKnowledge(5, 7), false)
  assert.deepEqual(state.committed, [])
})
