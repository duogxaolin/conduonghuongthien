import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { aiModerationQueue, aiModerationRules, articleComments } from '../server/db/schema.ts'

/**
 * Every non-empty piece of user content goes through the AI scan — there is no length floor
 * (the old gate was `matchedKeywords.length > 0 || content.length >= 5`, which let 1-4 character
 * slang slip past the model) — and the instant layer (`fastPreModerate`) still runs FIRST and
 * spares the model when it blocks.
 *
 * `moderation-always-scan.test.ts` pinned this with regexes over the worker's source (no
 * `content.length >= 5`, `if (content.length > 0)` present, `fastPreModerate` exported). Here the
 * real `checkAndModerateContent` runs against a fake database and a fake AI gateway that records
 * whether, and with what, it was called.
 */

type Row = Record<string, unknown>
const dialect = new MySqlDialect()
const rec = {
  rules: [] as Row[],
  queue: [] as Row[],
  updates: [] as Array<{ table: unknown, set: Row }>,
  ai: { ok: true, text: '{"verdict":"safe"}' } as Row,
  aiPrompts: [] as string[],
  order: [] as string[],
}

const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => Object.assign(Promise.resolve(table === aiModerationRules ? rec.rules : []), { orderBy: () => ({ limit: async () => [] }) }),
    }),
  }),
  insert: (table: unknown) => ({ values: async (values: Row) => { if (table === aiModerationQueue) { rec.order.push('queue'); rec.queue.push(values) } } }),
  // The review-queue row of an item that HAS an id: `INSERT … SELECT … WHERE NOT EXISTS (pending row of the same item)`.
  execute: async (query: Parameters<MySqlDialect['sqlToQuery']>[0]) => {
    const { sql, params } = dialect.sqlToQuery(query)
    const columns = /^insert into `ai_moderation_queue` \(([^)]+)\)/i.exec(sql)
    if (!columns) throw new Error(`unexpected execute: ${sql}`)
    const names = columns[1]!.split(',').map(column => column.trim().replace(/`/g, '').replace(/_(\w)/g, (_m, ch: string) => ch.toUpperCase()))
    rec.order.push('queue')
    rec.queue.push(Object.fromEntries(names.map((name, index) => [name, params[index]])))
    return [{ affectedRows: 1 }, undefined]
  },
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { rec.order.push('hide'); rec.updates.push({ table, set }) } }) }),
}
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), {
  namedExports: {
    callAi: async (_service: string, input: { prompt: string }) => { rec.order.push('ai'); rec.aiPrompts.push(input.prompt); return rec.ai },
  },
})

const worker = await import('../server/services/moderation-worker.ts')
const violation = { ok: true, text: '{"verdict":"violation","intent":"spam","riskLevel":"high","reason":"quảng cáo ngắn"}' }

function reset() {
  rec.rules = []; rec.queue = []; rec.updates = []; rec.aiPrompts = []; rec.order = []
  rec.ai = { ok: true, text: '{"verdict":"safe"}' }
  worker.invalidateModerationRulesCache()
}

test('content of 1 to 4 characters that matches no rule is still sent to the AI', async () => {
  for (const content of ['a', 'ok', 'ls', 'wow', 'xin!']) {
    reset()
    const verdict = await worker.checkAndModerateContent({ content, targetType: 'comment', targetId: 5 })
    assert.equal(rec.aiPrompts.length, 1, `${JSON.stringify(content)} reached the model`)
    assert.ok(rec.aiPrompts[0]!.includes(content), 'and the model saw that content')
    assert.equal(verdict.flagged, false)
    assert.deepEqual(rec.updates, [])
  }
})

test('and the model\'s verdict applies to that short content: a violation is hidden and queued', async () => {
  for (const content of ['hi', 'abc', 'xyz9']) {
    reset()
    rec.ai = violation
    const verdict = await worker.checkAndModerateContent({ content, targetType: 'comment', targetId: 5 })
    assert.equal(verdict.flagged, true, JSON.stringify(content))
    assert.equal(verdict.action, 'auto_hide')
    assert.equal(rec.updates.length, 1)
    assert.equal(rec.updates[0]!.table, articleComments)
    assert.equal(rec.updates[0]!.set.isHidden, true)
    assert.equal(rec.queue.length, 1)
  }
})

test('longer content, and short content next to rules that do not match it, are scanned as before', async () => {
  reset()
  await worker.checkAndModerateContent({ content: 'một câu bình thường dài hơn năm ký tự', targetType: 'comment' })
  assert.equal(rec.aiPrompts.length, 1)

  reset()
  rec.rules = [{ id: 1, pattern: 'qc', ruleType: 'keyword', category: 'spam', severity: 'low', action: 'flag_only', isEnabled: true }]
  await worker.checkAndModerateContent({ content: 'ok', targetType: 'comment' })
  assert.equal(rec.aiPrompts.length, 1, 'a rule set that matches nothing is not a reason to skip the model')
})

test('nothing is sent to the AI for empty or whitespace-only content', async () => {
  for (const content of ['', '   ', '\n\t ']) {
    reset()
    const verdict = await worker.checkAndModerateContent({ content, targetType: 'comment', targetId: 5 })
    assert.equal(rec.aiPrompts.length, 0)
    assert.deepEqual(verdict, { flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] })
  }
})

test('the instant layer still runs first: a built-in rule blocks short slang without the AI being asked', async () => {
  for (const content of ['djt', 'dcm']) {
    reset()
    rec.ai = { ok: true, text: '{"verdict":"safe"}' } // were the model asked, it would let this through
    const verdict = await worker.checkAndModerateContent({ content, targetType: 'comment', targetId: 5 })
    assert.equal(verdict.flagged, true, JSON.stringify(content))
    assert.equal(verdict.action, 'auto_hide')
    assert.equal(rec.aiPrompts.length, 0, 'a blocked item does not cost a model call')
    assert.equal(rec.updates[0]!.set.isHidden, true)
    assert.ok(!rec.order.includes('ai'))
  }
})

test('a custom instant rule from the database blocks before the AI as well; a harmless short comment is allowed by the instant layer', async () => {
  reset()
  rec.rules = [{ id: 2, pattern: 'cam-tu', ruleType: 'keyword', category: 'custom', severity: 'critical', action: 'auto_hide', isEnabled: true }]
  const blocked = await worker.checkAndModerateContent({ content: 'cam-tu', targetType: 'comment', targetId: 6 })
  assert.equal(blocked.flagged, true)
  assert.equal(rec.aiPrompts.length, 0)

  reset()
  const instant = await worker.fastPreModerate('ok', { targetType: 'comment' })
  assert.deepEqual([instant.blocked, instant.action], [false, 'allow'])
  assert.equal(rec.aiPrompts.length, 0, 'the instant layer never calls the model itself')
})
