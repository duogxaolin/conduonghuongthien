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

/**
 * Bỏ nội dung chuỗi ký tự khỏi một dòng trước khi tìm định danh.
 *
 * `\bid\b` khớp chữ "id" trong câu `throw new Error('… returned no id')` — một
 * thông điệp lỗi bằng tiếng Anh, không phải một phép đọc biến. Đây là dương tính
 * giả đã xảy ra thật với `chatbot-small-talk.ts`, và nó tệ hơn một lỗi thường: nó
 * dạy người đọc rằng guard này ồn, và bước tiếp theo của bài học đó là tắt nó đi.
 */
function withoutStringLiterals(line: string): string {
  return line
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/**
 * Bỏ KHOÁ của object literal trước khi tìm định danh.
 *
 * Trong `meta: { deletedCount: count }`, chữ `deletedCount` là **tên trường**
 * của dòng audit, không phải phép đọc biến `deletedCount` đang trong TDZ. Đây là
 * dương tính giả thứ ba của cùng cổng này (sau nội dung chuỗi ký tự và
 * `.property`), và nó xuất hiện ở đúng chỗ quy ước của dự án dẫn tới: một
 * transaction trả về một con số rồi ghi con số đó vào `meta` dưới cùng cái tên.
 * Tức là càng viết đúng quy ước thì càng dễ bị cổng này báo oan — và bước tiếp
 * theo của bài học "cổng này ồn" là tắt nó đi.
 *
 * Chỉ bỏ khi định danh đứng ĐẦU DÒNG, ngay sau `{`, hoặc ngay sau `,`. Một phép
 * đọc thật trong nhánh ternary (`cond ? deletedCount : 0`) đứng sau `? ` nên
 * không khớp; bỏ mọi `định danh:` sẽ làm guard mù với đúng nhánh đó.
 */
function withoutObjectKeys(line: string): string {
  return line.replace(/(^|[{,])(\s*)[A-Za-z_$][\w$]*\s*:/g, '$1$2_:')
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
        .filter(line => !line.startsWith('//') && !line.startsWith('*'))
        .map(withoutStringLiterals)
        .map(withoutObjectKeys)
        // `(?<![.\w$])` chặn khớp sau một dấu chấm: `result.id` là một thuộc tính
        // của giá trị khác, không phải biến đang trong TDZ. Không có nó thì mọi
        // transaction gán vào một biến tên `id` đều đỏ ngay khi bên trong có bất
        // cứ phép đọc `.id` nào — tức là hầu như luôn luôn.
        .filter(line => new RegExp(`(?<![.\\w$])${variable}\\b`).test(line))

      it(`${file}: \`${variable}\` không được đọc trong chính khối của nó`, () => {
        assert.deepEqual(offenders, [],
          `\`${variable}\` còn trong TDZ suốt callback — dùng giá trị cục bộ (thường là \`created\`) `
          + `rồi \`return\` nó. Đây là lỗi LÚC CHẠY mà typecheck và build đều không thấy.`)
      })
    }
  }
})

/**
 * Kiểm chứng âm tính: phần nới lỏng ở trên KHÔNG làm guard ngừng bắt lỗi thật.
 *
 * Guard vừa được nới hai lần — bỏ nội dung chuỗi ký tự, và bỏ khớp sau dấu chấm —
 * và mỗi lần nới một cổng là một cơ hội để nó trở thành cổng không kiểm gì cả.
 * Riêng dạng hỏng đó thì im lặng: một guard đã ngừng chặn đọc ra y hệt một guard
 * đang chạy đúng, vì cả hai đều xanh.
 *
 * Nên phần phát hiện được chạy lại ở đây trên các mẫu dựng tay: một nhóm **phải**
 * bị bắt (đúng hình dạng đã làm mọi lượt tạo bài viết trả 500), một nhóm **không
 * được** bị bắt (đúng ba dương tính giả đã sửa).
 */
describe('phần phát hiện TDZ vẫn bắt được lỗi thật sau khi nới', () => {
  function detects(body: string, variable: string): boolean {
    return body
      .split('\n')
      .map(line => line.trim())
      .filter(line => !line.startsWith('//') && !line.startsWith('*'))
      .map(withoutStringLiterals)
      .map(withoutObjectKeys)
      .some(line => new RegExp(`(?<![.\\w$])${variable}\\b`).test(line))
  }

  it('bắt được phép đọc trần — đúng hình dạng đã trả 500 ở bốn endpoint', () => {
    assert.ok(
      detects("await tx.insert(activityLogs).values({ resourceId: newArticleId })", 'newArticleId'),
      'guard đã ngừng chặn chính lỗi nó ra đời để chặn',
    )
  })

  it('bắt được phép đọc nằm sâu trong một biểu thức', () => {
    assert.ok(detects('meta: { id: Number(created), n: 1 }', 'created'))
  })

  it('KHÔNG bắt một thuộc tính cùng tên', () => {
    assert.ok(
      !detects('const created = Number(result.id)', 'id'),
      '`result.id` là thuộc tính của giá trị khác — bắt nó là làm mọi transaction tên `id` đỏ',
    )
  })

  it('KHÔNG bắt một khoá object literal cùng tên', () => {
    // Đúng dương tính giả vừa gặp: `deletedCount: count` trong
    // `activityLogs.values({ deletedCount: count, … })` khi biến TDZ tên là
    // `deletedCount` — khoá đứng bên trái dấu `:` không phải phép đọc biến.
    assert.ok(
      !detects('await tx.insert(activityLogs).values({ deletedCount: count })', 'deletedCount'),
      '`deletedCount:` là khoá object literal, không phải phép đọc biến `deletedCount`',
    )
  })

  it('vẫn bắt phép đọc biến đứng ngay sau một khoá object literal', () => {
    // Khoá và giá trị có thể trùng chữ ở hai bên dấu `:` — bộ lọc phải xoá đúng
    // phần khoá và để lại phần giá trị cho vòng kiểm định danh còn lại.
    assert.ok(
      detects('await tx.insert(activityLogs).values({ resourceId: deletedCount })', 'deletedCount'),
      'giá trị bên phải dấu `:` vẫn là một phép đọc biến thật, guard không được bỏ qua nó',
    )
  })

  it('KHÔNG bắt chữ nằm trong một thông điệp lỗi', () => {
    assert.ok(
      !detects("if (!result) throw new Error('insert returned no id')", 'id'),
      'chữ "id" trong một câu tiếng Anh không phải một phép đọc biến',
    )
  })
})
