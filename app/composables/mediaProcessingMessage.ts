/** Translate common processing failures into an action, without exposing paths or tool output. */
export function mediaProcessingMessage(reason: unknown): string {
  const text = typeof reason === 'string' ? reason : ''
  if (/ENOSPC|disk|đĩa|dung lượng/i.test(text)) return 'Máy chủ không đủ dung lượng để xử lý video. Liên hệ quản trị viên để giải phóng dung lượng rồi thử xử lý lại.'
  if (/spawn ff(?:mpeg|probe).*ENOENT|command not found/i.test(text)) return 'Máy chủ chưa có công cụ xử lý video. Liên hệ quản trị viên để kiểm tra cài đặt trước khi thử lại.'
  if (/ENOENT|source.*(?:missing|not found)|không tìm thấy.*tệp|đường dẫn media không hợp lệ/i.test(text)) return 'Không tìm thấy tệp video gốc. Liên hệ quản trị viên để kiểm tra hoặc tải lại tệp.'
  if (/EACCES|permission denied|quyền.*ghi/i.test(text)) return 'Máy chủ không có quyền đọc hoặc ghi tệp video. Liên hệ quản trị viên để kiểm tra quyền lưu trữ.'
  if (/ECONN|ETIMEDOUT|kết nối|timed?\s*out|network|socket/i.test(text)) return 'Kết nối bị gián đoạn trong lúc xử lý video. Hãy thử xử lý lại khi kết nối ổn định.'
  if (/ffprobe|invalid data|unsupported|codec|định dạng|no video|không.*luồng video/i.test(text)) return 'Không đọc được định dạng hoặc luồng hình của video. Kiểm tra tệp gốc có phát được rồi tải lại bằng định dạng được hỗ trợ.'
  if (/hết số lượt|retry limit|attempts exhausted/i.test(text)) return 'Video đã hết lượt tự động thử lại. Có thể yêu cầu xử lý lại; nếu vẫn lỗi, liên hệ quản trị viên để kiểm tra tệp và máy chủ.'
  return 'Không xử lý được video. Hãy thử xử lý lại. Nếu vẫn lỗi, liên hệ quản trị viên kèm tiêu đề video và thời điểm xảy ra lỗi.'
}
