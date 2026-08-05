import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { rollUpRelatedTopics, type TopicCategoryInput } from '../server/utils/related-topics'

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
  const source = template(COMPONENT)
  assert.match(source, /v-if="relatedPending"/, 'thiếu nhánh tải thì khối trông như đã tải xong mà trống')
  assert.match(source, /v-else-if="relatedError"/, 'thiếu nhánh lỗi thì fetch hỏng đọc ra như không có gì liên quan')
  assert.match(source, /v-if="relatedArticles\.length"/, 'không có bài liên quan thì không dựng lưới rỗng')
})

test('nhánh lỗi của khối liên quan tự thông báo và gọi lại đúng lượt fetch đã hỏng', () => {
  const source = template(COMPONENT)
  const errorTag = source.match(/<[^>]*v-else-if="relatedError"[^>]*>/)?.[0]
  assert.ok(errorTag, 'nhánh lỗi của khối liên quan đã đổi chỗ')
  assert.match(errorTag, /role="alert"/, 'không có nó thì người dùng trình đọc màn hình không được thông báo gì')
  assert.match(source, /@click="refreshRelated\(\)"/, 'nút thử lại phải gọi lại chính lượt fetch đã hỏng')
  assert.doesNotMatch(
    templateCode(COMPONENT),
    /location\.reload/,
    'tải lại trang để chạy lại một request là ném đi state của mọi khung khác',
  )
})

test('lỗi của khối liên quan không được gộp vào lỗi của cả trang', () => {
  // Gộp là biến một khối phụ hỏng thành một trang lỗi, ném đi đúng phần nội dung
  // đã tải xong. Dòng `loadError` này cũng được `public-pages-structure` ghim.
  const source = code(COMPONENT)
  assert.match(source, /const loadError = computed\(\(\) => !!error\.value\)/, 'loadError chỉ đọc lượt fetch bài viết')
  assert.match(
    source,
    /const relatedError = computed\(\(\) => !!relatedFetchError\.value \|\| relatedData\.value\?\.ok === false\)/,
  )
})

test('khung chờ của khối liên quan được thông báo và tôn trọng reduced-motion', () => {
  const source = template(COMPONENT)
  const container = source.match(/<div\s+v-if="relatedPending"[\s\S]{0,300}?>/)?.[0] ?? ''
  assert.match(container, /role="status"/)
  assert.match(container, /aria-busy="true"/)
  assert.match(source, /sr-only">Đang tải nội dung liên quan/, 'khung chờ cần một nhãn tiếng Việt')

  // Kiểm theo **từng thẻ**: một tệp có hai khung chờ mà chỉ một cái được gắn
  // guard vẫn phải trượt. Đây là cùng luật mà skeleton-loading-ui.test.ts áp.
  for (const tag of source.match(/<[^>]*\banimate-pulse[^>]*>/g) ?? []) {
    assert.ok(tag.includes('motion-reduce:animate-none'), `animate-pulse thiếu guard: ${tag.slice(0, 120)}`)
  }
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
  assert.match(template(COMPONENT), /:to="`\$\{backTo\}\/\$\{item\.slug\}`"/)
})

test('ảnh thẻ liên quan không phải một điểm dừng tab thứ hai', () => {
  // Ảnh và tiêu đề trỏ cùng một chỗ. Để cả hai vào thứ tự tab là buộc người dùng
  // bàn phím bấm Tab hai lần cho mỗi thẻ để đi qua danh sách.
  const imageLink = template(COMPONENT).match(/<nuxt-link :to="`\$\{backTo\}\/\$\{item\.slug\}`" class="block h-\[140px\][^>]*>/)?.[0]
  assert.ok(imageLink, 'link ảnh của thẻ liên quan đã đổi')
  assert.match(imageLink, /tabindex="-1"/)
  assert.match(imageLink, /aria-hidden="true"/)
  assert.match(template(COMPONENT), /alt=""/, 'ảnh trang trí phải có alt rỗng, không lặp lại tiêu đề')
})

test('chip chủ đề chỉ hiện ở nơi cú bấm thật sự lọc được', () => {
  // Hai điều kiện, phải đúng cả hai:
  //  1. `/news` là danh sách DUY NHẤT đọc `?cat=` (news/index.vue) — ba danh sách
  //     còn lại bỏ qua tham số đó và trả về đúng trang chưa lọc.
  //  2. `/news` cũng ghim cứng `type: 'news'`, nên chủ đề của một bài `document`
  //     hay `faq` sẽ mở ra một danh sách rỗng.
  const source = code(COMPONENT)
  assert.match(source, /props\.backTo === '\/news'/)
  assert.match(source, /article\.value\?\.type === 'news'/)
  assert.match(source, /relatedTopics\.value\.length > 0/)
  assert.match(template(COMPONENT), /v-if="showTopics"/)
  assert.match(template(COMPONENT), /:to="`\$\{backTo\}\?cat=\$\{topic\.slug\}`"/)
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

test('thẻ bài liên quan xếp một cột ở cột phải, hai cột khi còn đủ chỗ', () => {
  // Cột phải rộng 320px, nên hai thẻ cạnh nhau ở đó hẹp hơn cả ảnh của chúng.
  // Nhưng trên mobile/tablet khối này lại là dải ngang chiếm hết bề rộng, và ở
  // đó một cột là bỏ không nửa màn hình.
  const source = template(COMPONENT)
  for (const marker of ['v-if="relatedPending"', 'v-if="relatedArticles.length"']) {
    const tag = source.match(new RegExp(`<div[^>]*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`))?.[0] ?? ''
    assert.ok(tag, `không tìm thấy lưới cho ${marker}`)
    assert.match(tag, /sm:grid-cols-2/, `${marker}: tablet còn chỗ cho hai cột`)
    assert.match(tag, /lg:grid-cols-1/, `${marker}: ở cột phải 320px phải quay về một cột`)
  }
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
  assert.doesNotMatch(template(COMPONENT), /id="noi-dung-lien-quan"/)
})

test('lượt fetch liên quan có key riêng và lazy', () => {
  // Thiếu `lazy` thì router giữ nguyên trang cũ tới khi khối phụ này về — bấm một
  // liên kết trông y hệt bấm hụt. Key riêng để hai lượt fetch không ghi đè nhau.
  const source = read(COMPONENT)
  assert.match(source, /key: \(\) => `article-related-\$\{props\.slug\}`/)
  const relatedFetch = source.match(/useFetch\(\(\) => `\/api\/public\/articles\/\$\{props\.slug\}\/related`[\s\S]*?\}\)/)?.[0]
  assert.ok(relatedFetch, 'lượt fetch liên quan đã đổi hình dạng')
  assert.match(relatedFetch, /lazy: true/)
  assert.match(relatedFetch, /default: \(\) => \(\{ ok: true, articles: \[\], topics: \[\] \}\)/)
})

test('component không thêm CSS tuỳ chỉnh cho phần mới', () => {
  // Quy tắc dự án: code mới dùng Tailwind. `<style scoped>` sẵn có chỉ chứa quy
  // tắc `:deep()` cho rich-text của v-html — phần mới không được nối vào đó.
  const style = read(COMPONENT).match(/<style scoped>[\s\S]*<\/style>/)?.[0] ?? ''
  assert.doesNotMatch(style, /lien-quan/, 'phần liên quan phải dựng bằng utility class')
  assert.doesNotMatch(style, /line-clamp/, 'line-clamp-2 là utility có sẵn của Tailwind 3.4')
})
