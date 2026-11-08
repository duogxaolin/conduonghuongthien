/**
 * Lượt gọi AI mà cổng AI (`callAi`, `server/services/ai-gateway-call.ts`) từ chối vì CẤU HÌNH — không
 * phải lỗi tạm thời. Gọi lại không bao giờ thành công cho tới khi cán bộ sửa ở Quản trị › AI, nên nơi
 * gọi chạy vòng (dịch bài, dịch hàng loạt, dịch toàn cục, dịch giao diện theo lô) dừng ngay ở lượt đầu
 * thay vì thử lại từng đoạn/từng bài và ghi một dòng cảnh báo cho mỗi lượt (CHANGELOG § 98).
 *
 * Bốn mã, đúng nhóm "AI chưa cấu hình" mà kiểm duyệt tự động đã dùng (`moderation-worker-check.ts`):
 *   - `service_not_found` / `service_inactive` — dịch vụ chưa tạo, đang tắt, hoặc thiếu Base URL / model;
 *   - `no_api_key` — nhà cung cấp chưa có khoá, hoặc khoá không giải mã được (đổi khoá mã hoá);
 *   - `provider_inactive` — công tắc "Hoạt động/Tắt" của nhà cung cấp đang tắt.
 * Không có `budget_exceeded` (hết hạn mức có thể qua khi sang tháng/nâng hạn mức — mỗi nơi gọi xử lý riêng)
 * và `provider_url_rejected`.
 *
 * Chatbot KHÔNG dùng tập này: ở đó `service_*`/`no_api_key` vẫn lùi về đường gọi cũ cấu hình ở "Cài đặt
 * Chatbot" (chủ đích), còn `provider_inactive` dừng hẳn như `budget_exceeded` (`chat-policy-provider.ts`).
 */

/** Mã từ chối khi công tắc của nhà cung cấp mà dịch vụ dùng đang tắt. */
export const AI_PROVIDER_INACTIVE = 'provider_inactive'

const NOT_CONFIGURED_ERRORS: ReadonlySet<string> = new Set(['service_not_found', 'service_inactive', 'no_api_key', AI_PROVIDER_INACTIVE])

/** HTTP status của endpoint quản trị khi AI chưa cấu hình — một định nghĩa, trang quản trị đọc cùng hằng. */
export { AI_NOT_CONFIGURED_STATUS } from '../../../shared/ai-not-configured'

const GENERIC_MESSAGE = 'Dịch vụ AI chưa được cấu hình (dịch vụ hoặc nhà cung cấp đang tắt, hoặc chưa có khoá API). Kiểm tra ở Quản trị › AI.'

/** Cổng AI đã từ chối lượt gọi vì cấu hình — gọi lại cũng vô ích. */
export function isAiNotConfigured(error: string | null | undefined): boolean {
  return typeof error === 'string' && NOT_CONFIGURED_ERRORS.has(error)
}

/** Câu cho cán bộ: lời của cổng AI nếu có (nhà cung cấp đang tắt thì nêu tên), không thì một câu chung. */
export function aiNotConfiguredMessage(result: { errorMessage?: string }): string {
  return result.errorMessage?.trim() || GENERIC_MESSAGE
}

/**
 * Ném từ sâu bên trong một lượt dịch khi cổng AI từ chối vì cấu hình, để vòng ngoài dừng (thay vì đếm
 * là "mô hình trả lời không đọc được"). `message` là câu cho cán bộ.
 */
export class AiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiNotConfiguredError'
  }
}
