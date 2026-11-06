/**
 * Thế hệ dữ liệu nền / cấu hình AI TRONG TIẾN TRÌNH — tăng mỗi lần `bumpAnswerCacheVersion()` chạy
 * (`server/services/chatbot-answer-cache.ts`).
 *
 * Vì sao có: gateway AI giữ cấu hình dịch vụ và hàng nhà cung cấp trong bộ nhớ 60 s
 * (`ai-gateway-config.ts`). Cán bộ đổi model của trợ lý (vì nó trả lời tệ) → phiên bản cache câu trả
 * lời tăng → nhưng trong ~60 s model CŨ vẫn trả lời, và câu đó được ghi dưới khoá MỚI, phát lại tới
 * 30 ngày (verifier 2026-11-06 — cùng họ lỗi với bản kho kiến thức trong bộ nhớ). Loader so thế hệ đọc
 * TRƯỚC lượt đọc CSDL với thế hệ của bản giữ: khác ⇒ nạp lại; lượt nạp bắt đầu trước khi tăng thế hệ
 * thì mang thế hệ cũ nên lượt sau nạp lại, không bao giờ "làm tươi" bản cũ.
 *
 * Chỉ trong một tiến trình: production chạy một tiến trình Node (một container `app`). Nhiều tiến
 * trình thì tiến trình khác vẫn chờ hết 60 s — phiên bản trong khoá cache vẫn đúng, chỉ có cửa sổ đó.
 */
let generation = 0

export function configGeneration(): number {
  return generation
}

export function advanceConfigGeneration(): number {
  generation += 1
  return generation
}
