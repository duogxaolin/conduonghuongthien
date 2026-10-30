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
const { sovereigntyHanMentions, sovereigntyOwnership, sovereigntyScriptMentions } = await import('../server/utils/chatbot/sovereignty-patterns')

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

// ─── Họ 2: ngoại lệ "sa" ────────────────────────────────────────────────────────────────────────────────────────────

const scriptBranch = (text: string) => sovereigntyScriptMentions(fold(text), false)

test('family 2: a toned "sa" is the name typed in a hurry — only "sà vào/xuống" (the verb) is excepted', () => {
  for (const text of ['hoàng sà ai đang giữ', 'trường sá có phải của mình không', 'hoàng sả là gì vậy ad', 'trường sạ ai làm chủ',
    'hoàng sã với trường sá khác gì nhau', 'hoàng sá của vn phải ko', 'bao giờ lấy lại hoàng sà', 'trường sà giờ ai quản lý',
    'hoàng sà giờ ra sao', 'trường sá bây giờ thế nào', 'Hoàng Sà vào thời Nguyễn đã có người ở']) {
    assert.equal(scriptBranch(text), true, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
  for (const text of ['Bé Hoàng sà vào lòng mẹ khi tôi ra trại', 'Thằng Hoàng sà xuống ghế ngủ luôn']) assert.equal(scriptBranch(text), false, text)
})

test('family 2: a place word after "Sa" is only a place in Title case after "trường" and before a lowercase word — never in ALL CAPS', () => {
  // Câu VIẾT HOA TOÀN BỘ hay Viết Hoa Mọi Chữ không cho biết đâu là tên riêng: "VĨ/Vĩ Tuyến" là vĩ tuyến, không phải Sa Vĩ.
  for (const text of ['HOÀNG SA VĨ TUYẾN BAO NHIÊU', 'Hoàng Sa Vĩ Tuyến 16 Độ Bắc Đúng Không', 'HOÀNG SA VĨ ĐẠI MUÔN NĂM',
    'TRƯỜNG SA THẦY TÔI BẢO LÀ CỦA VIỆT NAM', 'TRƯỜNG SA HUỲNH ĐỆ TÔI ĐANG CANH GIỮ', 'Trường Sa Vĩ Đại', 'Hoàng Sa Vĩ độ bao nhiêu',
    'Hoàng Sa Huỳnh đệ canh giữ', 'TRƯỜNG SA RÀI RÁC ĐẢO NHỎ']) {
    assert.equal(scriptBranch(text), true, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
  for (const text of ['học sinh trường Sa Thầy Kon Tum được hỗ trợ gì', 'Trường Sa Rài ở Đồng Tháp có lớp xóa mù không',
    'trường Sa Huỳnh tuyển giáo viên', 'Bé nhà tôi học lớp 3 Trường Sa Pa', 'Trường Sa Đéc tuyển giáo viên hợp đồng', 'TRƯỜNG SA PA TUYỂN SINH']) {
    assert.equal(scriptBranch(text), false, text)
  }
})

test('family 2: the ownership words verifier 5 used turn every exception off, in every script', () => {
  for (const text of ['ai giữ', 'ai đang giữ', 'phải giữ', 'là gì', 'là cái gì', 'ai làm chủ', 'ai quản lý', 'ai đang quản lý', 'khác gì',
    'có phải của', 'phải ko', 'phải không', 'là của', 'của việt nam', 'của vn', 'của mình', 'của ta', 'của họ', 'lấy lại',
    'ai giu', 'ai dang giu', 'la gi', 'ai lam chu', 'ai quan ly', 'khac gi', 'co phai cua', 'phai ko', 'la cua', 'cua viet nam', 'lay lai',
    // Đã có từ vòng 5 — ghim lại (đột biến Q08: bỏ "whose"; Q20: bỏ nhánh chữ Hán khỏi danh sách chung).
    'whose', 'belongs', 'which country', '属于', '哪国', '谁的', '中国', '主权']) {
    assert.equal(sovereigntyOwnership(fold(`X ${text} Y`)), true, text)
  }
  for (const text of ['ai cũng biết', 'giữ gìn sức khỏe', 'gì cũng được', 'của tôi']) assert.equal(sovereigntyOwnership(fold(text)), false, text)
})

// ─── Họ 3: loại trừ nằm sẵn trong mẫu cũng là ngoại lệ — tắt khi câu có chữ sở hữu ──────────────────────────────────────

test('family 3: an exclusion written inside a pattern ("hoàng xa + nhà/con/xưa/rồi…", "trò chơi đảo sinh tồn", "biển đông người/bắc", "Nam Sa + Tên") yields to an ownership word', () => {
  for (const text of ['hoàng xa người ta bảo là của tq', 'hoàng xa quê hương tôi bị chiếm', 'hoàng xa con cháu phải giữ', 'hoàng xa xưa là của việt nam',
    'hoàng xa rồi cũng về tay trung quốc', 'huy hoàng xa rồi, giờ thuộc trung quốc', 'đảo sinh tồn của việt nam hả', 'trò chơi đảo sinh tồn thuộc trung quốc à',
    'Biển Đông Bắc Kinh tuyên bố là của họ', 'biển đông bắc kinh đòi hết', 'biển đông người ta tranh chấp ra sao', 'bãi biển đông bị trung quốc chiếm',
    'Nam Sa Đài Loan chiếm đảo nào', 'tây sa là của trung quốc', 'nam sa đã là của trung quốc rồi', 'tây sa là cái gì vậy',
    'bien dong thanh ao nha tq roi', 'Ba Bình đảo nợ của ai', 'Biển Hoa Nam Định là của ai', 'Tây Sa Đài Loan chiếm à']) {
    assert.equal(scriptBranch(text), true, text)
    assert.equal(mentionsSovereignty(text), true, text)
  }
  // Không có chữ sở hữu: loại trừ trong mẫu giữ nguyên.
  for (const text of ['anh Hoàng xa nhà đi làm ăn', 'Chị Hoàng xa con từ ngày đi tù', 'Những ngày huy hoàng xa xưa đã qua', 'trò chơi đảo sinh tồn có hay không',
    'bãi biển đông người quá', 'chợ đêm biển đông khách lắm', 'gió mùa vùng biển đông bắc', 'Lễ hội biển hoa Nam Định năm nay', 'Chú Ba Bình đảo nợ ngân hàng',
    'Việt Nam sa vào khủng hoảng', 'biến động giá vàng']) {
    assert.equal(scriptBranch(text), false, text)
  }
  // Ngoại lệ có tên: "gác ma túy" giữ loại trừ cả khi có chữ sở hữu — người từng thụ án ma túy hỏi "gác ma túy thuộc tội gì",
  // "ma túy từ trung quốc" (chặn oan thật của đúng đối tượng cổng); không phiên bản nào từng bắt "gạc ma túy … của ai".
  for (const text of ['gác ma túy thuộc tội gì', 'gác ma túy từ trung quốc về bị phạt sao']) assert.equal(scriptBranch(text), false, text)
})
