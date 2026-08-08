/**
 * Favicon do quản trị viên cấu hình — biên tin cậy, và hai allowlist phải khớp nhau.
 *
 * Giá trị `favicon_url` đi từ một ô nhập ở `/admin/settings/general`, qua cột
 * `settings`, rồi vào thuộc tính `href` của một thẻ `<link>` trên **mọi** trang
 * của cổng — kể cả `/admin`. Đó là cùng loại đường đi mà `nav-config.ts` và
 * `chatbot-storage.ts` đã được tách ra để kiểm: dữ liệu không do mình viết, đi
 * thẳng vào HTML.
 *
 * Lý do tệp test này tồn tại, cụ thể: `public/favicon.ico` cũ **không phải một
 * icon**. Nó là một trang HTML (`<!DOCTYPE html PUBLIC …`, 1245 byte) lọt vào từ
 * commit đầu tiên, và production phục vụ nó với `content-type:
 * image/vnd.microsoft.icon` kèm mã `200`. Không có gì hỏng, không có log nào, và
 * cổng thì không có favicon suốt thời gian đó. Một tệp nhị phân sai chỗ không tự
 * báo, nên phép kiểm phải nhìn vào **byte**, không nhìn vào mã trạng thái.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { describe, it, test } from 'node:test'

import {
  DEFAULT_APPLE_ICON_URL,
  DEFAULT_FAVICON_URL,
  buildFaviconTags,
  faviconMimeType,
  safeFaviconUrl,
} from '../server/utils/favicon.ts'
import { DEFAULT_ICO_FILENAME, wrapPngAsIco } from '../server/utils/favicon-image.ts'
import {
  EXT_BY_IMAGE_MIME,
  detectImageMime,
  isSharpDecodable,
  type DetectedImageMime,
} from '../server/utils/image-mime.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/**
 * Bỏ comment trước khi khẳng định một chuỗi **không** xuất hiện.
 *
 * Cùng cách `tests/public-qa-documents-page.test.ts` đã làm, và vì cùng một lý do
 * đã trả giá: chính dòng giải thích *vì sao* `immutable` là sai ở tuyến
 * `/favicon.ico` sẽ làm đỏ cái test nó đang giải thích. Bài học rút ra từ một test
 * như thế là xoá lời giải thích, không phải giữ guard.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // `[^:]` giữ `https://` khỏi bị coi là comment một dòng.
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1')

const readCode = (path: string) => stripComments(read(path))

// ─── safeFaviconUrl: mọi giá trị không dùng được ra null ─────────────────────

describe('safeFaviconUrl — biên tin cậy', () => {
  /**
   * Từng dạng một, để khi test đỏ thì thông báo chỉ thẳng vào dạng đã lọt.
   *
   * `//evil.com` là ca dễ bỏ sót nhất: trình duyệt đọc URL tương đối giao thức là
   * **tuyệt đối**, nên một phép kiểm "bắt đầu bằng /" là chưa đủ.
   */
  const MUST_BE_NULL: Array<[string, unknown]> = [
    ['không phải chuỗi', 42],
    ['null', null],
    ['undefined', undefined],
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['javascript:', 'javascript:alert(1)'],
    ['JavaScript: hoa thường lẫn lộn', 'JaVaScRiPt:alert(1)'],
    ['java\\tscript: có tab chèn giữa', 'java\tscript:alert(1)'],
    ['data:image/svg+xml', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['data:image/png', 'data:image/png;base64,iVBORw0KGgo='],
    ['URL tương đối giao thức', '//evil.com/x.png'],
    ['http:// (mixed content)', 'http://example.com/x.png'],
    ['ftp://', 'ftp://example.com/x.png'],
    ['đường dẫn có dấu gạch chéo ngược', '/\\evil.com/x.png'],
    ['đường dẫn có dấu ngoặc kép', '/x".png'],
    ['đường dẫn có dấu nháy đơn', "/x'.png"],
    ['đường dẫn có dấu ngoặc nhọn', '/x<svg>.png'],
    ['đường dẫn có ký tự xuống dòng', '/x.png\n<script>'],
    ['đường dẫn có CR', '/x.png\r\nX-Injected: 1'],
    ['đường dẫn có khoảng trắng bên trong', '/my icon.png'],
    ['đường dẫn có userinfo', '/x@evil.com/y.png'],
    ['đường dẫn mang scheme lẫn vào', '/x:y.png'],
    ['không phải đường dẫn cũng không phải https', 'favicon.png'],
    ['https:// không có host', 'https://'],
    ['https:// rồi tới gạch chéo', 'https:///x.png'],
    ['https:// có userinfo trong host', 'https://evil.com@real.com/x.png'],
    ['https://@ ngay đầu', 'https://@evil.com/x.png'],
  ]

  for (const [label, value] of MUST_BE_NULL) {
    it(`${label} → null (lùi về mặc định)`, () => {
      assert.equal(
        safeFaviconUrl(value),
        null,
        `${label} lọt vào href của <link rel="icon"> trên mọi trang của cổng`,
      )
    })
  }

  const MUST_BE_ACCEPTED: Array<[string, string]> = [
    ['đường dẫn tương đối', '/favicon-32.png'],
    ['đường dẫn upload cục bộ', '/uploads/2026/08/1234_icon.png'],
    ['đường dẫn .ico', '/favicon.ico'],
    ['https tuyệt đối (R2)', 'https://cdn.example.com/icon.png'],
    ['https có query', 'https://cdn.example.com/icon.png?v=2'],
    ['HTTPS viết hoa', 'HTTPS://cdn.example.com/icon.png'],
  ]

  for (const [label, value] of MUST_BE_ACCEPTED) {
    it(`${label} → nhận`, () => {
      assert.equal(safeFaviconUrl(value), value, `${label} bị từ chối oan`)
    })
  }

  /**
   * `https://` là nhánh bắt buộc, không phải tiện nghi.
   *
   * `uploadR2File` sinh URL tuyệt đối (`server/utils/media-r2.ts:41`), nên bỏ
   * nhánh này là làm tính năng hỏng **chỉ trên** deployment đã bật Cloudflare R2 —
   * và hỏng im lặng: cán bộ chọn tệp từ Thư viện Media, lưu thành công, rồi
   * favicon lùi về mặc định mà không có gì giải thích.
   */
  it('nhận URL tuyệt đối vì lưu trữ R2 sinh ra chúng', () => {
    assert.ok(safeFaviconUrl('https://pub-abc.r2.dev/2026/08/icon.png'))
  })

  it('cắt khoảng trắng hai đầu thay vì từ chối', () => {
    assert.equal(safeFaviconUrl('  /favicon-32.png  '), '/favicon-32.png')
  })

  it('từ chối giá trị dài quá mức thay vì cắt bớt', () => {
    assert.equal(safeFaviconUrl('/' + 'a'.repeat(600) + '.png'), null)
  })

  it('giữ nguyên chữ hoa thường của phần sau scheme', () => {
    // Scheme không phân biệt hoa thường, phần còn lại của URL thì có — nên giá
    // trị TRẢ VỀ phải là chuỗi gốc, không phải chuỗi đã hạ chữ.
    const url = 'https://CDN.example.com/Icon-Xyz.PNG'
    assert.equal(safeFaviconUrl(url), url)
  })
})

// ─── faviconMimeType: khai đúng hoặc không khai ──────────────────────────────

describe('faviconMimeType', () => {
  it('suy được kiểu từ các đuôi đã biết', () => {
    assert.equal(faviconMimeType('/x.png'), 'image/png')
    assert.equal(faviconMimeType('/x.ico'), 'image/x-icon')
    assert.equal(faviconMimeType('/x.gif'), 'image/gif')
    assert.equal(faviconMimeType('/x.jpg'), 'image/jpeg')
    assert.equal(faviconMimeType('/x.jpeg'), 'image/jpeg')
    assert.equal(faviconMimeType('/x.webp'), 'image/webp')
  })

  it('bỏ query và fragment trước khi đọc đuôi', () => {
    assert.equal(faviconMimeType('/x.png?v=2'), 'image/png')
    assert.equal(faviconMimeType('/x.png#frag'), 'image/png')
  })

  it('không phân biệt hoa thường ở đuôi tệp', () => {
    assert.equal(faviconMimeType('/X.PNG'), 'image/png')
  })

  /**
   * `null` chứ không phải một giá trị đoán bừa.
   *
   * Trình duyệt dùng `type` để chọn giữa nhiều thẻ icon, nên một nhãn sai khiến
   * nó bỏ qua đúng tệp đang dùng được. Không có `type` thì nó tự dò theo nội
   * dung — đó là hành vi đúng khi mình không biết chắc.
   */
  it('trả null cho đuôi lạ thay vì đoán', () => {
    assert.equal(faviconMimeType('/x.bmp'), null)
    assert.equal(faviconMimeType('/x'), null)
    assert.equal(faviconMimeType('/uploads/no-extension'), null)
  })

  /**
   * Cố ý KHÔNG có nhánh `.svg`. Một favicon SVG là tài liệu thực thi được, và dự
   * án đã có quy tắc không bao giờ phục vụ SVG inline (`sanitize-html.ts`,
   * `upload.post.ts`). Khai `type` cho nó ở đây là mời một lần refactor sau này
   * nhận luôn cả tệp .svg.
   */
  it('không khai kiểu cho SVG', () => {
    assert.equal(faviconMimeType('/x.svg'), null)
  })
})

// ─── buildFaviconTags ───────────────────────────────────────────────────────

describe('buildFaviconTags', () => {
  it('luôn có một thẻ rel="icon"', () => {
    const tags = buildFaviconTags('/favicon-32.png')
    assert.ok(tags.some(tag => tag.rel === 'icon'), 'không có thẻ icon nào')
  })

  it('bỏ hẳn thuộc tính type khi không suy được', () => {
    const tags = buildFaviconTags('/uploads/no-extension')
    const icon = tags.find(tag => tag.rel === 'icon')
    assert.equal(icon?.type, undefined, 'một type khai sai còn tệ hơn không khai')
  })

  it('lùi về mặc định khi URL không dùng được', () => {
    for (const bad of ['javascript:alert(1)', '//evil.com/x.png', '']) {
      const tags = buildFaviconTags(bad)
      const icon = tags.find(tag => tag.rel === 'icon')
      assert.equal(icon?.href, DEFAULT_FAVICON_URL, `${bad} không được lùi về mặc định`)
      for (const tag of tags) {
        assert.doesNotMatch(tag.href, /javascript:|evil\.com/, 'giá trị độc lọt vào thẻ')
      }
    }
  })

  /**
   * Icon iOS đi theo favicon đã cấu hình, và **chỉ** dùng bản 180×180 khi cổng
   * còn dùng bộ mặc định.
   *
   * Đây là chỗ giả định đầu tiên của em đã sai theo hướng ngược lại: em từng cho
   * rằng nên **bỏ** `apple-touch-icon` khi cán bộ đặt icon riêng, để iOS không
   * phóng to một ảnh 32px. Nhưng hậu quả của việc bỏ nó là màn hình chính iOS lùi
   * về icon mặc định — tức là **logo cũ của cổng nằm cạnh logo mới của cơ quan**,
   * và không có gì trên trang cài đặt nói ra điều đó. Một icon hơi mờ vẫn là icon
   * đúng; một icon đúng nét nhưng sai nhận diện thì không.
   *
   * Bản 180×180 chỉ dùng cho trường hợp mặc định vì đó là lúc duy nhất ta **biết
   * chắc** mình có sẵn tệp đúng cỡ trên đĩa.
   */
  it('icon iOS đi theo favicon đã cấu hình', () => {
    const withDefault = buildFaviconTags(DEFAULT_FAVICON_URL)
    assert.ok(
      withDefault.some(tag => tag.rel === 'apple-touch-icon' && tag.href === DEFAULT_APPLE_ICON_URL),
      'bộ mặc định phải dùng bản 180px có sẵn trên đĩa',
    )

    const custom = '/uploads/2026/08/custom.png'
    const withCustom = buildFaviconTags(custom)
    assert.ok(
      withCustom.some(tag => tag.rel === 'apple-touch-icon' && tag.href === custom),
      'icon iOS còn trỏ tệp mặc định: màn hình chính sẽ hiện logo cũ cạnh logo mới',
    )
  })

  /**
   * Hàm này **tự** validate, không tin nơi gọi đã validate.
   *
   * Bản đầu nhận "một URL đã được chấp nhận" — một hợp đồng chỉ tồn tại trong lời
   * văn, nên nơi gọi thứ hai về sau không có gì nhắc nó phải kiểm trước. Đây là
   * chỗ duy nhất dựng ra thẻ icon, nên phép kiểm nằm ở đây thì mọi đường tới HTML
   * đều đã đi qua nó.
   */
  it('tự khử độc đầu vào thay vì tin nơi gọi', () => {
    for (const bad of ['javascript:alert(1)', '//evil.com/x.png', 42, null, undefined]) {
      const tags = buildFaviconTags(bad)
      for (const tag of tags) {
        assert.doesNotMatch(
          tag.href,
          /javascript:|evil\.com/,
          `giá trị ${String(bad)} lọt vào href của thẻ icon`,
        )
      }
    }
  })
})

// ─── Tệp mặc định phải là ẢNH THẬT, không phải HTML ──────────────────────────

describe('tệp favicon mặc định', () => {
  /**
   * Đây là phép kiểm đã phát hiện lỗi gốc, và nó nhìn vào **byte**.
   *
   * `public/favicon.ico` cũ trả `200` với `content-type` của icon trong khi nội
   * dung là HTML. Một phép kiểm theo mã trạng thái, theo sự tồn tại của tệp, hay
   * theo đuôi tệp đều **xanh** với tệp đó.
   */
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  for (const url of [DEFAULT_FAVICON_URL, DEFAULT_APPLE_ICON_URL]) {
    it(`${url} tồn tại và là PNG thật`, () => {
      const path = new URL(`../public${url}`, import.meta.url)
      assert.ok(existsSync(path), `${url} không có trên đĩa — chạy npm run make:favicon`)

      const head = readFileSync(path).subarray(0, 4)
      assert.ok(
        head.equals(PNG_MAGIC),
        `${url} không phải PNG (4 byte đầu: ${head.toString('hex')}). ` +
        'Đúng lỗi mà public/favicon.ico cũ mang: một tệp HTML mang tên icon.',
      )
    })
  }

  /**
   * `public/favicon.ico` phải VẮNG, và khẳng định này đã bị đảo ngược hai lần.
   *
   * Bản đầu đòi tệp phải vắng ("tệp hỏng thì xoá"). Rồi phép đo cho thấy xoá đi
   * không ra 404 mà ra placeholder của Nitro (`200`, `content-type: image/x-icon`,
   * thân là chuỗi `data:image/gif;base64,…`), nên khẳng định đổi thành "phải có
   * mặt và mang byte thật".
   *
   * Phép đo thứ ba mới cho ra câu trả lời đúng, và nó phản trực giác: một tệp tĩnh
   * ở `public/favicon.ico` **thắng** route handler cùng đường dẫn, nên nó làm
   * `server/routes/favicon.ico.ts` **không bao giờ chạy** — favicon cán bộ cấu
   * hình bị bỏ qua ở đúng đường dẫn mà máy quét gọi tới. Còn tệ hơn: tệp có lúc
   * build rồi mất lúc chạy thì manifest tĩnh vẫn khai nó còn, `readFile` ném
   * `ENOENT`, và khách nhận **500** chứ không phải 404.
   *
   * Nên bộ mặc định mang tên `favicon-default.ico` và tuyến sở hữu đường dẫn.
   */
  it('không có tệp tĩnh favicon.ico che tuyến động', () => {
    assert.ok(
      !existsSync(new URL('../public/favicon.ico', import.meta.url)),
      'public/favicon.ico đã quay lại — tệp tĩnh thắng route, nên favicon đã cấu hình sẽ bị bỏ qua ở /favicon.ico',
    )
  })

  it('script sinh icon có trong repo để lượt sinh này tái lập được', () => {
    assert.ok(existsSync(new URL('../scripts/make-favicon.ts', import.meta.url)))
  })
})

// ─── Hai allowlist phải khớp nhau ────────────────────────────────────────────

/**
 * `favicon_url` phải có ở **cả hai** danh sách, và thiếu một bên nào cũng hỏng im
 * lặng theo một hướng khác nhau:
 *  - thiếu ở `ALLOWED_SETTING_KEYS` → biểu mẫu trả 400 "Khóa cài đặt không hợp lệ",
 *    và vì nó gửi cả object settings nên **toàn bộ** lượt lưu bị từ chối, không
 *    chỉ ô favicon;
 *  - thiếu ở endpoint công khai → lưu được nhưng không nơi nào ngoài admin đọc
 *    được. Đó đúng là hình dạng của `logo_url` hôm nay (xem mục "Ngoài phạm vi").
 */
test('favicon_url ghi được qua endpoint cài đặt', () => {
  const code = read('server/api/admin/settings/index.put.ts')
  assert.match(code, /'favicon_url'/, 'thiếu trong ALLOWED_SETTING_KEYS → cả biểu mẫu trả 400')
})

test('favicon_url không bị xếp vào nhóm chỉ SuperAdmin', () => {
  const code = read('server/api/admin/settings/index.put.ts')
  const gated = /const SUPERADMIN_ONLY_KEYS = new Set\(\[([^\]]*)\]\)/.exec(code)?.[1] ?? ''
  assert.doesNotMatch(
    gated,
    /favicon_url/,
    'favicon không chèn JavaScript nên nó không thuộc cùng nhóm với tracking_custom_head',
  )
})

test('favicon_url được phát ra cho trang công khai', () => {
  const code = read('server/api/public/settings.get.ts')
  assert.match(code, /'favicon_url'/, 'lưu được mà trang công khai không đọc được')
})

// Khẳng định về hàng seed nằm ở cuối tệp, và nó đã bị ĐẢO NGƯỢC: test cũ ở đây đòi
// seed **phải** ghi `favicon_url = '/favicon-32.png'` với lý do "một CSDL mới không
// có giá trị nào cho ô này". Giả định đó sai — bộ đọc tự lùi về đúng đường dẫn đó
// khi hàng vắng — và hàng seed gây ra một lỗi đo được: `/favicon.ico` phục vụ PNG.
// Xem test `seed KHÔNG ghi hàng favicon_url`.

// ─── Plugin: khác tracking.ts ở hai điểm, và cả hai đều có lý do ─────────────

describe('plugin favicon', () => {
  const plugin = read('server/plugins/favicon.ts')

  /**
   * `tracking.ts` **cố ý** bỏ qua `/admin/**` vì đo hành vi cán bộ là quyết định
   * riêng tư. Favicon thì ngược lại: một trang quản trị không có icon là một tab
   * trắng mà cán bộ phải phân biệt với mọi tab trắng khác đang mở.
   *
   * Đây là điểm dễ bị "dọn dẹp cho giống nhau" nhất giữa hai tệp, nên nó được
   * ghim ở đây.
   */
  it('KHÔNG bỏ qua tuyến /admin', () => {
    assert.doesNotMatch(
      plugin,
      /startsWith\('\/admin/,
      'plugin đã sao chép nhánh bỏ qua admin của tracking.ts — /admin sẽ mất favicon',
    )
  })

  it('bỏ qua tuyến /api', () => {
    assert.match(plugin, /startsWith\('\/api\/'\)/, 'tuyến API không dựng tài liệu nào')
  })

  it('nội suy href qua escapeHtml', () => {
    assert.match(plugin, /escapeHtml/, 'giá trị đi vào thuộc tính HTML mà không escape')
  })

  /**
   * Plugin **không** tự đọc CSDL, và điều đó là ràng buộc chứ không phải gọn gàng.
   *
   * Tuyến `/favicon.ico` cần **cùng** giá trị này. Mỗi nơi một bộ đệm là hai lượt
   * hết hạn lệch nhau, nên trong tối đa 30 giây thẻ `<link>` và `/favicon.ico` có
   * thể trỏ **hai icon khác nhau** — mà favicon bị trình duyệt đệm rất lâu, nên
   * một lần đọc lệch đọng lại rất dai.
   */
  it('đọc qua bộ đọc dùng chung, không tự truy vấn', () => {
    assert.match(plugin, /loadFaviconSetting/, 'plugin phải dùng bộ đọc dùng chung')
    assert.doesNotMatch(
      plugin,
      /getDb\(\)/,
      'plugin tự truy vấn CSDL — bộ đệm thứ hai sẽ lệch với tuyến /favicon.ico',
    )
  })
})

// ─── Bộ đọc dùng chung: một bộ đệm cho cả thẻ <link> và tuyến /favicon.ico ───

describe('bộ đọc cấu hình favicon', () => {
  const loader = read('server/utils/favicon-setting.ts')

  it('lỗi CSDL vẫn lùi về mặc định, không trả rỗng', () => {
    // Khác tracking.ts (ở đó "không chèn gì" là kết quả an toàn). Ở đây "không
    // chèn gì" nghĩa là mọi khách thấy tab trắng suốt thời gian CSDL có vấn đề,
    // trong khi tệp mặc định đã nằm sẵn trên đĩa và biết là dùng được.
    const branch = loader.slice(loader.indexOf('catch'))
    assert.match(branch, /FALLBACK|DEFAULT_FAVICON_URL/, 'nhánh lỗi không lùi về mặc định')
  })

  it('đi qua safeFaviconUrl trước khi dùng', () => {
    assert.match(loader, /safeFaviconUrl/, 'thiếu biên tin cậy')
  })

  /**
   * Bộ đệm phải bỏ được, và đây là phần dễ bỏ sót nhất.
   *
   * Trang cài đặt đã phải cảnh báo rằng **trình duyệt** đệm favicon rất lâu. Thêm
   * một lớp đệm phía máy chủ mà không có đường xoá là làm lời cảnh báo đó thành vô
   * ích: cán bộ lưu xong, tải lại, thấy icon cũ, và không phân biệt được hai
   * nguyên nhân — cả hai đều trông như "không lưu được".
   */
  it('có đường bỏ bộ đệm sau khi lưu', () => {
    assert.match(loader, /export function clearFaviconSettingCache/, 'không có đường bỏ bộ đệm')
  })
})

// ─── Tuyến /favicon.ico: đường dẫn mà máy quét gọi TRỰC TIẾP ─────────────────

/**
 * Thẻ `<link>` chỉ phục vụ những nơi phân tích HTML. Trình duyệt cũ, đầu đọc RSS,
 * phần mềm gom tin và phần lớn bộ dò liên kết gọi thẳng `/favicon.ico`.
 *
 * Tuyến này tồn tại vì **phép đo**, không vì suy luận. Ba kết quả đo được trên bản
 * build, và cả ba đều phản trực giác:
 *  1. `public/favicon.ico` có lúc build → tệp tĩnh **thắng** tuyến, hàm không bao
 *     giờ chạy, cấu hình bị bỏ qua trong im lặng.
 *  2. Tệp có lúc build rồi mất lúc chạy → manifest tĩnh vẫn khai nó còn, `readFile`
 *     ném `ENOENT` → **500**, không phải 404.
 *  3. Không có tệp tĩnh → tuyến thắng, kể cả thắng placeholder data-URI của Nitro.
 */
describe('tuyến /favicon.ico', () => {
  // Bỏ comment: suite này có cả khẳng định "phải vắng", và docstring của tuyến
  // giải thích *vì sao* `immutable` sai — nó sẽ khớp vào chính guard đó.
  const route = readCode('server/routes/favicon.ico.ts')

  it('đọc qua bộ đọc dùng chung với plugin', () => {
    assert.match(route, /loadFaviconSetting/, 'tuyến phải phục vụ favicon ĐÃ CẤU HÌNH, không phải bản cố định')
  })

  it('lấy tên tệp mặc định từ hằng số, không viết cứng', () => {
    assert.match(route, /DEFAULT_ICO_FILENAME/, 'tên tệp viết cứng ở hai chỗ sẽ lệch nhau')
    assert.doesNotMatch(
      route,
      /'favicon-default\.ico'/,
      'viết cứng tên tệp — script sinh tệp và tuyến đọc tệp phải cùng đọc một hằng số',
    )
  })

  /**
   * `immutable` là đúng cho `/uploads/**` (tên tệp có dấu thời gian) và **sai** ở
   * đây: đường dẫn cố định trong khi nội dung đổi được từ trang quản trị, nên
   * `max-age=31536000, immutable` ghim icon cũ trong máy khách suốt một năm.
   */
  it('không đệm immutable', () => {
    assert.doesNotMatch(route, /immutable/, 'đường dẫn cố định + nội dung đổi được: immutable ghim icon cũ cả năm')
    assert.match(route, /max-age=\d+/, 'thiếu Cache-Control')
  })

  it('chặn đi ra khỏi thư mục public', () => {
    assert.match(route, /\.\.'?\)|includes\('\.\.'\)/, 'thiếu phép chặn path traversal')
    assert.match(route, /startsWith\(publicRoot/, 'thiếu phép kiểm đường dẫn đã resolve còn trong gốc')
  })

  /**
   * Cấu hình trỏ tới một tệp đã bị xoá khỏi Thư viện Media **không** được thành
   * 404: cổng vẫn còn một icon dùng được trên đĩa, và một tab trắng vì lý do đó là
   * hỏng ở chỗ không cần hỏng.
   */
  it('lùi về tệp mặc định thay vì 404 khi tệp đã cấu hình biến mất', () => {
    assert.match(route, /continue/, 'không đi tiếp tới ứng viên sau khi statSync thất bại')
    assert.match(route, /candidates\.push\(\{ file: fallback/, 'tệp mặc định không nằm trong danh sách ứng viên')
  })

  it('gắn nosniff', () => {
    assert.match(route, /X-Content-Type-Options/, 'byte ảnh không được để trình duyệt diễn giải lại')
  })

  /**
   * Tuyến này phục vụ **chỉ** ICO, và đây là lỗi đã ĐO ĐƯỢC trên máy chủ thật.
   *
   * Bản đầu nhận bất kỳ icon cục bộ nào rồi tự gắn `image/png` khi tệp không phải
   * `.ico`. Với hàng seed `favicon_url = '/favicon-32.png'`, `/favicon.ico` trả
   * `content-type: image/png`, 2213 byte — ở đúng đường dẫn mà máy quét, đầu đọc
   * RSS và trình duyệt cũ gọi **để lấy ICO**. Phần lớn chấp nhận PNG, nhưng chính
   * những chương trình cũ là lý do tuyến này tồn tại thì không.
   *
   * Lỗi lọt qua 1404 test vì mọi test đều kiểm mã ở trạng thái nghỉ; chỉ một lượt
   * `curl` trên bản build mới nói ra.
   */
  it('chỉ phục vụ ICO, không bao giờ PNG', () => {
    assert.doesNotMatch(
      route,
      /image\/png/,
      'tuyến /favicon.ico phục vụ PNG — máy quét gọi đường dẫn này để lấy ICO',
    )
    assert.match(
      route,
      /endsWith\('\.ico'\)/,
      'không kiểm tệp đã cấu hình có thật là .ico',
    )
  })
})

/**
 * `favicon_url` **không** được có hàng seed.
 *
 * `loadFaviconSetting` đã tự lùi về `/favicon-32.png` khi hàng vắng, nên hàng seed
 * không mua thêm gì — nhưng nó gây ra hai chuyện sai. Một là lỗi đo được ở trên
 * (`/favicon.ico` trả PNG). Hai là `/admin/settings/general` hiện ra như "đã cấu
 * hình" trong khi cổng đang dùng bộ mặc định, nên nút "Về mặc định" trông như không
 * làm gì.
 *
 * Vắng mặt là cách diễn đạt đúng cho "chưa cấu hình", và là trạng thái mà
 * `favicon.delete.ts` trả về.
 */
test('seed KHÔNG ghi hàng favicon_url', () => {
  const code = read('server/db/seed.ts')
  assert.doesNotMatch(
    code,
    /\{\s*key:\s*'favicon_url'/,
    'hàng seed favicon_url đã quay lại: /favicon.ico sẽ phục vụ PNG, và trang cài đặt khai "đã cấu hình" cho chính giá trị mặc định',
  )
})

test('nuxt.config không còn thẻ icon viết cứng', () => {
  const code = read('nuxt.config.ts')
  assert.doesNotMatch(
    code,
    /rel:\s*'icon'/,
    'hai thẻ rel="icon" cùng lúc: thẻ nào thắng là do trình duyệt quyết định, ' +
    'nên cán bộ đổi favicon sẽ thấy đổi trên Chrome mà không đổi trên Safari',
  )
  assert.doesNotMatch(code, /favicon\.ico/, 'còn trỏ tới tệp đã xoá')
})

// ─── Upload nhận .ico ───────────────────────────────────────────────────────

/**
 * Phép nhận diện định dạng **chạy thật**, không soi văn bản mã nguồn.
 *
 * Ba khẳng định đầu của suite này từng soi chữ trong `upload.post.ts` (`0x00 &&
 * buf[1] === 0x00 …`), và chúng đỏ ngay khi logic dời sang module dùng chung dù
 * hành vi không đổi một chút nào. Đó là dấu hiệu chúng ghim **cách viết** chứ
 * không ghim **hành vi**. Gọi thẳng hàm thì phép kiểm sống qua mọi lần dời chỗ, và
 * nó khẳng định được thứ mạnh hơn: giá trị trả về đúng.
 */
describe('nhận diện định dạng ảnh theo magic byte', () => {
  /** Vỏ ICO thật, dựng bằng chính hàm mà bộ mặc định dùng. */
  const realIco = wrapPngAsIco(readFileSync(new URL('../public/favicon-32.png', import.meta.url)))

  const SAMPLES: Array<[string, Buffer, DetectedImageMime | null]> = [
    ['PNG', readFileSync(new URL('../public/favicon-32.png', import.meta.url)), 'image/png'],
    ['ICO', realIco, 'image/x-icon'],
    ['JPEG', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), 'image/jpeg'],
    ['GIF', Buffer.from('GIF89a....', 'latin1'), 'image/gif'],
    ['WebP', Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')]), 'image/webp'],
    // Đây chính là ca đã kiểm trên máy chủ thật: một tệp văn bản đổi tên thành
    // `.ico` kèm `Content-Type: image/x-icon` phải bị từ chối — magic byte là
    // thẩm quyền, không phải tên tệp hay header client gửi.
    ['văn bản đội tên .ico', Buffer.from('day khong phai icon, chi la van ban thuong.', 'latin1'), null],
    ['HTML (đúng lỗi favicon gốc)', Buffer.from('<!DOCTYPE html><html></html>', 'latin1'), null],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'latin1'), null],
    ['quá ngắn', Buffer.from([0x00, 0x00]), null],
    ['rỗng', Buffer.alloc(0), null],
  ]

  for (const [label, bytes, expected] of SAMPLES) {
    it(`${label} → ${expected ?? 'null'}`, () => {
      assert.equal(detectImageMime(bytes), expected)
    })
  }

  it('mọi định dạng nhận được đều có đuôi tệp', () => {
    // Một MIME nhận được mà không có đuôi tệp sẽ ném 415 ở cuối đường tải lên —
    // sau khi đã qua phép kiểm magic byte, tức là một tệp hợp lệ bị từ chối với
    // một lý do không liên quan gì tới nó.
    for (const [, , mime] of SAMPLES) {
      if (mime) assert.ok(EXT_BY_IMAGE_MIME[mime], `${mime} thiếu đuôi tệp`)
    }
  })

  it('.svg vắng khỏi bảng đuôi tệp', () => {
    // Tiêu chí là "có chạy được hay không", không phải "định dạng nào quen hơn":
    // SVG phục vụ inline là tài liệu chạy được trên origin của cổng.
    assert.ok(!Object.keys(EXT_BY_IMAGE_MIME).includes('image/svg+xml'))
  })

  /**
   * sharp **không** giải mã được ICO (đã kiểm: `sharp.format.ico` là undefined).
   * Khối `try/catch` quanh sharp nuốt lỗi nên lời gọi vẫn *chạy được*, và đi qua
   * một nhánh xử lý không áp dụng được là mời một lần refactor sau này dời logic
   * thật vào một nhánh không bao giờ chạy.
   */
  it('ICO bị loại khỏi nhánh sharp, các định dạng khác thì không', () => {
    assert.equal(isSharpDecodable('image/x-icon'), false)
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as DetectedImageMime[]) {
      assert.equal(isSharpDecodable(mime), true, `${mime} bị loại oan khỏi nhánh sharp`)
    }
  })
})

describe('upload nhận .ico', () => {
  const upload = read('server/api/admin/media/upload.post.ts')

  it('dùng bộ nhận diện dùng chung, không viết bản riêng', () => {
    // Hai bộ nhận diện là hai danh sách định dạng sẽ lệch nhau — đúng hình dạng
    // lỗi mà `.ico` vừa gây ra giữa đường tải lên và đường phục vụ.
    assert.match(upload, /detectImageMime/, 'endpoint phải dùng bộ nhận diện dùng chung')
    assert.doesNotMatch(upload, /const detectMime =/, 'bản nhận diện riêng đã quay lại')
  })

  it('thông báo lỗi nêu đủ định dạng được nhận', () => {
    // Một thông báo nói "JPEG/PNG/GIF/WebP" trong khi ICO đã được nhận sẽ khiến
    // cán bộ tin rằng tệp .ico của họ không dùng được.
    assert.match(upload, /JPEG\/PNG\/GIF\/WebP\/ICO/)
  })

  it('không bao giờ suy đuôi tệp từ tên client gửi cho ảnh', () => {
    assert.match(
      upload,
      /EXT_BY_MIME\[effectiveMime\]/,
      'đuôi tệp phải suy từ MIME đã kiểm bằng magic byte',
    )
  })

  /**
   * Guard sharp phải key theo **kết quả magic byte**, không theo header client.
   *
   * Bản cũ viết `!mimeType.includes('gif')` trên chuỗi do client khai, nên một GIF
   * động tải lên kèm `Content-Type: image/png` đi qua điều kiện đó và **bị làm
   * phẳng còn một khung**. Việc gộp về module chung đã đóng luôn khoảng trống này.
   */
  it('guard sharp key theo magic byte, không theo header client', () => {
    assert.match(upload, /isSharpDecodable\(detectedImageMime\)/, 'guard không dùng kết quả magic byte')
    assert.doesNotMatch(upload, /mimeType\.includes\('gif'\)/, 'guard còn đọc header do client khai')
  })
})

// ─── Ô nhập trong trang admin ───────────────────────────────────────────────

describe('ô nhập favicon ở /admin/settings/general', () => {
  const page = read('app/pages/admin/settings/general.vue')

  it('có trong state của biểu mẫu', () => {
    assert.match(page, /favicon_url:/)
  })

  it('vẫn chọn được từ Thư viện Media', () => {
    assert.match(page, /pickImage\('favicon_url'\)/, 'thiếu nút Thư viện')
  })

  /**
   * Tệp tải lên đi qua endpoint SINH ẢNH, **không** qua `uploadImage`.
   *
   * Đây là chỗ khẳng định đã bị đảo ngược: bản đầu đòi ô này dùng lại `uploadImage`
   * "cho giống ô logo". Nhưng `uploadImage` lưu **nguyên** tệp cán bộ chọn, và ảnh
   * cán bộ có trong tay là logo cơ quan — thường 1200×800 và vài trăm KB. Dán thẳng
   * nó vào thẻ `<link rel="icon">` là cả mấy trăm KB đó tải trên **mọi** trang của
   * cổng, cộng với việc bị bóp méo vì không vuông. Không có gì báo, ở cả hai chuyện.
   *
   * Nên "giống ô logo" là tiêu chí sai ở đúng ô này.
   */
  it('tải ảnh lên đi qua endpoint sinh bộ favicon, không lưu tệp gốc', () => {
    assert.match(page, /uploadFavicon/, 'thiếu đường sinh bộ favicon')
    assert.doesNotMatch(
      page,
      /uploadImage\(e, 'favicon_url'\)/,
      'favicon đi qua uploadImage: tệp gốc 1200×800 sẽ tải trên mọi trang và bị bóp méo',
    )
    assert.match(page, /\/api\/admin\/settings\/favicon/, 'không gọi endpoint favicon')
  })

  /**
   * Đặt lại về mặc định phải là một NÚT, không phải xoá ô rồi bấm Lưu.
   *
   * Lượt lưu chung chỉ biết `favicon_url`; bản `.ico` dẫn xuất nằm ở khoá riêng
   * `favicon_ico_url` mà biểu mẫu không hề biết tới — nên xoá ô trống rồi lưu sẽ để
   * tuyến `/favicon.ico` phục vụ icon cũ trong khi thẻ `<link>` đã về mặc định.
   */
  it('có nút trả về mặc định gọi DELETE', () => {
    assert.match(page, /resetFavicon/, 'thiếu nút trả về mặc định')
    assert.match(page, /method: 'DELETE'/, 'nút trả về mặc định không gọi DELETE')
  })

  /**
   * Hai nút này có hiệu lực **ngay**, khác mọi ô khác trên trang, nên phải nói ra.
   *
   * Chúng ghi tệp ra đĩa nên không hoãn được tới lượt "Lưu Cài Đặt" chung. Một thay
   * đổi đã có hiệu lực mà trông như đang chờ lưu là cách cán bộ bỏ trang đi và tưởng
   * mình chưa đổi gì.
   */
  it('nói rõ hai nút đó có hiệu lực ngay', () => {
    assert.match(page, /không cần bấm "Lưu Cài Đặt"/, 'không nói ra sự bất đối xứng với các ô khác')
  })

  it('input file nhận PNG, JPG và ICO', () => {
    const accept = page.match(/accept="([^"]*)"[^>]*:disabled="uploadingFavicon"/)?.[1]
      ?? page.match(/accept="([^"]*)"/g)?.find(value => value.includes('.ico'))
      ?? ''
    for (const ext of ['.png', '.jpg', '.ico']) {
      assert.ok(accept.includes(ext), `hộp thoại tệp không cho chọn ${ext}`)
    }
  })

  /**
   * Câu về bộ nhớ đệm là phần dễ bị bỏ nhất và cũng là phần sinh ra nhiều báo lỗi
   * giả nhất: trình duyệt giữ favicon rất lâu, nên cán bộ đổi xong, tải lại
   * trang, không thấy gì đổi, và kết luận tính năng hỏng.
   */
  /**
   * Regex khớp trên khái niệm ("bộ nhớ đệm"), không khớp trên một cụm chữ cứng.
   *
   * Bản đầu của em tự đặt ra cụm "lưu favicon" rồi viết template bằng chữ khác
   * ("Trình duyệt **giữ** favicon trong **bộ nhớ đệm** rất lâu") — hai bên không
   * khớp nhau vì cùng một ý nhưng khác từ. `bộ nhớ đệm` là danh từ neo đúng khái
   * niệm cần có mặt, và nó không xuất hiện ở đoạn nào khác trong trang này.
   */
  it('nói rõ trình duyệt cache favicon rất lâu', () => {
    assert.match(page, /bộ nhớ đệm/i, 'thiếu lời nhắc về bộ nhớ đệm của trình duyệt')
  })

  it('nêu kích thước nên dùng', () => {
    assert.match(page, /32/, 'không nêu kích thước nào')
  })
})

// ─── Cổng vào và cổng ra phải nhận cùng một tập định dạng ────────────────────

/**
 * Nhận một định dạng ở đường **tải lên** mà không nhận ở đường **phục vụ** là
 * không nhận nó.
 *
 * Đây là lỗ đã đo được trên máy chủ thật, không phải một giả thuyết. Sau khi mở
 * `detectMime()` cho `.ico`, một tệp icon thật tải lên **thành công** (`200`,
 * `mimeType: image/x-icon`, byte nguyên vẹn), rồi được phục vụ lại với
 * `Content-Type: application/octet-stream` — vì `mimeMap` ở đường phục vụ không
 * có `.ico`. Nhánh đó còn gắn thêm `Content-Disposition: attachment` và
 * `X-Content-Type-Options: nosniff`, hai header tồn tại **để trình duyệt từ chối
 * vẽ tệp**. Kết quả: favicon lưu đúng, hiện đúng trong ô nhập, thẻ `<link>` trỏ
 * đúng, mà tab vẫn trống — cùng một hình dạng hỏng như tệp `favicon.ico` HTML mà
 * cả việc này ra đời để dứt điểm.
 *
 * Hai allowlist ở hai tệp khác nhau thì không có gì buộc chúng khớp nhau, nên
 * phép buộc nằm ở đây.
 */
describe('đường tải lên và đường phục vụ nhận cùng định dạng', () => {
  const uploadRoute = read('server/api/admin/media/upload.post.ts')
  const serveRoute = read('server/routes/uploads/[...path].ts')

  it('đường phục vụ khai .ico với đúng MIME ảnh', () => {
    assert.match(
      serveRoute,
      /'\.ico':\s*'image\/x-icon'/,
      '.ico thiếu ở mimeMap: tệp sẽ phục vụ dưới application/octet-stream + attachment, tab vẫn trống',
    )
  })

  /**
   * ĐỐI CHIẾU THẬT hai danh sách, không soi chữ ở một trong hai tệp.
   *
   * Bản đầu khẳng định bằng cách tìm `'image/x-icon': '.ico'` trong
   * `upload.post.ts`, và nó đỏ ngay khi bảng đó dời sang module dùng chung — dù
   * hành vi không đổi. Tệ hơn: nó chỉ kiểm được **một** định dạng, nên thêm một
   * định dạng thứ sáu vào đường tải lên mà quên đường phục vụ vẫn **xanh**. Đó
   * đúng là lỗ đã đo được với `.ico`.
   *
   * Nay nó lặp qua **mọi** định dạng đường tải lên nhận, và đòi đường phục vụ khai
   * MIME ảnh cho từng cái.
   */
  it('mọi định dạng nhận ở cổng vào đều hiện được ở cổng ra', () => {
    for (const ext of Object.values(EXT_BY_IMAGE_MIME)) {
      const declared = new RegExp(`'\\${ext}':\\s*'image/`)
      assert.match(
        serveRoute,
        declared,
        `${ext} nhận được ở đường tải lên nhưng thiếu ở mimeMap của đường phục vụ: ` +
        'tệp sẽ phục vụ dưới application/octet-stream + Content-Disposition: attachment, ' +
        'tức trình duyệt TỪ CHỐI vẽ nó — tải lên thành công mà tab vẫn trống',
      )
    }
  })

  /**
   * `.svg` phải vắng ở **cả hai** đầu, và lý do khác lý do của `.ico`.
   *
   * Một SVG phục vụ dưới `image/svg+xml` là một tài liệu **chạy được** trên chính
   * origin của cổng — nó chứa `<script>` được. ICO là thùng chứa ảnh raster, không
   * có nhánh nào để chạy gì. Đó là tiêu chí phân biệt, không phải "định dạng nào
   * quen hơn"; ghi lại vì lần nới tiếp theo sẽ được lập luận bằng chính tiền lệ
   * của `.ico`.
   */
  it('.svg vẫn vắng ở cả hai đầu', () => {
    assert.doesNotMatch(
      serveRoute,
      /'\.svg':\s*'image\/svg\+xml'/,
      'SVG phục vụ inline là một tài liệu chạy được trên origin của cổng',
    )
    assert.doesNotMatch(
      uploadRoute,
      /'image\/svg\+xml':\s*'\.svg'/,
      'SVG không được vào EXT_BY_MIME',
    )
  })
})

// ─── Bộ mặc định đi kèm mã nguồn ────────────────────────────────────────────

/**
 * Bộ `.ico` mặc định phải là một icon **thật**, và phép kiểm nhìn vào byte.
 *
 * Tệp mang tên `favicon-default.ico`, **không** phải `favicon.ico`: một tệp tĩnh ở
 * đường dẫn sau sẽ thắng `server/routes/favicon.ico.ts` và làm tuyến đó không bao
 * giờ chạy (đã đo trên bản build), nên favicon cán bộ cấu hình bị bỏ qua ở đúng
 * đường dẫn mà máy quét, đầu đọc RSS và trình duyệt cũ gọi trực tiếp.
 *
 * Tệp phải có mặt vì tuyến đó lùi về nó ở mọi nhánh lỗi — chưa cấu hình gì, CSDL
 * không nối được, hay cấu hình trỏ vào một tệp đã bị xoá khỏi Thư viện Media.
 */
describe('bộ favicon mặc định là ảnh thật', () => {
  const asBuffer = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url))
  const ICO = `public/${DEFAULT_ICO_FILENAME}`

  it('có mặt và mang magic-byte của ICO', () => {
    assert.ok(existsSync(new URL(`../${ICO}`, import.meta.url)), `thiếu ${ICO}`)

    const buf = asBuffer(ICO)
    assert.deepEqual(
      [buf[0], buf[1], buf[2], buf[3]],
      [0x00, 0x00, 0x01, 0x00],
      `${ICO} không mang magic-byte ICO — có thể lại là HTML hoặc một placeholder`,
    )
  })

  /**
   * Khẳng định tường minh rằng nó **không** phải HTML và **không** phải chuỗi
   * data-URI. Phép kiểm magic-byte trên đã bao hàm, nhưng hai dạng này là hai lần
   * thật sự đã xảy ra trên đường dẫn này, nên chúng được nêu tên: một test đỏ nên
   * chỉ vào triệu chứng đã biết chứ không chỉ vào một mảng byte.
   */
  it('không phải HTML cũng không phải chuỗi data-URI', () => {
    const head = asBuffer(ICO).subarray(0, 64).toString('latin1')
    assert.doesNotMatch(head, /<!DOCTYPE|<html/i, `${ICO} lại là một trang HTML`)
    assert.doesNotMatch(head, /^data:/, `${ICO} là placeholder data-URI của Nitro, không phải tệp thật`)
  })

  it('ICO dùng lại đúng ảnh 32px, không phải một tệp rời', () => {
    const ico = asBuffer(ICO)
    const png = asBuffer('public/favicon-32.png')

    // Vỏ ICO là 6 byte tiêu đề + 16 byte mục thư mục, rồi tới nguyên PNG.
    assert.ok(
      ico.subarray(22).equals(png),
      `phần thân ${DEFAULT_ICO_FILENAME} khác favicon-32.png — hai icon sẽ lệch nhau khi logo đổi`,
    )
  })
})
