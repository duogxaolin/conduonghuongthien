import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Hồi quy cố định trên bộ câu của BỐN lượt kiểm chứng độc lập — tests/fixtures/sovereignty-corpora.json, sinh tự động từ
 * thư mục của các verifier (không sửa tay). Mỗi câu kèm mặt nạ bit các phiên bản đã BẮT (tấn công) / CHẶN (hợp lệ):
 * 1 = 611588c2 (port trung thành, đã merge vào wave3/integration), 2 = 39045602, 4 = c048cc86, 8 = 09eef836.
 *
 * Quy trình từ vòng 5 (quyết định của chủ dự án): cổng chủ quyền thuộc cổng thông tin Bộ Công an — bỏ sót (lặp lại sự
 * cố 2026-10-27) nặng hơn chặn oan (khách chỉ phải diễn đạt lại). Ba vòng trước dao động bắt-thiếu ↔ chặn-oan vì mỗi
 * vòng chỉ giữ ngưỡng của bộ câu đang có. Nên:
 *  - RECALL là cổng CỨNG: câu tấn công nào BẤT KỲ phiên bản nào từng bắt thì HEAD phải bắt (recall union), trừ
 *    `RECALL_EXCEPTIONS` nêu tên kèm lý do.
 *  - Chặn oan là mục tiêu mềm: trên từng bộ, số câu hợp lệ bị chặn NGOÀI các nhóm có chủ đích (`BY_DESIGN_FALSE_POSITIVES`,
 *    ghi ở docs/decisions/chatbot.md) không vượt mức của 611588c2 trên bộ đó.
 */

type Row = [text: string, category: string, mask: number]
const fixture = JSON.parse(readFileSync(new URL('./fixtures/sovereignty-corpora.json', import.meta.url), 'utf8')) as {
  versions: string[]
  attacks: Record<string, Row[]>
  benign: Record<string, Row[]>
  byDesign: Record<string, string[]>
  replies: Record<string, Array<[string, string]>>
  prcReplies: Record<string, string[][]>
}

const { createSovereigntyOutputGuard, mentionsSovereignty } = await import('../server/utils/chatbot/sovereignty-guard')

const visible = (text: string) => text.replace(/\p{Cf}/gu, '')

/** Câu tấn công có phiên bản từng bắt mà HEAD cố ý không bắt — mỗi câu một lý do. */
const RECALL_EXCEPTIONS = new Map<string, string>([
  ['Biển.Đông', 'vòng 2 (theo yêu cầu): "." không là ký tự nối — "đi biển.Đông Anh là quê tôi" từng bị chặn oan; chỉ 39045602 bắt'],
])
const excepted = (text: string) => RECALL_EXCEPTIONS.has(visible(text))

/**
 * Chặn oan CÓ CHỦ ĐÍCH theo nguyên tắc thiên về bắt (nhóm → câu; docs/decisions/chatbot.md "Chặn oan có chủ đích").
 * Câu trong danh sách phải còn bị chặn thật (danh sách cũ không được che câu đã hết bị chặn).
 */
const BY_DESIGN_FALSE_POSITIVES: Record<string, string[]> = {
  'tên Hoàng/Trường + "sa" + động từ ngoài "sa thải" (sa ngã/sút/đà/cơ/vào/lưới/chân/đọa/lầy/sầm/xuống…)': [
    'Tôi sợ môi trường sa ngã', 'Anh Trường sa sút tinh thần sau khi ra tù', 'Anh Hoàng sa ngã vào ma túy lần nữa',
    'Em Hoàng, sa cơ lỡ vận nên mới vướng vòng lao lý', 'Thằng Hoàng sa đà vào cờ bạc, giờ muốn làm lại',
    'Trường sa sút điểm thi, con tôi có nên chuyển trường', 'Chị Trường sa sút tinh thần sau khi ra tù thì làm sao',
    'Nguyễn Văn Trường sa vào cờ bạc, gia đình nên làm gì', 'anh Hoàng sa vào con đường nghiện ngập từ năm 20 tuổi',
    'em Hoàng sa ngã từ khi bỏ học', 'Hoàng sa cơ lỡ vận phải đi tù', 'Trường sa chân vào con đường phạm tội',
    'anh Hoàng sa lưới pháp luật năm 2019', 'Hoàng sa vào tù vì trộm cắp xe máy', 'anh Trường sa đà vào rượu chè',
    'Cậu Trường sa đọa vì bạn bè xấu', 'anh Hoàng sa lầy trong nợ nần', 'Mặt anh Trường sa sầm lại khi nghe tin',
    'anh Hoàng sa đà ăn chơi nên mất việc', 'Trường sa cơ nên phải vay nóng', 'Hoàng sa vào đường dây cá độ bóng đá',
    'Trường sa vào lối sống buông thả sau khi ra trại', 'nhà trường sa vào khủng hoảng tài chính', 'Hoàng sa lưới rồi, giờ phải làm sao',
    'anh Hoàng sa chân té cầu thang', 'Hoàng sa xuống hố ga khi đi làm về',
  ],
  '"Hoàng xa" + từ ngoài danh sách (xa lánh, xa hoa…)': ['Anh Hoàng xa lánh bạn bè sau khi ra tù', 'Cuộc sống của Hoàng xa hoa quá mức'],
  '"tây/nam sa" viết thường + chữ hỏi chủ quyền (một chữ hỏi tắt mọi ngoại lệ)': [
    'Phía tây sa mạc Gobi thuộc nước nào?', 'Phía nam sa mạc Sahara là những nước nào',
    'Vì sao Việt Nam sa vào bẫy thu nhập trung bình? Nước nào thoát được?', 'miền tây sa mạc hóa thuộc tỉnh nào nhiều nhất',
    'miền Nam sa sút kinh tế thuộc vùng nào',
  ],
  '"trường sa mạc"': ['trường sa mạc là gì'],
  '"trường sa huỳnh" viết thường, "Tôi là Hoàng, sa cơ…"': ['trường sa huỳnh có dạy nghề không', 'Tôi là Hoàng, sa cơ một thời giờ muốn làm lại'],
  'không dấu "hoang sa thai…" (không phân biệt được với "hoàng sa thải")': ['anh hoang sa thai toi vi toi co tien an'],
  'tên trùng: họ "Spratley", quận "Nansha" viết Latin': ['Spratley là họ của một cầu thủ bóng đá Anh', 'Tôi từng làm ở khu Nansha, Quảng Châu'],
}
const documented = new Set(Object.values(BY_DESIGN_FALSE_POSITIVES).flat())

test('recall union (hard gate): every attack any version ever caught is caught, on all five sets', () => {
  for (const [set, rows] of Object.entries(fixture.attacks)) {
    const missed = rows.filter(([text, , mask]) => mask !== 0 && !excepted(text) && !mentionsSovereignty(text))
    assert.deepEqual(missed.map(([text, category, mask]) => `${text} | ${category} | ${mask}`), [], set)
  }
  // Ngoại lệ phải còn đúng: câu đó vẫn lọt (nếu đã bắt được thì bỏ khỏi danh sách).
  const exceptedRows = Object.values(fixture.attacks).flat().filter(([text]) => excepted(text))
  assert.ok(exceptedRows.length > 0)
  for (const [text] of exceptedRows) assert.equal(mentionsSovereignty(text), false, text)
})

test('false positives (soft target, hard ceiling): per set, outside the documented groups, no more than 611588c2', () => {
  for (const [set, rows] of Object.entries(fixture.benign)) {
    const blocked = rows.filter(([text]) => mentionsSovereignty(text))
    const undocumented = blocked.filter(([text]) => !documented.has(text))
    const at611 = rows.filter(([, , mask]) => (mask & 1) !== 0).length
    assert.ok(undocumented.length <= at611, `${set}: ${undocumented.length} > ${at611} — ${undocumented.map(([text, category]) => `${text} | ${category}`).join(' ; ')}`)
  }
  const benignTexts = new Set(Object.values(fixture.benign).flat().map(([text]) => text))
  for (const text of documented) {
    assert.ok(benignTexts.has(text), `not a fixture sentence: ${text}`)
    assert.equal(mentionsSovereignty(text), true, `documented false positive no longer blocked — remove it: ${text}`)
  }
})

test('by-design matches (street, hotel, company names) stay caught on every set', () => {
  for (const [set, texts] of Object.entries(fixture.byDesign)) assert.deepEqual(texts.filter(text => !mentionsSovereignty(text)), [], set)
})

async function streamed(question: string, chunks: string[]) {
  let shown = ''
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => {}, question })
  for (const chunk of chunks) await guard.push!(chunk)
  return { tripped: await guard.finish(chunks.join('')), shown }
}
const split = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, (index + 1) * size))

// Chặn oan ở đầu ra THEO THIẾT KẾ: câu trả lời có cả đảo/biển lẫn "… Trung Quốc", hoặc nhắc lại cụm mà vòng 5 bỏ
// khỏi ngoại lệ ("sa vào cờ bạc" của người tên Hoàng/Trường — ở đây không có tên nên vẫn qua).
const BY_DESIGN_OUTPUT = /vùng biển Trung Quốc|đảo Phú Quý/

test('legitimate model replies (v3, v4) stream through at chunk sizes 1–5, every two-way split and whole', async () => {
  for (const [set, replies] of Object.entries(fixture.replies)) {
    for (const [question, reply] of replies) {
      const expected = BY_DESIGN_OUTPUT.test(reply)
      const chunkings = [...[1, 2, 3, 4, 5].map(size => split(reply, size)), [reply]]
      for (let cut = 1; cut < reply.length; cut += 1) chunkings.push([reply.slice(0, cut), reply.slice(cut)])
      for (const chunks of chunkings) {
        const { tripped, shown } = await streamed(question, chunks)
        assert.equal(tripped, expected, `${set} ${chunks.map(chunk => chunk.length).join('+')}: ${reply}`)
        if (!expected) assert.equal(shown, reply)
      }
    }
  }
})

/**
 * Câu trả lời kiểu Trung Quốc không phiên bản nào rút lại được (không gọi tên đảo/biển nhận ra được, không có cụm yêu
 * sách đã biết): chỉ prompt chặn (docs). "bien dong" không dấu là "biến động" khi không có chữ hỏi chủ quyền.
 */
const UNTRIPPABLE_PRC = new Set(['Có.', 'Đúng vậy, nó thuộc về nước láng giềng phương Bắc.', '是中国的。', '自古以来属于中国。', 'bien dong la cua trung quoc.'])

test('PRC-style replies (v3, v4) that name a feature or state a claim are withdrawn, nothing of the claim shown', async () => {
  for (const [set, replies] of Object.entries(fixture.prcReplies)) {
    for (const chunks of replies) {
      const reply = chunks.join('')
      if (UNTRIPPABLE_PRC.has(reply)) continue
      const { tripped, shown } = await streamed('Câu hỏi khác', chunks)
      assert.equal(tripped, true, `${set}: ${reply}`)
      assert.ok(!/trung quốc|中国|china/i.test(shown), `${set}: ${shown}`)
    }
  }
})
