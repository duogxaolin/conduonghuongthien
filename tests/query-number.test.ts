/**
 * `?page=abc` không được biến thành `page: null` trong phản hồi.
 *
 * `Math.max(1, Number(query.page))` là hình dạng sai, và nó **trông đúng**: có
 * kẹp biên, có giá trị mặc định. Nhưng `Number('abc')` là `NaN`, và mọi phép so
 * sánh với `NaN` đều `false` — nên `Math.max` trả lại chính `NaN`. Giá trị đó đi
 * vào `offset()` và JSON hoá thành `null`: endpoint trả về hàng nhưng **khai là
 * không ở trang nào**. `?page=1e999` (Infinity) lọt y hệt.
 *
 * Hàm này từng được chép **năm bản** giống hệt nhau, và **bốn** endpoint khác
 * thì không có bản nào — chúng vẫn viết phép kẹp biên trần. Đó là hình dạng của
 * một quy ước lan ra không đều: chỗ có helper thì đúng, chỗ không có thì sai, và
 * không có gì chỉ ra chỗ nào là chỗ nào. Nay chỉ còn một bản, và test cuối cùng
 * ở đây chặn việc bản thứ hai xuất hiện.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { finitePositive, MAX_PAGE } from '../server/utils/query-number.ts'

describe('finitePositive', () => {
  it('đọc số hợp lệ', () => {
    assert.equal(finitePositive('3', 1, MAX_PAGE), 3)
    assert.equal(finitePositive(7, 1, MAX_PAGE), 7)
  })

  /**
   * Từng dạng một. Mọi dạng ở đây phải ra **giá trị mặc định**, không ra `NaN`
   * và không ra `Infinity` — cả hai đều JSON hoá thành `null`.
   */
  const MUST_FALL_BACK: Array<[string, unknown]> = [
    ['chuỗi chữ', 'abc'],
    ['chuỗi rỗng', ''],
    ['undefined', undefined],
    ['null', null],
    ['NaN tường minh', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['1e999 (tràn thành Infinity)', '1e999'],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['object', {}],
    ['mảng nhiều phần tử', [1, 2]],
  ]

  for (const [label, raw] of MUST_FALL_BACK) {
    it(`${label} → giá trị mặc định`, () => {
      const value = finitePositive(raw, 1, MAX_PAGE)
      assert.equal(value, 1, `${label} lọt qua`)
      assert.ok(Number.isFinite(value), 'kết quả phải hữu hạn — NaN/Infinity JSON hoá thành null')
    })
  }

  it('kẹp biên dưới về 1, không cho 0 hay số âm', () => {
    assert.equal(finitePositive(0, 5, MAX_PAGE), 1)
    assert.equal(finitePositive(-9, 5, MAX_PAGE), 1)
  })

  it('kẹp biên trên theo max', () => {
    assert.equal(finitePositive(999_999_999, 1, MAX_PAGE), MAX_PAGE)
    assert.equal(finitePositive(999, 1, 50), 50)
  })

  it('cắt phần thập phân, không làm tròn lên', () => {
    assert.equal(finitePositive('2.9', 1, MAX_PAGE), 2,
      'trang 2.9 không tồn tại; làm tròn lên sẽ nhảy qua một trang dữ liệu')
  })
})

/**
 * Không endpoint nào được tự viết lại phép kẹp biên trần.
 *
 * Đây là guard chặn bản sao thứ hai. Nó soi văn bản mã nguồn, nên nó **không**
 * chứng minh endpoint xử lý đúng — nó chỉ chặn đúng hình dạng đã sai bốn lần.
 */
describe('không có phép đọc số query nào bỏ qua finitePositive', () => {
  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (full.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('không còn `Math.max(1, Number(query.page…))` ở đâu', () => {
    const offenders: string[] = []
    for (const file of walk('server/api')) {
      const source = readFileSync(file, 'utf8')
      if (/Math\.max\(\s*1\s*,\s*Number\(\s*query\.(page|perPage|limit)/.test(source)) {
        offenders.push(file)
      }
    }
    assert.deepEqual(offenders, [],
      'dùng `finitePositive` từ server/utils/query-number.ts — phép kẹp biên trần để NaN đi qua')
  })

  it('chỉ còn MỘT định nghĩa finitePositive', () => {
    const defs = [...walk('server/api'), ...walk('server/utils')]
      .filter(file => /function finitePositive/.test(readFileSync(file, 'utf8')))
    assert.deepEqual(defs, ['server/utils/query-number.ts'],
      'một bản sao thứ hai là chỗ thứ hai để phép kiểm này lệch đi')
  })
})
