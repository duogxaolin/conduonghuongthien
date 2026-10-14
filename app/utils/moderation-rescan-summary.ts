/**
 * Lời tóm tắt của lượt "Quét & dọn" trên trang `/admin/ai/moderation` — hàm thuần,
 * kiểm không cần mount (`tests/moderation-rescan-summary.test.ts`).
 *
 * `aiUnavailable` (do `rescanExistingContent` đặt, `server/services/moderation-worker.ts`):
 * AI kiểm duyệt CHƯA cấu hình, nên lượt quét chỉ áp các LUẬT (chặn tức thì + luật tuỳ
 * biến). Không nói ra điều đó thì "Đã quét 500 bình luận (ẩn 0)" đọc như "AI đã duyệt
 * 500 bình luận và thấy sạch" — một kết luận sai về độ phủ của kiểm duyệt.
 */

export interface RescanSummary {
  scannedComments: number
  hiddenComments: number
  failedComments: number
  scannedMessages: number
  deletedMessages: number
  failedMessages: number
  truncated: boolean
  aiUnavailable?: boolean
}

export const RESCAN_AI_UNAVAILABLE_NOTICE = 'AI kiểm duyệt chưa cấu hình — đã quét chỉ bằng luật.'

/** Số liệu của lượt quét vừa xong — dòng trạng thái dưới nút (cảnh báo AI là dòng riêng). */
export function rescanSummaryText(s: RescanSummary): string {
  const failed = s.failedComments + s.failedMessages
  return `Đã quét ${s.scannedComments} bình luận (ẩn ${s.hiddenComments}), ${s.scannedMessages} tin chat (xóa ${s.deletedMessages})`
    + (failed ? ` · ${failed} mục lỗi, xem nhật ký máy chủ` : '')
    + (s.truncated ? ' · đã đạt giới hạn mỗi lượt, chạy lại để quét tiếp phần còn lại.' : '.')
}

/** Lời cảnh báo riêng (dòng `role="status"` thứ hai) — rỗng khi AI đã tham gia lượt quét. */
export function rescanAiNotice(s: RescanSummary | null | undefined): string {
  return s?.aiUnavailable === true ? RESCAN_AI_UNAVAILABLE_NOTICE : ''
}

/** Toast khi lượt quét vừa xong: quét chỉ bằng luật là CẢNH BÁO, không phải "thành công". */
export function rescanFinishedToast(s: RescanSummary): { type: 'success' | 'warning'; message: string } {
  const notice = rescanAiNotice(s)
  return notice
    ? { type: 'warning', message: `${rescanSummaryText(s)} ${notice}` }
    : { type: 'success', message: rescanSummaryText(s) }
}
