/**
 * The quick-question strip is what a visitor sees before typing anything, so the
 * two ways an operator controls it are worth pinning down:
 *
 *   FILTERING. `listKnowledge` takes a tri-state `quick` filter. Absent means
 *   "either" — the default listing must keep returning every row, because a
 *   filter that quietly hides rows is worse than no filter.
 *
 *   VALIDATION. An unrecognised value is refused rather than coerced. `quick=1`
 *   silently read as "yes" would show an operator a filtered list while the
 *   control still said "Tất cả".
 *
 * The database is faked here: this file is about which conditions get built, not
 * about SQL. The UI half asserts the page actually wires the filter and the
 * per-row toggle, since a working endpoint nobody can reach is not a feature.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { mock } from 'node:test'
import { parse } from '@vue/compiler-sfc'

// ─── Fakes (must be installed before the service import) ─────────────────────

/** Conditions collected by the fake `where()` for the row query. */
let captured: unknown[] = []

const COLUMNS = {
  id: 'col:id',
  canonicalQuestion: 'col:canonicalQuestion',
  approvedAnswer: 'col:approvedAnswer',
  topic: 'col:topic',
  status: 'col:status',
  isQuickQuestion: 'col:isQuickQuestion',
  priority: 'col:priority',
  updatedAt: 'col:updatedAt',
  normalizedQuestion: 'col:normalizedQuestion',
}

mock.module('drizzle-orm', {
  namedExports: {
    and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
    or: (...parts: unknown[]) => ({ op: 'or', parts: parts.filter(Boolean) }),
    eq: (column: unknown, value: unknown) => ({ op: 'eq', column, value }),
    like: (column: unknown, value: unknown) => ({ op: 'like', column, value }),
    inArray: (column: unknown, values: unknown) => ({ op: 'inArray', column, values }),
    asc: (column: unknown) => ({ op: 'asc', column }),
    desc: (column: unknown) => ({ op: 'desc', column }),
    count: () => ({ op: 'count' }),
    sql: Object.assign(() => ({ op: 'sql' }), { raw: () => ({ op: 'sql.raw' }) }),
  },
})

mock.module(new URL('../server/db/schema.ts', import.meta.url), {
  namedExports: {
    chatbotKnowledge: COLUMNS,
    chatbotKnowledgeTerms: { knowledgeId: 'col:terms.knowledgeId', value: 'col:terms.value', kind: 'col:terms.kind' },
    activityLogs: {},
  },
})

/**
 * One chainable stub standing in for both queries `listKnowledge` runs. The row
 * query ends at `.offset()`, the total ends at `.where()`, and the terms lookup
 * ends at `.where()` too — so `where()` has to be awaitable as well as chainable.
 */
function fakeDb() {
  const rows: any[] = [{ id: 1, ...COLUMNS, status: 'published', isQuickQuestion: true }]
  let table = ''

  const builder: any = {
    from(source: unknown) { table = source === COLUMNS ? 'knowledge' : 'terms'; return builder },
    where(condition: unknown) {
      if (table === 'knowledge') captured.push(condition)
      // Awaited directly by the count query and the terms lookup.
      return Object.assign(Object.create(builder), {
        then: (resolve: (value: unknown) => unknown) =>
          resolve(table === 'knowledge' ? [{ total: rows.length }] : []),
      })
    },
    orderBy() { return builder },
    limit() { return builder },
    offset() { return Promise.resolve(rows) },
  }

  return { select: () => builder, insert: () => builder, update: () => builder, delete: () => builder }
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: { getDb: () => fakeDb() },
})

const { listKnowledge, ChatbotKnowledgeValidationError, QUICK_QUESTION_FILTERS } =
  await import('../server/services/chatbot-knowledge')

/** The `eq` conditions the row query was given, flattened out of `and(...)`. */
function equalityConditions(): Array<{ column: unknown; value: unknown }> {
  const [condition] = captured as any[]
  if (!condition) return []
  const parts = condition.op === 'and' ? condition.parts : [condition]
  return parts
    .filter((part: any) => part?.op === 'eq')
    .map((part: any) => ({ column: part.column, value: part.value }))
}

function reset() { captured = [] }

// ─── Service ─────────────────────────────────────────────────────────────────

test('the quick-question filter is tri-state and absent means every row', async () => {
  for (const quick of [undefined, '']) {
    reset()
    await listKnowledge({ quick })
    assert.deepEqual(
      equalityConditions(),
      [],
      `quick=${JSON.stringify(quick)} must not narrow the listing`,
    )
  }
})

test('quick=yes and quick=no each add exactly one boolean condition', async () => {
  reset()
  await listKnowledge({ quick: 'yes' })
  assert.deepEqual(equalityConditions(), [{ column: COLUMNS.isQuickQuestion, value: true }])

  reset()
  await listKnowledge({ quick: 'no' })
  assert.deepEqual(equalityConditions(), [{ column: COLUMNS.isQuickQuestion, value: false }])
})

test('an unrecognised quick value is refused rather than coerced', async () => {
  for (const quick of ['1', 'true', 'YES', 'all', 'null']) {
    reset()
    await assert.rejects(
      () => listKnowledge({ quick }),
      ChatbotKnowledgeValidationError,
      `quick=${quick} must be refused`,
    )
    assert.deepEqual(captured, [], 'a refused filter must not reach the database')
  }
})

test('the quick filter combines with status instead of replacing it', async () => {
  reset()
  await listKnowledge({ status: 'published', quick: 'yes' })
  assert.deepEqual(equalityConditions(), [
    { column: COLUMNS.status, value: 'published' },
    { column: COLUMNS.isQuickQuestion, value: true },
  ])
})

test('the accepted filter values are the ones the admin page offers', () => {
  assert.deepEqual([...QUICK_QUESTION_FILTERS], ['yes', 'no'])
})

// ─── Admin page wiring ───────────────────────────────────────────────────────

const knowledgePage = await readFile(
  new URL('../app/pages/admin/chatbot/knowledge/index.vue', import.meta.url),
  'utf8',
)
const knowledgeSfc = parse(knowledgePage, { filename: 'knowledge/index.vue' })
const knowledgeScript = knowledgeSfc.descriptor.scriptSetup?.content ?? ''
const knowledgeTemplate = knowledgeSfc.descriptor.template?.content ?? ''

test('the knowledge list sends the quick filter and reloads when it changes', () => {
  assert.equal(knowledgeSfc.errors.length, 0)
  assert.match(knowledgeScript, /quick: quick\.value/, 'the filter must reach the API call')
  assert.match(knowledgeScript, /watch\(\[topic, status, quick\]/, 'changing the filter must reload page 1')
  // Otherwise a filtered-empty result reads as "there is no knowledge at all".
  assert.match(knowledgeTemplate, /search \|\| topic \|\| status \|\| quick/)
})

test('the quick filter offers exactly all/yes/no', () => {
  const select = knowledgeTemplate.match(/<select v-model="quick"[\s\S]*?<\/select>/)
  assert.ok(select, 'the page must render a select bound to `quick`')
  const values = [...select![0].matchAll(/<option value="([^"]*)"/g)].map(match => match[1])
  assert.deepEqual(values, ['', 'yes', 'no'])
})

test('a row can be flipped in place and the bulk bar can flip a whole selection', () => {
  // The per-row control writes through the ordinary update route, so it inherits
  // the lifecycle rules instead of getting a bypass of its own.
  assert.match(knowledgeScript, /toggleQuickQuestion/)
  assert.match(knowledgeScript, /method: 'PUT', body: \{ isQuickQuestion: target \}/)
  assert.match(knowledgeTemplate, /@change="toggleQuickQuestion\(item\)"/)

  assert.match(knowledgeScript, /'\/api\/admin\/chatbot\/knowledge\/bulk-quick-question'/)
  assert.match(knowledgeScript, /bulkQuickQuestion\(true\)|bulkQuickQuestion\(target: boolean\)/)
  assert.match(knowledgeTemplate, /bulkQuickQuestion\(true\)/)
  assert.match(knowledgeTemplate, /bulkQuickQuestion\(false\)/)
})

test('a failed row toggle puts the old value back instead of leaving a lie on screen', () => {
  // Optimistic UI without a rollback is how a checkbox ends up disagreeing with
  // the database until the next reload.
  assert.match(knowledgeScript, /item\.isQuickQuestion = !target/)
  assert.match(knowledgeScript, /toast\.error\(/)
})
