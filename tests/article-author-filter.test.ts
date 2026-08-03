import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ArticleFilterValidationError,
  parseAuthorFilter,
} from '../server/utils/article-filters'

test('vắng bộ lọc tác giả nghĩa là không lọc', () => {
  assert.deepEqual(parseAuthorFilter(undefined), { kind: 'all' })
  assert.deepEqual(parseAuthorFilter(null), { kind: 'all' })
  assert.deepEqual(parseAuthorFilter(''), { kind: 'all' })
})

test('nhóm không rõ tác giả là một nhánh riêng, không phải id rỗng', () => {
  assert.deepEqual(parseAuthorFilter('none'), { kind: 'none' })
})

test('nhận id người dùng dạng số nguyên dương', () => {
  assert.deepEqual(parseAuthorFilter('1'), { kind: 'user', userId: 1 })
  assert.deepEqual(parseAuthorFilter('42'), { kind: 'user', userId: 42 })
  // Query của H3 có thể đã ép sang số; cả hai dạng phải cho cùng kết quả.
  assert.deepEqual(parseAuthorFilter(7), { kind: 'user', userId: 7 })
})

test('từ chối giá trị lạ thay vì suy diễn thành không lọc', () => {
  // `Number('abc')` là NaN. Nếu suy diễn, điều kiện NaN trả về danh sách rỗng
  // trong khi ô chọn vẫn ghi "Tất cả" — đọc ra "không có bài viết nào".
  for (const bad of ['abc', 'none-of-them', 'null', 'undefined', 'NaN']) {
    assert.throws(() => parseAuthorFilter(bad), ArticleFilterValidationError, `phải từ chối: ${bad}`)
  }
})

test('từ chối số không phải id hợp lệ', () => {
  // 0 và số âm không bao giờ là id trong bảng `users` (AUTO_INCREMENT từ 1).
  for (const bad of ['0', '-1', '-42']) {
    assert.throws(() => parseAuthorFilter(bad), ArticleFilterValidationError, `phải từ chối: ${bad}`)
  }
})

test('từ chối các dạng số mà Number() vẫn đọc được', () => {
  // Đây là nhóm nguy hiểm nhất: `Number()` chấp nhận hết, nên một bộ kiểm viết
  // bằng `Number(x) > 0` sẽ cho qua tất cả rồi lọc theo một id khác hẳn giá trị
  // người dùng thấy — `'1.9'` thành id 1, `' 2 '` thành id 2, `'0x3'` thành id 3.
  for (const bad of ['1.5', '1.0', '1e3', '0x2', ' 1', '1 ', '+1', '1_000', 'Infinity']) {
    assert.throws(() => parseAuthorFilter(bad), ArticleFilterValidationError, `phải từ chối: ${bad}`)
  }
})

test('từ chối số vượt ngưỡng nguyên an toàn', () => {
  // Vượt Number.MAX_SAFE_INTEGER thì phép so sánh id mất chính xác trên đường
  // đi, nên id đem đi truy vấn không còn là id đã nhận.
  assert.throws(() => parseAuthorFilter('9007199254740993'), ArticleFilterValidationError)
  assert.throws(() => parseAuthorFilter('99999999999999999999'), ArticleFilterValidationError)
})

test('từ chối query lặp lại thay vì lặng lẽ lấy phần tử đầu', () => {
  // `?authorId=1&authorId=2` đến tay handler dưới dạng mảng. Lấy phần tử đầu là
  // bỏ im nửa yêu cầu còn lại.
  assert.throws(() => parseAuthorFilter(['1', '2']), ArticleFilterValidationError)
  assert.throws(() => parseAuthorFilter({ id: 1 }), ArticleFilterValidationError)
  assert.throws(() => parseAuthorFilter(true), ArticleFilterValidationError)
})
