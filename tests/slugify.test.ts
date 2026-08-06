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
 * Không endpoint nào được tự khai lại `slugify`.
 *
 * Guard chặn bản sao thứ hai. Nó soi văn bản mã nguồn nên **không** chứng minh
 * endpoint xử lý đúng — nó chỉ chặn đúng hình dạng đã sai một lần, và chính hình
 * dạng đó là thứ khiến hai bản trôi xa nhau mà không ai đối chiếu.
 */
describe('chỉ còn MỘT định nghĩa slugify', () => {
  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (full.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('không tệp nào ngoài server/utils/slug.ts khai `function slugify`', () => {
    const defs = [...walk('server/api'), ...walk('server/utils'), ...walk('server/services')]
      .filter(file => /function slugify/.test(readFileSync(file, 'utf8')))
    assert.deepEqual(defs, ['server/utils/slug.ts'],
      'một bản sao thứ hai là chỗ thứ hai để phép cắt gạch treo bị bỏ sót — '
      + 'và `articles/[id].put.ts` không slugify lại, nên slug sai là vĩnh viễn')
  })
})
