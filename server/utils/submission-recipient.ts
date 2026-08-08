/**
 * Giải địa chỉ nhận thông báo cho một đơn đăng ký — **phía máy chủ**, không lấy
 * từ thân request.
 *
 * ## Vì sao tệp này tồn tại
 *
 * Biểu mẫu ở trang chủ và `/contact` **chưa bao giờ gửi được email nào**, và nó
 * hỏng theo bốn cách xếp lớp lên nhau nên không cách nào tự lộ ra:
 *
 * 1. `SupportFormBlock.vue` (biểu mẫu ở **trang chủ**) không gửi `recipientEmail`
 *    lẫn `formTitle` trong thân request — nên nhánh gửi mail ở
 *    `submissions.post.ts` không bao giờ được vào.
 * 2. `support_form` trong `app/utils/blocks/registry.ts` **không có** trường
 *    `recipientEmail` để cấu hình. Nó chỉ có `email` — địa chỉ **hiện trên trang**
 *    cho người dân đọc, không phải địa chỉ nhận đơn. Máy chủ thì đi tìm
 *    `data.recipientEmail` trên đúng loại block đó.
 * 3. `getConfiguredRecipients` truy vấn bảng `page_blocks` **chỉ với**
 *    `blockType = 'contact_form'`, nên một `support_form` có cấu hình vẫn không
 *    vào được allowlist.
 * 4. Đo trên CSDL đang chạy: cả hai hàng block đều có
 *    `JSON_EXTRACT(data,'$.recipientEmail') = NULL`, nên allowlist là **tập rỗng**
 *    và mọi địa chỉ đều bị từ chối — kể cả địa chỉ đúng.
 *
 * Hợp lại: đơn **lưu thành công**, người dân thấy lời cảm ơn, `/admin/submissions`
 * hiện đúng hàng, và **không ai được báo**. Không có lỗi ở đâu cả.
 *
 * ## Cách sửa
 *
 * Đi theo `server/api/public/chatbot/lead.post.ts` — tệp đó **vốn đã làm đúng**:
 * giải người nhận ở máy chủ theo một chuỗi ưu tiên, không bao giờ tin thân
 * request. Nhờ vậy khả năng open-relay biến mất **hoàn toàn** thay vì được canh
 * bằng một allowlist, và cấu hình mặc định (`settings.email`) dùng được ngay
 * không cần ai đi sửa từng block.
 *
 * Giá trị client gửi lên chỉ còn là một **lựa chọn trong allowlist** — nó chọn
 * được một trong những địa chỉ đã cấu hình, và không chọn được gì khác.
 */

export interface RecipientResolution {
  to: string | null
  /** Vì sao ra địa chỉ đó. Đi vào log, nên phải chỉ đúng vào chỗ cần sửa. */
  source: 'block-request' | 'block-single' | 'site-settings' | 'none'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim())
}

function clean(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Hàm **thuần**: (địa chỉ client xin, tập đã cấu hình, email của cổng) → địa chỉ.
 *
 * Thứ tự ưu tiên:
 *   1. Địa chỉ client xin — **chỉ khi** nó nằm trong tập đã cấu hình trên block.
 *   2. Tập đã cấu hình có **đúng một** địa chỉ → dùng nó. Đây là ca thật hay gặp
 *      nhất: cán bộ đặt email nhận trong Page Builder rồi biểu mẫu quên gửi kèm
 *      (chính bug #1). Nhiều hơn một thì **không đoán** — chọn hộ là gửi hồ sơ
 *      của công dân tới một đơn vị không phụ trách.
 *   3. `settings.email` — email liên hệ của cổng. Đây là lý do phép sửa này có
 *      hiệu lực **ngay** trên dữ liệu đang có, không cần một lượt migrate nào.
 *
 * Trả `null` khi không có gì dùng được. Nơi gọi ghi log rồi bỏ qua — đơn đã lưu
 * xong trước đó (chính sách 3C).
 */
export function resolveSubmissionRecipient(
  requested: unknown,
  configured: Iterable<string>,
  siteEmail: unknown,
): RecipientResolution {
  const allowed = new Set<string>()
  for (const entry of configured) {
    const value = clean(entry)
    if (isValidEmail(value)) allowed.add(value)
  }

  const asked = clean(requested)
  if (asked && allowed.has(asked)) return { to: asked, source: 'block-request' }

  if (allowed.size === 1) {
    // `[only] = allowed` cho ra `string | undefined` dưới `noUncheckedIndexedAccess`
    // — trình kiểm kiểu không biết `size === 1` bảo đảm có phần tử. Lấy qua vòng
    // lặp để không phải khẳng định một điều nó chưa kiểm được.
    for (const only of allowed) return { to: only, source: 'block-single' }
  }

  const site = clean(siteEmail)
  if (isValidEmail(site)) return { to: site, source: 'site-settings' }

  return { to: null, source: 'none' }
}
