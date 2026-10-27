/**
 * Chạy mẫu luật kiểm duyệt có giới hạn — tệp con của nhóm `moderation-regex`
 * (wave3-long-term 4.3, D-SPLIT; dời nguyên văn từ `moderation-regex.ts`, nơi gọi vẫn
 * import barrel đó).
 *
 * Lớp 2 — giới hạn thiệt hại lúc CHẠY (`testModerationRegex`): mỗi lượt khớp chạy
 * trên cửa sổ tối đa `MODERATION_REGEX_WINDOW` ký tự (văn bản dài hơn được quét theo
 * cửa sổ chồng nhau `MODERATION_REGEX_WINDOW_OVERLAP` ký tự, nên không lách được bằng
 * cách đặt nội dung sau ký tự thứ N), và đo thời gian từng cửa sổ. Một luật mà MỘT
 * cửa sổ chạy quá `MODERATION_RULE_WINDOW_BUDGET_MS` bị TẮT
 * `MODERATION_RULE_COOLDOWN_MS` và ghi log `ai_moderation.rule_slow_disabled` một lần.
 * Đo theo cửa sổ chứ không cộng dồn, để một văn bản dài (tin chatbot không có trần độ
 * dài ở tầng ứng dụng) không biến thành công tắc tắt luật cho bất kỳ ai. Tổng thời
 * gian một luật dùng cho một văn bản bị chặn ở `MODERATION_RULE_CALL_BUDGET_MS`: vượt
 * thì phần còn lại của văn bản đó KHÔNG được quét bằng luật ấy (log
 * `ai_moderation.rule_scan_truncated`, tối đa một lần mỗi luật mỗi khoảng chờ) — phần
 * đó lọt luật regex; trần độ dài ở endpoint chatbot là cách sửa tận gốc. Giới hạn
 * của lớp này: regex JS chạy ĐỒNG BỘ, không ngắt được — cửa sổ chậm đầu tiên vẫn chặn
 * vòng sự kiện trọn thời gian của nó; cửa sổ giới hạn được mẫu đa thức, KHÔNG giới
 * hạn được mẫu cấp số (32 ký tự là đủ treo). Lớp 2 chỉ bảo đảm mẫu đã lọt không chạy
 * lại liên tục. Hệ quả của cửa sổ: `^`/`$` khớp cả ở đầu/cuối mỗi cửa sổ khi văn bản
 * dài hơn N, và một lần khớp dài hơn phần chồng nhau đúng ở ranh giới cửa sổ có thể
 * bị bỏ sót.
 * Loại bỏ hẳn cần engine không lùi (RE2) hoặc chạy regex ngoài luồng chính có hạn
 * giờ — chưa có trong dự án.
 *
 * Tệp này là chủ DUY NHẤT của trạng thái lúc chạy — đồng hồ (`timing`), luật đang bị
 * tắt 10 phút (`disabledUntil`) và mốc log cắt quét (`truncationLoggedUntil`): không
 * `export`, chỉ đổi qua các hàm dưới đây (`tests/service-split-boundaries.test.ts`,
 * luật 4).
 */
import { logWarn } from '../utils/logger'
import {
  MODERATION_PATTERN_MAX_LENGTH,
  MODERATION_REGEX_WINDOW,
  MODERATION_REGEX_WINDOW_OVERLAP,
} from './moderation-regex-limits'

/**
 * Một cửa sổ chạy lâu hơn mức này thì luật bị TẮT tạm. Đo theo TỪNG cửa sổ, không
 * cộng dồn: cộng dồn thì một tin chatbot dài (hàng trăm cửa sổ) làm cả một luật rẻ
 * vượt ngưỡng — tức là ai cũng tắt được luật bằng một tin dài. Mẫu đã qua lớp 1
 * tốn cỡ 10–40 ms một cửa sổ trên máy phát triển; ngưỡng chừa biên cho VPS yếu.
 */
export const MODERATION_RULE_WINDOW_BUDGET_MS = 200
/**
 * Tổng thời gian một luật được dùng cho MỘT văn bản. Vượt thì dừng quét phần còn lại
 * của văn bản đó (không tắt luật — văn bản dài không phải lỗi của luật), để một văn
 * bản rất dài không chặn vòng sự kiện quá lâu.
 */
export const MODERATION_RULE_CALL_BUDGET_MS = 1000
/** Thời gian một luật chậm bị tắt (và khoảng tối thiểu giữa hai dòng log cùng loại). */
export const MODERATION_RULE_COOLDOWN_MS = 10 * 60_000

interface RegexTiming {
  /** Đồng hồ đo khoảng (ms, đơn điệu). */
  elapsed: () => number
  /** Giờ thực (ms) — cho hạn tắt luật. */
  now: () => number
}
const defaultTiming: RegexTiming = { elapsed: () => performance.now(), now: () => Date.now() }
let timing: RegexTiming = defaultTiming
const disabledUntil = new Map<string, number>()
const truncationLoggedUntil = new Map<string, number>()

/** Chỉ cho test: thay đồng hồ để không phải đo thời gian thật. `null` = khôi phục. */
export function setModerationRegexTimingForTests(next: RegexTiming | null): void {
  timing = next ?? defaultTiming
}

/** Bật lại mọi luật đã bị tắt vì chậm (gọi cùng lúc với xoá cache luật). */
export function resetSlowModerationRules(): void {
  disabledUntil.clear()
  truncationLoggedUntil.clear()
}

/** Luật này có đang bị tắt vì chậm không. */
export function isModerationRuleDisabled(pattern: string): boolean {
  const until = disabledUntil.get(pattern)
  if (until === undefined) return false
  if (until > timing.now()) return true
  disabledUntil.delete(pattern)
  return false
}

/**
 * Khớp `regex` (đã qua `compileModerationRegex`) trên `text` có giới hạn — xem "Lớp
 * 2" ở đầu tệp. Trả `false` khi luật đang bị tắt vì chậm.
 */
export function testModerationRegex(pattern: string, regex: RegExp, text: string): boolean {
  if (isModerationRuleDisabled(pattern)) return false
  const step = MODERATION_REGEX_WINDOW - MODERATION_REGEX_WINDOW_OVERLAP
  const start = timing.elapsed()
  for (let from = 0; ; from += step) {
    const before = timing.elapsed()
    const matched = regex.test(text.slice(from, from + MODERATION_REGEX_WINDOW))
    const after = timing.elapsed()
    if (after - before > MODERATION_RULE_WINDOW_BUDGET_MS) {
      disabledUntil.set(pattern, timing.now() + MODERATION_RULE_COOLDOWN_MS)
      logWarn({
        event: 'ai_moderation.rule_slow_disabled',
        pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
        elapsedMs: Math.round(after - before),
        inputLength: text.length,
        disabledForMs: MODERATION_RULE_COOLDOWN_MS,
      })
      return matched
    }
    if (matched) return true
    if (from + MODERATION_REGEX_WINDOW >= text.length) return false
    if (after - start > MODERATION_RULE_CALL_BUDGET_MS) {
      const now = timing.now()
      if ((truncationLoggedUntil.get(pattern) ?? 0) <= now) {
        truncationLoggedUntil.set(pattern, now + MODERATION_RULE_COOLDOWN_MS)
        logWarn({
          event: 'ai_moderation.rule_scan_truncated',
          pattern: pattern.slice(0, MODERATION_PATTERN_MAX_LENGTH),
          scannedChars: from + MODERATION_REGEX_WINDOW,
          inputLength: text.length,
        })
      }
      return false
    }
  }
}
