/**
 * `readAffectedRows` là chỗ duy nhất được đọc `affectedRows` — cùng họ lỗi `insertId`.
 *
 * `pool.query()` của mysql2 trả về một **mảng** `[header, fields]`. Đọc
 * `.affectedRows` trên giá trị chưa destructure ra `undefined` — âm thầm — và
 * `Number(undefined ?? 0)` là `0`. Điều đó đã xảy ra thật ở
 * `sessions/bulk-delete.post.ts`: một lượt xoá **thành công** báo về "đã xoá 0
 * bản ghi", nên cán bộ đi bấm xoá lần nữa trên những hàng đã biến mất.
 *
 * `as { affectedRows?: number }` là thứ làm nó vô hình: phép ép kiểu **khẳng
 * định** hình dạng chứ không **kiểm**, nên cách đọc sai qua được `typecheck`,
 * qua fake pool, và qua mọi test soi văn bản mã nguồn. Sáu chỗ trong dự án từng
 * tự viết phép ép kiểu đó.
 *
 * Phân biệt `null` với `0` là điều đáng ghim nhất: `0` là "không có hàng nào
 * khớp" — một lời khẳng định; `null` là "không đọc được" — một chỗ không biết.
 * Gộp hai thứ đó là cách một lượt truy vấn hỏng đọc ra thành một bảng đã sạch.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { affectedRowsOrZero, readAffectedRows } from '../server/utils/affected-rows.ts'

describe('readAffectedRows', () => {
  it('đọc header đã destructure', () => {
    assert.equal(readAffectedRows({ affectedRows: 7 }), 7)
  })

  /**
   * Hình dạng mà `pool.query()` thật sự trả về. Đây chính là ca đã hỏng ở
   * production: nơi gọi quên destructure và không có gì phản đối.
   */
  it('đọc cả mảng [header, fields] mà pool.query trả về', () => {
    assert.equal(readAffectedRows([{ affectedRows: 3 }, []]), 3)
  })

  it('0 là 0, không phải "không đọc được"', () => {
    assert.equal(readAffectedRows({ affectedRows: 0 }), 0)
    assert.equal(readAffectedRows([{ affectedRows: 0 }, []]), 0)
  })

  /**
   * Từng dạng một. Mọi dạng ở đây phải ra `null`, KHÔNG ra `0` — nơi gọi cần
   * phân biệt được "không có hàng nào khớp" với "không biết".
   */
  const MUST_BE_NULL: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['số', 42],
    ['chuỗi', 'ok'],
    ['object rỗng', {}],
    ['mảng rỗng', []],
    ['mảng phần tử đầu là null', [null, []]],
    ['affectedRows là chuỗi', { affectedRows: '5' }],
    ['affectedRows là null', { affectedRows: null }],
    ['affectedRows là NaN', { affectedRows: Number.NaN }],
    ['affectedRows âm', { affectedRows: -1 }],
  ]

  for (const [label, value] of MUST_BE_NULL) {
    it(`${label} → null, không phải 0`, () => {
      assert.equal(readAffectedRows(value), null,
        `${label} đọc thành một con số là một lời khẳng định về dữ liệu mà không ai kiểm`)
    })
  }

  /**
   * `'5'` phải ra `null` chứ không phải `5`: `Number('5')` chạy được, nhưng một
   * driver trả chuỗi ở trường này nghĩa là hình dạng đã khác điều mã này giả
   * định, và đoán tiếp là cách bỏ qua đúng cái tín hiệu đó.
   */
  it('không tự chuyển chuỗi số thành số', () => {
    assert.equal(readAffectedRows({ affectedRows: '5' }), null)
  })
})

describe('affectedRowsOrZero', () => {
  it('giữ nguyên số đọc được', () => {
    assert.equal(affectedRowsOrZero([{ affectedRows: 4 }, []]), 4)
    assert.equal(affectedRowsOrZero({ affectedRows: 0 }), 0)
  })

  it('không đọc được thì thành 0', () => {
    assert.equal(affectedRowsOrZero(null), 0)
    assert.equal(affectedRowsOrZero({}), 0)
  })
})
