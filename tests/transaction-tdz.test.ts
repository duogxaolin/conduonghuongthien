/**
 * Không biến nào của `db.transaction()` được đọc từ BÊN TRONG khối của chính nó.
 *
 * `const id = await db.transaction(async (tx) => { … })` tạo một biến còn trong
 * vùng chết tạm thời (TDZ) suốt thời gian callback chạy. Đọc nó ở trong ném
 * `ReferenceError: Cannot access 'id' before initialization` — **lúc chạy**, và
 * chỉ khi endpoint được gọi thật.
 *
 * Đây không phải giả thuyết. Việc bọc audit vào transaction đã tạo ra đúng lỗi
 * này ở **bốn** endpoint tạo mới (bài viết, tải ảnh, thêm block, tạo vai trò):
 * dòng audit viết `resourceId: newArticleId` thay vì `resourceId: created`, nên
 * **mọi lượt tạo bài viết trả 500**. Nó lọt qua `typecheck` (biến có tồn tại, và
 * kiểu đúng), qua `db:drift`, qua `npm run build`, và qua **cả 1187 test** — vì
 * không cổng nào trong số đó gọi endpoint thật. Chỉ một máy chủ đang chạy mới
 * phản đối.
 *
 * Test này soi văn bản mã nguồn, nên nó **không** chứng minh endpoint chạy được;
 * nó chỉ chặn đúng hình dạng đã hỏng một lần. Phần chứng minh hành vi là việc
 * của `tests/e2e/**` và của một lượt chạy thử trên máy chủ thật.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * Thân của một khối `db.transaction(...)`, tìm bằng cách đếm ngoặc nhọn.
 *
 * Đếm ngoặc chứ không dò thụt lề: thụt lề khác nhau giữa handler và service, và
 * một lần đoán sai độ sâu là một guard **im lặng không kiểm gì cả** — đúng loại
 * hỏng mà chính test này ra đời để chặn.
 */
function transactionBody(source: string, startIndex: number): string {
  const open = source.indexOf('{', startIndex)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return ''
}

describe('không có tham chiếu TDZ trong khối db.transaction', () => {
  const files = [...walk('server/api'), ...walk('server/services')]

  it(`quét ${files.length} tệp máy chủ`, () => {
    assert.ok(files.length > 100, 'danh sách tệp co lại bất thường — kiểm tra lại đường dẫn')
  })

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const pattern = /(?:const|let)\s+(\w+)\s*=\s*await\s+\w+\.transaction\s*\(/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      const variable = match[1]!
      const body = transactionBody(source, match.index + match[0].length - 1)
      const offenders = body
        .split('\n')
        .map(line => line.trim())
        .filter(line => new RegExp(`\\b${variable}\\b`).test(line))
        .filter(line => !line.startsWith('//') && !line.startsWith('*'))

      it(`${file}: \`${variable}\` không được đọc trong chính khối của nó`, () => {
        assert.deepEqual(offenders, [],
          `\`${variable}\` còn trong TDZ suốt callback — dùng giá trị cục bộ (thường là \`created\`) `
          + `rồi \`return\` nó. Đây là lỗi LÚC CHẠY mà typecheck và build đều không thấy.`)
      })
    }
  }
})
