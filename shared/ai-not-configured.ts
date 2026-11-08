/**
 * HTTP status một endpoint quản trị trả khi dịch vụ AI không chạy được vì CẤU HÌNH — nhà cung cấp đang
 * tắt, dịch vụ đang tắt, chưa có khoá (CHANGELOG § 98; mã của cổng AI: `server/utils/ai/not-configured.ts`).
 * Cùng cách với "R2 chưa cấu hình". Trang quản trị chạy theo lô (`useLanguageBatchTranslate`) dừng cả lượt
 * khi gặp status này, vì mọi lô sau cũng bị từ chối y như vậy.
 */
export const AI_NOT_CONFIGURED_STATUS = 503
