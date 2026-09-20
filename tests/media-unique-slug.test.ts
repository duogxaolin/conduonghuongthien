/**
 * Slug duy nhất cho mục media — và câu hỏi quan trọng hơn: nó chạy trên **client
 * nào**.
 *
 * Ràng buộc của tác vụ này không phải "sinh ra slug", mà là "sinh ra slug **trong
 * cùng transaction** với lượt ghi". Hai thứ đó khác nhau ở đúng một chỗ, và chỗ
 * đó không nhìn thấy được bằng mắt: một hàm nhận `db` rồi tự gọi `getDb()` bên
 * trong vẫn cho ra slug đúng, vẫn qua `typecheck`, vẫn qua mọi test chỉ khẳng
 * định chuỗi trả về — và chỉ hỏng khi hai lượt tạo chạy cùng lúc, dưới dạng một
 * lỗi UNIQUE mà cán bộ đọc thành "hệ thống lỗi".
 *
 * Nên test này khẳng định **truy vấn đi qua client được truyền vào**, và khẳng
 * định điều ngược lại: module không tự lấy kết nối từ pool. Khẳng định thứ hai
 * là một guard soi văn bản mã nguồn, và nó tồn tại vì đây đúng là hình dạng mà
 * một lần "đơn giản hoá" sau này sẽ tạo ra: bỏ tham số `client` đi, gọi thẳng
 * `getDb()`, và mọi thứ trông vẫn đúng.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { uniqueMediaSlug } from '../server/utils/unique-media-slug.ts'
import { slugify } from '../server/utils/slug.ts'

/**
 * Một client giao dịch giả: ghi lại **mọi** lượt gọi và trả về đúng những slug
 * đã có.
 *
 * Nó không mô phỏng MySQL và cố ý không cố làm điều đó. Điều nó phải chứng minh
 * là một câu hỏi về sự định tuyến — "lượt đọc này có đi qua client tôi đưa vào
 * không" — và một đối tượng ghi lại được lượt gọi trả lời câu đó chính xác hơn
 * một cơ sở dữ liệu thật, vì nó không thể vô tình trả lời đúng nhờ một kết nối
 * khác.
 */
function fakeTx(existingSlugs: string[]) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const chain = {
    from(...args: unknown[]) {
      calls.push({ method: 'from', args })
      return {
        async where(...whereArgs: unknown[]) {
          calls.push({ method: 'where', args: whereArgs })
          return existingSlugs.map(slug => ({ slug }))
        },
      }
    },
  }
  return {
    calls,
    select(...args: unknown[]) {
      calls.push({ method: 'select', args })
      return chain
    },
  }
}

describe('uniqueMediaSlug — slug sinh ra', () => {
  it('tiêu đề chưa dùng thì lấy thẳng slug hoá từ tiêu đề', async () => {
    const tx = fakeTx([])
    assert.equal(await uniqueMediaSlug(tx as never, 'Phóng sự tái hoà nhập'), 'phong-su-tai-hoa-nhap')
  })

  it('tiêu đề đã dùng thì thêm hậu tố nhỏ nhất còn trống', async () => {
    const tx = fakeTx(['phong-su', 'phong-su-2'])
    assert.equal(await uniqueMediaSlug(tx as never, 'Phóng sự'), 'phong-su-3')
  })

  it('hậu tố bắt đầu từ 2, không phải từ 1', async () => {
    // `-1` đọc ra như một phần của tiêu đề chứ không như một lượt đánh số, và
    // người đọc URL không phân biệt được hai thứ đó.
    const tx = fakeTx(['phong-su'])
    assert.equal(await uniqueMediaSlug(tx as never, 'Phóng sự'), 'phong-su-2')
  })

  it('bỏ qua chính hàng đang sửa, nên đổi tiêu đề không sinh hậu tố vô cớ', async () => {
    // Không có `excludeId`, sửa một mục mà giữ nguyên tiêu đề sẽ đụng chính nó
    // và đổi slug — làm chết mọi liên kết đã phát ra ngoài tới mục đó.
    const tx = fakeTx(['phong-su', 'phong-su-2'])
    assert.equal(await uniqueMediaSlug(tx as never, 'Phóng sự', 7), 'phong-su-3')
    // Và tiêu đề chưa ai dùng thì vẫn lấy thẳng, dù có `excludeId`.
    assert.equal(await uniqueMediaSlug(fakeTx([]) as never, 'Phóng sự', 7), 'phong-su')
  })

  it('tiêu đề không còn ký tự dùng được thì lùi về tiền tố, không trả chuỗi rỗng', async () => {
    // `slug` là NOT NULL UNIQUE. Một chuỗi rỗng sẽ chặn **mọi** mục thứ hai
    // không có tiêu đề dùng được — và thông báo lỗi cán bộ nhận sẽ là về ràng
    // buộc duy nhất, không nói gì về tiêu đề.
    for (const title of ['', '   ', '!!!', '🎬🎬🎬', '---']) {
      assert.equal(await uniqueMediaSlug(fakeTx([]) as never, title), 'video', `tiêu đề: "${title}"`)
    }
  })

  it('tiêu đề không phải chuỗi cũng lùi về tiền tố chứ không ném ra', async () => {
    for (const bad of [null, undefined, 42, { title: 'x' }, ['a']]) {
      assert.equal(await uniqueMediaSlug(fakeTx([]) as never, bad), 'video')
    }
  })

  it('slug dài bị cắt, để cột VARCHAR(512) không bao giờ là thứ từ chối lượt lưu', async () => {
    const long = 'a'.repeat(600)
    const slug = await uniqueMediaSlug(fakeTx([]) as never, long)
    assert.ok(slug.length <= 200, `slug dài ${slug.length} ký tự`)
    assert.ok(slug.length > 0)
  })

  it('tiêu đề chứa ký tự đại diện của LIKE bị lọc trước khi vào mẫu truy vấn', async () => {
    // `LIKE '<base>%'` chỉ an toàn vì `slugify` đã lọc `%` và `_` — hai ký tự đại
    // diện của `LIKE`. Không có bước đó, một tiêu đề chứa `%` biến lượt đọc tiền
    // tố thành một lượt quét toàn bảng: chậm dần theo số mục media, và không có
    // gì báo. Khẳng định này đặt ở `slugify` — nơi phép lọc thật sự xảy ra — chứ
    // không đi bới cấu trúc nội bộ của đối tượng SQL của drizzle, thứ sẽ đổi theo
    // phiên bản thư viện mà không nói gì về hành vi ở đây.
    for (const title of ['100% miễn phí', 'a_b_c', '%%%', '__']) {
      const base = slugify(title) || 'video'
      assert.doesNotMatch(base, /[%_]/, `slugify để lọt ký tự đại diện của LIKE: "${base}"`)
      // Và giá trị đó vẫn dùng được làm tiền tố.
      assert.equal(await uniqueMediaSlug(fakeTx([]) as never, title), base)
    }
  })
})

describe('uniqueMediaSlug — lượt đọc đi qua client được truyền vào', () => {
  it('mọi lượt truy vấn đều rơi vào client giao dịch', async () => {
    const tx = fakeTx([])
    await uniqueMediaSlug(tx as never, 'Phóng sự')
    // Ba lượt của chuỗi drizzle, và không lượt nào rời khỏi client này.
    assert.deepEqual(tx.calls.map(call => call.method), ['select', 'from', 'where'])
  })

  it('client giao dịch là tham số ĐẦU TIÊN, trước tiêu đề', async () => {
    // Đảo hai tham số sẽ khiến `uniqueMediaSlug(title, tx)` biên dịch được ở một
    // nơi gọi viết sai, và triệu chứng là một lượt đọc trên pool — im lặng.
    const tx = fakeTx([])
    const slug = await uniqueMediaSlug(tx as never, 'Phóng sự')
    assert.equal(slug, 'phong-su')
    assert.equal(tx.calls.length, 3, 'client được truyền vào không được dùng tới')
  })

  it('module không tự lấy kết nối từ pool', async () => {
    // Đây là guard cho hình dạng mà một lần "đơn giản hoá" sau này sẽ tạo ra:
    // bỏ tham số `client`, gọi thẳng `getDb()`. Slug vẫn đúng, `typecheck` vẫn
    // xanh, mọi test chỉ khẳng định chuỗi trả về vẫn xanh — và lượt đọc rời khỏi
    // transaction, nên hai lượt tạo cùng lúc cùng thấy "slug còn trống".
    //
    // `import type { getDb }` là cách dùng **kiểu**, không phải một giá trị chạy
    // được: nó bị xoá hoàn toàn lúc biên dịch và không thể tạo ra kết nối nào.
    // Cái bị chặn là một import **giá trị** cộng với một lượt gọi thật.
    const code = readFileSync(new URL('../server/utils/unique-media-slug.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /getDb\(\)/, 'module tự mở kết nối từ pool thay vì dùng client được truyền vào')
    assert.doesNotMatch(code, /import\s*\{[^}]*\bgetDb\b[^}]*\}\s*from/, 'module nhập `getDb` như một giá trị chạy được')
  })

  it('lượt ghi vẫn nằm trong transaction của nơi gọi, không phải ở đây', async () => {
    // Hàm này cố ý KHÔNG ghi gì: nó chỉ đọc để chọn slug, còn hàng và dòng audit
    // do nơi gọi ghi trong cùng một transaction. Một lượt `insert` ở đây sẽ tạo
    // ra một hàng thứ hai ngoài tầm kiểm của transaction đó.
    const code = readFileSync(new URL('../server/utils/unique-media-slug.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /\.insert\(|\.update\(|\.delete\(/, 'hàm chọn slug không được ghi gì')
  })
})
