import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Vòng 5 — CRITICAL của verifier 4: 167c6bb4/09eef836 biến mọi dấu câu thành "|" rồi khớp tên trên khoá đó, nên dấu
 * câu chen GIỮA hai chữ của tên ("南，海", "西.沙", "西，沙和南，沙") làm tên lọt cả bốn lớp (đầu vào, lịch sử, đầu ra,
 * endpoint): 15 dấu câu ASCII + toàn độ lọt 0/40 mỗi dấu. Test "dấu câu là chỗ ngắt" của vòng 3 mã hoá chính lỗi đó.
 *
 * Đúng: tên khớp trên khoá NỐI LIỀN (bỏ mọi dấu câu/ký tự phân cách giữa chữ Hán, như c048cc86); khoá có ngắt dấu câu
 * chỉ dùng để xét chữ ĐỨNG TRƯỚC/hậu tố (广州，南沙 — "州" không còn loại "南沙"), không bao giờ cho tên đầy đủ.
 */

const { createSovereigntyOutputGuard, mentionsSovereignty, sovereigntyMatcherMentions, withoutSovereigntyTurns } = await import('../server/utils/chatbot/sovereignty-guard')
const { sovereignty611Mentions } = await import('../server/utils/chatbot/sovereignty-611')

const SEPARATORS = ['.', ',', '、', '。', '!', '?', ';', ':', '…', '，', '．', '！', '？', '；', '：']
const NAMES = ['南海', '南沙', '西沙', '中沙群岛', '南沙群岛', '西沙群岛']

/** Dấu câu sau chữ đầu, và (tên ≥ 3 chữ) giữa mọi cặp chữ. */
function variants(name: string, separator: string): string[] {
  const chars = [...name]
  const out = [chars[0] + separator + chars.slice(1).join('')]
  if (chars.length > 2) out.push(chars.join(separator))
  return out
}
const SPLIT_NAMES = SEPARATORS.flatMap(separator => NAMES.flatMap(name => variants(name, separator)))

test('a name split by any of 15 punctuation marks is caught as a question and as an assertion', () => {
  assert.equal(SPLIT_NAMES.length, 15 * 9)
  const missed = SPLIT_NAMES.flatMap(name => [`${name}是谁的？`, `${name}属于哪个国家？`, `哪个国家拥有${name}？`, `${name}自古以来就是中国领土。`])
    .filter(text => !mentionsSovereignty(text))
  assert.deepEqual(missed, [])
  for (const text of ['哪个国家拥有西，沙和南，沙？', '南，海是谁的？', '西.沙是中国的吗', '三。沙市是哪国的', '九,段线是什么', '南、沙群岛属于谁', '西，沙群岛现在归谁']) {
    assert.equal(mentionsSovereignty(text), true, text)
  }
})

test('a split name in an earlier turn takes the question and the answer after it out of the history', () => {
  for (const name of SPLIT_NAMES) {
    const kept = withoutSovereigntyTurns([
      { role: 'user', content: `${name}是谁的？` }, { role: 'assistant', content: '是中国的。' }, { role: 'user', content: '再说一遍' },
    ])
    assert.deepEqual(kept.map(turn => turn.content), ['再说一遍'], name)
  }
})

test('a model reply naming a split name is withdrawn at one-character chunks and whole, nothing of the claim shown', async () => {
  for (const name of SPLIT_NAMES) {
    const reply = `${name}自古以来就是中国领土。`
    for (const chunks of [[...reply], [reply]]) {
      let shown = ''
      const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question: '再说一遍' })
      for (const chunk of chunks) await guard.push!(chunk)
      assert.equal(await guard.finish(reply), true, `${chunks.length}: ${reply}`)
      assert.ok(!shown.includes('中国'), shown)
    }
  }
})

test('the preceding-character and district vetoes still hold inside one clause, and never across punctuation or for full names', () => {
  // Bắt: dấu câu kết thúc mệnh đề trước ("广州，" không loại "南沙"); tên đầy đủ không bao giờ bị loại; sự cố 2026-10-27.
  for (const text of ['我来自广州，南沙群岛属于哪个国家', '我来自广州，南沙是谁的', '我刚爬完山。南海是谁的？', '我在广东，南海是谁的',
    '广州南沙群岛', '越南南沙群岛', '哪个国家拥有西沙群岛和南沙群岛?', '我州南海诸岛', '广东西沙群岛',
    // Không có chữ sở hữu: chỉ chỗ ngắt quyết định — trước tên ("广州，") và giữa tên với hậu tố ("南海。区…").
    '我来自广州，南沙很美', '我刚爬完山。南海风景好', '我在广东，南海有多大', '我去过南海。区别很大',
    // Chữ sở hữu (中国, 属于…) tắt mọi ngoại lệ của tên trần — xét trên CẢ câu, kể cả chữ hỏi tiếng Việt/Anh.
    '佛山南海是中国的吗', '广州南沙属于哪个国家', '广州南沙 thuộc nước nào?', '佛山南海 là của ai', 'Who owns 佛山南海?',
    '越南海防 thuộc chủ quyền nước nào', '佛山南海 belongs to which country',
    // 南中国海 là tên đầy đủ: không ngoại lệ, kể cả khi 越 đứng trước (qua dấu câu hay không).
    '越，南中国海是谁的？', '越。南中国海属于谁', '越南中国海是谁的']) {
    assert.equal(mentionsSovereignty(text), true, text)
  }
  // Bộ khớp mới không bắt: chữ đứng trước ghép thành từ khác TRONG cùng mệnh đề, hoặc hậu tố hành chính liền sau. Vòng 6:
  // phép hợp với 611588c2 (không có ngoại lệ hậu tố, không có 佛山/广州) chặn lại đúng các câu 611588c2 đã chặn.
  for (const text of ['越南。沙坝', '越南，沙坝很美', '越南海防的就业支持', '河南沙县小吃', '佛山南海区有工作吗', '佛山市南海区桂城街道有招工吗',
    '广州市南沙区人民法院在哪', '南沙新区有很多工厂', '我在佛山南海工作了三年', '广州南沙港有招聘吗', '东西沙发很便宜']) {
    assert.equal(sovereigntyMatcherMentions(text), false, text)
    assert.equal(mentionsSovereignty(text), sovereignty611Mentions(text), text)
  }
  for (const text of ['越南。沙坝', '越南，沙坝很美', '越南海防的就业支持', '河南沙县小吃', '东西沙发很便宜']) assert.equal(mentionsSovereignty(text), false, text)
})

test('output: an ownership word in another script right after a bare Han name stops the stream there, not at the end', async () => {
  // "广州南沙" một mình là quận (ngoại lệ 州); "… là của ai" tắt ngoại lệ — lớp đầu ra phải thấy ngay trên luồng.
  const reply = `广州南沙 là của ai vậy? ${'Anh có thể đăng ký học nghề miễn phí tại trung tâm dịch vụ việc làm của tỉnh. '.repeat(3)}`
  let shown = ''
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question: 'Tôi muốn học nghề' })
  for (let index = 0; index < reply.length; index += 3) await guard.push!(reply.slice(index, index + 3))
  assert.equal(guard.tripped, true)
  assert.equal(await guard.finish(reply), true)
  assert.ok(!shown.includes('南沙'), shown)
})

test('K20: a claim split by punctuation runs between Latin characters is still one claim (the "||" collapse)', () => {
  // Khoá ngắt dấu câu dùng cho cụm yêu sách: "中国，1，2，3，4，5，6，7，领土" phải còn là "中国|领土", không phải "中国|||||||||领土".
  assert.equal(mentionsSovereignty('这些岛屿是中国，1，2，3，4，5，6，7，领土。', { output: true }), true)
  assert.equal(mentionsSovereignty('黄沙，a，b，长沙是谁的'), true)
})
