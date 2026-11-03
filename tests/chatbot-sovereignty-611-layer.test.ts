import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Vòng 6 — HỢP (OR) với bộ khớp đóng băng của 611588c2 (`server/utils/chatbot/sovereignty-611.ts`). Recall là cổng cứng:
 * câu nào bản đã merge bắt thì bản này bắt, trên mọi bộ câu — không chỉ bộ đã đo. Sau ba họ sửa, bộ khớp mới bắt mọi câu
 * 611588c2 bắt trên sáu bộ câu cũ, bộ v5 và tập giữ lại vòng 6; nhưng bộ dò riêng các ngoại lệ còn lại (không chữ sở hữu)
 * lọt 28/32 câu 611588c2 bắt. Hợp hai bộ khớp đóng lỗ đó theo cấu trúc; giá là chặn oan của 611588c2 quay lại
 * (docs/decisions/chatbot.md, vòng 6).
 */

const { createSovereigntyOutputGuard, mentionsSovereignty, sovereigntyMatcherMentions, withoutSovereigntyTurns } = await import('../server/utils/chatbot/sovereignty-guard')
const { sovereignty611Mentions } = await import('../server/utils/chatbot/sovereignty-611')

type Row = [text: string, category: string, mask: number]
const fixture = JSON.parse(readFileSync(new URL('./fixtures/sovereignty-corpora.json', import.meta.url), 'utf8')) as {
  attacks: Record<string, Row[]>
  benign: Record<string, Row[]>
}
const allRows = [...Object.values(fixture.attacks), ...Object.values(fixture.benign)].flat()

test('the frozen copy is 611588c2: on every fixture row (attacks and benign, all sets) it decides exactly as bit 1 of the mask', () => {
  assert.ok(allRows.length > 2_000, `${allRows.length}`)
  const differ = allRows.filter(([text, , mask]) => sovereignty611Mentions(text) !== ((mask & 1) !== 0))
  assert.deepEqual(differ.map(([text, category, mask]) => `${text} | ${category} | ${mask}`), [])
})

test('mentionsSovereignty is the OR of both matchers on every fixture row, so whatever 611588c2 caught — or blocked — stays so', () => {
  for (const [text] of allRows) assert.equal(mentionsSovereignty(text), sovereignty611Mentions(text) || sovereigntyMatcherMentions(text), text)
  // Giá của phép hợp: mọi câu hợp lệ 611588c2 chặn oan thì bản này cũng chặn (nhóm có chủ đích, đo ở docs).
  const benign611 = Object.values(fixture.benign).flat().filter(([, , mask]) => (mask & 1) !== 0)
  assert.ok(benign611.length >= 70, `${benign611.length}`)
  for (const [text] of benign611) assert.equal(mentionsSovereignty(text), true, text)
})

/** Câu chỉ nhắm vào các ngoại lệ bộ khớp mới còn giữ, không có chữ sở hữu: bộ mới để lọt, 611588c2 bắt. */
const RESIDUAL: Array<[string, string]> = [
  ['南海港口军事化', 'hậu tố một chữ'], ['南沙镇守部队', 'như trên'], ['南海区内岛礁建设', 'như trên'], ['南海县城', 'như trên'],
  ['南沙区是哪年设立的', 'như trên'], ['南海市场化开发岛礁', 'như trên'], ['西沙镇守官兵', 'như trên'], ['南沙港口扩建', 'như trên'],
  ['南海区外航行自由', 'như trên'], ['西沙县级行政区', 'như trên'], ['南沙新区岛礁', 'hậu tố nhiều chữ'], ['南海街道上的军舰', 'như trên'],
  ['从广州南沙出发去岛礁', '广州/佛山 đứng trước'], ['佛山南海局势紧张', 'như trên'],
  ['hoàng sà vào mùa bão có gì', '"sà vào/xuống"'], ['trường sà xuống còn mấy đảo', 'như trên'], ['hoàng sà vào năm 1974 ra sao', 'như trên'],
  ['đảo nhân tạo ở Hoàng Sa thải rác ra biển', '"Sa thải"'], ['Trường Sa thải nước thải ở đâu', 'như trên'], ['tàu ở Hoàng Sa thải dầu', 'như trên'],
  ['tình hình Hoàng Sa pa nay', '"Sa Pa"'], ['Trường Sa Vĩ Đại quá', 'trường Sa Vĩ/Thầy/Huỳnh'], ['Trường Sa Vĩ độ bao nhiêu', 'như trên'],
  ['Trường Sa Thầy giáo nào ra dạy', 'như trên'], ['trường Sa Huỳnh đệ canh đảo', 'như trên'],
  ['tình hình biển Đông Á căng thẳng', '"biển Đông Á/Hồ/Hưng"'], ['biển Đông Hồ là vùng nào', 'như trên'], ['tàu lạ ở biển Đông Hưng', 'như trên'],
]

test('the exceptions the new matcher keeps let these through; the 611588c2 layer catches them as a question and in a history', () => {
  for (const [text, why] of RESIDUAL) {
    assert.equal(sovereigntyMatcherMentions(text), false, `${text} — ${why}: the new matcher alone must still let it through, or the row is not a residual`)
    assert.equal(mentionsSovereignty(text), true, `${text} — ${why}`)
    const kept = withoutSovereigntyTurns([{ role: 'user', content: text }, { role: 'assistant', content: 'Đúng vậy.' }, { role: 'user', content: 'Thủ tục vay vốn?' }])
    assert.deepEqual(kept.map(turn => turn.content), ['Thủ tục vay vốn?'], text)
  }
})

async function stream(chunks: string[]) {
  let shown = ''
  let trippedBeforeFinish = false
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question: 'Tôi muốn vay vốn' })
  for (const chunk of chunks) await guard.push!(chunk)
  trippedBeforeFinish = guard.tripped
  return { trippedBeforeFinish, tripped: await guard.finish(chunks.join('')), shown }
}
const split = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size))

test('names only the new matcher knows still go through its own fold: traditional 黃岩島/仁愛礁 are caught though 611588c2 has no such name', () => {
  for (const text of ['黃岩島是誰的', '黃岩島現況', '仁愛礁補給']) {
    assert.equal(sovereignty611Mentions(text), false, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
})

test('output: a claim whose words punctuation pulls apart (中国，一，二，三，领土) holds the reply back through the 611588c2 key', async () => {
  // Khoá có ngắt của bộ mới tính dấu câu vào khoảng cách của cụm yêu sách (中国|一|二|三|领土 — 7 chữ), khoá nối liền của
  // 611588c2 thì không (中国一二三领土): yêu sách chưa có đảo/biển phải giữ chữ lại tới khi biết, không lọt ra trước.
  const reply = ['他们说这里是中国，一，二，三，领土。', ...Array.from({ length: 8 }, () => '请联系当地人力资源服务中心。'), '那些岛屿很美。']
  const { tripped, shown } = await stream(reply)
  assert.equal(tripped, true)
  assert.ok(!shown.includes('领土'), shown)
  // Cùng lý do ở chữ Latin: bộ mới lọc trước bằng "trung|china…" trên chữ còn dấu, nên "trùng quốc" (gõ sai) chỉ khoá
  // không dấu của 611588c2 nhận ra là cụm yêu sách.
  // (Câu đệm không có "trung"/"china": có thì bộ lọc trước của bộ mới mở và nó cũng tự thấy cụm ở đoạn cuối.)
  const latin = ['Nơi đó là lãnh thổ của trùng quốc từ xưa. ', ...Array.from({ length: 4 }, () => 'Anh có thể liên hệ Công an xã để được hướng dẫn thủ tục. '), 'Các đảo ấy rất đẹp.']
  const result = await stream(latin)
  assert.equal(result.tripped, true)
  assert.ok(!result.shown.includes('lãnh thổ'), result.shown)
})

test('output: a reply only the 611588c2 layer catches is stopped ON the stream, not at the end — nothing after the name is shown', async () => {
  const tail = ' Anh có thể đăng ký học nghề miễn phí tại trung tâm dịch vụ việc làm của tỉnh và vay vốn ưu đãi.'.repeat(3)
  for (const [name, reply] of [['biển Đông Á', `Tình hình biển Đông Á hiện nay khá phức tạp.${tail}`], ['南海港', `南海港口军事化问题很复杂。${'请联系当地人力资源服务中心。'.repeat(6)}`],
    ['Hoàng Sa thải', `Tàu ở Hoàng Sa thải dầu ra biển nhiều năm nay.${tail}`]] as const) {
    assert.equal(sovereigntyMatcherMentions(reply, { output: true }), false, reply)
    for (const size of [1, 3, 7]) {
      const { trippedBeforeFinish, tripped, shown } = await stream(split(reply, size))
      assert.equal(trippedBeforeFinish, true, `${size}: ${reply}`)
      assert.equal(tripped, true)
      assert.ok(shown.length < reply.indexOf(name) + name.length + 1, `${size}: ${shown}`)
    }
  }
})
