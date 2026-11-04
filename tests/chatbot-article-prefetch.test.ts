/**
 * Câu trả lời có căn cứ: nạp sẵn bài viết ở máy chủ thay cho một vòng gọi công cụ.
 *
 * `delify-5.5` có sàn ~3,5 s cho mọi lượt gọi (đo 2026-11-04: câu "1+1=" với
 * `max_tokens: 5` vẫn 3 458–3 707 ms tới byte đầu). Vòng gọi công cụ tốn HAI lượt,
 * nên mỗi câu nghiệp vụ mất ~9 s tới chữ đầu. Tra bài viết ở máy chủ chỉ 31–127 ms.
 *
 * Ba bất biến phải cùng đúng, nếu không thì "tối ưu" là mất chất lượng:
 *  1. Câu hỏi đã khớp kho tri thức → nạp sẵn bài viết vào prompt và TẮT công cụ.
 *  2. Câu hỏi KHÔNG khớp kho tri thức → giữ đủ công cụ (model phải tự tìm).
 *  3. Ảnh bìa mặc định của cổng không bao giờ lọt vào prompt như ảnh của bài —
 *     492/1 132 bài của production mang đúng đường dẫn đó, và người đọc từng thấy
 *     `![Ảnh minh họa](/assets/default_cover_light.png)` (khung ảnh vỡ) trong câu trả lời.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/** Đúng giá trị mà `services/articles-thumbnail-scan.ts` đồng bộ 492 bài về. */
const DEFAULT_COVER = '/assets/default_cover_light.png'

// Hai tệp, một chủ sở hữu: phần tra bài viết nằm ở `chat-policy-article-search.ts` (tách
// khi `chat-policy-provider.ts` vượt 400 dòng), phần quyết định nạp sẵn/tắt công cụ và
// khối prompt nằm ở provider. Test đọc cả hai, nên tách tệp không làm mất phép kiểm.
const providerSource = readFileSync(new URL('../server/services/chat-policy-provider.ts', import.meta.url), 'utf8')
const articleSource = readFileSync(new URL('../server/services/chat-policy-article-search.ts', import.meta.url), 'utf8')
const articleOwner = `${providerSource}\n${articleSource}`

/** Cùng biểu thức với `searchArticles` — giữ ở đây để test chặn một bản sửa lệch. */
const coverOf = (thumbnailUrl: string | null) => (thumbnailUrl && thumbnailUrl !== DEFAULT_COVER ? thumbnailUrl : null)

test('the portal default cover is reported as "no cover", not as the article image', () => {
  assert.equal(coverOf(DEFAULT_COVER), null, 'ảnh mặc định của cổng không phải ảnh của bài')
  assert.equal(coverOf(null), null, 'bài chưa đặt ảnh')
  assert.equal(coverOf('https://cdn1.delify.vn/2026/09/2026_06_11_15_44_36_82.jpg'), 'https://cdn1.delify.vn/2026/09/2026_06_11_15_44_36_82.jpg')
})

test('the article tool reports the same cover as the prefetched block (one owner)', () => {
  // Cả hai đường đọc bài viết phải qua `searchArticles`: nếu ai đó chép lại phép lọc
  // ảnh bìa ở một nhánh, nhánh kia sẽ lại nhúng ảnh vỡ.
  const coverFilterSites = articleOwner.split('!== DEFAULT_COVER_URL ?').length - 1
  assert.equal(coverFilterSites, 1, `phép lọc ảnh bìa phải có đúng MỘT chỗ trong phần tra bài viết (thấy ${coverFilterSites})`)
  assert.equal(/coverImage:\s*r\.thumbnailUrl\s*\|\|\s*null/.test(articleOwner), false, 'còn chỗ trả thẳng thumbnailUrl (nhúng ảnh placeholder)')
})

test('tools are disabled exactly when the prompt already carries references', () => {
  // Một cờ duy nhất quyết định cả danh sách công cụ LẪN lời nhắc "không còn công cụ".
  // Hai điều kiện tách rời (cờ theo `references.length`, lời nhắc theo `articleBlock`)
  // từng để lọt trường hợp: kho khớp nhưng không tìm được bài → công cụ tắt mà model
  // không được báo, nên nó vẫn viết lệnh gọi công cụ dưới dạng chữ.
  assert.match(providerSource, /const toolsOff = references\.length > 0/, 'cờ duy nhất theo references')
  assert.match(providerSource, /tools: toolsOff \? \[\] : chatbotTools,/, 'danh sách công cụ phải theo cờ')
  assert.equal(/tools:\s*chatbotTools,/.test(providerSource), false, 'còn nhánh gửi toàn bộ công cụ vô điều kiện')
  const notices = providerSource.split('KHÔNG còn công cụ tra cứu trong lượt này').length - 1
  assert.equal(notices, 1, `lời nhắc phải có đúng một chỗ (thấy ${notices})`)
  // Lời nhắc nằm trong nhánh của CÙNG cờ, không phải nhánh `articleBlock`.
  assert.match(providerSource, /toolsOff\s*\n\s*\? '\\n\\nKHÔNG còn công cụ/, 'lời nhắc phải treo trên toolsOff')
})

test('the prefetch only runs when the knowledge bank matched, and is bounded', () => {
  const line = /const prefetched = references\.length > 0 \? await searchArticles\(([^)]*)\) : \[\]/.exec(providerSource)
  assert.ok(line, 'phải nạp sẵn CHỈ khi references.length > 0 (câu không khớp kho cần giữ công cụ)')
  const limit = Number(line![1]!.split(',').at(-1)?.trim())
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 6, `trần bài nạp sẵn phải nhỏ, thấy ${limit}`)
})

test('the prefetched block tells the model to quote links and not to emit tool calls', () => {
  assert.match(providerSource, /<UNTRUSTED_ARTICLE_LINKS>/, 'khối bài viết phải nằm trong thẻ dữ liệu (prompt injection)')
  assert.match(providerSource, /KHÔNG viết lệnh gọi công cụ/, 'thiếu lệnh cấm model phát lệnh gọi khi công cụ đã tắt')
})

test('the article hit keeps its database id (a refactor silently dropped it)', () => {
  // `searchArticles` là MỘT hàm cho cả tool lẫn khối nạp sẵn. Một lần gộp đã bỏ `id` khỏi
  // projection và khỏi object trả về; mọi test chỉ đọc title/url vẫn xanh, còn model mất
  // tay nắm ổn định khi cùng một bài xuất hiện hai lượt. Luật ở đây đọc thẳng hai chỗ.
  assert.match(articleSource, /id:\s*articles\.id,/, 'projection phải lấy articles.id')
  assert.match(articleSource, /return \{\s*id:\s*r\.id,/, 'object trả về phải mang id')
  assert.match(articleSource, /id:\s*number\n\s*title:\s*string/, 'ArticleHit phải khai báo id')
})
