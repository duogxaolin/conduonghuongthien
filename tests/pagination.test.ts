/**
 * `app/utils/pagination.ts` — hai hàm thay cho 5 bản chép `pageRange` và các cách
 * đọc `?page=` lệch nhau ở trang danh sách công khai.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { pageRange, parsePageParam } from '../app/utils/pagination'

test('parsePageParam: số hợp lệ đọc đúng, thập phân làm tròn xuống', () => {
  assert.equal(parsePageParam('2'), 2)
  assert.equal(parsePageParam(3), 3)
  assert.equal(parsePageParam('4.9'), 4)
})

test('parsePageParam: giá trị người đọc gõ bừa đều về trang 1, không bao giờ NaN', () => {
  for (const value of ['abc', '-3', '0', '', ' ', 'Infinity', '-Infinity', 'NaN', null, undefined, {}, '1e400']) {
    const page = parsePageParam(value)
    assert.equal(page, 1, `${String(value)} → ${page}`)
    assert.ok(Number.isFinite(page))
  }
})

test('parsePageParam: tham số lặp (?page=2&page=5) lấy phần tử đầu', () => {
  assert.equal(parsePageParam(['2', '5']), 2)
  assert.equal(parsePageParam([]), 1)
})

test('pageRange: ≤ 7 trang hiện hết', () => {
  assert.deepEqual(pageRange(1, 1), [1])
  assert.deepEqual(pageRange(3, 7), [1, 2, 3, 4, 5, 6, 7])
})

test('pageRange: không có trang nào → dãy rỗng (máy chủ trả totalPages 0 khi chuyên mục lạ)', () => {
  assert.deepEqual(pageRange(1, 0), [])
  assert.deepEqual(pageRange(1, Number.NaN), [])
})

test('pageRange: nhiều trang → đầu, cuối, hiện tại và hai trang kề', () => {
  assert.deepEqual(pageRange(1, 20), [1, 2, 20])
  assert.deepEqual(pageRange(10, 20), [1, 9, 10, 11, 20])
  assert.deepEqual(pageRange(20, 20), [1, 19, 20])
  assert.deepEqual(pageRange(2, 8), [1, 2, 3, 8])
})

test('pageRange bán kính 2 (AdminPagination) — giữ đúng dãy của bản chép cũ trong component', () => {
  assert.deepEqual(pageRange(10, 20, 2), [1, 8, 9, 10, 11, 12, 20])
  assert.deepEqual(pageRange(1, 20, 2), [1, 2, 3, 20])
  assert.deepEqual(pageRange(20, 20, 2), [1, 18, 19, 20])
  assert.deepEqual(pageRange(3, 8, 2), [1, 2, 3, 4, 5, 8])
  assert.deepEqual(pageRange(4, 7, 2), [1, 2, 3, 4, 5, 6, 7])
})

test('pageRange: trang hiện tại ngoài biên không đẻ ra số ngoài biên', () => {
  assert.deepEqual(pageRange(99, 10), [1, 10])
  assert.deepEqual(pageRange(-5, 10), [1, 10])
})
