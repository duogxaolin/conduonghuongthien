/**
 * Bề mặt TinyMCE mà dự án thật sự chạm tới — không hơn.
 *
 * TinyMCE nạp bằng thẻ `<script>` (tự chủ trong `public/assets/tinymce/`, có CDN
 * dự phòng) chứ không phải một gói npm, nên nó **không mang theo kiểu nào**.
 *
 * Khai đúng phần đang dùng thay vì `any`. `any` không chỉ tắt kiểm kiểu cho lời
 * gọi hợp lệ — nó nuốt luôn lỗi **gõ sai tên phương thức**: `ed.setConten(...)`
 * biên dịch trót lọt rồi ném lúc chạy, ở một trình soạn thảo mà lỗi đó nghĩa là
 * **mất bài viết cán bộ đang gõ dở**.
 *
 * Cố ý **không** cài `@types/tinymce`: cả dự án chỉ gọi năm phương thức, còn gói
 * kiểu đầy đủ là thêm một phụ thuộc phải cập nhật cho một thư viện vốn đang nạp
 * từ tệp tĩnh. Thêm phương thức mới thì khai thêm ở đây — danh sách này ngắn là
 * chủ đích, vì nó cũng là bản kê những gì dự án phụ thuộc vào.
 *
 * Dùng ở hai nơi (`TinyMceEditor.vue` và trang soạn bài viết), nên nó sống ở đây
 * chứ không nhân bản trong từng SFC.
 */

/** Một thực thể trình soạn thảo đã khởi tạo. */
export interface TinyMceEditorInstance {
  on: (event: string, handler: () => void) => void
  getContent: () => string
  setContent: (html: string) => void
  /** Chèn HTML tại vị trí con trỏ (dùng khi chọn ảnh từ Thư viện Media). */
  insertContent: (html: string) => void
  remove: () => void
  destroy: () => void
}

/** Đối tượng toàn cục do thẻ script tạo ra. */
export interface TinyMceGlobal {
  init: (config: Record<string, unknown>) => void
  /** `undefined` khi id không khớp trình soạn thảo nào đang sống. */
  get: (id: string) => TinyMceEditorInstance | undefined
}

/** `window` sau khi thẻ script đã nạp xong — `tinymce` là tuỳ chọn vì lượt nạp
 *  có thể còn đang chạy, hoặc đã hỏng cả tệp tĩnh lẫn CDN. */
export type WindowWithTinyMce = Window & { tinymce?: TinyMceGlobal }
