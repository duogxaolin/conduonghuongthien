/**
 * Hợp đồng của giao diện công khai Thư viện Video.
 *
 * Đây là **khẳng định trên văn bản mã nguồn**, không phải khẳng định về thứ người
 * dùng thấy — cùng ranh giới mà `tests/admin-error-retry-ui.test.ts` và
 * `tests/skeleton-loading-ui.test.ts` đã ghi rõ. Chúng chứng minh một nhánh còn
 * tồn tại và sẽ đỏ khi ai đó xoá nó; chúng **không** chứng minh khung chờ vẽ ra
 * đúng kích thước, hay trình đọc màn hình đọc đúng. Muốn biết điều đó cần một
 * trình duyệt thật.
 *
 * Vì sao vẫn đáng có: ba thứ dưới đây hỏng theo cách **im lặng**, và cả ba đều đã
 * có tiền lệ trong chính dự án này.
 *
 *   1. **Thư viện phát video lọt vào gói chính.** Không có gì đỏ: trang vẫn chạy,
 *      chỉ là mọi trang của cổng nặng thêm ~150KB. Phải grep bản **build** mới
 *      thấy; ở đây chỉ ghim được luật "không `import` tĩnh" trong mã nguồn.
 *   2. **Trạng thái mang danh tính người đọc lọt vào HTML dựng phía máy chủ.**
 *      `/media/**` phục vụ qua `swr: 60`, nên khối đó được phát lại cho người kế
 *      tiếp — kèm cờ cho biết bình luận nào của **người đang xem**.
 *   3. **Lượt đếm xem bắn từ máy chủ.** Con số vẫn trông hợp lý, chỉ cao hơn sự
 *      thật, và mỗi lượt dựng HTML lại tốn thêm một truy vấn.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { buildMasterPlaylist, isPlayable } from '../server/services/video-processing.ts'

const appRoot = new URL('../app/', import.meta.url)
const projectRoot = new URL('../', import.meta.url)

const read = (path: string) => readFileSync(new URL(path, appRoot), 'utf8')
const templateOf = (path: string) =>
  parse(read(path), { filename: path }).descriptor.template?.content ?? ''

/**
 * Mọi khẳng định "thứ này KHÔNG được xuất hiện" chạy trên văn bản **đã bỏ chú
 * thích**.
 *
 * Không có bước này thì chính dòng giải thích *vì sao* `v-html` là sai, hay *vì
 * sao* `import('hls.js')` chỉ được nằm một chỗ, sẽ làm đỏ cái test mà nó đang giải
 * thích — và bài học rút ra sẽ là xoá lời giải thích chứ không phải giữ guard.
 * Cùng cách `tests/public-qa-documents-page.test.ts` đã làm, và cùng lý do.
 */
const stripComments = (source: string) =>
  source
    // ⚠️ **Thứ tự là ràng buộc thật, không phải cách sắp cho gọn.** Chú thích khối
    // phải đi **sau** chú thích HTML, vì khối `<!-- -->` đầu tệp có chứa chuỗi
    // `/media/**` — dấu `/**` đó mở một "chú thích khối" mà dấu đóng gần nhất là
    // JSDoc đầu tiên trong `<script>`. Chạy `/* */` trước sẽ **nuốt trọn** phần
    // template và phần import nằm giữa hai dấu đó, và triệu chứng là ba khẳng định
    // đỏ với thông báo ngược hẳn sự thật ("không còn luồng bình luận" trong khi
    // `<ArticleComments>` vẫn nằm đó). Đã trả giá đúng một lần.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `[^:]` giữ `https://` khỏi bị cắt như một chú thích dòng.
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

/** Văn bản mã nguồn, đã bỏ chú thích. */
const code = (path: string) => stripComments(read(path))
/** Phần template, đã bỏ chú thích. */
const templateCode = (path: string) => stripComments(templateOf(path))

const LISTING = 'pages/media/index.vue'
const DETAIL = 'pages/media/[slug].vue'
const PLAYER = 'components/MediaPlayer.vue'
const LIVE_HERO = 'components/LiveHero.vue'
const DEFAULT_HERO = 'components/MediaDefaultHero.vue'
const HLS_COMPOSABLE = 'composables/useHlsVideo.ts'

/** Mọi tệp `.vue`/`.ts` dưới `app/` và `server/`. */
function walkSource(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, projectRoot), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.nuxt' || entry.name === '.output') continue
        walk(`${child}/`)
        continue
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) found.push(child)
    }
  }
  walk(root)
  return found
}

// ─── 14.4: thư viện phát video chỉ được nạp SAU khi trang mount ──────────────

test('không tệp nào trong app/ hay server/ import TĨNH thư viện phát video', () => {
  /**
   * `import` tĩnh ở tầng kiểu cũng tính. `import type Hls from 'hls.js'` biến gói
   * thành một phụ thuộc thời gian biên dịch của mọi tệp chạm tới nó, và đó đúng là
   * thứ tệp composable ghi rõ nó tránh — một `import type` bị xoá lúc biên dịch
   * nhưng vẫn kéo theo một phụ thuộc mà trình đóng gói nhìn thấy.
   */
  const offenders: string[] = []
  for (const file of [...walkSource('app/'), ...walkSource('server/')]) {
    // Đã bỏ chú thích: chính docstring của composable **nêu tên** dạng import bị
    // cấm để giải thích vì sao nó bị cấm, và một phép soi thô sẽ đỏ vì lời giải
    // thích đó — dạy người sau xoá lời giải thích thay vì giữ guard.
    const source = stripComments(readFileSync(new URL(file, projectRoot), 'utf8'))
    // `import('hls.js')` động KHÔNG khớp: dấu `(` đứng giữa `import` và dấu nháy.
    for (const pattern of [/\bfrom\s+['"](hls\.js|plyr)['"]/, /\brequire\(\s*['"](hls\.js|plyr)['"]\s*\)/]) {
      if (pattern.test(source)) offenders.push(`${file} (${pattern})`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `thư viện phát video bị import tĩnh — nó sẽ vào gói chính cho MỌI trang: ${offenders.join(', ')}`,
  )
})

test('toàn dự án có ĐÚNG MỘT chuỗi import động tới thư viện phát video', () => {
  /**
   * Hai bản sao là hai chỗ để một bản lỡ dùng `import` tĩnh mà không có gì đỏ ở
   * đâu cả. Ghim số lần xuất hiện, không chỉ ghim sự tồn tại: một phép tìm đơn lẻ
   * vẫn xanh khi bản sao thứ hai mọc lên ở một tệp khác.
   */
  const hits: string[] = []
  for (const file of [...walkSource('app/'), ...walkSource('server/')]) {
    const source = stripComments(readFileSync(new URL(file, projectRoot), 'utf8'))
    if (/import\(\s*['"]hls\.js['"]\s*\)/.test(source)) hits.push(file)
  }
  assert.deepEqual(hits, ['app/composables/useHlsVideo.ts'], 'chuỗi nạp hls.js phải nằm đúng một chỗ')
})

test('`MediaPlayer.vue` chọn cơ chế theo `source` và nói ra khi không phát được', () => {
  const source = code(PLAYER)

  // Hai cơ chế, chọn theo `source` của chính mục — không theo một cờ cấu hình.
  assert.match(source, /item\.source === 'youtube'/, 'mất nhánh nguồn ngoài')
  assert.match(source, /item\.playable && item\.streamUrl/, 'mất nhánh video tự lưu trữ')

  // Nhánh "chưa có bản nào sẵn sàng" phải là một câu giải thích, không phải một
  // trình phát rỗng: `playable: false` là tín hiệu duy nhất mà máy chủ gửi ra.
  assert.match(source, /Video đang được xử lý/, 'mất lời giải thích khi chưa có bản sẵn sàng')

  // Nguồn ngoài nhúng thẳng miền không cookie do máy chủ dựng sẵn.
  assert.match(source, /:src="item\.embedUrl"/, 'nhánh nguồn ngoài không dùng đường dẫn máy chủ dựng')
  assert.doesNotMatch(source, /youtube\.com\/iframe_api/, 'nạp SDK của nền tảng ngoài')
  assert.doesNotMatch(source, /youtube\.com(?!-nocookie)/, 'trỏ tới miền không phải bản không cookie')

  // Không `v-html`: tiêu đề và mô tả là chữ do cán bộ gõ.
  assert.doesNotMatch(source, /v-html/, 'nội dung do cán bộ gõ đi qua v-html')
})

test('composable HLS không nạp thư viện khi trình duyệt đã phát HLS gốc', () => {
  // Safari/iOS có bộ giải mã HLS gốc. Nạp 150KB rồi mới phát hiện điều đó là bắt
  // người dùng trả giá cho sự lười.
  const source = code(HLS_COMPOSABLE)
  const nativeCheck = source.indexOf("canPlayType('application/vnd.apple.mpegurl')")
  const dynamicLoad = source.indexOf("await import('hls.js')")
  assert.ok(nativeCheck > -1, 'mất phép kiểm HLS gốc')
  assert.ok(dynamicLoad > -1, 'mất lượt nạp động')
  assert.ok(nativeCheck < dynamicLoad, 'phép kiểm HLS gốc phải chạy TRƯỚC khi nạp thư viện')
})

/**
 * 14.4 đòi hai điều về **chất lượng bản phát**, và cả hai nằm ở phía máy chủ chứ
 * không ở trình phát — nên chúng không kiểm được bằng cách đọc `MediaPlayer.vue`.
 *
 * "Lùi về bản sẵn sàng cao nhất" **không** phải một nhánh `if` trong trình phát:
 * `master.m3u8` chỉ liệt kê những bản đã cắt xong (`buildMasterPlaylist` nhận
 * `ready`, không nhận kế hoạch), và hls.js tự chọn theo ABR trong số đó. Một phép
 * kiểm "có nhánh lùi" trong tệp giao diện sẽ là một khẳng định về thứ không tồn
 * tại — nó xanh mãi mãi và không chặn được gì.
 *
 * Thứ kiểm được là **hình dạng dữ liệu**: bản chưa sẵn sàng không được lọt vào
 * playlist, và "không bản nào sẵn sàng" phải ra `playable: false` để giao diện có
 * đường nói ra thay vì dựng một khung đen.
 */
test('playlist chỉ liệt kê bản đã sẵn sàng, và mục không bản nào là không phát được', () => {
  const playlist = buildMasterPlaylist([
    { name: '360p', height: 360, width: 640, bandwidth: 896_000 },
  ])
  assert.match(playlist, /360p\/index\.m3u8/, 'bản đã sẵn sàng không vào playlist')
  assert.doesNotMatch(playlist, /720p/, 'bản chưa cắt xong lọt vào playlist — liên kết chết giữa lượt phát')

  // `isPlayable` là **điều kiện duy nhất** sinh ra `playable` trong
  // `serializePublicMedia`, và `streamUrl` chỉ được dựng khi nó đúng.
  assert.equal(isPlayable({ processingStatus: 'ready', resolutionsReady: [] }), false,
    'không bản nào sẵn sàng nhưng vẫn khai là phát được')
  assert.equal(isPlayable({ processingStatus: 'processing', resolutionsReady: ['360p'] }), true,
    'một bản đã xong là đủ để phát — công bố lũy tiến không được chặn ở đây')
})

// ─── 14.2: trang danh sách ───────────────────────────────────────────────────

test('trang danh sách tách được đang tải / lỗi / rỗng thành ba nhánh riêng', () => {
  const template = templateOf(LISTING)

  assert.match(template, /v-if="pending"/, 'mất nhánh đang tải')
  assert.match(template, /v-else-if="loadError"/, 'mất nhánh lỗi')
  assert.match(template, /v-else-if="!items\.length"/, 'mất nhánh rỗng')

  // Ba nhánh phải theo thứ tự này. Đảo nhánh rỗng lên trước nhánh lỗi thì một lượt
  // truy vấn hỏng hiện ra y hệt "cổng chưa đăng gì" — và người đọc kế tiếp đi tạo
  // lại nội dung đã có.
  const pending = template.indexOf('v-if="pending"')
  const error = template.indexOf('v-else-if="loadError"')
  const empty = template.indexOf('v-else-if="!items.length"')
  assert.ok(pending < error && error < empty, 'thứ tự ba nhánh trạng thái đã đổi')
})

test('khung chờ của trang danh sách tự khai báo với trợ năng', () => {
  const template = templateOf(LISTING)
  const block = template.slice(template.indexOf('v-if="pending"'), template.indexOf('v-else-if="loadError"'))

  assert.match(block, /role="status"/, 'khung chờ không được thông báo là vùng trạng thái')
  assert.match(block, /aria-busy="true"/, 'khung chờ không khai là đang bận')
  assert.match(block, /sr-only/, 'thiếu nhãn đọc được cho trình đọc màn hình')
  assert.match(block, /aria-hidden="true"/, 'các ô xám phải bị ẩn khỏi trợ năng')

  // Từng thẻ một, không theo cả tệp: một tệp có hai khung chờ mà chỉ một cái được
  // gắn guard vẫn phải trượt.
  for (const tag of block.match(/<[^>]*animate-pulse[^>]*>/g) ?? []) {
    assert.match(tag, /motion-reduce:animate-none/, `khung chờ thiếu guard chuyển động: ${tag.slice(0, 120)}`)
  }
})

test('nhánh lỗi của trang danh sách là alert và thử lại đúng lượt gọi đã hỏng', () => {
  const template = templateCode(LISTING)
  const source = code(LISTING)

  const block = template.slice(template.indexOf('v-else-if="loadError"'), template.indexOf('v-else-if="!items.length"'))
  assert.match(block, /role="alert"/, 'nhánh lỗi không được thông báo cho trình đọc màn hình')

  // Nút thử lại trỏ vào một hàm **có khai báo trong cùng tệp**, và hàm đó gọi
  // `refresh()` — chạy lại chính lượt fetch đã hỏng, không tải lại trang.
  const handler = block.match(/@click="(\w+)"/)?.[1] ?? ''
  assert.ok(handler, 'nhánh lỗi không có nút thử lại')
  assert.match(source, new RegExp(`function ${handler}\\(`), `nút thử lại trỏ vào ${handler} nhưng tệp không khai báo hàm đó`)
  assert.match(source, /refresh\(\)/, 'nút thử lại không chạy lại chính lượt fetch đã hỏng')

  assert.doesNotMatch(source, /location\.reload\(\)/, 'tải lại cả trang để chạy lại một request')
})

test('trang danh sách đọc `ok: false` của máy chủ thay vì đoán từ mảng rỗng', () => {
  /**
   * Máy chủ cố ý trả **cùng một hình dạng** ở cả hai nhánh, khác đúng trường `ok`
   * (`index.get.ts`). Suy từ `items.length === 0` là gộp một lượt truy vấn hỏng vào
   * "chưa đăng gì" — đúng thứ mà hình dạng đó tồn tại để ngăn.
   */
  const source = code(LISTING)
  assert.match(source, /data\.value\?\.ok === false/, 'nhánh lỗi không đọc trường `ok`')
  assert.match(source, /!!error\.value/, 'nhánh lỗi không bắt cả lượt fetch hỏng')
})

test('bộ lọc của trang danh sách nằm trong URL và số trang không tự kẹp biên', () => {
  const source = code(LISTING)

  // Chia sẻ được và sống qua F5 — cùng lối `/qa-documents` và `/documents`.
  assert.match(source, /route\.query/, 'bộ lọc không đọc từ URL')
  assert.match(source, /navigateTo\(\{ path: '\/media'/, 'bộ lọc không ghi lại vào URL')

  // `Math.max(1, Number('abc'))` là `NaN` — mọi so sánh với `NaN` đều `false`, nên
  // `Math.max` trả lại chính `NaN`, và nó đi thẳng vào query string.
  assert.doesNotMatch(source, /Math\.max\(1,\s*Number\(/, 'kẹp biên trần: `NaN` lọt qua và thành `?page=NaN`')
  assert.match(source, /Number\.isFinite/, 'không kiểm hữu hạn trước khi dùng số trang')
})

test('trang danh sách lọc lại từ URL khi URL đổi vì lý do khác', () => {
  // Nút Back của trình duyệt và một liên kết nội bộ trỏ tới `/media?category=…`
  // đều dùng lại chính component này. Không có lượt đọc lại thì thanh địa chỉ đổi
  // mà danh sách thì không.
  assert.match(code(LISTING), /watch\(\(\) => route\.query/, 'bộ lọc không theo dõi thay đổi của URL')
})

// ─── 14.3: trang chi tiết ────────────────────────────────────────────────────

test('trang chi tiết để luồng bình luận nạp từ trình duyệt sau mount', () => {
  /**
   * Ràng buộc an toàn bộ nhớ đệm, không phải chi tiết kỹ thuật: `/media/**` phục vụ
   * qua `swr: 60`, nên HTML dựng phía máy chủ được phát lại cho người kế tiếp —
   * kèm cờ `canDelete` cho biết bình luận nào là của **người đang xem**.
   */
  const source = code(DETAIL)

  assert.match(source, /<ArticleComments/, 'trang chi tiết không còn luồng bình luận')
  assert.match(source, /:media-item-id="item\.id"/, 'luồng bình luận không được nói đây là mục media')

  // Trang này KHÔNG được tự đọc danh tính người đọc: chính danh tính đó là thứ
  // không được phép vào HTML đệm. `ArticleComments` tự nạp nó sau mount.
  assert.doesNotMatch(source, /useReaderAuth/, 'trang chi tiết tự đọc danh tính người đọc')
  assert.doesNotMatch(source, /cdkt_reader/, 'trang chi tiết chạm vào vé phiên của người đọc')
})

test('trang chi tiết chỉ đếm lượt xem và nạp cột phụ từ trình duyệt', () => {
  /**
   * Trang phục vụ qua `swr: 60`: người đọc thứ hai trở đi trong mỗi cửa sổ 60 giây
   * **không chạm vào mã máy chủ nào**. Đếm phía máy chủ sẽ thiếu đúng bằng phần mà
   * bộ nhớ đệm đang phát huy tác dụng — và con số thiếu đó trông vẫn hợp lý.
   *
   * `lazy: true` chỉ bỏ chặn điều hướng **phía client**; lượt dựng phía máy chủ vẫn
   * chờ dữ liệu, nên `item` đã khác `null` khi `watch(..., { immediate: true })`
   * chạy trên máy chủ. Thiếu chốt `import.meta.client` là mỗi lượt dựng HTML gửi
   * một lượt đếm từ địa chỉ của chính máy chủ.
   */
  const source = code(DETAIL)

  assert.match(source, /import\.meta\.client/, 'thiếu chốt chỉ chạy ở trình duyệt')
  const watchBlock = source.slice(source.indexOf('watch(item'), source.indexOf('watch(item') + 500)
  assert.match(watchBlock, /import\.meta\.client/, 'lượt đếm xem vẫn chạy trên máy chủ')
  assert.match(source, /pingView\(/, 'mất lượt đếm xem')
})

test('trang chi tiết dùng `lazy` và vẫn giữ đủ bốn nhánh trạng thái', () => {
  const template = templateCode(DETAIL)
  assert.match(code(DETAIL), /lazy: true/, 'thiếu `lazy` — khung xương không bao giờ được vẽ khi đổi trang')

  assert.match(template, /v-if="pending"/, 'mất nhánh đang tải')
  assert.match(template, /v-else-if="loadError"/, 'mất nhánh lỗi')
  assert.match(template, /v-else-if="!item"/, 'mất nhánh không tìm thấy')
  assert.match(template, /<MediaPlayer/, 'mất nhánh có dữ liệu')
})

test('trang chi tiết không mời thử lại một slug sẽ không bao giờ tồn tại', () => {
  // 404 là một câu trả lời hợp lệ, không phải một lượt hỏng. Gộp hai thứ đó là mời
  // người đọc bấm "Thử lại" cho một việc chắc chắn thất bại.
  const source = code(DETAIL)
  assert.match(source, /const loadError = computed\(\(\) => !!error\.value\)/, 'lỗi mạng và 404 lại bị gộp làm một')
  const template = templateCode(DETAIL)
  const notFound = template.slice(template.indexOf('v-else-if="!item"'), template.indexOf('<MediaPlayer'))
  assert.doesNotMatch(notFound, /@click="reload"/, 'nhánh không-tìm-thấy mời thử lại')
})

test('trang chi tiết định dạng ngày bằng bộ đọc UTC', () => {
  // Giá trị đến từ cột DATETIME và trang được dựng ở cả hai phía; một bộ định dạng
  // theo giờ cục bộ cho ra hai ngày khác nhau giữa HTML máy chủ và trình duyệt.
  const source = code(DETAIL)
  assert.match(source, /import \{ formatDateVN \} from '~\/utils\/formatDate'/, 'không dùng bộ định dạng UTC')
  assert.doesNotMatch(source, /\.get(Date|Month|FullYear)\(\)/, 'định dạng ngày theo giờ cục bộ')
})

// ─── 14.6: hero buổi phát ────────────────────────────────────────────────────

test('hero buổi phát hỏi trạng thái SAU mount và lùi về hero mặc định', () => {
  const source = code(LIVE_HERO)

  // Sau mount, không phải trong lượt dựng phía máy chủ: `/media` phục vụ qua
  // `swr: 60`, và một buổi phát có thể bắt đầu hoặc kết thúc bên trong cửa sổ đó.
  assert.match(source, /onMounted\(/, 'không hỏi trạng thái sau mount')
  assert.doesNotMatch(source, /useFetch\(|useAsyncData\(/, 'trạng thái buổi phát lọt vào HTML đệm')

  // Mọi nhánh hỏng đều lùi về hero mặc định — không nhánh nào làm trống đầu trang.
  assert.match(templateCode(LIVE_HERO), /<MediaDefaultHero v-else/, 'mất đường lùi về hero mặc định')
  assert.match(source, /catch \{/, 'lượt hỏi hỏng không được nuốt')
})

test('hero mặc định thuần trình bày, không tự đi lấy dữ liệu', () => {
  // Tách đôi để mỗi bên kiểm được một mình: khối này là hình dạng của một tiêu đề
  // trang, bên kia là một lượt gọi mạng có ba nhánh.
  const source = code(DEFAULT_HERO)
  assert.doesNotMatch(source, /\$fetch|useFetch\(|useAsyncData\(/, 'hero mặc định tự đi lấy dữ liệu')
  // Từng thẻ một, không theo cả tệp: đây là nội dung thật, không phải khung chờ, và
  // một khối trang trí nhấp nháy trong khi không tải gì là dạy người đọc rằng chuyển
  // động trên trang này không mang thông tin gì.
  for (const tag of templateCode(DEFAULT_HERO).match(/<[^>]*animate-pulse[^>]*>/g) ?? []) {
    assert.fail(`hero mặc định chứa một khối nhấp nháy: ${tag.slice(0, 120)}`)
  }
})

test('hero mặc định nhận câu mô tả qua prop, không viết cứng', () => {
  assert.match(code(DEFAULT_HERO), /description\?: string/, 'mất prop mô tả')
})

// ─── Không `v-html` ở bất cứ đâu trong giao diện công khai mới ───────────────

test('không tệp giao diện công khai nào của thư viện video dùng v-html', () => {
  // Tiêu đề, mô tả và nội dung bình luận là chữ do cán bộ hoặc công dân gõ. Máy chủ
  // lưu nguyên văn chính vì template không được phép diễn giải nó.
  for (const file of [LISTING, DETAIL, PLAYER, LIVE_HERO, DEFAULT_HERO]) {
    assert.doesNotMatch(code(file), /v-html/, `${file} dùng v-html`)
  }
})
