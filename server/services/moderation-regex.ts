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
 *     (catastrophic backtracking) treo cả tiến trình Node — vòng sự kiện đứng lại
 *     cho mọi người dùng — chỉ với một câu bình luận vài chục ký tự.
 *
 * HAI LỚP PHÒNG VỆ — đọc kỹ phạm vi của từng lớp (ở đầu tệp con tương ứng), đừng đọc
 * thành "đã chặn ReDoS": lớp 1 phân tích cấu trúc mẫu lúc LƯU (và lúc nạp luật cũ) và
 * là ước lượng thô, có khe hở; lớp 2 chỉ giới hạn thiệt hại lúc CHẠY — cửa sổ chậm đầu
 * tiên vẫn chặn vòng sự kiện. Loại bỏ hẳn cần engine không lùi (RE2) hoặc chạy regex
 * ngoài luồng chính có hạn giờ — chưa có trong dự án.
 *
 * Barrel từ wave3-long-term 4.3 (D-SPLIT): xuất lại ĐÚNG những tên tệp này luôn xuất
 * (16 giá trị + 1 kiểu, ghim ở `tests/service-split-boundaries.test.ts` luật 5), nên mọi
 * nơi gọi — hai endpoint luật, `moderation-rules-cache.ts`, `moderation-worker-check.ts`,
 * `moderation-worker-prescreen.ts` — giữ một đường import, và chỉ đường này (luật 6). Mã
 * nằm ở các tệp con (tách nguyên văn — không đổi hành vi):
 *
 *   - moderation-regex-limits.ts    trần độ dài, cờ `iu`, kích thước cửa sổ (chỉ hằng số)
 *   - moderation-regex-check.ts     kiểm mẫu lúc lưu + biên dịch có cache (chủ của cache)
 *   - moderation-regex-runtime.ts   lớp 2: chạy theo cửa sổ, đo giờ, tắt luật chậm 10 phút
 *                                   (chủ DUY NHẤT của đồng hồ và sổ luật đang tắt)
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
  MODERATION_RULE_CALL_BUDGET_MS,
  MODERATION_RULE_COOLDOWN_MS,
  setModerationRegexTimingForTests,
  resetSlowModerationRules,
  isModerationRuleDisabled,
  testModerationRegex,
} from './moderation-regex-runtime'

export { findCatastrophicShape } from './moderation-regex-analysis'
