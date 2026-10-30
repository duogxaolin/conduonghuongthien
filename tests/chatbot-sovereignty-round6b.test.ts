import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Vòng 6b (2026-10-30) — verifier 6 (bộ câu thứ sáu, 1062 tấn công / 345 hợp lệ): quyết định cuối không lọt union, nhưng
 * phép hợp với 611588c2 GIỮA LUỒNG không tương đương bản gốc, và yêu sách viết chữ PHỒN THỂ lọt ở mọi phiên bản.
 */

const { createSovereigntyOutputGuard, mentionsSovereignty } = await import('../server/utils/chatbot/sovereignty-guard')

const SEPARATORS = ['，', '、', '。', ',', '.', '；', '：', '！', '？', '…']
const claimSplit = (separator: string) => [...'中国对这些岛屿一直都拥有主权'].join(separator)

async function stream(chunks: string[], question = '请问一下') {
  let shown = ''
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question })
  for (const chunk of chunks) await guard.push!(chunk)
  const midStream = guard.tripped
  return { midStream, tripped: await guard.finish(chunks.join('')), shown }
}
const split = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size))
const TAIL = ' 如需更多信息，请告诉我。祝您生活愉快，身体健康！我们还可以讨论就业、贷款和职业培训等话题。'

test('a Han claim whose characters punctuation pulls apart is stopped ON the stream, as 611588c2 stops it — nothing of it shown', async () => {
  // Cửa sổ chữ Hán của lớp 611588c2 từng cắt 24 ký tự trên khoá CÓ dấu ngắt rồi mới nối: "中，国，对，…" chỉ còn ~12 chữ, cụm
  // 中国…主权 không lọt vào cửa sổ, chỉ `finish` bắt — 25–33 ký tự yêu sách đã tới khách (provider lỗi trước `finish` thì ở lại).
  for (const separator of SEPARATORS) {
    for (const reply of [`关于这些岛屿：${claimSplit(separator)}${TAIL}`, `关于这个问题：${claimSplit(separator)}。这些岛屿很美。${TAIL}`]) {
      for (const size of [1, 2, 3]) {
        const { midStream, tripped, shown } = await stream(split(reply, size))
        assert.equal(midStream, true, `${size}: ${reply}`)
        assert.equal(tripped, true)
        assert.equal(shown, '', `${size}: ${shown}`)
      }
    }
  }
})

test('/api/chat (no stream) and finish: a punctuation-split Han claim is withdrawn by the answer alone', async () => {
  for (const separator of SEPARATORS) {
    const guard = createSovereigntyOutputGuard({ replace: () => {}, question: '请问一下' })
    assert.equal(await guard.finish(`关于这些岛屿：${claimSplit(separator)}${TAIL}`), true, separator)
    assert.equal(mentionsSovereignty(`关于这些岛屿：${claimSplit(separator)}。`, { output: true }), true, separator)
  }
})
