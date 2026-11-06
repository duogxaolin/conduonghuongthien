import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Bản kho kiến thức giữ trong bộ nhớ (`publishedEntries`, `server/utils/chatbot/chat.ts`, 60 s) gắn với
 * phiên bản cache câu trả lời mà nó được nạp dưới.
 *
 * Lỗi gốc (2026-11-06): cán bộ sửa một câu trả lời sai trong kho → tăng phiên bản → trong 60 s, lượt hỏi
 * tính khoá với phiên bản MỚI nhưng truy xuất trên bản kho CŨ còn trong bộ nhớ → câu trả lời từ dữ liệu
 * cũ được ghi dưới khoá mới và phát lại tới 30 ngày. Phiên bản khác ⇒ phải nạp lại NGAY.
 */

let loads = 0
const fakeDb = {
  select: () => ({
    from: () => ({
      where: async () => {
        loads += 1
        return []
      },
    }),
  }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => null } })

const { publishedEntries } = await import('../server/utils/chatbot/chat')

test('the same version reuses the copy; a new version reloads at once; no version reuses whatever is fresh', async () => {
  await publishedEntries(3)
  assert.equal(loads, 1)
  await publishedEntries(3)
  assert.equal(loads, 1, 'same version inside the 60 s window must not hit the database')

  await publishedEntries(4)
  assert.equal(loads, 2, 'a bumped version must reload instead of serving the pre-edit copy')

  // Lượt tra câu gợi ý trong cùng lượt hỏi gọi không kèm phiên bản: dùng bản vừa nạp.
  await publishedEntries()
  assert.equal(loads, 2)

  // Bản nạp dưới phiên bản cũ hơn (lượt hỏi chậm, đọc phiên bản trước lần tăng) cũng không được dùng cho phiên bản mới.
  await publishedEntries(3)
  assert.equal(loads, 3)
  await publishedEntries(4)
  assert.equal(loads, 4)
})
