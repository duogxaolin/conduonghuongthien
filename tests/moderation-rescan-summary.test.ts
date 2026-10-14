import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  RESCAN_AI_UNAVAILABLE_NOTICE,
  rescanAiNotice,
  rescanFinishedToast,
  rescanSummaryText,
  type RescanSummary,
} from '../app/utils/moderation-rescan-summary.ts'

/**
 * Lượt "Quét & dọn" khi AI kiểm duyệt CHƯA cấu hình chỉ chạy bằng luật
 * (`summary.aiUnavailable`). Trang quản trị phải nói điều đó — nếu không, "đã quét
 * N bình luận (ẩn 0)" đọc như AI đã duyệt sạch N bình luận.
 */

const base: RescanSummary = {
  scannedComments: 120,
  hiddenComments: 3,
  failedComments: 0,
  scannedMessages: 40,
  deletedMessages: 1,
  failedMessages: 0,
  truncated: false,
}

test('lượt quét có AI: tóm tắt như cũ, không có lời cảnh báo', () => {
  assert.equal(rescanSummaryText(base), 'Đã quét 120 bình luận (ẩn 3), 40 tin chat (xóa 1).')
  assert.equal(rescanAiNotice(base), '')
  assert.equal(rescanAiNotice({ ...base, aiUnavailable: false }), '')
})

test('lượt quét chỉ bằng luật: dòng cảnh báo riêng + toast là CẢNH BÁO nói rõ', () => {
  const summary = { ...base, aiUnavailable: true }
  assert.equal(rescanAiNotice(summary), 'AI kiểm duyệt chưa cấu hình — đã quét chỉ bằng luật.')
  // Dòng số liệu không lặp lại cảnh báo (cảnh báo có dòng riêng ngay bên dưới).
  assert.doesNotMatch(rescanSummaryText(summary), /chỉ bằng luật/)
  const toast = rescanFinishedToast(summary)
  assert.equal(toast.type, 'warning')
  assert.ok(toast.message.endsWith(RESCAN_AI_UNAVAILABLE_NOTICE))
  assert.ok(toast.message.startsWith('Đã quét 120 bình luận'))
})

test('lượt quét có AI: toast thành công như cũ', () => {
  assert.deepEqual(rescanFinishedToast(base), { type: 'success', message: 'Đã quét 120 bình luận (ẩn 3), 40 tin chat (xóa 1).' })
})

test('lỗi + chạm giới hạn vẫn được nói, kèm cảnh báo AI', () => {
  const text = rescanFinishedToast({ ...base, failedComments: 2, failedMessages: 1, truncated: true, aiUnavailable: true }).message
  assert.match(text, /3 mục lỗi, xem nhật ký máy chủ/)
  assert.match(text, /đã đạt giới hạn mỗi lượt/)
  assert.match(text, /chỉ bằng luật/)
})

test('chưa có kết quả → không có cảnh báo', () => {
  assert.equal(rescanAiNotice(null), '')
  assert.equal(rescanAiNotice(undefined), '')
})

// Hành vi hiển thị nằm trong template — đây là phần duy nhất phải đọc chữ: dòng
// cảnh báo có `role="status"` và đọc từ chính hàm thuần ở trên.
test('moderation.vue: dòng cảnh báo AI là role="status", đọc từ rescanAiNotice của lượt đã xong', () => {
  const source = readFileSync(new URL('../app/pages/admin/ai/moderation.vue', import.meta.url), 'utf8')
  assert.match(source, /from '~\/utils\/moderation-rescan-summary'/)
  const block = source.match(/<p\s+v-if="rescanAiUnavailableText"[\s\S]*?<\/p>/)
  assert.ok(block, 'thiếu dòng cảnh báo AI trong vùng trạng thái quét')
  assert.match(block![0], /role="status"/)
  assert.match(block![0], /\{\{ rescanAiUnavailableText \}\}/)
  assert.match(source, /rescanAiUnavailableText = computed\(\(\) =>[\s\S]{0,160}rescanAiNotice\(/)
  assert.doesNotMatch(source, /function rescanSummaryText/, 'tóm tắt chỉ có một bản (utils)')
  assert.match(source, /rescanFinishedToast\(next\.summary\)/, 'toast khi xong dùng hàm thuần (cảnh báo khi chỉ quét bằng luật)')
})
