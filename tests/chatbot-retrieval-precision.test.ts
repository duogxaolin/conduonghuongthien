/**
 * Độ CHÍNH XÁC của truy xuất kho tri thức, không chỉ độ phủ.
 *
 * Bộ test cũ (`chatbot-knowledge-retrieval.test.ts`) khoá đúng một ca lọt — khoá "thủ"
 * khớp "thức" — bằng cách nâng ngưỡng khớp chuỗi con từ 3 lên 4 ký tự. Đo trên kho 20
 * mục của bản QA (2026-11-04) cho thấy ngưỡng đó vẫn để 5/6 câu lạc đề đi qua, vì
 * đường vòng còn lại là **hư từ**: "thực hiện"/"công tác", "cần"/"sư", "thế"/"nào".
 *
 * Vá bằng danh sách hư từ ở cả hai vế (câu hỏi và câu hỏi chuẩn của mục), nên:
 *   - không mất câu đúng nào (10/10 giữ nguyên),
 *   - câu lạc đề lọt giảm 5/6 → 3/6,
 *   - ba câu còn lại là đồng âm khác nghĩa ("giá"~"gia đình", "canh"~"chuẩn bị",
 *     "Việt Nam" là cụm từ khoá thật) — chặn chúng cần so khớp ngữ nghĩa, không phải
 *     một ngưỡng chuỗi khác. Chúng được ghi ở đây như giới hạn đã biết, không phải
 *     hành vi mong muốn: nếu ai cắm semantic provider (bước 5), ba ca này phải đổi.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { retrieveKnowledge, type RetrievalEntry } from '../server/utils/chatbot/retrieval.ts'

/** Mục kho tối thiểu: câu hỏi chuẩn + từ khoá sinh tự động, như `chatbot_knowledge_terms`. */
function entry(id: number, canonicalQuestion: string, keywords: string[], aliases: string[] = []): RetrievalEntry {
  return {
    id,
    status: 'published',
    canonicalQuestion,
    normalizedQuestion: canonicalQuestion,
    approvedAnswer: `Trả lời cho mục ${id}`,
    topic: 'pháp luật',
    priority: 0,
    sourceLabel: null,
    sourceReference: null,
    sourceUrl: null,
    terms: [
      ...keywords.map(value => ({ kind: 'keyword' as const, value, normalizedValue: value })),
      ...aliases.map(value => ({ kind: 'alias' as const, value, normalizedValue: value })),
    ],
  } as RetrievalEntry
}

/**
 * Bốn mục đại diện cho đúng loại khớp giả đã đo được.
 *
 * Từ khoá ở đây phải giống thứ `chatbot_knowledge_terms` thật sinh ra: nó tách câu hỏi
 * chuẩn thành ÂM TIẾT và CẶP ÂM TIẾT ("gia", "gia đình", "đình"), không chỉ cụm có
 * nghĩa. Đó chính là lý do "Giá vàng" khớp "… và gia đình" — bỏ âm tiết đơn khỏi fixture
 * sẽ làm test xanh trong khi production vẫn lọt.
 */
const BANK: RetrievalEntry[] = [
  entry(8, 'Vai trò của Ủy ban Trung ương Mặt trận Tổ quốc Việt Nam', ['việt', 'nam', 'việt nam', 'mặt trận', 'vai trò']),
  entry(12, 'Chuẩn bị tái hòa nhập cộng đồng đối với người chấp hành xong án', ['chuẩn', 'bị', 'chuẩn bị', 'tái hòa nhập']),
  entry(20, 'Điều kiện để người chấp hành xong án phạt tù được vay vốn', ['vay', 'vốn', 'vay vốn', 'điều kiện', 'ngân hàng']),
  entry(9, 'Trách nhiệm của các cơ quan, tổ chức và gia đình', ['gia', 'đình', 'gia đình', 'trách nhiệm', 'cơ quan']),
]

const ids = (query: string) => retrieveKnowledge(BANK, query, { topK: 3 }).map(item => item.id)

test('a question made only of function words matches nothing', () => {
  // "thế nào?" / "là gì?" không mang chủ đề; trước đây `partial >= 2` khớp mọi mục có
  // chữ "thế nào" trong câu hỏi chuẩn.
  for (const q of ['Thế nào?', 'Là gì?', 'Có không?', 'Về thì sao?']) {
    assert.deepEqual(ids(q), [], `"${q}" phải trả rỗng`)
  }
})

test('function words shared with the canonical question are not evidence of relevance', () => {
  // 'thuc' (thực) từng khớp "thực hiện"; 'cong' (công) khớp "công tác".
  assert.deepEqual(ids('Công thức nấu phở bò ngon?'), [], '"công thức" không được khớp "công tác"')
  assert.deepEqual(ids('Thời tiết Hà Nội thế nào?'), [], 'chỉ có hư từ, không khớp gì')
})

test('real questions still reach their entry', () => {
  assert.deepEqual(ids('Điều kiện vay vốn ngân hàng là gì?'), [20])
  assert.deepEqual(ids('Chuẩn bị tái hòa nhập cộng đồng gồm gì?'), [12])
  assert.deepEqual(ids('Trách nhiệm của gia đình?'), [9])
})

test('known limit: homographs still match (needs semantic matching, not a tighter string threshold)', () => {
  // Ba ca dưới đây là GIỚI HẠN ĐÃ ĐO, không phải hành vi mong muốn. Nếu chúng bắt đầu
  // trả rỗng thì ai đó đã siết ngưỡng (và có thể đã làm mất câu đúng — đo lại bộ 10 ca
  // trước khi giữ); nếu chúng vẫn trả kết quả sau khi cắm semantic provider thì bước 5
  // chưa có tác dụng.
  assert.deepEqual(ids('Giá vàng hôm nay bao nhiêu?'), [9], '"giá" ~ "gia đình"')
  assert.deepEqual(ids('Làm sao để nấu canh chua?'), [12], '"canh" ~ "chuẩn bị"')
  assert.deepEqual(ids('Bóng đá Việt Nam hôm qua thắng không?'), [8], '"Việt Nam" là cụm từ khoá thật của mục 8')
})
