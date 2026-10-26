import assert from 'node:assert/strict'
import test, { after, before, beforeEach, mock } from 'node:test'
import { getTableName } from 'drizzle-orm'
import { startH3TestServer, type H3TestServer } from './_h3-test-server'

/**
 * Every path that writes `lang_translations.value`, run as a REAL h3 handler on real
 * bytes against a fake DB that records what would be stored.
 *
 * The bug (found in the Wave 3 7.1 `adminFetch` rollout): the translations tab sent
 * `value: null` for an untouched empty row, and `PUT /api/admin/languages/:code/
 * translations` stored `String(i.value)` — the TEXT "null", which the public site
 * printed (`t()` falls back only on an empty value). The same coercion sat in the AI
 * paths: the chunk endpoint stored `String(p.value)` for any truthy model value
 * (`{…}` → "[object Object]"), the bulk endpoint stored whatever the model sent, and
 * the single-key endpoint stored the model's text even when that text was "null".
 *
 * Decision pinned here: a `null` value in the PUT means "clear", stored as SQL NULL —
 * the state "Đồng bộ key" / a new language give a row, which every reader (public
 * `t()`, the coverage stats, the batch scan) already treats as untranslated. Anything
 * that is not a string or null is a 400 before any write.
 */

type Write = { table: string, kind: 'insert' | 'update', values: Record<string, unknown> }
const writes: Write[] = []
/** Rows the fake DB returns for any `select … from lang_translations`. */
let selectRows: Array<Record<string, unknown>> = []
/** Whether `select … from languages` finds the language (S3: an unknown code is a 404). */
let languageKnown = true

function fakeDb() {
  const select = () => ({
    from: (table: object) => {
      const rows = () => Promise.resolve(getTableName(table as never) === 'languages' ? (languageKnown ? [{ id: 1 }] : []) : selectRows)
      const chain = {
        where: () => chain,
        orderBy: () => chain,
        limit: rows,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => rows().then(resolve, reject),
      }
      return chain
    },
  })
  const handle = {
    select,
    insert: (table: object) => ({
      values: async (values: Record<string, unknown>) => {
        writes.push({ table: getTableName(table as never), kind: 'insert', values })
        return [{ insertId: 1, affectedRows: 1 }]
      },
    }),
    update: (table: object) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          writes.push({ table: getTableName(table as never), kind: 'update', values })
          return [{ affectedRows: 1 }]
        },
      }),
    }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(handle),
  }
  return handle
}

let aiAnswer: { ok: boolean, text?: string } = { ok: true, text: '' }
const prompts: string[] = []
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb() } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })
mock.module('../server/services/ai-gateway', {
  namedExports: { callAi: async (_service: string, input: { prompt: string }) => { prompts.push(input.prompt); return aiAnswer } },
})

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.createError = h3.createError
globals.getRouterParam = h3.getRouterParam
// Nitro's auto-import of the legacy reader, so this file also runs (red) against the
// handlers that called `readBody` bare.
globals.readBody = h3.readBody

const putTranslations = (await import('../server/api/admin/languages/[code]/translations/index.put')).default
const translateChunk = (await import('../server/api/admin/languages/ai-translate-chunk.post')).default
const translateKey = (await import('../server/api/admin/languages/ai-translate-key.post')).default
const translateMissing = (await import('../server/api/admin/languages/ai-translate.post')).default

let server: H3TestServer
before(async () => {
  const admin = (handler: (event: h3.H3Event) => unknown) => h3.defineEventHandler((event) => {
    event.context.adminUser = { id: 7, isSuperAdmin: true }
    return handler(event)
  })
  server = await startH3TestServer((router) => {
    router.put('/api/admin/languages/:code/translations', admin(putTranslations))
    router.post('/api/admin/languages/ai-translate-chunk', admin(translateChunk))
    router.post('/api/admin/languages/ai-translate-key', admin(translateKey))
    router.post('/api/admin/languages/ai-translate', admin(translateMissing))
  })
})
after(() => server.close())
beforeEach(() => {
  writes.length = 0
  selectRows = []
  languageKnown = true
  aiAnswer = { ok: true, text: '' }
})

const send = (method: string, path: string, body: unknown, contentType = 'application/json') =>
  server.send(method, path, { body: typeof body === 'string' ? body : JSON.stringify(body), contentType })
const put = (body: unknown, contentType?: string) => send('PUT', '/api/admin/languages/en/translations', body, contentType)
/** What reached `lang_translations` (the audit row is checked separately). */
const stored = () => writes.filter(w => w.table === 'lang_translations').map(w => w.values)
const audits = () => writes.filter(w => w.table === 'activity_logs')

// ─── PUT /api/admin/languages/:code/translations ─────────────────────────────

test('PUT: value null clears the row — stored as SQL NULL, never the text "null" (RED before: String(null))', async () => {
  const response = await put({ items: [{ group: 'nav', key: 'news', value: null }] })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(stored(), [{ langCode: 'en', group: 'nav', key: 'news', value: null, isAiTranslated: false }])
  assert.equal(audits().length, 1)
})

test('PUT: an existing row is updated with NULL too, not "null"', async () => {
  selectRows = [{ id: 12 }]
  const response = await put({ items: [{ group: 'nav', key: 'news', value: null }] })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(stored(), [{ value: null, isAiTranslated: false }])
})

test('PUT: a value that is not a string or null is 400 and nothing is written (RED before: "5", "true", "[object Object]")', async () => {
  for (const value of [5, true, { text: 'x' }, ['x']]) {
    const response = await put({ items: [{ group: 'nav', key: 'news', value }] })
    assert.equal(response.status, 400, `${JSON.stringify(value)}: ${response.text}`)
    assert.equal(response.json().statusMessage, 'Trường "items[0].value" không hợp lệ.')
  }
  assert.deepEqual(writes, [])
})

test('PUT: an item without a value is 400 — not silently skipped with a 200 (RED before)', async () => {
  const response = await put({ items: [{ group: 'nav', key: 'news' }] })
  assert.equal(response.status, 400, response.text)
  assert.deepEqual(writes, [])
})

test('PUT: keys and groups are bounded by their columns; values by a sane maximum', async () => {
  const cases: Array<[string, unknown]> = [
    ['empty key', { group: 'nav', key: '', value: 'x' }],
    ['key over VARCHAR(200)', { group: 'nav', key: 'k'.repeat(201), value: 'x' }],
    ['group over VARCHAR(50)', { group: 'g'.repeat(51), key: 'news', value: 'x' }],
    ['value over 10 000 characters', { group: 'nav', key: 'news', value: 'v'.repeat(10_001) }],
  ]
  for (const [what, item] of cases) {
    const response = await put({ items: [item] })
    assert.equal(response.status, 400, `${what}: ${response.text}`)
  }
  assert.deepEqual(writes, [])

  const longest = await put({ items: [{ group: 'nav', key: 'k'.repeat(200), value: 'v'.repeat(10_000) }] })
  assert.equal(longest.status, 200, longest.text)
})

test('PUT: a body that is not a JSON list of items is 400 before any write', async () => {
  for (const [body, contentType] of [
    [{ items: [] }, 'application/json'],
    [{ items: 'x' }, 'application/json'],
    [{}, 'application/json'],
    ['{"items":[{"group":"nav","key":"news","value":"x"}', 'application/json'],
    ['items=x', 'application/x-www-form-urlencoded'],
  ] as const) {
    const response = await put(body, contentType)
    assert.equal(response.status, 400, `${JSON.stringify(body)} (${contentType}): ${response.text}`)
  }
  assert.deepEqual(writes, [])
})

test('PUT: text is stored as typed — an empty string stays empty, a missing group is "general"', async () => {
  const response = await put({ items: [
    { group: 'nav', key: 'home', value: 'Homepage' },
    { group: 'nav', key: 'news', value: '' },
    { key: 'title', value: 'Portal' },
  ] })
  assert.equal(response.status, 200, response.text)
  assert.equal(response.json().count, 3)
  assert.deepEqual(stored().map(v => [v.group, v.key, v.value]), [['nav', 'home', 'Homepage'], ['nav', 'news', ''], ['general', 'title', 'Portal']])
})

test('PUT: a language code that does not exist is a 404 and nothing is written — no orphan rows (RED before: 200, rows inserted)', async () => {
  languageKnown = false
  const response = await send('PUT', '/api/admin/languages/xx/translations', { items: [{ group: 'nav', key: 'news', value: 'News' }] })
  assert.equal(response.status, 404, response.text)
  assert.equal(response.json().statusMessage, 'Ngôn ngữ không tồn tại.')
  assert.deepEqual(writes, [])
})

test('the AI paths refuse an unknown language code the same way (one check, in the write service)', async () => {
  languageKnown = false
  aiAnswer = { ok: true, text: JSON.stringify([{ i: 1, key: 'news', value: 'News' }]) }
  const chunk = await send('POST', '/api/admin/languages/ai-translate-chunk', { langCode: 'xx', items: [{ group: 'nav', key: 'news' }] })
  assert.equal(chunk.status, 404, chunk.text)
  assert.deepEqual(writes, [])
})

// ─── AI write paths: only real text from the model is stored ────────────────

/** A model answer mixing real text with everything `String()` used to turn into a row. */
const MODEL_ANSWER = '```json\n' + JSON.stringify([
  { key: 'home', value: ' Accueil ' },
  { key: 'news', value: null },
  { key: 'about', value: 'null' },
  { key: 'contact', value: { text: 'Contact' } },
  { key: 'search', value: 5 },
  { key: 'menu' },
  { key: 'invented_by_model', value: 'Hallucinated' },
]) + '\n```'

test('chunk: only string values for keys that were asked for are stored (RED before: "null", "[object Object]", "5")', async () => {
  aiAnswer = { ok: true, text: MODEL_ANSWER }
  const items = ['home', 'news', 'about', 'contact', 'search', 'menu'].map(key => ({ group: 'nav', key, sourceText: key }))
  const response = await send('POST', '/api/admin/languages/ai-translate-chunk', { langCode: 'fr', langName: 'French', items })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(response.json().translated, [{ group: 'nav', key: 'home', value: 'Accueil' }])
  assert.deepEqual(stored().map(v => [v.group, v.key, v.value]), [['nav', 'home', 'Accueil']])
})

test('chunk: the same key in two groups gets both answers, each in its own group, even when the model reorders them (RED before)', async () => {
  aiAnswer = { ok: true, text: JSON.stringify([{ i: 2, key: 'retry', value: 'Try the form again' }, { i: 1, key: 'retry', value: 'Retry' }]) }
  const items = [{ group: 'nav', key: 'retry', sourceText: 'Thử lại' }, { group: 'form', key: 'retry', sourceText: 'Gửi lại biểu mẫu' }]
  const response = await send('POST', '/api/admin/languages/ai-translate-chunk', { langCode: 'fr', items })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(stored().map(v => [v.group, v.key, v.value]), [['form', 'retry', 'Try the form again'], ['nav', 'retry', 'Retry']])
  assert.match(prompts.at(-1)!, /"i"/, 'the prompt asks the model to echo the line number')
})

test('chunk: an item without a group is 400, not a row written under group "undefined" (RED before)', async () => {
  aiAnswer = { ok: true, text: JSON.stringify([{ key: 'home', value: 'Accueil' }]) }
  for (const items of [[{ key: 'home' }], [{ group: 'nav', key: { k: 1 } }], 'home']) {
    const response = await send('POST', '/api/admin/languages/ai-translate-chunk', { langCode: 'fr', items })
    assert.equal(response.status, 400, `${JSON.stringify(items)}: ${response.text}`)
  }
  assert.deepEqual(writes, [])
})

test('single key: a model that answers "null" stores nothing and the officer gets an error (RED before: stored "null")', async () => {
  for (const text of ['null', '"null"', '  ', 'undefined']) {
    aiAnswer = { ok: true, text }
    const response = await send('POST', '/api/admin/languages/ai-translate-key', { langCode: 'fr', group: 'nav', key: 'news', sourceText: 'Tin tức' })
    assert.equal(response.status, 502, `${JSON.stringify(text)}: ${response.text}`)
  }
  assert.deepEqual(writes, [])

  aiAnswer = { ok: true, text: '"Actualités"' }
  const response = await send('POST', '/api/admin/languages/ai-translate-key', { langCode: 'fr', group: 'nav', key: 'news', sourceText: 'Tin tức' })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(stored().map(v => [v.group, v.key, v.value, v.isAiTranslated]), [['nav', 'news', 'Actualités', true]])
})

test('single key: a key that is not a string is 400 (RED before: stored under "[object Object]")', async () => {
  aiAnswer = { ok: true, text: 'Actualités' }
  const response = await send('POST', '/api/admin/languages/ai-translate-key', { langCode: 'fr', group: 'nav', key: { k: 1 } })
  assert.equal(response.status, 400, response.text)
  assert.deepEqual(writes, [])
})

test('translate missing: only string values for requested keys are stored (RED before: the number 5 reached the column)', async () => {
  // The same rows answer every read: the vi list, the target list (no value → all six
  // missing) and the per-item existence check (→ the update path, which sets `value`).
  selectRows = ['home', 'news', 'about', 'contact', 'search', 'menu'].map((key, i) => ({ id: i + 1, group: 'nav', key, value: null }))
  aiAnswer = { ok: true, text: MODEL_ANSWER }
  const response = await send('POST', '/api/admin/languages/ai-translate', { langCode: 'fr', langName: 'French' })
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(stored(), [{ value: 'Accueil', isAiTranslated: true }])
})
