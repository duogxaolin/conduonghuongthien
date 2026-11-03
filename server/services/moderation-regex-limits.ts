/**
 * Giới hạn dùng chung của nhóm `moderation-regex` (wave3-long-term 4.3, D-SPLIT; dời
 * nguyên văn từ `moderation-regex.ts`): trần độ dài mẫu, cờ biên dịch, và kích thước cửa
 * sổ quét. Cửa sổ là nơi lớp 2 chạy luật (`moderation-regex-runtime.ts`) và cũng là độ
 * dài mà lớp 1 ước lượng chi phí trên đó (`moderation-regex-analysis.ts`).
 *
 * Chỉ hằng số, không import gì: mọi tệp con khác import từ đây mà không tạo vòng
 * (kiểm → phân tích → chạy → kiểm là vòng nếu hằng số nằm ở tệp kiểm).
 */

/** Trần độ dài mẫu (cả từ khoá lẫn regex). */
export const MODERATION_PATTERN_MAX_LENGTH = 200

/** Cờ dùng khi khớp — kiểm lúc lưu dùng ĐÚNG cờ này (cờ `u` khắt khe hơn không-`u`). */
export const MODERATION_REGEX_FLAGS = 'iu'

/** Cửa sổ văn bản mỗi lượt khớp — bằng trần độ dài bình luận (`COMMENT_MAX_LENGTH`). */
export const MODERATION_REGEX_WINDOW = 2000
/** Phần chồng nhau giữa hai cửa sổ liên tiếp khi văn bản dài hơn một cửa sổ. */
export const MODERATION_REGEX_WINDOW_OVERLAP = 400
