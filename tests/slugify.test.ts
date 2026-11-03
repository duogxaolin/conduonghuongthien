/**
 * `slugify` — MỘT bản, và slug không bao giờ mang dấu gạch treo ở hai đầu.
 *
 * Endpoint tạo bài viết từng giữ một bản chép cục bộ thiếu đúng một dòng: phép
 * cắt `^-+|-+$`. Sáu endpoint khác (`categories`, `content-types`, `pages`) đều
 * import bản dùng chung, nên chỉ đường tạo bài viết là lệch — và nó lệch theo
 * hướng **vĩnh viễn**: `articles/[id].put.ts` **không** slugify lại, nên một slug
 * dị dạng sinh ra lúc tạo sẽ đi vào URL công khai `/news/<slug>`, vào email thông
 * báo trả lời bình luận, và vào chỉ mục tìm kiếm, rồi ở đó mãi.
 *
 * Phạm vi hẹp hơn tưởng ban đầu, và điều đó đáng ghi ra: gạch ngang em (`—`,
 * U+2014) **không** tái hiện được lỗi, vì `[^0-9a-z-\s]` lược nó cùng khoảng
 * trắng quanh nó và `.trim()` dọn sạch. Chỉ **gạch ngang ASCII** lọt qua — nó nằm
 * trong lớp ký tự được giữ — rồi đọng lại ở hai đầu. Một ví dụ sai trong tài liệu
 * còn tệ hơn không có ví dụ: người sau thử ca đó, không tái hiện được, và kết
 * luận cả mục này là tưởng tượng.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { slugify } from '../server/utils/slug.ts'

describe('slugify', () => {
  it('bỏ dấu tiếng Việt và đổi đ → d', () => {
    assert.equal(slugify('Mô hình tái hòa nhập'), 'mo-hinh-tai-hoa-nhap')
    assert.equal(slugify('Đường hướng thiện'), 'duong-huong-thien')
  })

  /**
   * Đây là dòng đã thiếu trong bản chép. Từng ca một, vì "không có gạch treo" là
   * một khẳng định về **kết quả**, và mỗi hình dạng đầu vào tới nó bằng một đường
   * khác nhau.
   */
  const NO_HANGING_DASH: Array<[string, string]> = [
    ['gạch ASCII hai đầu — ca đã đo được là lệch thật', '-- Tin nong --'],
    ['một gạch ở đầu', '-Tin nong'],
    ['một gạch ở cuối', 'Tin nong-'],
    ['gạch lẫn khoảng trắng', '  --  Tin nong  --  '],
    ['toàn gạch và khoảng trắng', '  ---  '],
  ]

  for (const [label, input] of NO_HANGING_DASH) {
    it(`${label}: không còn gạch treo`, () => {
      const out = slugify(input)
      assert.ok(!out.startsWith('-'), `\`${out}\` mở đầu bằng gạch — URL công khai sẽ là /news/${out}`)
      assert.ok(!out.endsWith('-'), `\`${out}\` kết thúc bằng gạch`)
    })
  }

  it('gạch ASCII hai đầu cho ra đúng slug sạch', () => {
    assert.equal(slugify('-- Tin nong --'), 'tin-nong')
  })

  /**
   * Ghim lại ca KHÔNG tái hiện, để không ai đi "sửa" một lỗi không tồn tại.
   * Gạch ngang em bị lược như mọi ký tự ngoài lớp được giữ.
   */
  it('gạch ngang em (—) bị lược, KHÔNG tạo gạch treo', () => {
    assert.equal(slugify('— Tin nóng —'), 'tin-nong',
      'nếu ca này bắt đầu ra `-tin-nong-` thì lớp ký tự được giữ đã đổi')
  })

  it('gộp nhiều khoảng trắng và nhiều gạch thành một', () => {
    assert.equal(slugify('Tin    nong'), 'tin-nong')
    assert.equal(slugify('Tin---nong'), 'tin-nong')
  })

  it('chuỗi rỗng cho ra chuỗi rỗng, không ném', () => {
    assert.equal(slugify(''), '')
    assert.equal(slugify('!!!'), '')
  })
})

/**
 * Bản "đang gõ" cho ô slug ở trang quản trị: cùng luật ký tự, chỉ khác là GIỮ một
 * gạch cuối — cắt nó mỗi lần gõ phím thì cán bộ không gõ nổi `tin-nong`. Bản chuẩn
 * (`slugify`) áp lúc rời ô, lúc lưu và cho slug sinh từ tên.
 */
describe('slugifyDraft (shared/slugify.ts) — ô slug đang gõ', () => {
  it('giữ một gạch cuối để gõ tiếp từ sau', async () => {
    const { slugifyDraft } = await import('../shared/slugify.ts')
    assert.equal(slugifyDraft('tin-'), 'tin-')
    assert.equal(slugifyDraft('Tin nóng-'), 'tin-nong-')
    assert.equal(slugifyDraft('tin---'), 'tin-')
  })

  it('gạch đầu bị cắt ngay — không bao giờ hợp lệ, không cần để gõ tiếp', async () => {
    const { slugifyDraft } = await import('../shared/slugify.ts')
    assert.equal(slugifyDraft('-tin'), 'tin')
    assert.equal(slugifyDraft('  ---  '), '')
  })

  it('khác slugify đúng ở gạch cuối, không ở chỗ nào khác', async () => {
    const { slugify: canonical, slugifyDraft } = await import('../shared/slugify.ts')
    for (const input of ['Mô hình tái hòa nhập', 'Đường hướng thiện-', '-- Tin nong --', 'Tin    nong', 'Tin---nong', '— Tin nóng —', 'R&D_2026!', '', '!!!']) {
      assert.equal(canonical(input), slugifyDraft(input).replace(/-+$/, ''), input)
    }
  })
})

/**
 * Chỉ còn MỘT định nghĩa logic slugify, ở `shared/slugify.ts` — máy chủ re-export
 * (`server/utils/slug.ts`), trang quản trị import qua `~~/shared/slugify`.
 *
 * Guard chặn bản sao thứ hai. Nó soi văn bản mã nguồn nên **không** chứng minh
 * nơi gọi xử lý đúng — nó chỉ chặn đúng hình dạng đã sai hai lần: endpoint tạo bài
 * viết từng có `function slugify` riêng, rồi ba trang quản trị có
 * `const slugifyLocal = (text) => …` (dạng arrow, nên guard cũ chỉ tìm
 * `function slugify` trong `server/` để lọt), cả bốn thiếu phép cắt gạch treo.
 */
describe('chỉ còn MỘT định nghĩa slugify', () => {
  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.(ts|vue|js|mjs)$/.test(full)) out.push(full)
    }
    return out
  }
  const sources = () => ['app', 'server', 'shared'].flatMap(walk)

  /** Hàm kiểu slug có hợp đồng KHÁC, cố ý giữ riêng — nêu tên kèm lý do. */
  const NOT_A_SLUGIFY_COPY: Record<string, string> = {
    'app/utils/toc.ts': '`slugifyHeading` sinh id neo cho mục lục: mọi chuỗi ký tự không phải chữ/số thành `-` '
      + '(`R&D` → `r-d`, còn slugify ra `rd`), cắt 80 ký tự. Liên kết `#…` đã chia sẻ phụ thuộc vào nó; không phải slug lưu CSDL.',
  }

  it('không tệp nào ngoài shared/slugify.ts khai hàm tên slugify… (function hay arrow)', () => {
    const defs = sources()
      .filter(file => /\bfunction\s+slugify\w*|\b(?:const|let|var)\s+slugify\w*\s*=/.test(readFileSync(file, 'utf8')))
      .filter(file => !NOT_A_SLUGIFY_COPY[file])
    assert.deepEqual(defs, ['shared/slugify.ts'],
      'một bản sao thứ hai là chỗ thứ hai để phép cắt gạch treo bị bỏ sót — '
      + 'và `articles/[id].put.ts` không slugify lại, nên slug sai là vĩnh viễn')
  })

  it('không tệp nào khác chứa logic kiểu slugify (NFD + thay bằng "-"), dù đặt tên gì', () => {
    const copies = sources()
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return /\.normalize\(\s*['"]NFD['"]\s*\)/.test(source) && /\.replace\([^)]*,\s*['"]-['"]\s*\)/.test(source)
      })
      .filter(file => !NOT_A_SLUGIFY_COPY[file])
    assert.deepEqual(copies, ['shared/slugify.ts'], 'đổi tên bản chép không làm nó hết là bản chép')
  })

  it('server/utils/slug.ts dùng chính slugify của shared/', async () => {
    const shared = await import('../shared/slugify.ts')
    assert.equal(slugify, shared.slugify)
  })
})
