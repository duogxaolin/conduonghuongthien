import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Đợt 3 (2026-10-31, chủ dự án quyết): yêu sách viết chữ PHỒN THỂ phải bị thay như bản giản thể. Vòng 7 thêm cụm
 * 归/为…所有 và 中国…拥有 + 这/该… mà không thêm dạng phồn thể của các chữ đó vào bảng gộp (`HAN_FOLD`,
 * `sovereignty-normalize.ts`), trái quy tắc của vòng 6b ("mọi chữ của mẫu yêu sách có dạng phồn thể") — nên
 * "中國擁有這些島嶼" lọt trong khi "中国拥有这些岛屿" bị thay (verifier v8: O-zht-002 "中國擁有那些島礁"). Sửa ở bảng gộp:
 * 擁 → 拥 cùng ba chữ phồn thể mà chính các cụm đó cần (這 → 这, 為/爲 → 为, 該 → 该). Không thêm ngoại lệ, không đổi cụm.
 */

const { createSovereigntyOutputGuard, mentionsSovereignty } = await import('../server/utils/chatbot/sovereignty-guard')
const { sovereigntyFold } = await import('../server/utils/chatbot/sovereignty-normalize')

const split = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size))
async function stream(question: string, chunks: string[]) {
  let shown = ''
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question })
  for (const chunk of chunks) await guard.push!(chunk)
  return { tripped: await guard.finish(chunks.join('')), shown }
}
/** Mọi cách chia: chunk 1–5, cả câu, mọi chỗ cắt đôi. */
function chunkings(text: string): string[][] {
  const out = [...[1, 2, 3, 4, 5].map(size => split(text, size)), [text]]
  for (let cut = 1; cut < text.length; cut += 1) out.push([text.slice(0, cut), text.slice(cut)])
  return out
}

/** [câu trả lời phồn thể, bản giản thể] — mỗi câu phồn thể lọt trên mã trước bản sửa (f58c7584), bản giản thể thì không. */
const TWINS: Array<[traditional: string, simplified: string]> = [
  ['中國擁有這些島嶼。', '中国拥有这些岛屿。'],
  ['簡單來說，中國擁有那些島礁。', '简单来说，中国拥有那些岛礁。'],
  ['中國一直擁有整個群島。', '中国一直拥有整个群岛。'],
  ['中國擁有該島礁。', '中国拥有该岛礁。'],
  ['這些島嶼歸為中國所有。', '这些岛屿归为中国所有。'],
  ['這些島嶼為中國所有。', '这些岛屿为中国所有。'],
  ['這些島嶼爲中國所有。', '这些岛屿为中国所有。'],
]

test('a claim written in traditional characters is replaced exactly like its simplified twin, on /api/chat and on every chunking, nothing of the claimant shown', async () => {
  for (const [traditional, simplified] of TWINS) {
    for (const [reply, claimant] of [[simplified, '中国'], [traditional, '中國']] as const) {
      assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question: '請問' }).finish(reply), true, reply)
      for (const chunks of chunkings(reply)) {
        const { tripped, shown } = await stream('請問', chunks)
        assert.equal(tripped, true, `${chunks.map(chunk => chunk.length).join('+')}: ${reply}`)
        assert.ok(!shown.includes(claimant), `${chunks.map(chunk => chunk.length).join('+')}: ${shown}`)
      }
    }
  }
})

test('the fold does not move the trigger: traditional replies without island/sea, or with an island and no claim, go through as their simplified twins do', async () => {
  for (const [traditional, simplified] of [
    ['中國擁有這麼多工廠，您可以去那裡找工作。', '中国拥有这么多工厂，您可以去那里找工作。'],
    ['那個工廠為中國所有，您在那裡工作並不違法。', '那个工厂为中国所有，您在那里工作并不违法。'],
    ['中國擁有很多海島旅遊資源，您可以考慮從事旅遊相關工作。', '中国拥有很多海岛旅游资源，您可以考虑从事旅游相关工作。'],
    ['如果您曾在海南島服刑，回國後請到當地公安機關登記。該程序是越南的法律規定。', '如果您曾在海南岛服刑，回国后请到当地公安机关登记。该程序是越南的法律规定。'],
  ]) {
    for (const reply of [simplified, traditional]) {
      assert.equal(mentionsSovereignty(reply, { output: true }), false, reply)
      for (const size of [1, 3, reply.length]) {
        const { tripped, shown } = await stream('我曾在中國服刑', split(reply, size))
        assert.equal(tripped, false, `${size}: ${reply}`)
        assert.equal(shown, reply)
      }
    }
  }
})

test('"China owns it" is still replaced (owner\'s decision: keep it)', async () => {
  for (const [question, reply] of [['Who owns Money Island?', 'China owns it.'], ['Which country owns those islands?', 'China owns them.']]) {
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question }).finish(reply), true, reply)
    for (const chunks of chunkings(reply)) {
      const { tripped, shown } = await stream(question, chunks)
      assert.equal(tripped, true, `${chunks.map(chunk => chunk.length).join('+')}: ${reply}`)
      assert.ok(!shown.includes('China'), shown)
    }
  }
})

// Mỗi chữ Hán trong mẫu yêu sách / ngữ cảnh đảo của `sovereignty-claims.ts` phải được xếp vào một nhóm: giống nhau ở hai lối
// viết, hoặc có dạng phồn thể (và dạng biến thể/Nhật) mà bảng gộp đưa về đúng nó. Thêm cụm mới với chữ chưa xếp → test đỏ,
// buộc người thêm quyết định chữ đó có dạng phồn thể không — lỗ của vòng 7 không lặp lại âm thầm.
const SAME_IN_BOTH = new Set('一中主人以全共其分古和固土地域它所整方是有此民海的礁管自那部')
const TRADITIONAL_FORMS: Record<string, string> = {
  个: '個', 为: '為爲', 于: '於', 华: '華', 国: '國囯', 属: '屬', 岛: '島嶋嶌', 归: '歸帰', 拥: '擁', 权: '權権', 来: '來',
  群: '羣', 该: '該', 辖: '轄', 这: '這', 领: '領',
}
// Chữ thử nối sau khoá giữa luồng (`HAN_SETTLE_PROBE`), không bao giờ khớp với chữ model viết; dạng phồn thể 區 cố ý KHÔNG gộp
// (hậu tố loại trừ — chú thích của `HAN_FOLD`).
const PROBE_ONLY = new Set('区')

test('every Han character of the claim and island patterns is classified, and each traditional form folds to it', () => {
  const source = readFileSync(new URL('../server/utils/chatbot/sovereignty-claims.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  // Bỏ chú thích bằng regex có thể nuốt cả mã ("/*" trong một chuỗi mở một khối giả) — khi đó test này thành im lặng.
  for (const pattern of ['COUNTRY_HAN = [', 'HAN_CLAIMS = new RegExp', 'HAN_END_CLAIM = new RegExp', 'ISLAND_HAN = /', 'QUESTION_ISLAND_HAN = /']) {
    assert.ok(source.includes(pattern), `mất mẫu sau khi bỏ chú thích: ${pattern}`)
  }
  const used = new Set(source.match(/\p{Script=Han}/gu))
  assert.ok(used.size > 30, `${used.size} chữ`)
  for (const char of used) {
    assert.ok(SAME_IN_BOTH.has(char) || Object.hasOwn(TRADITIONAL_FORMS, char) || PROBE_ONLY.has(char), `chữ chưa xếp nhóm: ${char}`)
  }
  for (const [simplified, forms] of Object.entries(TRADITIONAL_FORMS)) {
    assert.ok(used.has(simplified), `${simplified} không còn trong mẫu — gỡ khỏi bảng của test`)
    for (const form of forms) assert.equal(sovereigntyFold(form), simplified, form)
  }
  for (const char of SAME_IN_BOTH) assert.equal(sovereigntyFold(char), char, char)
})
