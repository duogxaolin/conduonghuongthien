/**
 * Người dùng mở đầu bằng MỘT CÂU KỂ về hoàn cảnh ("tôi vừa đi tù về") chứ không phải câu hỏi.
 *
 * Khi đó kho tri thức khớp từ "tù" và (ở chế độ chỉ-kho, hoặc khi AI không khả dụng) trả nguyên văn
 * định nghĩa "Công tác tái hòa nhập cộng đồng là…" — đúng nội dung nhưng lạc đề với người đang cần biết
 * việc đầu tiên phải làm. Hàng small-talk riêng cho nhóm câu kể này trả lời bằng lời khuyên + hỏi tiếp.
 *
 * Chạy bộ khớp thật trên dữ liệu seed thật.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CHATBOT_SMALL_TALK_SEED } from '../server/data/chatbot-small-talk-seed'
import { matchSmallTalk, type SmallTalkEntry } from '../server/utils/chatbot/small-talk'

const plain = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim()
const entries: SmallTalkEntry[] = CHATBOT_SMALL_TALK_SEED.map((e, i) => ({
  id: i + 1, category: e.category, answer: e.answer, patterns: e.patterns,
  normalizedQuestion: plain(e.question), isEnabled: true, displayOrder: i,
}))

const SITUATION_STATEMENTS = [
  'tôi vừa đi tù về',
  't mới đi tù về',
  'Tôi mới đi tù về',
  'mình vừa đi tù về, giờ phải làm sao',
  'tôi vừa ra tù',
  'tôi vừa chấp hành xong án',
  'vừa được tha tù hôm qua',
]

test('câu kể "vừa/mới đi tù về" nhận lời khuyên việc đầu tiên, không phải định nghĩa', () => {
  for (const text of SITUATION_STATEMENTS) {
    const match = matchSmallTalk(entries, text)
    assert.ok(match, `phải khớp small-talk: ${text}`)
    assert.equal(match.category, 'support', text)
    assert.match(match.answer, /Công an xã\/phường/u, text)
    assert.match(match.answer, /đăng ký cư trú/u, `việc đầu tiên phải được nêu: ${text}`)
    assert.doesNotMatch(match.answer, /Công tác tái hòa nhập cộng đồng có thể hiểu/u, 'không được là định nghĩa')
  }
})

test('câu hỏi thật về chính sách KHÔNG bị hàng này chiếm — vẫn xuống kho/AI', () => {
  for (const text of [
    'người chấp hành xong án phạt tù có được vay vốn không',
    'thủ tục xoá án tích như thế nào',
    'điều kiện vay vốn ngân hàng chính sách xã hội cho người mới ra khỏi trại',
    'tái hòa nhập cộng đồng là gì',
  ]) {
    const match = matchSmallTalk(entries, text)
    assert.ok(!match || match.answer !== CHATBOT_SMALL_TALK_SEED.find(e => e.question === 'Tôi vừa đi tù về')!.answer, `không được chiếm: ${text}`)
  }
})
