import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Vòng 6 (2026-10-30) — verifier 5: recall union trên bộ câu thứ năm lọt 37 câu mà một phiên bản trước đã bắt, thuộc ba
 * họ ngoại lệ quá rộng. Quy trình recall-first: không thêm ngoại lệ, chỉ THU HẸP ba họ đó; ngoại lệ chỉ vô hiệu một
 * đoạn khớp cụ thể và tắt khi câu có chữ sở hữu. Mỗi họ ghim ở hai tầng: hành vi (`mentionsSovereignty`) và hàm khớp
 * của bộ khớp mới (`sovereigntyHanMentions` / `sovereigntyScriptMentions`) — tầng sau để đột biến vẫn giết được khi một
 * lớp khác cũng bắt câu đó.
 */

const { mentionsSovereignty } = await import('../server/utils/chatbot/sovereignty-guard')
const { sovereigntyFold: fold, sovereigntyHanKey: hanKey } = await import('../server/utils/chatbot/sovereignty-normalize')
const { sovereigntyHanMentions, sovereigntyOwnership } = await import('../server/utils/chatbot/sovereignty-patterns')

/** Chỉ nhánh chữ Hán của bộ khớp mới (chữ sở hữu xét trên cả câu, như `mentionsSovereignty`). */
const hanBranch = (text: string) => sovereigntyHanMentions(hanKey(fold(text)), false, () => sovereigntyOwnership(fold(text)))

// ─── Họ 1: ngoại lệ chữ Hán ─────────────────────────────────────────────────────────────────────────────────────────

test('family 1: a single-character suffix only vetoes a district when it is not the head of another word (区域), and 西沙区 is the name', () => {
  // 区域 = "khu vực", không phải quận; 西沙区 là đơn vị hành chính Trung Quốc đặt cho Hoàng Sa (2020) — tên, không ngoại lệ.
  for (const text of ['南海区域局势最近怎么样', '南沙区域的岛礁建设', '西沙区域有多少岛', '西沙区是哪年设立的', '西沙区人口多少',
    '南海区域的军事化', '南海区域争端怎么解决', '西沙区和南沙区都是三亚管吗', '南沙区域', '南海区域航行自由', '西沙区政府驻地在哪',
    '南海区域的岛屿归谁管', '南海县域经济', '西沙区']) {
    assert.equal(hanBranch(text), true, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
  // Hậu tố hành chính thật vẫn loại ở bộ khớp mới (bộ khớp 611588c2 thì không — xem phần hợp ở dưới).
  for (const text of ['佛山市南海区桂城街道有招工吗', '广州市南沙区人民法院在哪', '南沙新区有很多工厂', '南海观音寺在哪里', '大阪の南海電鉄で働いていました']) {
    assert.equal(hanBranch(text), false, text)
  }
})

test('family 1: a preceding character only vetoes when it ends a place word — surnames and 周/王/张/山 as ordinary words do not', () => {
  // 本周 (tuần này), 称王 (xưng vương), 扩张 (bành trướng), 登山 (leo núi) — chữ đứng trước là chữ thường, không phải
  // tên người hay địa danh. Chỉ 广州 (trước 南沙) và 佛山 (trước 南海) là địa danh hai chữ còn được loại.
  for (const text of ['本周南海局势', '一周南海动态汇总', '北京扩张南海野心', '称王南海', '每周南沙新闻', '近一周南海紧张', '登山南海岛礁',
    '上周西沙发生了什么', '我叫张南海', '李南沙是谁', '王南海，你好']) {
    assert.equal(hanBranch(text), true, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
  for (const text of ['我在佛山南海工作了三年', '广州南沙港有招聘吗', '越南海防的就业支持', '河南沙县小吃', '东西沙发很便宜', '中南海在北京', '云南海拔高吗']) {
    assert.equal(hanBranch(text), false, text)
  }
  // Hai chữ của địa danh phải cùng mệnh đề: "广，州南沙" không phải 广州.
  assert.equal(hanBranch('我去过广，州南沙现在怎样'), true)
  assert.equal(hanBranch('我来自广州，南沙现在怎么样'), true)
})
