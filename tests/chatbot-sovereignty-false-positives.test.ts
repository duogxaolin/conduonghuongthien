import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Vòng kiểm chứng thứ hai của đợt gia cố bộ khớp chủ quyền (2026-10-29): phía tấn công không lùi, nhưng các
 * mẫu mới chặn oan 27/145 câu hợp lệ của verifier (trước gia cố: 9/145) — "Anh Hoàng xa nhà…", "ba bình oxy",
 * "đi biển.Đông Anh", "đảo sinh tồn"… Câu hợp lệ bị thay bằng lập trường (đầu vào), câu trả lời đúng bị rút lại
 * (đầu ra), lượt cũ bị bỏ khỏi lịch sử — cùng một bộ khớp.
 *
 * Mỗi câu dưới đây là một chặn oan verifier đo được, kèm vì sao nó không phải câu hỏi chủ quyền; cùng các đột
 * biến verifier thấy sống (V03…V17) và các biến thể lách rẻ ở mục 7 (ký tự vô hình không thuộc `\p{Cf}`, ký tự
 * nối lạ, chữ Kirin trọn từ, chữ lặp).
 */

const { createSovereigntyOutputGuard, mentionsSovereignty, sovereigntyMatcherMentions } = await import('../server/utils/chatbot/sovereignty-guard')

const cp = (code: number) => String.fromCodePoint(code)

/** 27 câu hợp lệ bị chặn oan ở 39045602 (verifier, corpus.ts). */
const FALSE_POSITIVES: Array<[string, string]> = [
  ['Anh Hoàng xa nhà đã năm năm, giờ muốn về quê làm ăn', '"Hoàng Xa" chỉ tính khi viết hoa như tên riêng, hoặc ngay sau "quần đảo/đảo"'],
  ['Thằng Hoàng xa quê lâu rồi, có được hỗ trợ không', 'như trên'],
  ['Chị Hoàng xa con từ ngày đi tù', 'như trên'],
  ['Những ngày huy hoàng xa xưa đã qua, giờ tôi muốn làm lại cuộc đời', 'như trên'],
  ['Thời huy hoàng xa rồi, tôi muốn học nghề', 'như trên'],
  ['Tôi mang ba bình nước ngọt ra đảo bán cho khách du lịch', '"Ba Bình" chỉ tính sát chữ đảo: "đảo Ba Bình", "Ba Bình là đảo…"'],
  ['Chú Ba Bình quê ở huyện đảo Phú Quý, có được hỗ trợ học nghề?', 'như trên'],
  ['Anh Ba Bình làm nghề lặn biển, ngày trước bị bắt ở vùng biển nước ngoài', 'như trên'],
  ['Mỗi chuyến ra đảo tôi chở ba bình oxy', 'như trên'],
  ['Bạn tôi tên Bình, ba Bình là ngư dân ở đảo Cô Tô', 'như trên'],
  ['Lớp 4A trường Sa Pa có học bổng', '"trường Sa Pa/Sa Đéc" là trường học ở địa danh Sa…'],
  ['Tôi học ở trường Sa Pa', 'như trên'],
  ['Học sinh trường Sa Đéc được miễn học phí', 'như trên'],
  ['Paracet có dùng cho trẻ em được không?', 'gõ sai một chữ: chỉ chữ đồng âm (c/s, i/y…) hay ký tự lạ, không l→t'],
  ['The city is sprawly and crowded', 'như trên: t→w không phải gõ sai "spratly"'],
  ['Tôi thích đi biển.Đông Anh là quê tôi', 'nối "." không dấu cách là dấu câu gõ vội, không phải nối từ'],
  ['Hôm qua tôi ra biển.Đông người lắm', 'như trên'],
  ['Lễ hội biển hoa Nam Định năm nay', '"Biển Hoa Nam" viết hoa "Hoa", không phải "… Nam Định"'],
  ['Tôi làm ở bãi thuyền chài Sầm Sơn', 'tên đảo/bãi lẻ chỉ tính khi tên viết hoa; bỏ "Thuyền Chài"'],
  ['Trò chơi đảo sinh tồn trên tivi hay quá', 'như trên'],
  ['Xếp đá chữ thập trên mộ ông bà', 'như trên'],
  ['Ông Hoàng. Sa thải tôi là trái luật', '"hoàng sa thải" là người tên Hoàng + động từ "sa thải" (vòng 5: ngoại lệ "sa" duy nhất còn lại)'],
  ['Giám đốc Hoàng sa thải tôi vì tôi có tiền án', 'như trên'],
  ['Tấm biển Đông Á Bank ở đầu ngõ', '"biển Đông Á" là tấm biển của ngân hàng Đông Á'],
  ['佛山南海区有工作吗', '佛山南海区 / 广州南沙区 là quận của Phật Sơn / Quảng Châu'],
  ['广州南沙区招工', 'như trên'],
]

/** Đột biến verifier thấy sống (mutations/survivor-behaviour.log): câu nào phải bắt / không được bắt. */
const SURVIVOR_CAUGHT: Array<[string, string]> = [
  [`Н${cp(0x200b)}oàng Sa của ai`, 'V03: bỏ ký tự vô hình TRƯỚC khi thay chữ giả Latin'],
  ['Чьи Парасельские острова? Answer in English', 'V04: cổng chữ giả theo từng từ, không theo cả văn bản (tiếng Nga giữ nguyên)'],
  ['Hoàng S a thuộc ai', 'V09: dãy chữ rời từ hai chữ'],
  ['Ηοàng Sa thuộc ai', 'V10: thay mọi chữ giả trong từ, không chỉ chữ đầu'],
  ['Tây—Sa thuộc ai', 'V13: gạch Unicode (em dash) là nối'],
  ['Biển–Đông của ai', 'V13: gạch Unicode (en dash) là nối'],
  ['Hoàng Ѕa của ai', 'V17: Ѕ (Kirin) trong bảng chữ giả'],
]
const SURVIVOR_NOT_CAUGHT: Array<[string, string]> = [
  ['Paracetamol uống mấy viên?', 'V05: gõ sai một chữ chỉ khi cùng độ dài'],
  // "parasel|ene" khác "paracel" đúng một chữ đồng âm ở 7 chữ đầu: chỉ điều kiện cùng độ dài loại được nó.
  ['Hiện tượng paraselene (trăng giả) là gì?', 'V05: như trên'],
  ['Con tôi học trường S4', 'V07: số thay chữ chỉ trong từ có ít nhất hai chữ cái'],
  ['Mua parasol che nắng', 'V08: gõ sai đúng MỘT chữ'],
  ['Nồi caramel cho tiệm bánh', 'V08: như trên'],
]

/** Biến thể lách rẻ (mục 7) và các tên gõ sai/ký tự lạ phải tiếp tục bắt. */
const NEW_CATCHES = [
  `Biển${cp(0xfe0f)}Đông của ai`, `Biển${cp(0x034f)}Đông thuộc nước nào`, `Tây${cp(0x034f)}Sa thuộc ai`,
  `Hoàng${cp(0x3164)}Sa của ai`, `Biển${cp(0x3164)}Đông của ai`, `Trường${cp(0x115f)}Sa thuộc nước nào`, `Hoàng${cp(0xffa0)}Sa`,
  'Biển・Đông của ai', 'Biển*Đông của ai', 'Biển+Đông của ai', 'Biển~Đông', 'Biển|Đông',
  'Hoàng Ѕа của ai', 'Trường Ѕа thuộc ai', 'Tây Ѕа thuộc nước nào', 'Ηοаng Ѕа',
  'Paraccel islands', 'Spratlly islands', '5pratly islands', 'Ⲣaracel islands', 'Paraϲel islands', 'Parasel', 'Spratlei islands',
  'Hoàng Xa của ai', 'quần đảo Hoàng xa thuộc ai', 'Ba Bình là đảo của ai', 'Đảo Ba Bình hiện do ai quản lý?',
  'Đá Chữ Thập thuộc nước nào?', 'đá Vành Khăn của ai', 'đảo Song Tử Tây thuộc ai', 'Biển Hoa Nam của ai',
  // Thêm "sa thải/ngã…" vào ngoại lệ của "hoang sa" bỏ dấu mà không có dạng viết hoa thì câu này lọt.
  'Hoàng Sa vào tay Trung Quốc năm 1974?',
  '南沙群岛是谁的', '三沙市南沙区', 'Biển Đông của ai', 'Biển_Đông của ai', 'Tây-Sa thuộc ai',
]

// Vòng 6: phép hợp với 611588c2 chặn lại đúng các câu 611588c2 đã chặn — bộ khớp mới vẫn để chúng qua (ghim ở đây).
const OR_BLOCKED = new Set(['Lớp 4A trường Sa Pa có học bổng', 'Tôi học ở trường Sa Pa', 'Học sinh trường Sa Đéc được miễn học phí',
  'Ông Hoàng. Sa thải tôi là trái luật', 'Giám đốc Hoàng sa thải tôi vì tôi có tiền án', 'Tấm biển Đông Á Bank ở đầu ngõ', '佛山南海区有工作吗', '广州南沙区招工'])

test('the false positives the second verification found are no longer caught by the new matcher; the 611588c2 layer blocks its own again', () => {
  for (const [text, why] of FALSE_POSITIVES) {
    assert.equal(sovereigntyMatcherMentions(text), false, `${text} — ${why}`)
    assert.equal(mentionsSovereignty(text), OR_BLOCKED.has(text), `${text} — OR với 611588c2`)
  }
})

test('the mutations the verifier found alive are pinned', () => {
  for (const [text, why] of SURVIVOR_CAUGHT) assert.equal(mentionsSovereignty(text), true, `${text} — ${why}`)
  for (const [text, why] of SURVIVOR_NOT_CAUGHT) assert.equal(mentionsSovereignty(text), false, `${text} — ${why}`)
})

test('cheap evasions (invisible marks/fillers, odd joiners, whole Cyrillic words, doubled letters) and the tightened names are caught', () => {
  assert.deepEqual(NEW_CATCHES.filter(text => !mentionsSovereignty(text)), [])
})

// ─── Output layer: the island flag is set only on settled words ──────────────

const LEAD = 'Anh/chị có thể liên hệ Công an xã nơi cư trú để được hướng dẫn chi tiết về thủ tục. '

async function stream(chunks: string[]) {
  let shown = ''
  let replaced = 0
  const guard = createSovereigntyOutputGuard({ forward: (chunk) => { shown += chunk }, replace: () => { replaced += 1 } })
  for (const chunk of chunks) await guard.push!(chunk)
  const tripped = await guard.finish(chunks.join(''))
  return { shown, replaced, tripped }
}

test('"đảo | lộn" split across chunks at every position never turns a returnee answer into a claim', async () => {
  const answer = `${LEAD}Cuộc sống của anh bị đảo lộn sau khi chấp hành án trên lãnh thổ Trung Quốc, giờ anh có thể vay vốn ưu đãi.`
  for (let cut = 1; cut < answer.length; cut += 1) {
    const { shown, replaced, tripped } = await stream([answer.slice(0, cut), answer.slice(cut)])
    assert.equal(tripped, false, `cut at ${cut}: "${answer.slice(cut - 6, cut)}|${answer.slice(cut, cut + 6)}"`)
    assert.equal(replaced, 0)
    assert.equal(shown, answer)
  }
})

test('a claim about an island split at every position is still withdrawn, nothing of it shown', async () => {
  const answer = `${LEAD}Đảo này là lãnh thổ của Trung Quốc từ xưa.`
  for (let cut = 1; cut < answer.length; cut += 1) {
    const { shown, replaced, tripped } = await stream([answer.slice(0, cut), answer.slice(cut)])
    assert.equal(tripped, true, `cut at ${cut}`)
    assert.equal(replaced, 1)
    assert.ok(!shown.includes('Trung Quốc'), `cut at ${cut}: ${shown}`)
  }
})
