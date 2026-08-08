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

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

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
      assert.ok(existsSync(path), `${url} không có trên đĩa — chạy node scripts/make-favicon.mjs`)

      const head = readFileSync(path).subarray(0, 4)
      assert.ok(
        head.equals(PNG_MAGIC),
        `${url} không phải PNG (4 byte đầu: ${head.toString('hex')}). ` +
        'Đúng lỗi mà public/favicon.ico cũ mang: một tệp HTML mang tên icon.',
      )
    })
  }

  // `public/favicon.ico` KHÔNG được khẳng định là vắng ở đây, dù bản đầu của tệp
  // test này từng làm vậy.
  //
  // Giả định lúc đó là "tệp hỏng nên phải xoá". Đo trên máy chủ thật thì xoá đi
  // không cho ra 404 mà cho ra placeholder có sẵn của Nitro: `200`,
  // `content-type: image/x-icon`, thân là chuỗi `data:image/gif;base64,…`. Tức là
  // vẫn không có icon, chỉ đổi nguồn của thứ sai. Yêu cầu đúng vì thế là **có mặt
  // và mang byte thật** — khẳng định ở suite "bộ favicon mặc định là ảnh thật".

  it('script sinh icon có trong repo để lượt sinh này tái lập được', () => {
    assert.ok(existsSync(new URL('../scripts/make-favicon.mjs', import.meta.url)))
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

test('seed có hàng favicon_url mặc định', () => {
  const code = read('server/db/seed.ts')
  assert.match(code, /key: 'favicon_url'/, 'một CSDL mới không có giá trị nào cho ô này')
})

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

  it('lỗi CSDL vẫn chèn thẻ mặc định, không chèn rỗng', () => {
    // Khác tracking.ts (ở đó "không chèn gì" là kết quả an toàn). Ở đây "không
    // chèn gì" nghĩa là mọi khách thấy tab trắng suốt thời gian CSDL có vấn đề,
    // trong khi tệp mặc định đã nằm sẵn trên đĩa và biết là dùng được.
    const branch = plugin.slice(plugin.indexOf('catch'))
    assert.match(branch, /DEFAULT_FAVICON_URL/, 'nhánh lỗi không lùi về mặc định')
  })

  it('nội suy href qua escapeHtml', () => {
    assert.match(plugin, /escapeHtml/, 'giá trị đi vào thuộc tính HTML mà không escape')
  })

  it('đi qua safeFaviconUrl trước khi dùng', () => {
    assert.match(plugin, /safeFaviconUrl/, 'thiếu biên tin cậy')
  })
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

describe('upload nhận .ico', () => {
  const upload = read('server/api/admin/media/upload.post.ts')

  it('nhận diện ICO theo magic byte, không theo tên tệp', () => {
    assert.match(upload, /0x00 && buf\[1\] === 0x00 && buf\[2\] === 0x01/, 'thiếu nhận diện ICO')
  })

  it('có đuôi tệp cho ICO', () => {
    assert.match(upload, /'image\/x-icon': '\.ico'/)
  })

  it('bỏ qua sharp cho ICO', () => {
    // sharp không giải mã được ICO (đã kiểm: `sharp.format.ico` là undefined).
    // Khối try/catch quanh sharp sẽ nuốt lỗi nên nó *chạy được*, nhưng đi qua một
    // nhánh xử lý không áp dụng được là mời một lần refactor sau này biến nó
    // thành lỗi thật.
    assert.match(upload, /effectiveMime !== 'image\/x-icon'/, 'ICO vẫn đi vào nhánh sharp')
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
})

// ─── Ô nhập trong trang admin ───────────────────────────────────────────────

describe('ô nhập favicon ở /admin/settings/general', () => {
  const page = read('app/pages/admin/settings/general.vue')

  it('có trong state của biểu mẫu', () => {
    assert.match(page, /favicon_url:/)
  })

  it('dùng lại Thư viện Media và Upload như ô logo', () => {
    assert.match(page, /pickImage\('favicon_url'\)/, 'thiếu nút Thư viện')
    assert.match(page, /uploadImage\(e, 'favicon_url'\)/, 'thiếu nút Upload')
  })

  it('input file nhận cả .ico', () => {
    const accept = /accept="([^"]*)"[^>]*favicon/.test(page) || page.includes('.png,.ico')
    assert.ok(accept, 'cán bộ có tệp .ico sẽ không chọn được nó trong hộp thoại tệp')
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

  it('đường tải lên nhận .ico bằng magic-byte, không bằng đuôi tệp', () => {
    assert.match(
      uploadRoute,
      /'image\/x-icon':\s*'\.ico'/,
      'thiếu .ico trong EXT_BY_MIME',
    )
    assert.match(
      uploadRoute,
      /0x00.*0x00.*0x01.*0x00|buf\[0\]\s*===\s*0x00/s,
      'thiếu phép kiểm magic-byte 00 00 01 00 cho ICO',
    )
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
 * `public/favicon.ico` phải là một icon **thật**, và phép kiểm nhìn vào byte.
 *
 * Xoá tệp hỏng đi là chưa đủ: khi đường dẫn đó không có tệp, Nitro trả về
 * placeholder có sẵn của nó (`nitropack/.../renderer.mjs`) — `200` kèm
 * `content-type: image/x-icon`, thân là **chuỗi văn bản** `data:image/gif;base64,…`
 * chứ không phải byte ảnh. Đo được trên máy chủ thật sau khi xoá. Tức là cùng một
 * kiểu hỏng, chỉ đổi nguồn: trạng thái đúng, nhãn đúng, byte sai.
 *
 * Tệp phải có mặt vì thẻ `<link>` chỉ phục vụ những nơi **đọc HTML**; máy quét,
 * đầu đọc RSS và trình duyệt cũ gọi `/favicon.ico` trực tiếp.
 */
describe('bộ favicon mặc định là ảnh thật', () => {
  const asBuffer = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url))

  it('favicon.ico có mặt và mang magic-byte của ICO', () => {
    const path = 'public/favicon.ico'
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `thiếu ${path}`)

    const buf = asBuffer(path)
    assert.deepEqual(
      [buf[0], buf[1], buf[2], buf[3]],
      [0x00, 0x00, 0x01, 0x00],
      'favicon.ico không mang magic-byte ICO — có thể lại là HTML hoặc một placeholder',
    )
  })

  /**
   * Khẳng định tường minh rằng nó **không** phải HTML và **không** phải chuỗi
   * data-URI. Phép kiểm magic-byte trên đã bao hàm, nhưng hai dạng này là hai lần
   * thật sự đã xảy ra trên đường dẫn này, nên chúng được nêu tên: một test đỏ nên
   * chỉ vào triệu chứng đã biết chứ không chỉ vào một mảng byte.
   */
  it('favicon.ico không phải HTML cũng không phải chuỗi data-URI', () => {
    const head = asBuffer('public/favicon.ico').subarray(0, 64).toString('latin1')
    assert.doesNotMatch(head, /<!DOCTYPE|<html/i, 'favicon.ico lại là một trang HTML')
    assert.doesNotMatch(head, /^data:/, 'favicon.ico là placeholder data-URI của Nitro, không phải tệp thật')
  })

  it('ICO dùng lại đúng ảnh 32px, không phải một tệp rời', () => {
    const ico = asBuffer('public/favicon.ico')
    const png = asBuffer('public/favicon-32.png')

    // Vỏ ICO là 6 byte tiêu đề + 16 byte mục thư mục, rồi tới nguyên PNG.
    assert.ok(
      ico.subarray(22).equals(png),
      'phần thân ICO khác favicon-32.png — hai icon sẽ lệch nhau khi logo đổi',
    )
  })
})
