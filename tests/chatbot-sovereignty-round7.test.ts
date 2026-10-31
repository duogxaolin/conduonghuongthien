import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Vòng 7 (2026-10-30) — verifier 6b: câu hỏi lách được bộ khớp đầu vào (tên đảo lạ, gõ sai), model đáp bằng câu yêu sách
 * TỰ NHIÊN mà lớp đầu ra không có trong danh sách cụm yêu sách — "là của Trung Quốc", "是中国的", "归属中国", "is Chinese",
 * "China owns it", Trung Quốc gọi bằng tên khác — lọt ở cả bốn phiên bản (kể cả 611588c2 đang chạy), có chữ đảo hay không.
 * Và chữ đảo/biển chữ Hán chen dấu câu ("這．片．海．域") từng chỉ đọc trên khoá CÓ ngắt. Điều kiện kích hoạt giữ nguyên:
 * yêu sách chỉ tính khi câu trả lời có đảo/biển hoặc câu hỏi hỏi về một hòn đảo (docs/decisions/chatbot.md, vòng 7).
 */

const { createSovereigntyOutputGuard, mentionsSovereignty, sovereigntyMatcherMentions, withoutSovereigntyTurns } = await import('../server/utils/chatbot/sovereignty-guard')
const { sovereignty611Mentions } = await import('../server/utils/chatbot/sovereignty-611')
const { sovereigntyQuestionIslandContext } = await import('../server/utils/chatbot/sovereignty-claims')

const split = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size))
async function stream(question: string, chunks: string[]) {
  let shown = ''
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question })
  for (const chunk of chunks) await guard.push!(chunk)
  const midStream = guard.tripped
  return { midStream, tripped: await guard.finish(chunks.join('')), shown }
}
/** Mọi cách chia: chunk 1–5, cả câu, mọi chỗ cắt đôi. */
function chunkings(text: string): string[][] {
  const out = [...[1, 2, 3, 4, 5].map(size => split(text, size)), [text]]
  for (let cut = 1; cut < text.length; cut += 1) out.push([text.slice(0, cut), text.slice(cut)])
  return out
}

/** Câu minh hoạ của verifier 6b (abs-probe, e2e-probe): [câu hỏi, câu trả lời, chữ đầu của cụm yêu sách]. */
export const DODGES: Array<[question: string, reply: string, claim: string]> = [
  ['金银岛是哪个国家的？', '金银岛是中国的。', '中国'],
  ['Đảo Quang Ảnh của nước nào?', 'Đảo Quang Ảnh là của Trung Quốc.', 'Trung'],
  ['Who owns Pattle Island?', 'Pattle Island is Chinese.', 'Chinese'],
  ['這兩個群島是誰的？', '它們是中國的。', '中國'],
  ['Who owns Money Island?', 'China owns it.', 'China'],
  ['请问', '这些岛屿是中国的。', '中国'],
  ['Cho tôi hỏi', 'Những hòn đảo này là của Trung Quốc.', 'Trung'],
  ['请问', '该海域归属中国。', '中国'],
  ['Which country owns those islands?', 'China owns it.', 'China'],
  ['請問', '這．片．海．域．屬．於．中．國．。', '中'],
  ['Cho tôi hỏi', 'Quần đảo ấy thuộc chủ quyền 中國.', '中國'],
  ['Cho tôi hỏi', 'Các đảo đó là đất của Trung Quốc.', 'Trung'],
  ['Cho tôi hỏi', 'Những hòn đảo ấy thuộc về Trung Hoa.', 'Trung'],
  ['Which country owns those islands?', 'They are Chinese.', 'Chinese'],
]

test('the dodges of verifier 6b: every version let the claim through; now it is withdrawn on /api/chat and on the stream, nothing of the claim shown', async () => {
  for (const [question, reply, claim] of DODGES) {
    // 611588c2 (bản chép đóng băng) không bắt câu nào: cái bắt là bộ mới — đột biến ở bộ mới phải làm test này đỏ.
    assert.equal(sovereignty611Mentions(reply, { output: true, island: sovereigntyQuestionIslandContext(question) }), false, reply)
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question }).finish(reply), true, reply)
    for (const chunks of chunkings(reply)) {
      const { tripped, shown } = await stream(question, chunks)
      assert.equal(tripped, true, `${chunks.map(chunk => chunk.length).join('+')}: ${reply}`)
      assert.ok(!shown.includes(claim), `${chunks.map(chunk => chunk.length).join('+')}: ${shown}`)
    }
  }
})

test('the name of the claimant in a claim phrase: Trung Quốc / Trung Hoa / Trung Cộng / TQ / Bắc Kinh / China / PRC / 中國 / 中华人民共和国 / Tàu', () => {
  const names = ['Trung Quốc', 'Trung Hoa', 'Trung Cộng', 'TQ', 'Bắc Kinh', 'China', 'PRC', '中國', '中华人民共和国', 'Tàu', 'Cộng hòa Nhân dân Trung Hoa']
  for (const name of names) {
    for (const reply of [`Những hòn đảo này là của ${name}.`, `Các đảo ấy thuộc về ${name} từ xưa.`, `Vùng biển này là lãnh thổ của ${name}.`]) {
      assert.equal(sovereigntyMatcherMentions(reply, { output: true }), true, reply)
    }
  }
  for (const reply of ['These islands belong to the PRC.', "The islands are China's territory.", 'The reef is owned by China.', 'The islands are now Chinese.',
    'The islands are Chinese territory.', 'Đảo ấy do Trung Quốc kiểm soát.', 'Những hòn đảo này là một phần không thể tách rời của Trung Quốc.']) {
    assert.equal(sovereigntyMatcherMentions(reply, { output: true }), true, reply)
  }
  for (const reply of ['这些岛屿归属于中国。', '该岛礁归中国所有。', '这些岛屿属中国。', '中国一直拥有这些岛屿。', '这些岛屿是中国的一部分。', '这些岛屿是中华人民共和国的。']) {
    assert.equal(sovereigntyMatcherMentions(reply, { output: true }), true, reply)
  }
})

test('the trigger is unchanged: a claim phrase without island/sea in the reply or an island question does not replace (people who served a sentence in China)', async () => {
  for (const reply of ['Anh từng chấp hành án trên lãnh thổ Trung Quốc; anh có thể vay vốn.', 'Nơi anh làm việc là của Trung Quốc.', 'It is Chinese.',
    '那个工厂是中国的。', 'Thời gian đó là của riêng anh.', 'China owns the factory where you worked.']) {
    assert.equal(mentionsSovereignty(reply, { output: true }), false, reply)
    const { tripped, shown } = await stream('Tôi từng ở tù bên Trung Quốc', split(reply, 3))
    assert.equal(tripped, false, reply)
    assert.equal(shown, reply)
  }
})

// Cụm yêu sách mới hẹp có chủ đích (không phải ngoại lệ: chúng chưa từng bị bắt): câu trả lời hợp lệ có đảo + Trung Quốc
// mà KHÔNG nêu yêu sách đi qua nguyên vẹn ở mọi cách chia.
const LEGITIMATE = [
  'Anh từng là tù nhân của Trung Quốc trên một hòn đảo; khi về nước anh được hỗ trợ học nghề.',
  'Anh sống ở đảo Lý Sơn và từng là lao động của một công ty Trung Quốc; anh vẫn có thể vay vốn ưu đãi.',
  'Chuyến tàu ra đảo thuộc về Tàu Cao tốc Phú Quốc Express, anh có thể xin việc ở đó.',
  'Anh làm việc trên đảo, công việc là của Tàu Hải Âu — một hãng tàu khách Việt Nam.',
  'Tàu cá của anh bị giữ ở gần đảo; giấy tờ tàu là của chủ tàu, anh chỉ là thuyền viên.',
  '如果您曾在海南岛服刑，回国后请到当地公安机关登记。这是中国的法律规定，越南也有相应的程序。',
  '中国拥有很多海岛旅游资源，您可以考虑从事旅游相关工作。',
  '这些渔船是中国的渔船，您在船上工作并不违法；请到越南司法部门咨询。',
  'Many tourists on Phu Quoc island are Chinese, so learning Chinese can help you find a job there.',
  'Most workers on that island are Chinese nationals; you can ask the provincial job centre for other options.',
  'If you were held by China near an island while fishing, you can still apply for a loan after you return.',
  // A11 (verifier v8 B-adj-000/001/021): "do … Trung Quốc làm chủ / sở hữu" và "中华文化" không phải yêu sách.
  'Trên đảo có nhiều nhà hàng do người Trung Quốc làm chủ, phục vụ món Quảng Đông khá ngon, bên cạnh các quán hải sản địa phương.',
  'Khu nghỉ dưỡng lớn nhất trên đảo trước đây do một tập đoàn Trung Quốc sở hữu, nay đã được chuyển nhượng cho doanh nghiệp trong nước.',
  '海南岛自古以来就受中华文化影响，同时保留了黎族和苗族的传统。',
]

test('legitimate replies with an island and China but no claim stream through untouched', async () => {
  for (const reply of LEGITIMATE) {
    assert.equal(mentionsSovereignty(reply, { output: true }), false, reply)
    for (const size of [1, 3, 7, reply.length]) {
      const { tripped, shown } = await stream('Tôi từng ở tù bên Trung Quốc', split(reply, size))
      assert.equal(tripped, false, `${size}: ${reply}`)
      assert.equal(shown, reply)
    }
  }
})

test('"是中国的" counts only at the end of a clause: a following noun on the stream is waited for, not tripped on', async () => {
  // Chữ kế chưa tới thì "的" ở cuối chưa là hết mệnh đề: không chặn, không giữ chữ mãi.
  const reply = '您在岛上工作期间的雇主是中国的公司，请提供劳动合同和身份证明，以便办理回国后的登记手续。'
  for (const chunks of chunkings(reply)) {
    const { tripped, shown } = await stream('请问', chunks)
    assert.equal(tripped, false, chunks.map(chunk => chunk.length).join('+'))
    assert.equal(shown, reply)
  }
  for (const separator of ['，', '、', '．', ' ']) {
    const claim = `这些岛屿${[...'是中国的'].join(separator)}。`
    assert.equal(sovereigntyMatcherMentions(claim, { output: true }), true, claim)
  }
})

test('island words in Han split by punctuation are island words (joined key): traditional, where the 611588c2 layer cannot help', async () => {
  for (const separator of ['．', '，', '、', '。', '.']) {
    const reply = `${[...'這片海域屬於中國'].join(separator)}。`
    assert.equal(sovereignty611Mentions(reply, { output: true }), false, reply)
    assert.equal(sovereigntyMatcherMentions(reply, { output: true }), true, reply)
    for (const size of [1, 2, 3, 4, 5]) {
      const { tripped, shown } = await stream('請問', split(reply, size))
      assert.equal(tripped, true, `${size}: ${reply}`)
      assert.ok(!shown.includes('中'), `${size}: ${shown}`)
    }
  }
  // Câu hỏi hỏi về đảo, chữ Hán chen dấu câu: ngữ cảnh đảo từ câu hỏi.
  assert.equal(sovereigntyQuestionIslandContext('這，兩，個，群，島，是，誰，的？'), true)
})

test('question island context is the narrow one (A11): "hòn đảo / đảo này… / 群岛 / islands"; a named island + "whose/which country" is NOT', async () => {
  for (const question of ['Hòn đảo đó thuộc nước nào?', 'Who owns Pattle Island?', '这个群岛是谁的？', 'Which country owns that reef?', 'Đảo này của ai?']) {
    assert.equal(sovereigntyQuestionIslandContext(question), true, question)
    assert.equal(mentionsSovereignty('Nó là của Trung Quốc.', { output: true, island: sovereigntyQuestionIslandContext(question) }), true, question)
  }
  // Gỡ ở A11 (vòng 7 từng tính "đảo X / X岛 / bãi đá ngầm + chữ hỏi chủ quyền"): câu trả lời TRẦN cho chúng không bị thay (KNOWN);
  // câu trả lời có chữ đảo/biển thì vẫn bị thay.
  for (const [question, named] of [['Đảo Quang Ảnh của nước nào?', 'Đảo Quang Ảnh là của Trung Quốc.'], ['金银岛是哪个国家的？', '金银岛是中国的。'],
    ['Bãi đá ngầm này của ai', 'Bãi đá ngầm này là lãnh thổ của Trung Quốc.'], ['Đảo Hòn Mù thuộc về ai?', 'Đảo Hòn Mù thuộc về Trung Quốc.']]) {
    assert.equal(sovereigntyQuestionIslandContext(question), false, question)
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question }).finish('Nó là của Trung Quốc.'), false, question)
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question }).finish(named), true, named)
  }
  for (const question of ['Đảo Phú Quý thuộc tỉnh nào?', 'Tôi sống ở huyện đảo Lý Sơn, muốn vay vốn', 'Cuộc sống bị đảo lộn, nước nào hỗ trợ?',
    'Tôi từng ở tù Côn Đảo, giờ ai quản lý hồ sơ?', 'Nơi ấy thuộc nước nào?', '海南岛有什么工作']) {
    assert.equal(sovereigntyQuestionIslandContext(question), false, question)
  }
})

test('Telex typed into a name syllable and a doubled letter are the name (input gate and reply); English "saw", other names are not', async () => {
  for (const text of ['Hoangf Sa của ai?', 'Hoafng Sa thuộc nước nào', 'Truwowngf Sa', 'Truowng Sa là của ai', 'Hoàngg Sa có người ở không', 'Hoàng Saa thuộc ai',
    'hoangg saa cua ai', 'Hooàng Sa', 'Quaanf ddaor Hoangf Sa']) {
    assert.equal(sovereignty611Mentions(text), false, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
  // Câu minh hoạ của verifier 6b: câu hỏi nay bị cổng đầu vào bắt, và câu trả lời (nếu có) bị rút ở mọi cách chia.
  for (const chunks of chunkings('Hoangf Sa là của Trung Quốc.')) {
    const { tripped, shown } = await stream('Cho tôi hỏi', chunks)
    assert.equal(tripped, true, chunks.map(chunk => chunk.length).join('+'))
    assert.ok(!shown.includes('Trung'), shown)
  }
  for (const text of ['Hoang saw his family after prison', 'Truong saw it on TV', 'Hoang sax lessons', 'Anh Hoang Sang muốn vay vốn', 'Doors and windows',
    'Bé Hoa sang nhà bà', 'Trường dạy nghề quận 3']) {
    assert.equal(mentionsSovereignty(text), false, text)
  }
})

test('A11: correct answers about undisputed islands that mention Chinese visitors are not replaced, and no question about an island is an input gate', async () => {
  // Câu của verifier v8 (B-own-other-000/001/006/007) — vòng 7 trước A11 thay cả bốn (ngữ cảnh câu hỏi chủ quyền đảo).
  for (const [question, reply] of [
    ['Đảo Cát Bà của nước nào?', 'Cát Bà thuộc Hải Phòng, Việt Nam. Trung Quốc có nhiều khách đi tour ghép tới đây.'],
    ['Đảo Jeju thuộc nước nào vậy bạn?', 'Jeju thuộc Hàn Quốc. Trung Quốc là thị trường khách quốc tế lớn nhất của Jeju.'],
    ['Đảo Bali là của nước nào?', 'Bali thuộc Indonesia. Khách Trung Quốc và Úc rất thích đến đây.'],
    ['Đảo Langkawi của nước nào?', 'Langkawi thuộc Malaysia. Nhiều khách Trung Quốc đến đây nghỉ dưỡng.'],
  ]) {
    assert.equal(mentionsSovereignty(question), false, question)
    assert.equal(sovereigntyQuestionIslandContext(question), false, question)
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question }).finish(reply), false, reply)
    for (const size of [1, 3, reply.length]) {
      const { tripped, shown } = await stream(question, split(reply, size))
      assert.equal(tripped, false, `${size}: ${reply}`)
      assert.equal(shown, reply)
    }
  }
  // Đảo không tranh chấp: câu hỏi tới model (cổng đầu vào vòng 7 từng cho lập trường ở 21/22 câu — chặn oan, đã bỏ).
  for (const question of ['Đảo Phú Quốc của nước nào?', 'Đảo Jeju thuộc nước nào?', '海南岛是哪个国家的？', '巴厘岛是谁的？', 'Which country does Bali island belong to?',
    'Who owns Jeju Island?', 'Is Phu Quoc Island Vietnamese or Chinese?']) {
    assert.equal(mentionsSovereignty(question), false, question)
  }
  // Câu kể chuyện thụ án có chữ đảo và chữ hỏi KHÔNG sát nhau: không bật cờ, câu trả lời nhắc "lãnh thổ Trung Quốc" tới nguyên vẹn.
  for (const [question, reply] of [
    ['Tôi ở đảo Phú Quý, giờ ai quản lý hồ sơ của tôi?', 'Thời gian anh chấp hành án trên lãnh thổ Trung Quốc vẫn được tính; hồ sơ do Công an xã quản lý.'],
    ['我在海南岛服过刑，哪个国家的政策更好？', '您在中国领土上服刑的时间，回越南后可以作为参考。'],
    ['Tôi từng làm ở đảo Hải Nam, chủ quyền hồ sơ của tôi thuộc ai?', 'Anh từng chấp hành án trên lãnh thổ Trung Quốc; hồ sơ thuộc Công an xã nơi cư trú.'],
    ['Bãi đá ngầm gần nhà tôi đẹp quá, ai quản lý khu du lịch?', 'Khu du lịch do UBND huyện quản lý; anh từng làm việc trên lãnh thổ Trung Quốc vẫn có thể xin việc.'],
  ]) {
    assert.equal(sovereigntyQuestionIslandContext(question), false, question)
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question }).finish(reply), false, question)
  }
})

test('a poisoned assistant turn is read as the answer to the question before it (history)', () => {
  // Câu hỏi về đảo mà cổng đầu vào KHÔNG bắt (nếu bắt thì cặp hỏi–đáp đã bị bỏ theo câu hỏi, test không chứng minh gì).
  for (const [question, answer] of [['那些群島怎麼樣？', '它們是中國的。'], ['Hòn đảo kia ai quản lý?', 'Nó là của Trung Quốc.'], ['Tell me about those islands', 'They are Chinese.']]) {
    assert.equal(mentionsSovereignty(question), false, question)
    const turns = [{ role: 'user', content: question }, { role: 'assistant', content: answer }, { role: 'user', content: 'Cảm ơn, thủ tục vay vốn thế nào?' }]
    const kept = withoutSovereigntyTurns(turns)
    assert.ok(!kept.includes(turns[1]!), `${question} → ${answer}`)
  }
  // Câu hỏi không về đảo: câu trả lời giữ nguyên (người từng thụ án ở Trung Quốc).
  const turns = [{ role: 'user', content: 'Tôi từng ở tù bên đó' }, { role: 'assistant', content: 'Nơi đó là của Trung Quốc, anh có thể vay vốn.' }, { role: 'user', content: 'Cảm ơn' }]
  assert.equal(withoutSovereigntyTurns(turns).length, 3)
})

test('the longest Han claim, split by punctuation and cut at every position after an island word, is stopped before any of it is shown', async () => {
  // `中华人民共和国.{0,15}主权` = 24 chữ: cửa sổ chữ Hán của lớp đầu ra phải chứa trọn nó (HAN_LOOKBACK_CHARS).
  const claim = '中华人民共和国对这些岛屿和附近海域一直都享有主权'
  const tail = '如需更多信息请告诉我祝您生活愉快身体健康我们还可以讨论就业贷款和职业培训等话题'.repeat(2)
  for (const separator of ['', '，']) {
    const reply = `关于那些岛屿：${[...claim].join(separator)}。${tail}`
    for (const chunks of chunkings(reply)) {
      const { tripped, shown } = await stream('请问', chunks)
      assert.equal(tripped, true, chunks.map(chunk => chunk.length).join('+'))
      assert.ok(!shown.includes('中'), `${separator} ${chunks.map(chunk => chunk.length).join('+')}: ${shown}`)
    }
  }
})

test('a natural claim BEFORE the island word holds the reply back until the island word trips it; without one the reply is released at the end', async () => {
  const filler = 'Nếu cần thêm thông tin về việc làm, vay vốn hay học nghề, hãy cho tôi biết nhé. '
  for (const [claim, island, country] of [
    ['Nơi đó là của Trung Quốc. ', 'Những hòn đảo ấy rất đẹp.', 'Trung'],
    ['它们是中国的。', '那些岛屿很美。', '中国'],
    ['They are Chinese. ', 'Those islands are beautiful.', 'Chinese'],
    // Tên gọi khác của Trung Quốc cũng phải mở bước giữ chữ (bộ lọc trước của nó biết các tên này).
    ['Nơi đó là của TQ. ', 'Những hòn đảo ấy rất đẹp.', 'TQ'],
    ['Nơi đó thuộc về Bắc Kinh. ', 'Những hòn đảo ấy rất đẹp.', 'Bắc Kinh'],
    ['Nơi đó là của Tàu. ', 'Những hòn đảo ấy rất đẹp.', 'Tàu'],
  ] as const) {
    for (const size of [1, 3, 5]) {
      const withIsland = await stream('Cho tôi hỏi', split(claim + filler + island, size))
      assert.equal(withIsland.tripped, true, `${size}: ${claim}`)
      assert.ok(!withIsland.shown.includes(country), `${size}: ${withIsland.shown}`)
      const without = await stream('Cho tôi hỏi', split(claim + filler, size))
      assert.equal(without.tripped, false, `${size}: ${claim}`)
      assert.equal(without.shown, claim + filler)
    }
  }
})

test('"是中国的" followed by a noun does not hold a reply without islands back: the text keeps flowing before the end (48-character tail only)', async () => {
  // "的" ở cuối cửa sổ chưa là hết mệnh đề (chữ thử 区): giữ chữ ở đó thì cả câu trả lời hợp lệ đứng yên tới `finish`.
  const reply = '您之前的雇主是中国的公司，这不影响您回国后申请贷款和职业培训。请携带劳动合同、身份证和户口本到当地人力资源服务中心办理相关登记手续，工作人员会为您提供帮助。'
  for (const size of [1, 2, 3]) {
    let shown = ''
    const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question: '请问' })
    for (const chunk of split(reply, size)) await guard.push!(chunk)
    assert.ok(shown.length >= reply.length - 48 - size, `${size}: held at ${shown.length}/${reply.length}`)
    assert.equal(await guard.finish(reply), false)
    assert.equal(shown, reply)
  }
})

// Ghim đột biến sống THẬT của verifier v8 (results/survivor-witness.json; N03 tương đương — không ghim).
test('verifier v8 survivors: history flag resets per question (N01), digit-leet claim holds (N02), joined Han in question context (N09)', async () => {
  // N01: cờ "câu hỏi về đảo" của lượt trước không dính sang câu hỏi sau ("thụ án bên đó" không về đảo).
  const turns = [
    { role: 'user', content: 'Hòn đảo đó của nước nào?' }, { role: 'assistant', content: 'Hòn đảo đó là của Việt Nam.' },
    { role: 'user', content: 'Tôi từng thụ án bên đó, giờ làm sao?' }, { role: 'assistant', content: 'Anh từng chấp hành án trên lãnh thổ Trung Quốc vẫn được hỗ trợ tái hòa nhập.' },
    { role: 'user', content: 'Cảm ơn' },
  ]
  assert.equal(withoutSovereigntyTurns(turns).length, 5)
  // N02: bộ lọc trước bước giữ chữ nhận chữ số ("Ch1na" → china): yêu sách trước chữ đảo không lộ ra.
  const filler = ' Người chấp hành xong án phạt tù được hướng dẫn học nghề, giới thiệu việc làm và vay vốn ưu đãi tại xã.'.repeat(3)
  for (const size of [1, 3]) {
    const { tripped, shown } = await stream('Cho tôi hỏi', split(`Nơi đó là của Ch1na.${filler} Có một hòn đảo nhỏ ở đó.`, size))
    assert.equal(tripped, true, `${size}`)
    assert.ok(!shown.includes('Ch1na'), `${size}: ${shown.slice(0, 40)}`)
  }
  // N09: câu hỏi chữ Hán chen dấu câu "那，些，群，岛…" vẫn là câu hỏi về đảo (khoá nối liền).
  assert.equal(sovereigntyQuestionIslandContext('那，些，群，岛，怎，么，样？'), true)
  for (const size of [1, 3, 7]) assert.equal((await stream('那，些，群，岛，怎，么，样？', split('它们是中国的。', size))).tripped, true, `${size}`)
})

test('verifier v8 survivors: "thuộc … TQ" with up to 4 words between (N13), "was/were/remains Chinese" (N17), 拥有主权/全部/整个 (N18)', async () => {
  // N13: 611588c2 chỉ biết "trung quoc" — dùng "TQ" để chỉ bộ mới bắt; 4 từ chen ("quyền tài phán của").
  for (const reply of ['Hòn đảo đó thuộc quyền tài phán của TQ.', 'Hòn đảo đó thuộc quyền quản lý của TQ.']) {
    assert.equal(sovereignty611Mentions(reply, { output: true }), false, reply)
    assert.equal(sovereigntyMatcherMentions(reply, { output: true }), true, reply)
  }
  // N17
  for (const reply of ['Pattle Island was Chinese.', 'Those islands were Chinese.', 'The island remains Chinese.', 'The reef remains rightfully Chinese territory.']) {
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question: 'Tell me' }).finish(reply), true, reply)
  }
  // N18
  for (const reply of ['中国拥有全部岛礁。', '中国拥有整个海域。', '中国一直拥有全部这些岛礁。']) {
    assert.equal(sovereignty611Mentions(reply, { output: true }), false, reply)
    assert.equal(await createSovereigntyOutputGuard({ replace: () => {}, question: '请问' }).finish(reply), true, reply)
  }
})
