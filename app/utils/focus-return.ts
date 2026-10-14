/**
 * Nhớ phần tử đang giữ focus lúc một lớp phủ (ngăn kéo, hộp thoại) mở ra, rồi trả
 * focus về đó khi lớp phủ đóng — đúng điều DNA giao diện yêu cầu ở hộp thoại: người
 * dùng bàn phím/trình đọc màn hình không bị văng về đầu tài liệu.
 *
 * Tách khỏi component để kiểm được không cần mount: nó chỉ cần đối tượng có
 * `focus()` (và tuỳ chọn `isConnected`), không cần DOM thật.
 */
export interface FocusTargetLike {
  focus: () => void
  /** `false` nghĩa là phần tử đã bị gỡ khỏi tài liệu (route đổi, v-if…). */
  isConnected?: boolean
}

export interface FocusReturn {
  /** Gọi lúc mở: nhớ `active` (thường `document.activeElement`). */
  remember: (active: FocusTargetLike | null | undefined) => void
  /**
   * Gọi lúc đóng. Chỉ trả focus khi `shouldRestore` — nơi gọi truyền `false` nếu
   * người dùng đã tự chuyển focus sang chỗ khác (không giật focus của họ).
   * Trả `true` nếu thực sự đã focus lại.
   */
  restore: (shouldRestore?: boolean) => boolean
}

/**
 * Bẫy Tab của hộp thoại modal: chỉ can thiệp ở HAI MÉP (Tab ở phần tử cuối → về
 * đầu; Shift+Tab ở phần tử đầu → về cuối) và khi focus đang nằm ngoài danh sách
 * (`activeIndex === -1`, vd. trên chính khung hộp thoại). Ở giữa thì trả `null` —
 * trình duyệt tự chuyển tới phần tử kế tiếp, vốn cũng nằm trong hộp thoại.
 *
 * `inert` lên phần còn lại của trang chưa đủ: đi quá phần tử cuối, Chrome đưa focus
 * ra thanh địa chỉ/`<body>` chứ không quay vòng, nên vẫn phải có bẫy này.
 */
export function trapTabTarget(count: number, activeIndex: number, backwards: boolean): number | null {
  if (count <= 0) return null
  if (activeIndex < 0 || activeIndex >= count) return backwards ? count - 1 : 0
  if (!backwards && activeIndex === count - 1) return 0
  if (backwards && activeIndex === 0) return count - 1
  return null
}

/** Phần DOM tối thiểu `inertOutside` cần — kiểm được bằng đối tượng giả, không cần DOM thật. */
export interface InertNodeLike {
  tagName: string
  parentElement: InertNodeLike | null
  children: ArrayLike<InertNodeLike>
  childElementCount: number
  textContent: string | null
  hasAttribute: (name: string) => boolean
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
}

const NEVER_INERT_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'HEAD'])

/**
 * Có nên đặt `inert` lên một phần tử anh em của hộp thoại không.
 *
 * - đã `inert` sẵn → không đụng (và không gỡ lúc đóng: không phải của mình);
 * - vùng thông báo (`aria-live`, `role=status|alert`, vd. ToastContainer) → để yên,
 *   thông báo phát ra trong lúc ngăn kéo mở vẫn phải tới được trình đọc màn hình;
 * - lớp rỗng (không phần tử con, không chữ) → để yên: không có gì để focus hay đọc,
 *   và nền mờ của ngăn kéo là đúng một lớp như vậy — nó phải còn nhận được cú bấm
 *   để đóng ngăn kéo (phần tử `inert` không nhận sự kiện chuột).
 */
function shouldInert(node: InertNodeLike): boolean {
  if (NEVER_INERT_TAGS.has(node.tagName.toUpperCase())) return false
  if (node.hasAttribute('inert')) return false
  if (node.hasAttribute('aria-live')) return false
  const role = node.getAttribute('role')
  if (role === 'status' || role === 'alert') return false
  if (node.childElementCount === 0 && !(node.textContent ?? '').trim()) return false
  return true
}

/**
 * Đặt `inert` lên mọi thứ NGOÀI `root` (đi ngược từ `root` lên `<body>`, mỗi tầng
 * đánh dấu các anh em), trả về hàm gỡ đúng những thuộc tính chính nó đã đặt.
 *
 * Đây là nửa "modal" mà `aria-modal` chỉ hứa: trình đọc màn hình (kể cả vuốt trên
 * điện thoại) và Tab đều không còn với tới trang phía sau. Làm từ trong component
 * hộp thoại (không cần sửa layout) và tự tìm anh em, nên một khối mới thêm vào
 * layout sau này cũng được phủ mà không phải nhớ khai báo.
 */
export function inertOutside(root: InertNodeLike): () => void {
  const marked: InertNodeLike[] = []
  for (let node: InertNodeLike = root; node.parentElement && node.tagName.toUpperCase() !== 'BODY'; node = node.parentElement) {
    const siblings = node.parentElement.children
    for (let i = 0; i < siblings.length; i += 1) {
      const sibling = siblings[i]!
      if (sibling === node || !shouldInert(sibling)) continue
      sibling.setAttribute('inert', '')
      marked.push(sibling)
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    for (const el of marked) el.removeAttribute('inert')
  }
}

export function createFocusReturn(isBody: (el: FocusTargetLike) => boolean = () => false): FocusReturn {
  let opener: FocusTargetLike | null = null
  return {
    remember(active) {
      // `<body>` (focus không nằm ở đâu cả) không phải nơi đáng trả về.
      opener = active && !isBody(active) ? active : null
    },
    restore(shouldRestore = true) {
      const target = opener
      opener = null
      if (!shouldRestore || !target) return false
      if (target.isConnected === false) return false
      target.focus()
      return true
    },
  }
}
