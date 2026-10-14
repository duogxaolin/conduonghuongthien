import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { safeInternalPath, SAFE_PATH_MAX_LENGTH } from '../app/utils/safe-path'

const FALLBACK = '/'

describe('safeInternalPath — đường dẫn nội bộ từ query không tin cậy', () => {
  // [mô tả, đầu vào, kết quả mong đợi]
  const accepted: Array<[string, unknown, string]> = [
    ['định dạng thật nút "In bài" gửi (/news)', '/news', '/news'],
    ['đường dẫn lồng nhau', '/reintegration-models/abc', '/reintegration-models/abc'],
    ['gốc', '/', '/'],
    ['có chuỗi truy vấn', '/news?page=2', '/news?page=2'],
    ['được cắt khoảng trắng hai đầu', '  /news  ', '/news'],
    ['mã hoá phần trăm vô hại', '/tin%20tuc', '/tin%20tuc'],
    ['mảng query lấy phần tử đầu', ['/documents', '/evil'], '/documents'],
    ['dấu / trong đoạn sau được phép', '/a//b', '/a//b'],
  ]
  for (const [name, input, expected] of accepted) {
    it(`nhận: ${name}`, () => assert.equal(safeInternalPath(input, FALLBACK), expected))
  }

  const rejected: Array<[string, unknown]> = [
    ['network-path //evil.com', '//evil.com'],
    ['network-path nhiều dấu /', '///evil.com'],
    ['gạch ngược /\\evil.com', '/\\evil.com'],
    ['hai gạch ngược \\\\evil.com', '\\\\evil.com'],
    ['gạch ngược ở giữa', '/news\\x'],
    ['URL tuyệt đối https', 'https://evil.com'],
    ['scheme không có //', 'javascript:alert(1)'],
    ['scheme data', 'data:text/html,<script>1</script>'],
    ['không có dấu / đầu (sẽ thành host)', 'evil.com'],
    ['tương đối "news"', 'news'],
    ['%2F mã hoá thành //', '/%2Fevil.com'],
    ['%2f chữ thường', '/%2fevil.com'],
    ['%5C mã hoá thành \\', '/%5Cevil.com'],
    ['tab xen giữa (trình duyệt xoá → //)', '/\t/evil.com'],
    ['LF xen giữa', '/\n/evil.com'],
    ['CR xen giữa', '/\r/evil.com'],
    ['NUL', '/news\u0000'],
    ['ký tự điều khiển C1', '/news\u0085'],
    ['U+2028 (dấu phân dòng Unicode)', '/ne' + String.fromCharCode(0x2028) + 'ws'],
    ['mã hoá lỗi', '/%E0%A4%A'],
    ['rỗng', ''],
    ['chỉ khoảng trắng', '   '],
    ['mảng rỗng', []],
    ['mảng có phần tử đầu độc hại', ['//evil.com', '/news']],
    ['số', 42],
    ['null', null],
    ['undefined', undefined],
    ['đối tượng', { toString: () => '/news' }],
    ['quá dài', '/' + 'a'.repeat(SAFE_PATH_MAX_LENGTH)],
  ]
  for (const [name, input] of rejected) {
    it(`từ chối → dự phòng: ${name}`, () => {
      assert.equal(safeInternalPath(input, FALLBACK), FALLBACK)
      assert.equal(safeInternalPath(input, '/news'), '/news', 'dự phòng do nơi gọi chọn')
    })
  }

  it('đúng ngưỡng độ dài vẫn nhận', () => {
    const edge = '/' + 'a'.repeat(SAFE_PATH_MAX_LENGTH - 1)
    assert.equal(safeInternalPath(edge, FALLBACK), edge)
  })

  it('kết quả luôn là path cùng origin khi dựng URL tuyệt đối', () => {
    const inputs = ['/news', '//evil.com', '/\\evil.com', '/\t/evil.com', '/%2Fevil.com', 'https://evil.com', ['//x']]
    for (const input of inputs) {
      const out = safeInternalPath(input, '/')
      assert.equal(new URL(out, 'https://conduonghuongthien.example').origin, 'https://conduonghuongthien.example', String(input))
    }
  })
})

describe('trang in bài dùng safeInternalPath (kiểm cấu trúc)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const source = readFileSync(path.join(root, 'app/pages/in-bai/[slug].vue'), 'utf8')

  it('backPath đi qua safeInternalPath và href không còn ghép `/${backPath}`', () => {
    assert.match(source, /safeInternalPath\(route\.query\.back/)
    assert.doesNotMatch(source, /href="`\/\$\{backPath\}`"/)
    assert.doesNotMatch(source, /`\/\$\{backPath\}`/)
    assert.match(source, /:href="backPath"/)
  })
})
