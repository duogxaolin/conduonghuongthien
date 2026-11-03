import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { rollUpRelatedTopics, type TopicCategoryInput } from '../server/utils/related-topics'
import { ARTICLE_DETAIL_FAMILY, familySource, familyStyle, familyTemplate, readAppFile } from './_component-family.ts'

/**
 * Nội dung liên quan ở cuối trang chi tiết bài viết.
 *
 * Phần gộp số bài theo chủ đề là **hàm thuần**, nên nó được kiểm bằng hành vi
 * thật với bảng danh mục dựng tay — đó là phần sai được trong im lặng, vì một con
 * số lệch vẫn là một con số trông hợp lý. Phần còn lại (truy vấn Drizzle và cây
 * template) chỉ kiểm được bằng văn bản mã nguồn: nó chặn việc xoá mất một guard,
 * **không** chứng minh guard đó chạy đúng lúc chạy thật.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const HANDLER = '../server/api/public/articles/[slug]/related.get.ts'
const COMPONENT = '../app/components/ArticleDetail.vue'

const template = (path: string) => parse(read(path), { filename: path }).descriptor.template?.content ?? ''

/**
 * Mọi khẳng định "thứ này không được xuất hiện" chạy trên bản đã bỏ chú thích.
 * Không có bước này thì một chú thích giải thích *vì sao* không được dùng
 * `location.reload()` sẽ làm đỏ đúng cái test nó ghi lại — và dạy người sau xoá
 * lời giải thích thay vì giữ guard.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // `[^:]` để `https://` không bị bắt thành chú thích một dòng.
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

const code = (path: string) => stripComments(read(path))
const templateCode = (path: string) => stripComments(template(path))

/**
 * Since wave3 4.2 the view is a family: ArticleDetail.vue (fetches, skeletons, error +
 * retry, the aside and its order in the grid — those checks stay on `template(COMPONENT)`)
 * plus `components/article/*` and the composables split out of it
 * (tests/_component-family.ts, parts derived from the directory). Checks on what MOVED —
 * the loaded list, the topic chips, the related fetch — and every "must not appear" check
 * read the whole family; the last block proves they bite when the violation is in a part.
 */
const familyT = (overrides?: Record<string, string>) => familyTemplate(ARTICLE_DETAIL_FAMILY, overrides)
const familyCode = (overrides?: Record<string, string>) => stripComments(familySource(ARTICLE_DETAIL_FAMILY, overrides))

const relatedItem = (tpl: string) => tpl.match(/<li v-for="item in relatedArticles"[\s\S]*?<\/li>/)?.[0] ?? ''
const linksPerItem = (tpl: string) => (relatedItem(tpl).match(/<nuxt-link/g) || []).length
const unguardedPulseTags = (tpl: string) => (tpl.match(/<[^>]*\banimate-pulse[^>]*>/g) ?? []).filter(tag => !tag.includes('motion-reduce:animate-none'))
const RELATED_ERROR_SEPARATE = /const relatedError = computed\(\(\) => !!relatedFetchError\.value \|\| relatedData\.value\?\.ok === false\)/
function relatedFetchShape(source: string): string[] {
  const problems: string[] = []
  if (!/useAsyncData\(\s*\(\) => `article-related-\$\{props\.slug}`,/.test(source)) problems.push('key per slug')
  if (!/\/api\/public\/articles\/\$\{props\.slug\}\/related/.test(source)) problems.push('related URL')
  // The call that OWNS the key: from the `useAsyncData(` right before it to the `)` closing
  // that call on its own line — not from the first `useAsyncData(` of the family (the
  // article's own, also `lazy`), which would let the related one lose `lazy` unnoticed.
  const keyAt = source.indexOf('`article-related-${props.slug}`')
  const start = keyAt === -1 ? -1 : source.lastIndexOf('useAsyncData(', keyAt)
  const relatedFetch = start === -1 ? '' : (source.slice(start).match(/^[\s\S]*?\n\s*\)\n/)?.[0] ?? '')
  if (!/lazy: true/.test(relatedFetch)) problems.push('lazy')
  if (!/default: \(\) => \(\{ ok: true, articles: \[\], topics: \[\] \}\)/.test(relatedFetch)) problems.push('default')
  // Off the server or not started at once = not in the cached HTML (M17/M18).
  if (/\bserver\s*:\s*false\b/.test(relatedFetch)) problems.push('server: false')
  if (/\bimmediate\s*:\s*false\b/.test(relatedFetch)) problems.push('immediate: false')
  return problems
}

/**
 * ArticleDetail.vue starts the related read in its setup, at top level, between the article
 * read and the settings read — the order the two reads had before the split, so they run in
 * parallel (on the server Nuxt awaits both before writing the page) — and hands it a fetcher
 * that requests at once, without waiting for the article.
 */
function relatedCallProblems(parent: string): string[] {
  const problems: string[] = []
  const script = parent.slice(parent.indexOf('<script'))
  const articleAt = script.search(/const articleAsync = useAsyncData\(/)
  const callAt = script.search(/^const \{[^}]*\} = useArticleRelated\(/m)
  const settingsAt = script.indexOf("'public-settings-nav'")
  // Top level = no brace open around the call (comments out first: they quote `{ … }`).
  const depth = (text: string) => (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length
  const atTopLevel = callAt !== -1 && depth(stripComments(script.slice(script.indexOf('>') + 1, callAt))) === 0
  if (!atTopLevel) problems.push('useArticleRelated is not called at the top level of setup')
  else if (!(articleAt !== -1 && articleAt < callAt && callAt < settingsAt)) problems.push('not between the article read and the settings read')
  const call = callAt === -1 ? '' : script.slice(callAt, script.indexOf('\n)', callAt))
  // D-FETCH lot G: the fetcher is `() => publicFetch<…>(\`…/related…\`)` (was a `$fetch` cast).
  if (!/\n\s*\(\) => publicFetch<[^>\n]+>\(`\/api\/public\/articles\/\$\{props\.slug\}\/related/.test(call)) problems.push('the fetcher does not request at once')
  if (/\bawait\b|\.then\(|article\.value/.test(call.slice(call.indexOf('() =>')))) problems.push('the fetcher waits for the article')
  return problems
}
const customCssProblems = (style: string) => [/lien-quan/, /line-clamp/].filter(re => re.test(style)).map(String)

const category = (over: Partial<TopicCategoryInput> & { id: number }): TopicCategoryInput => ({
  name: `Chủ đề ${over.id}`,
  slug: `chu-de-${over.id}`,
  parentId: null,
  displayOrder: 0,
  ...over,
})

// ─── Gộp số bài: con số trên chip phải bằng số bài mà chip đó mở ra ──────────

test('danh mục gốc gộp cả số bài của danh mục con', () => {
  // `/api/public/articles?categorySlug=` phân giải một danh mục gốc thành
  // `[gốc, ...con]` (articles.get.ts:36-45). Chỉ đếm bài gán trực tiếp cho gốc sẽ
  // báo một con số nhỏ hơn danh sách mà cú bấm hiện ra.
  const topics = rollUpRelatedTopics(
    [category({ id: 1 }), category({ id: 2, parentId: 1 }), category({ id: 3, parentId: 1 })],
    new Map([[1, 2], [2, 5], [3, 4]]),
    null,
    12,
  )
  assert.equal(topics.find(t => t.slug === 'chu-de-1')?.total, 11, 'gốc phải là 2 + 5 + 4')
})

test('danh mục con chỉ tính bài của chính nó', () => {
  // Cùng lý do ngược lại: `categorySlug` của một danh mục con phân giải thành
  // `[chính nó]`, nên gộp thêm gì vào cũng là báo nhiều hơn thực tế.
  const topics = rollUpRelatedTopics(
    [category({ id: 1 }), category({ id: 2, parentId: 1 })],
    new Map([[1, 3], [2, 5]]),
    null,
    12,
  )
  assert.equal(topics.find(t => t.slug === 'chu-de-2')?.total, 5)
})

test('cây ba tầng gộp đúng theo luật của endpoint danh sách, không đệ quy', () => {
  // Luật là "có cha thì chỉ đếm mình", không phải "gộp mọi con cháu". Với một
  // danh mục tầng giữa (id 2: có cha 1, có con 3), `?categorySlug=chu-de-2` phân
  // giải thành `[2]` chứ không phải `[2, 3]` (articles.get.ts:43-45) — nên chip
  // của nó phải báo 1, và gộp cháu vào sẽ báo nhiều hơn danh sách nó mở ra.
  //
  // Cây danh mục của cổng là hai tầng, nên đây là ca giả định. Nó có ở đây để
  // ghim một điều: hàm này phải sai *giống hệt* endpoint danh sách, chứ không
  // được "đúng hơn" — hai luật lệch nhau là con số trên chip lệch khỏi thứ nó mở.
  const topics = rollUpRelatedTopics(
    [category({ id: 1 }), category({ id: 2, parentId: 1 }), category({ id: 3, parentId: 2 })],
    new Map([[1, 1], [2, 1], [3, 7]]),
    null,
    12,
  )
  assert.equal(topics.find(t => t.slug === 'chu-de-1')?.total, 2, 'gốc gộp con trực tiếp (1 + 1), không gộp cháu')
  assert.equal(topics.find(t => t.slug === 'chu-de-2')?.total, 1, 'tầng giữa chỉ đếm mình, đúng như categorySlug trả về')
})

test('danh mục con trỏ tới cha vắng mặt vẫn tự đứng thành một chip', () => {
  // Cha có thể ở thể loại khác (truy vấn lọc `categories.type`) hoặc đã bị xoá.
  // Bỏ hàng này đi là ẩn mất một chủ đề đang có bài.
  const topics = rollUpRelatedTopics([category({ id: 9, parentId: 404 })], new Map([[9, 3]]), null, 12)
  assert.deepEqual(topics.map(t => t.slug), ['chu-de-9'])
  assert.equal(topics[0]?.total, 3)
})

// ─── Loại chủ đề rỗng ───────────────────────────────────────────────────────

test('chủ đề không có bài nào bị loại khỏi danh sách', () => {
  // Một chip mở ra danh sách trống là một ngõ cụt, và nó chiếm đúng chỗ mà một
  // chủ đề có nội dung đáng được đứng.
  const topics = rollUpRelatedTopics(
    [category({ id: 1 }), category({ id: 2 })],
    new Map([[1, 4]]),
    null,
    12,
  )
  assert.deepEqual(topics.map(t => t.slug), ['chu-de-1'])
})

test('danh mục gốc rỗng nhưng có con đang có bài thì vẫn hiện', () => {
  // Đây là hình dạng thật của cây danh mục: gốc là nhãn nhóm, bài nằm ở con.
  // Loại theo số bài gán trực tiếp sẽ xoá hết tầng gốc.
  const topics = rollUpRelatedTopics(
    [category({ id: 1 }), category({ id: 2, parentId: 1 })],
    new Map([[2, 6]]),
    null,
    12,
  )
  assert.deepEqual(topics.map(t => t.slug), ['chu-de-1', 'chu-de-2'])
  assert.equal(topics[0]?.total, 6)
})

// ─── Thứ tự ─────────────────────────────────────────────────────────────────

test('chủ đề của bài đang đọc lên đầu dù có ít bài hơn', () => {
  // Đó là chỗ người đọc đang đứng, nên cũng là cú bấm tiếp theo có khả năng nhất.
  const topics = rollUpRelatedTopics(
    [category({ id: 1 }), category({ id: 2 })],
    new Map([[1, 50], [2, 1]]),
    2,
    12,
  )
  assert.equal(topics[0]?.slug, 'chu-de-2')
  assert.equal(topics[0]?.isCurrent, true)
  assert.equal(topics[1]?.isCurrent, false)
})

test('thứ tự sau đó là nhiều bài trước, rồi displayOrder, rồi id', () => {
  const topics = rollUpRelatedTopics(
    [
      category({ id: 1, displayOrder: 9 }),
      category({ id: 2, displayOrder: 1 }),
      category({ id: 3, displayOrder: 1 }),
      category({ id: 4, displayOrder: 0 }),
    ],
    new Map([[1, 2], [2, 2], [3, 2], [4, 8]]),
    null,
    12,
  )
  // id 4 nhiều bài nhất; ba cái còn lại hoà 2 bài → displayOrder rồi id.
  assert.deepEqual(topics.map(t => t.slug), ['chu-de-4', 'chu-de-2', 'chu-de-3', 'chu-de-1'])
})

test('displayOrder null đọc thành 0 chứ không thành NaN', () => {
  // Cột này nullable. `NaN` trong bộ so sánh trả về `false` ở mọi phép so, nên
  // thứ tự sẽ phụ thuộc vào thuật toán sắp xếp thay vì vào dữ liệu.
  const topics = rollUpRelatedTopics(
    [category({ id: 1, displayOrder: null }), category({ id: 2, displayOrder: 5 })],
    new Map([[1, 1], [2, 1]]),
    null,
    12,
  )
  assert.deepEqual(topics.map(t => t.slug), ['chu-de-1', 'chu-de-2'])
})

test('danh sách bị cắt theo limit sau khi đã xếp, không phải trước', () => {
  // Cắt trước khi xếp sẽ ném đi đúng những chủ đề đáng hiện nhất.
  const many = Array.from({ length: 20 }, (_, i) => category({ id: i + 1 }))
  const counts = new Map(many.map((c, i) => [c.id, i + 1]))
  const topics = rollUpRelatedTopics(many, counts, null, 3)
  assert.deepEqual(topics.map(t => t.slug), ['chu-de-20', 'chu-de-19', 'chu-de-18'])
})

test('hàm không lộ trường nội bộ ra ngoài', () => {
  // `displayOrder` và `id` chỉ dùng để xếp thứ tự. Trả chúng ra là gửi id nội bộ
  // xuống trình duyệt mà không nơi gọi nào cần.
  const [topic] = rollUpRelatedTopics([category({ id: 1 })], new Map([[1, 1]]), 1, 12)
  assert.deepEqual(Object.keys(topic ?? {}).sort(), ['isCurrent', 'name', 'slug', 'total'])
})

// ─── Endpoint ───────────────────────────────────────────────────────────────

test('cả hai truy vấn chỉ đọc bài đã xuất bản', () => {
  // Bản nháp không được dùng làm mỏ neo (để lộ chủ đề và các bài lân cận của nó)
  // và cũng không được đếm vào con số trên chip.
  const handler = read(HANDLER)
  const clauses = handler.match(/eq\(articles\.status, 'published'\)/g) ?? []
  assert.ok(clauses.length >= 3, `mọi truy vấn phải lọc published, thấy ${clauses.length}`)
})

test('bài đang đọc không bao giờ là bài liên quan của chính nó', () => {
  assert.match(read(HANDLER), /ne\(articles\.id, current\.id\)/)
})

test('bài liên quan cùng thể loại với bài đang đọc', () => {
  // Một câu chuyện tấm gương nằm dưới nhãn "bài viết liên quan" của một bản tin
  // là nói sai về thứ nó là — và link sẽ trỏ sai tiền tố route.
  assert.match(read(HANDLER), /eq\(articles\.type, current\.type\)/)
})

test('slug lạ trả về danh sách rỗng chứ không phải lỗi', () => {
  // Đây là khối phụ của một trang đã tự xử lý 404 của chính nó. `createError` ở
  // đây sẽ biến một bài viết đọc được thành một trang lỗi.
  assert.doesNotMatch(code(HANDLER), /createError/, 'slug lạ phải trả rỗng, không được ném lỗi')
  assert.match(read(HANDLER), /if \(!current\) return empty\(\)/)
})

test('truy vấn hỏng phân biệt được với không có gì liên quan', () => {
  // `ok: false` là thứ phía client biến thành nhánh lỗi có nút thử lại. Trả rỗng
  // khi hỏng sẽ đọc ra là "bài này không liên quan tới bài nào", và người đọc
  // mất đường đi tiếp mà không có gì giải thích.
  const handler = read(HANDLER)
  assert.match(handler, /return \{ ok: false as const, articles: \[\], topics: \[\] \}/)
  assert.match(handler, /ok: true as const, articles: relatedRows/)
})

test('phản hồi rỗng là hàm, không phải object cấp module', () => {
  // Một object cấp module trả về cho mọi request là một mảng mà bất cứ ai cũng
  // đẩy phần tử vào được, và lỗi đó hiện ra dưới dạng nội dung liên quan của bài
  // này rò sang bài khác.
  const handler = read(HANDLER)
  assert.match(handler, /const empty = \(\) => \(\{/, 'empty phải là hàm trả về object mới mỗi lượt')
  assert.doesNotMatch(handler, /const EMPTY = \{/)
})

test('bài không có danh mục thì bỏ hẳn mệnh đề CASE, không thay bằng hằng số', () => {
  // `ORDER BY 1` trong MySQL là "sắp theo cột thứ nhất của SELECT" — ở đây là
  // `id` — một lượt sắp xếp sai hoàn toàn mà không có lỗi nào.
  const handler = read(HANDLER)
  assert.match(handler, /current\.categoryId === null\s*\n?\s*\?\s*\[\]/, 'nhánh null phải là mảng rỗng')
  assert.match(handler, /CASE WHEN \$\{articles\.categoryId\} = \$\{current\.categoryId\}/)
})

test('endpoint dùng hàm gộp dùng chung chứ không tự viết lại', () => {
  // Hai bản gộp là hai cơ hội để con số trên chip lệch khỏi danh sách nó mở ra.
  const handler = read(HANDLER)
  assert.match(handler, /import \{ rollUpRelatedTopics \}/)
  assert.match(handler, /rollUpRelatedTopics\(categoryRows, directTotals, current\.categoryId, RELATED_TOPIC_LIMIT\)/)
})

// ─── Component: tải / lỗi / rỗng là một hợp đồng ─────────────────────────────

test('khối liên quan có cả ba trạng thái dữ liệu', () => {
  // Tải + lỗi ở ArticleDetail.vue (hợp đồng tải/lỗi/rỗng ở cha); danh sách đã tải ở
  // ArticleRelatedList.vue.
  const source = template(COMPONENT)
  assert.match(source, /v-if="relatedPending"/, 'thiếu nhánh tải thì khối trông như đã tải xong mà trống')
  assert.match(source, /v-else-if="relatedError"/, 'thiếu nhánh lỗi thì fetch hỏng đọc ra như không có gì liên quan')
  assert.match(source, /<ArticleRelatedList\s+v-else\b/, 'danh sách đã tải là nhánh còn lại, sau tải và lỗi')
  assert.match(familyT(), /v-if="relatedArticles\.length"/, 'không có bài liên quan thì không dựng lưới rỗng')
})

test('nhánh lỗi của khối liên quan tự thông báo và gọi lại đúng lượt fetch đã hỏng', () => {
  const source = template(COMPONENT)
  const errorTag = source.match(/<[^>]*v-else-if="relatedError"[^>]*>/)?.[0]
  assert.ok(errorTag, 'nhánh lỗi của khối liên quan đã đổi chỗ')
  assert.match(errorTag, /role="alert"/, 'không có nó thì người dùng trình đọc màn hình không được thông báo gì')
  assert.match(source, /@click="refreshRelated\(\)"/, 'nút thử lại phải gọi lại chính lượt fetch đã hỏng')
  assert.doesNotMatch(
    familyCode(),
    /location\.reload/,
    'tải lại trang để chạy lại một request là ném đi state của mọi khung khác',
  )
  assert.equal(templateCode(COMPONENT).includes('location.reload'), false)
})

test('lỗi của khối liên quan không được gộp vào lỗi của cả trang', () => {
  // Gộp là biến một khối phụ hỏng thành một trang lỗi, ném đi đúng phần nội dung
  // đã tải xong. Dòng `loadError` này cũng được `public-pages-structure` ghim.
  const source = code(COMPONENT)
  // `fetchOutcome` đọc status/error/data của lượt fetch BÀI VIẾT (không phải `related*`);
  // 404 tách khỏi "hỏng" ở `resolveDetailFetch` (tests/public-detail-ssr-status.test.ts).
  assert.match(source, /const fetchOutcome = computed\(\(\) => resolveDetailFetch\(\{ status: status\.value, error: error\.value, hasContent: !!data\.value\?\.article \}\)\)/, 'loadError chỉ đọc lượt fetch bài viết')
  assert.match(source, /const loadError = computed\(\(\) => fetchOutcome\.value === 'failed'\)/, 'loadError chỉ đọc lượt fetch bài viết')
  // `relatedError` nay ở `useArticleRelated` (tách ở wave3 4.2) — cùng biểu thức.
  assert.match(familyCode(), RELATED_ERROR_SEPARATE)
})

test('khung chờ của khối liên quan được thông báo và tôn trọng reduced-motion', () => {
  const source = template(COMPONENT)
  const container = source.match(/<div\s+v-if="relatedPending"[\s\S]{0,300}?>/)?.[0] ?? ''
  assert.match(container, /role="status"/)
  assert.match(container, /aria-busy="true"/)
  assert.match(source, /sr-only">\{\{ t\('a_related_loading'\) \}\}/, 'khung chờ cần một nhãn tiếng Việt (qua i18n key a_related_loading)')

  // Kiểm theo **từng thẻ**: một tệp có hai khung chờ mà chỉ một cái được gắn
  // guard vẫn phải trượt. Đây là cùng luật mà skeleton-loading-ui.test.ts áp — trên cả
  // họ tệp (cha + phần tách ra).
  assert.deepEqual(unguardedPulseTags(familyT()), [])
})

test('khung chờ chính của trang chi tiết cũng mang đủ hợp đồng thông báo', () => {
  // Khung này có trước khối liên quan và chưa từng có phần thông báo — trình đọc
  // màn hình đọc ra một chuỗi hộp rỗng vô nghĩa thay vì "đang tải bài viết".
  const source = template(COMPONENT)
  const container = source.match(/<div\s+v-if="pending"[\s\S]{0,300}?>/)?.[0] ?? ''
  assert.match(container, /role="status"/)
  assert.match(container, /aria-busy="true"/)
  assert.match(source, /sr-only">Đang tải nội dung bài viết/)
  const mainError = source.match(/<[^>]*v-else-if="loadError"[^>]*>/)?.[0] ?? ''
  assert.match(mainError, /role="alert"/)
})

test('mọi ô xám trong khung chờ đều bị ẩn khỏi trình đọc màn hình', () => {
  const source = template(COMPONENT)
  const skeletons = source.match(/<div\s+v-if="(?:pending|relatedPending)"[\s\S]*?<\/div>\s*<!--/g) ?? []
  assert.ok(skeletons.length >= 1, 'không tìm thấy khung chờ nào để kiểm')
  assert.ok(
    (source.match(/aria-hidden="true"/g) ?? []).length >= 5,
    'các ô xám phải mang aria-hidden, nếu không chúng được đọc ra thành hộp rỗng',
  )
})

// ─── Component: link và điều kiện hiện chip ─────────────────────────────────

test('link bài liên quan dựng từ backTo, không thêm prop mới', () => {
  // Bốn trang bọc truyền `/news`, `/news`, `/role-models`,
  // `/reintegration-models` — `back-to` đã là tiền tố route đúng cho cả bốn.
  assert.match(familyT(), /:to="`\$\{backTo\}\/\$\{item\.slug\}`"/)
  assert.match(template(COMPONENT), /<ArticleRelatedList[\s\S]*?:back-to="backTo"/, 'danh sách nhận đúng backTo của trang')
})

test('mỗi mục bài viết khác là MỘT điểm dừng tab, không phải hai', () => {
  // Ảnh và tiêu đề trỏ cùng một chỗ, nên hai link riêng buộc người dùng bàn phím
  // bấm Tab hai lần cho mỗi mục để đi qua danh sách.
  //
  // Bản thẻ trước đó giải bằng `tabindex="-1"` + `aria-hidden` trên link ảnh —
  // đúng, nhưng là hai thứ phải nhớ gắn. Bản danh sách này bọc cả ảnh lẫn tiêu đề
  // trong MỘT `<nuxt-link>`, nên vấn đề không còn tồn tại để mà quên: nếu ai đó
  // tách ảnh ra thành link riêng, số link trong mỗi `<li>` tăng lên và test đỏ.
  const source = familyT()
  const item = relatedItem(source)
  assert.ok(item, 'không tìm thấy mục trong danh sách bài viết khác')
  assert.equal(linksPerItem(source), 1, 'mỗi mục phải có đúng một link bọc cả ảnh và tiêu đề')
  assert.match(item, /<img/, 'ảnh nhỏ vẫn ở lại — nó giúp nhận ra bài đã đọc trong nháy mắt')
  assert.match(item, /alt=""/, 'ảnh trang trí phải có alt rỗng, không lặp lại tiêu đề ngay cạnh nó')
})

test('chip chủ đề chỉ hiện ở nơi cú bấm thật sự lọc được', () => {
  // Hai điều kiện, phải đúng cả hai:
  //  1. `/news` là danh sách DUY NHẤT có category filter (path segment
  //     `/news/<cat>` qua route dishwasher `news/[id].vue`) — ba danh sách hệ
  //     thống còn lại không có category filter nên chip bấm hụt.
  //  2. `/news` cũng ghim cứng `type: 'news'`, nên chủ đề của một bài `document`
  //     hay `faq` sẽ mở ra một danh sách rỗng.
  const source = familyCode()
  assert.match(source, /props\.backTo === '\/news'/)
  assert.match(source, /article\.value\?\.type === 'news'/)
  assert.match(source, /relatedTopics\.value\.length > 0/)
  assert.match(familyT(), /v-if="showTopics"/)
  assert.match(familyT(), /:to="`\$\{backTo\}\/\$\{topic\.slug\}`"/)
  assert.match(template(COMPONENT), /:show-topics="showTopics"/, 'điều kiện chip đi từ cha xuống danh sách')
})

test('cả khối ẩn đi khi không có gì để hiện', () => {
  // Một tiêu đề "Nội dung liên quan" bên trên khoảng trắng còn trống trải hơn chỗ
  // trống ban đầu — đúng thứ yêu cầu này ra đời để sửa.
  assert.match(
    template(COMPONENT),
    /v-if="relatedPending \|\| relatedError \|\| relatedArticles\.length \|\| showTopics"/,
  )
})

test('khối liên quan nằm trong nhánh bài viết, không phải nhánh 404', () => {
  // Đặt ngoài `<article v-else-if="article">` là hiện "nội dung liên quan" trên
  // một trang không tìm thấy bài nào.
  //
  // Định vị thẻ mở bằng regex chứ không bằng chuỗi `'<article v-else-if="article">'`
  // khớp cứng: thẻ đó nay mang thêm class lưới hai cột, và một khẳng định về
  // *thứ tự* không nên đỏ chỉ vì một class được thêm vào. Bản khớp cứng đã đỏ
  // đúng như vậy — và nếu đọc nhầm nó thành "khối liên quan sai chỗ" thì việc
  // sửa sẽ là di chuyển khối, tức phá đúng thứ guard này đang bảo vệ.
  const source = template(COMPONENT)
  const articleStart = source.search(/<article\s+v-else-if="article"/)
  const relatedStart = source.indexOf('aria-labelledby="noi-dung-lien-quan-heading"')
  const notFound = source.indexOf('<div v-else class="py-10 text-center">')
  assert.ok(articleStart >= 0 && relatedStart > articleStart, 'khối liên quan phải nằm sau <article>')
  assert.ok(notFound > relatedStart, 'khối liên quan phải nằm trước nhánh không tìm thấy')
})

// ─── Bố cục hai cột ────────────────────────────────────────────────────────

test('khối liên quan là cột phải trên PC, không phải dải ngang dưới đáy', () => {
  // Trên màn hình rộng, một dải ngang dưới đáy bài đặt phần "đọc gì tiếp" ngay
  // dưới cái màn hình vừa cuộn hết — người đọc phải cuộn thêm để thấy nó, còn
  // hai bên cột chữ là khoảng trắng không làm gì.
  const source = template(COMPONENT)
  const grid = source.match(/<article\s+v-else-if="article"[^>]*>/)?.[0] ?? ''
  assert.match(grid, /lg:grid\b/, 'lưới chỉ bật từ lg — mobile vẫn là một luồng xếp dọc')
  assert.match(grid, /lg:grid-cols-\[minmax\(0,820px\)_320px\]/, 'cột đọc trần 820px, cột phải cố định 320px')

  // `items-start` là điều kiện tiên quyết của `sticky`, không phải tinh chỉnh:
  // mặc định `stretch` kéo ô lưới cao bằng bài viết, và `sticky` trong một ô cao
  // bằng cả vùng cuộn thì không bao giờ dính.
  assert.match(grid, /lg:items-start/, 'thiếu items-start thì sticky ở cột phải không bao giờ dính')

  const aside = source.match(/<aside[^>]*aria-labelledby="noi-dung-lien-quan-heading"[\s\S]{0,400}?>/)?.[0] ?? ''
  assert.ok(aside, 'khối liên quan phải là <aside> — nó là điều hướng phụ, không phải một mục của bài')
  assert.match(aside, /lg:sticky/)
  // Cùng giá trị mà sidebar của /news dùng, và cùng lý do: chừa cái header
  // `fixed` của layouts/default.vue.
  assert.match(aside, /lg:top-\[100px\]/)
  // Đường kẻ ngang chỉ có nghĩa khi khối nằm DƯỚI bài; ở cột phải nó là một nét
  // cắt ngang giữa hai cột.
  assert.match(aside, /lg:border-t-0/)
})

test('cột đọc giữ nguyên bề rộng đọc được và không bị khối v-html nong ra', () => {
  const source = template(COMPONENT)
  // Container nới ra để có chỗ cho cột phải, nhưng cột chữ KHÔNG được nới theo:
  // một dòng chữ dài 1200px thì mắt mất chỗ khi xuống hàng.
  assert.match(source, /max-w-\[1200px\]/, 'container phải đủ rộng cho hai cột')
  assert.doesNotMatch(source, /max-w-\[800px\]/, 'bề rộng cột đọc nay do lưới quyết định, không do container')

  // `min-w-0` để một bảng hoặc ảnh rộng trong `v-html` co lại theo cột thay vì
  // nong cột ra và đẩy cột phải tràn khỏi container. Đây là hành vi mặc định của
  // grid item (`min-width: auto`), nên thiếu class này là một lỗi bố cục chỉ lộ
  // ra với đúng những bài có nội dung rộng.
  assert.match(source, /<div class="min-w-0">/, 'cột đọc cần min-w-0')

  // Khung chờ và nhánh lỗi của cả trang phải khớp bề rộng cột đọc: trải hết
  // 1200px là hứa một bố cục rộng rồi trả về một cột hẹp.
  const skeleton = source.match(/<div\s+v-if="pending"[^>]*>/)?.[0] ?? ''
  assert.match(skeleton, /lg:max-w-\[820px\]/)
  const mainError = source.match(/<div\s+v-else-if="loadError"[\s\S]{0,300}?>/)?.[0] ?? ''
  assert.match(mainError, /lg:max-w-\[820px\]/)
})

test('bài viết khác là danh sách hàng ngang, không phải lưới thẻ', () => {
  // Bản đầu là lưới thẻ: ảnh cao 140px + ngày + danh mục + hai dòng tóm tắt, tức
  // mỗi mục cao khoảng 250px. Năm mục như vậy chiếm nhiều chiều cao hơn cả phần
  // đầu của bài đang đọc — một danh sách điều hướng phụ tự nhận lấy sự chú ý mà
  // bài viết đáng được nhận.
  //
  // Test này chốt ba thứ làm nên "nhỏ thôi": hàng ngang (`flex`, không `grid`),
  // ảnh ở kích thước thumbnail cố định, và KHÔNG có đoạn tóm tắt.
  const source = familyT()

  const list = source.match(/<ul v-if="relatedArticles\.length"[^>]*>/)?.[0] ?? ''
  assert.ok(list, 'không tìm thấy danh sách bài viết khác')
  assert.doesNotMatch(list, /grid-cols/, 'không còn là lưới thẻ')
  assert.match(list, /divide-y/, 'các mục phân cách bằng đường kẻ, không phải viền thẻ')

  const item = source.match(/<li v-for="item in relatedArticles"[\s\S]*?<\/li>/)?.[0] ?? ''
  assert.match(item, /flex items-start/, 'ảnh và chữ nằm cạnh nhau trên một hàng')
  assert.match(item, /w-\[72px\] h-\[54px\]/, 'ảnh ở kích thước thumbnail cố định')
  assert.doesNotMatch(item, /item\.excerpt/, 'đoạn tóm tắt là phần chiếm chiều cao nhiều nhất và đã bỏ')

  // Khung chờ phải mang cùng hình dạng, nếu không trang sẽ nhảy đúng lúc nội dung
  // về — và đó là loại lỗi chỉ thấy được trên mạng chậm.
  const skeletonItem = source.match(/<div\s+v-if="relatedPending"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? ''
  assert.match(skeletonItem, /w-\[72px\] h-\[54px\]/, 'khung chờ phải đo theo nội dung thật')
})

test('bình luận ở trong cột đọc, không ở cột phải', () => {
  // Một luồng hội thoại dài không đoán được độ dài sẽ phá bố cục của một cột
  // hẹp — và bình luận là phần *nội dung* của bài này, không phải điều hướng đi
  // nơi khác.
  const source = template(COMPONENT)
  const comments = source.indexOf('<ArticleComments')
  const asideStart = source.search(/<aside[^>]*aria-labelledby="noi-dung-lien-quan-heading"/)
  assert.ok(comments >= 0 && asideStart >= 0, 'không tìm thấy bình luận hoặc khối liên quan')
  assert.ok(comments < asideStart, 'bình luận phải nằm trong cột đọc, tức trước <aside>')
})

test('id tiêu đề khối không đụng vào anchor do buildToc sinh', () => {
  // `buildToc` biến chữ của mỗi <h2> trong bài thành id. Một tác giả viết đúng
  // heading "Nội dung liên quan" sẽ tạo ra `id="noi-dung-lien-quan"` trùng — hậu
  // tố `-heading` là cùng quy ước mà `muc-luc-heading` đang dùng.
  assert.match(template(COMPONENT), /id="noi-dung-lien-quan-heading"/)
  assert.doesNotMatch(familyT(), /id="noi-dung-lien-quan"/)
})

test('lượt fetch liên quan có key riêng và lazy', () => {
  // Thiếu `lazy` thì router giữ nguyên trang cũ tới khi khối phụ này về — bấm một
  // liên kết trông y hệt bấm hụt. Key riêng để hai lượt fetch không ghi đè nhau.
  //
  // Lưu ý: trước đây dùng `useFetch`, nay đổi sang `useAsyncData` + `$fetch` ép
  // kiểu hàm để tránh TS2589 "Type instantiation is excessively deep" khi Nitro
  // route type quá sâu. Hình dạng khác (useAsyncData thay useFetch, url nằm ở
  // tham số handler thứ hai) nhưng cùng ba điều kiện phải giữ: key riêng theo
  // slug, lazy: true, default trả {ok,articles,topics}.
  //
  // Từ wave3 4.2: `useAsyncData` ở `useArticleRelated` (gọi tại cùng chỗ trong setup của
  // ArticleDetail.vue — hai lượt fetch vẫn song song), URL ở ArticleDetail.vue (lượt
  // `$fetch` ép kiểu ở lại cha; từ D-FETCH lô G là `publicFetch<…>(…)`). Đọc cả họ tệp.
  assert.deepEqual(relatedFetchShape(familySource(ARTICLE_DETAIL_FAMILY)), [])
  assert.deepEqual(relatedCallProblems(read(COMPONENT)), [], 'cha gọi composable ngay trong setup, song song với lượt đọc bài')
})

test('component không thêm CSS tuỳ chỉnh cho phần mới', () => {
  // Quy tắc dự án: code mới dùng Tailwind. `<style scoped>` sẵn có chỉ chứa quy
  // tắc `:deep()` cho rich-text của v-html (nay ở ArticleBody.vue) — phần mới không được
  // nối vào đó, và không phần tách nào được có CSS riêng cho khối liên quan.
  assert.deepEqual(customCssProblems(familyStyle(ARTICLE_DETAIL_FAMILY)), [], 'phần liên quan phải dựng bằng utility class; line-clamp là utility có sẵn của Tailwind 3.4')
})

// ─── Bằng chứng tiêm lỗi: các guard trên vẫn cắn khi vi phạm nằm ở phần tách ra ───

test('guard họ tệp: vi phạm cấy vào phần tách ra làm guard đỏ (wave3 4.2)', () => {
  const LIST = 'components/article/ArticleRelatedList.vue'
  const RELATED = 'composables/useArticleRelated.ts'
  const list = readAppFile(LIST)
  const related = readAppFile(RELATED)
  const swap = (src: string, from: string, to: string) => {
    const out = src.replace(from, to)
    assert.notEqual(out, src, `chuỗi cấy không khớp: ${from.slice(0, 60)}`)
    return out
  }

  // Hai link trong một mục (ảnh tách thành link riêng).
  const twoLinks = swap(list, '<img', '<nuxt-link :to="`${backTo}/${item.slug}`"><img src="x" /></nuxt-link><img')
  assert.equal(linksPerItem(familyT({ [LIST]: twoLinks })), 2)
  // Đoạn tóm tắt quay lại.
  const excerpt = swap(list, '{{ item.title }}</span>', '{{ item.title }}</span><span>{{ item.excerpt }}</span>')
  assert.match(relatedItem(familyT({ [LIST]: excerpt })), /item\.excerpt/)
  // Một khung chờ không tôn trọng reduced-motion trong một phần MỚI của thư mục.
  const planted = { 'components/article/Planted.vue': '<template><div class="animate-pulse"></div></template>' }
  assert.equal(unguardedPulseTags(familyT(planted)).length, 1)
  // CSS riêng cho khối liên quan trong một phần.
  const css = { 'components/article/Planted.vue': '<template><p /></template><style scoped>.lien-quan { color: red }</style>' }
  assert.equal(customCssProblems(familyStyle(ARTICLE_DETAIL_FAMILY, css)).length, 1)
  // Lỗi khối liên quan gộp vào lỗi trang / bỏ lazy / bỏ default — trong composable.
  const merged = swap(related, '!!relatedFetchError.value || relatedData.value?.ok === false', '!!relatedFetchError.value')
  assert.doesNotMatch(stripComments(familySource(ARTICLE_DETAIL_FAMILY, { [RELATED]: merged })), RELATED_ERROR_SEPARATE)
  assert.deepEqual(relatedFetchShape(familySource(ARTICLE_DETAIL_FAMILY, { [RELATED]: swap(related, 'lazy: true,', '') })), ['lazy'])
  assert.deepEqual(relatedFetchShape(familySource(ARTICLE_DETAIL_FAMILY, { [RELATED]: swap(related, "default: () => ({ ok: true, articles: [], topics: [] }),", '') })), ['default'])
  // M17/M18: chỉ chạy phía trình duyệt, hoặc không chạy ngay.
  assert.deepEqual(relatedFetchShape(familySource(ARTICLE_DETAIL_FAMILY, { [RELATED]: swap(related, 'lazy: true,', 'lazy: true,\n      server: false,') })), ['server: false'])
  assert.deepEqual(relatedFetchShape(familySource(ARTICLE_DETAIL_FAMILY, { [RELATED]: swap(related, 'lazy: true,', 'lazy: true,\n      immediate: false,') })), ['immediate: false'])
  // Lời gọi ở cha: dời xuống sau settings, bọc trong onMounted, hoặc fetcher chờ bài.
  const parent = read(COMPONENT)
  const callStart = parent.indexOf('const { relatedPending')
  const callEnd = parent.indexOf('\n)\n', callStart) + 3
  const call = parent.slice(callStart, callEnd)
  const settingsStart = parent.indexOf('const { data: settingsData }')
  assert.ok(callStart > 0 && callEnd > callStart && settingsStart > callEnd)
  const moved = parent.slice(0, callStart) + parent.slice(callEnd, settingsStart) + parent.slice(settingsStart).replace("useSiteSettings(settingsData)\n", `useSiteSettings(settingsData)\n${call}`)
  assert.deepEqual(relatedCallProblems(moved), ['not between the article read and the settings read'])
  assert.deepEqual(relatedCallProblems(swap(parent, call, `onMounted(() => {\n${call}})\n`)), ['useArticleRelated is not called at the top level of setup'])
  const fetcher = '  () => publicFetch<ArticleRelatedResponse>'
  assert.deepEqual(relatedCallProblems(swap(parent, fetcher, fetcher.replace('  () => ', '  async () => { await until(article); return '))), ['the fetcher does not request at once', 'the fetcher waits for the article'])
})
