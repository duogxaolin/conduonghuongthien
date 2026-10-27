/**
 * Biên dịch, kiểm và CHẠY mẫu luật kiểm duyệt do cán bộ viết — MỘT chỗ cho cả ba
 * nơi dùng: `fastPreModerate`, `checkAndModerateContent` và hai endpoint tạo/sửa luật.
 *
 * Vì sao có tệp này:
 *
 *  1. Hai nơi khớp luật từng biên dịch KHÁC nhau. `checkAndModerateContent` gọi
 *     `pattern.toLowerCase()` trước `new RegExp(...)`, nên `\S \W \D \B` bị đổi
 *     thành `\s \w \d \b` — nghĩa ngược hẳn (`^\D+$` thành "toàn chữ số"). Không
 *     phân biệt hoa/thường thì đã có cờ `i`; mẫu KHÔNG bao giờ bị hạ chữ.
 *  2. Mẫu regex của cán bộ chạy trên MỌI tin nhắn công khai. Một mẫu lùi vô hạn
 *     (catastrophic backtracking) chạy không giới hạn sẽ treo cả tiến trình Node — vòng sự
 *     kiện đứng lại cho mọi người dùng — chỉ với một câu bình luận vài chục ký tự.
 *
 * HAI LỚP PHÒNG VỆ — đọc kỹ phạm vi của từng lớp (ở đầu tệp con tương ứng): lớp 1 phân
 * tích cấu trúc mẫu lúc LƯU (và lúc nạp luật cũ) và chỉ là ước lượng tốt-nhất-có-thể, có
 * khe hở không vá trọn được (chữ ngoài bảng mẫu — `FINDING moderation-regex-4`); lớp 2
 * giới hạn TỔNG thời gian khớp lúc CHẠY: mỗi cửa sổ bị NGẮT CỨNG ở ~200 ms (`node:vm` có hạn
 * giờ); mỗi luật tối đa 1 s mỗi chu kỳ 60 s (+ một cửa sổ) rồi tắt 10 phút; mỗi request mà
 * nơi gọi truyền hạn mức (hai endpoint chat, đường đăng bình luận) tối đa 250 ms. Ngoài lớp
 * 2: từ điển dựng sẵn `INSTANT_*` (≤ ~10 ms trên 10 000 ký tự dựng sẵn), phép phân tích lớp 1 lúc
 * lưu/nạp luật (chỉ cán bộ có quyền sửa luật kích hoạt), và hạn mức request ở nơi chưa truyền
 * (chat livestream, quét lại) — ở đó chỉ hai mức đầu áp.
 *
 * Barrel từ wave3-long-term 4.3 (D-SPLIT): xuất lại những tên tệp này xuất trước khi tách
 * (16 giá trị + 1 kiểu) cộng các tên thêm có chủ đích sau đó (ghim ở
 * `tests/service-split-boundaries.test.ts` luật 5), nên mọi nơi gọi — hai endpoint luật, hai
 * endpoint chat, `comments-posting.ts`, `moderation-rules-cache.ts`,
 * `moderation-worker-check.ts`, `moderation-worker-prescreen.ts` — giữ một đường import, và
 * chỉ đường này (luật 6). Mã nằm ở các tệp con:
 *
 *   - moderation-regex-limits.ts    trần độ dài, cờ `iu`, kích thước cửa sổ (chỉ hằng số)
 *   - moderation-regex-check.ts     kiểm mẫu lúc lưu + biên dịch có cache (chủ của cache)
 *   - moderation-regex-runtime.ts   lớp 2: mọi luật của một lô văn bản trong một lượt `vm` có
 *                                   hạn giờ cứng, theo cửa sổ (chủ DUY NHẤT của ngữ cảnh `vm`)
 *   - moderation-regex-budget.ts    lớp 2: sổ — đồng hồ, luật đang tắt, ngân sách chu kỳ mỗi luật,
 *                                   hạn mức mỗi request (chủ DUY NHẤT của bốn sổ đó; tách khỏi
 *                                   tệp chạy ở 4.3c tiếp)
 *   - moderation-regex-parser.ts    lớp 1: đọc mẫu thành cây, bảng ký tự mẫu (KHÔNG xuất lại)
 *   - moderation-regex-analysis.ts  lớp 1: xét hình dạng nguy hiểm trên cây
 *
 * Tệp con import lẫn nhau, không bao giờ import barrel này.
 */

export {
  MODERATION_PATTERN_MAX_LENGTH,
  MODERATION_REGEX_FLAGS,
  MODERATION_REGEX_WINDOW,
  MODERATION_REGEX_WINDOW_OVERLAP,
} from './moderation-regex-limits'

export {
  isRegexRuleType,
  checkModerationPattern,
  compileModerationRegex,
  clearCompiledModerationRegexCache,
} from './moderation-regex-check'
export type { ModerationPatternCheck } from './moderation-regex-check'

export {
  MODERATION_RULE_WINDOW_BUDGET_MS,
  testModerationRegex,
  testModerationRegexes,
  testModerationRegexBatch,
  scanModerationRegexBatch,
} from './moderation-regex-runtime'
export type { ModerationRegexBatchItem, ModerationRegexBatchScan, ModerationRegexRule } from './moderation-regex-runtime'

export {
  MODERATION_RULE_COOLDOWN_MS,
  MODERATION_RULE_CUMULATIVE_BUDGET_MS,
  MODERATION_RULE_CUMULATIVE_PERIOD_MS,
  MODERATION_REQUEST_BUDGET_MS,
  setModerationRegexTimingForTests,
  resetSlowModerationRules,
  isModerationRuleDisabled,
  createModerationRegexBudget,
} from './moderation-regex-budget'
export type { ModerationRegexBudget } from './moderation-regex-budget'

export { findCatastrophicShape } from './moderation-regex-analysis'
