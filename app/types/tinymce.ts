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

/** Nút DOM trong vùng soạn thảo — chỉ phần dự án đọc/ghi (nút "Sửa ảnh", chú thích ảnh). */
export interface TinyMceDomNode {
  nodeName?: string
  /** 1 element, 3 text. */
  nodeType?: number
  nodeValue?: string | null
  className?: string
  childNodes?: ArrayLike<TinyMceDomNode>
  closest?: (selector: string) => TinyMceDomNode | null
  querySelector?: (selector: string) => TinyMceDomNode | null
  querySelectorAll?: (selector: string) => ArrayLike<TinyMceDomNode>
  getAttribute?: (name: string) => string | null
  setAttribute?: (name: string, value: string) => void
  removeAttribute?: (name: string) => void
}

/** Nút của cây HTML mà bộ tuần tự hoá (`serializer`) duyệt — `type` 3 là nút chữ, `value` là chữ của nó. */
export interface TinyMceAstNode {
  /** Element name, lower case (`img`, `figcaption`); `#text` for a text node. */
  name: string
  type: number
  value?: string
  firstChild: TinyMceAstNode | null
  next: TinyMceAstNode | null
  getAll: (name: string) => TinyMceAstNode[]
  /** Đọc; ghi với `value` là chuỗi; gỡ thuộc tính với `null`. */
  attr: (name: string, value?: string | null) => unknown
}

/** Một thực thể trình soạn thảo đã khởi tạo. */
export interface TinyMceEditorInstance {
  /** `FullscreenStateChanged` mang `state`; các sự kiện khác không cần đối số. */
  on: (event: string, handler: (event: { state?: boolean }) => void) => void
  off: (event: string, handler: (event: { state?: boolean }) => void) => void
  /** Plugin đã nạp — `fullscreen.isFullscreen()` cho nút "Phóng to" biết trạng thái lúc nó được vẽ. */
  plugins?: { fullscreen?: { isFullscreen: () => boolean } }
  getContent: () => string
  setContent: (html: string) => void
  /** Chèn HTML tại vị trí con trỏ (dùng khi chọn ảnh từ Thư viện Media). */
  insertContent: (html: string) => void
  /** Chạy một lệnh có sẵn của TinyMCE — `mceImage` mở hộp thoại ảnh cho ảnh đang chọn (nút "Sửa ảnh"). */
  execCommand: (name: string) => void
  /**
   * Vùng chọn — nút "Sửa ảnh" bật khi nút đang chọn là `IMG`, hoặc `FIGURE.image` (bấm vào ảnh có chú thích chọn cả
   * khung, không phải `IMG`); `setCursorLocation` đưa con trỏ vào ô chú thích vừa chèn.
   */
  selection: {
    getNode: () => TinyMceDomNode | null
    setCursorLocation?: (node: TinyMceDomNode, offset?: number) => void
  }
  /** Vùng soạn thảo (thân tài liệu trong iframe). */
  getBody?: () => TinyMceDomNode | null
  /** Tài liệu trong iframe soạn thảo (đặt `zoom` lên `documentElement`, nghe `wheel`) và khung ngoài của trình soạn (thanh trạng thái). */
  getDoc?: () => Document
  getContainer?: () => HTMLElement
  /** Báo TinyMCE vị trí đã đổi: thanh nổi đang mở tính lại chỗ đứng (sau khi đổi mức phóng to). */
  dispatch?: (name: string) => void
  nodeChanged?: () => void
  /** Công cụ DOM của TinyMCE — chỉ phần tạo và chèn một đoạn văn trống sau ảnh có chú thích. */
  dom?: {
    create: (name: string, attrs?: Record<string, string> | null, html?: string) => TinyMceDomNode
    insertAfter: (node: TinyMceDomNode, reference: TinyMceDomNode) => void
  }
  /** Bộ tuần tự hoá HTML: bộ lọc nút chạy lên mọi kết quả của `getContent()` (chữ thay thế của ảnh theo chú thích). */
  serializer?: {
    addNodeFilter: (name: string, handler: (nodes: TinyMceAstNode[]) => void) => void
    /** Thuộc tính tạm của trình soạn: có trong DOM, không có trong `getContent()`, mã nguồn và clipboard. */
    addTempAttr: (name: string) => void
  }
  /** Giao diện của TinyMCE — chỉ phần đăng ký nút/mục menu (nút "video từ kho", nút ảnh từ thư viện, "Sửa ảnh"). */
  ui?: {
    registry: {
      addButton: (name: string, spec: {
        icon: string
        text?: string
        tooltip: string
        onAction: () => void
        /** Chạy khi nút gắn vào thanh; trả hàm gỡ. `setEnabled` tắt/bật nút. */
        onSetup?: (api: { setEnabled: (state: boolean) => void }) => () => void
      }) => void
      addMenuItem?: (name: string, spec: { icon: string, text: string, onAction: () => void }) => void
      /** Nút bật/tắt: `setActive` đặt trạng thái nhấn (nút "Phóng to"). */
      addToggleButton: (name: string, spec: {
        icon: string
        text?: string
        tooltip: string
        onAction: () => void
        onSetup?: (api: { setEnabled: (state: boolean) => void, setActive: (state: boolean) => void }) => () => void
      }) => void
    }
  }
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
