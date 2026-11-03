/**
 * Quyết định thuần của khung hộp thoại quản trị `AdminModal.vue` (design D-MODAL,
 * spec `admin-dialogs`). Tách khỏi component để kiểm được không cần DOM — cùng lý do
 * với `focus-return.ts`: component chỉ đọc sự kiện rồi hỏi các hàm này nên làm gì.
 */

export const ADMIN_MODAL_SIZES = ['sm', 'md', 'lg', 'xl', '2xl', 'drawer'] as const
export type AdminModalSize = (typeof ADMIN_MODAL_SIZES)[number]

export function isAdminModalSize(value: unknown): value is AdminModalSize {
  return typeof value === 'string' && (ADMIN_MODAL_SIZES as readonly string[]).includes(value)
}

/**
 * Lớp phủ: hộp giữa màn hình, hoặc ngăn kéo bám mép phải (`drawer` — bảng khối và
 * phiên bản của trình dựng trang). Viết thẳng chữ để Tailwind quét được.
 */
export function adminModalOverlayClass(size: AdminModalSize): string {
  return size === 'drawer'
    ? 'flex justify-end'
    : 'flex items-center justify-center p-4'
}

/**
 * Khung bên trong. `max-h-full` (theo vùng nội dung của lớp phủ, đã trừ `p-4`) + thân
 * cuộn riêng: tiêu đề và hàng nút luôn nhìn thấy, kể cả biểu mẫu dài trên điện thoại.
 */
export function adminModalPanelClass(size: AdminModalSize): string {
  if (size === 'drawer') return 'flex h-full w-full max-w-md flex-col bg-white shadow-2xl'
  const width = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-3xl',
    '2xl': 'max-w-4xl',
  }[size]
  return `flex max-h-full w-full ${width} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`
}

export interface AdminModalKeyInput {
  key: string
  /** Đang lưu / đang chạy một thao tác — không được đóng giữa chừng. */
  busy: boolean
  /** Một điều khiển bên trong đã tự xử lý phím (vd. ô có danh sách gợi ý tự đóng bằng Escape). */
  defaultPrevented: boolean
  /** Hộp này đang bị `inert` — một lớp khác (ConfirmModal) mở đè lên và sở hữu bàn phím. */
  covered: boolean
  /** Phím xảy ra trên một phần tử bên trong hộp. */
  inside: boolean
  /** Focus không nằm ở đâu cả (`<body>`): nút vừa bấm bị disabled/biến mất. */
  focusLost: boolean
}

export type AdminModalKeyAction = 'close' | 'trap' | 'none'

/**
 * Hộp nghe phím ở mức `document` (không chỉ trên chính nó): nút "Lưu" bị `disabled`
 * lúc lưu làm trình duyệt đẩy focus về `<body>`; nếu chỉ nghe trên hộp thì sau một lần
 * lưu hỏng, Escape không còn đóng được và Tab đi ra lớp thông báo phía sau. Nhưng phím
 * xảy ra ở lớp KHÁC (hộp xác nhận mở đè, toast, thư viện ảnh) không phải của hộp này.
 */
export function adminModalKeyAction(input: AdminModalKeyInput): AdminModalKeyAction {
  if (input.covered || input.defaultPrevented) return 'none'
  if (!input.inside && !input.focusLost) return 'none'
  if (input.key === 'Escape') return input.busy ? 'none' : 'close'
  // Đang lưu vẫn bẫy Tab: bận chỉ chặn ĐÓNG, không mở đường ra sau hộp.
  if (input.key === 'Tab') return 'trap'
  return 'none'
}

export interface AdminModalBackdropInput {
  busy: boolean
  /** `pointerdown` bắt đầu trên chính nền (không phải trong khung). */
  pressStartedOnBackdrop: boolean
  /** `click` có đích là chính nền. */
  clickOnBackdrop: boolean
}

/**
 * Bấm ra nền đóng hộp — như các hộp cũ (`@click.self`) — trừ hai trường hợp:
 * đang lưu, và cú bấm bắt đầu TRONG khung (bôi đen chữ trong ô nhập rồi thả chuột ra
 * ngoài: trình duyệt bắn `click` lên tổ tiên chung là nền, `@click.self` trần đóng mất
 * biểu mẫu đang gõ).
 */
export function adminModalBackdropCloses(input: AdminModalBackdropInput): boolean {
  return !input.busy && input.pressStartedOnBackdrop && input.clickOnBackdrop
}

/**
 * Phím đang GIỮ lúc hộp mở. Hộp mở ở `keydown` của Enter trên nút rồi đưa focus vào
 * trong; người dùng còn giữ phím thì hệ điều hành LẶP phím (`repeat: true`) vào điều
 * khiển vừa nhận focus — mỗi lần một "lưu bản sao lưu", một "đồng ý" ở hộp xác nhận,
 * một lần bấm nút đầu tiên. Lần thả (`keyup`) cũng rơi vào đó.
 *
 * Hộp gắn bộ này ở pha capture của `document` khi mở: nuốt mọi keydown lặp và lần thả
 * của phím đã giữ từ trước, cho tới khi người dùng nhấn MỘT phím mới (keydown không
 * lặp) hoặc thả phím. Giữ phím của chính người dùng trong hộp (xoá chữ) không bị nuốt.
 */
export interface HeldKeyGuard {
  arm: () => void
  disarm: () => void
  /** true = nuốt keydown này. */
  keydown: (event: { repeat: boolean }) => boolean
  /** true = nuốt keyup này. */
  keyup: () => boolean
}

export function createHeldKeyGuard(): HeldKeyGuard {
  let armed = false
  return {
    arm() { armed = true },
    disarm() { armed = false },
    keydown(event) {
      if (!armed) return false
      if (event.repeat) return true
      armed = false
      return false
    },
    keyup() {
      if (!armed) return false
      armed = false
      return true
    },
  }
}

/**
 * Enter người dùng thật sự nhấn trong ô nhập: không phải phím lặp (giữ phím), không
 * phải Enter chốt chữ của bộ gõ (IME tiếng Việt). Dùng cho `@keydown.enter` trong hộp
 * thoại — lớp thứ hai sau `createHeldKeyGuard` (và cho hộp chưa dùng AdminModal).
 */
export function isDeliberateEnter(event: { key: string; repeat: boolean; isComposing: boolean; keyCode?: number }): boolean {
  // Safari chốt chữ của bộ gõ bằng một keydown `isComposing: false` mà `keyCode: 229`.
  return event.key === 'Enter' && !event.repeat && !event.isComposing && event.keyCode !== 229
}

/**
 * Nơi "đỗ" focus dự phòng khi không trả được về nút mở: `<main>`, nhận focus bằng
 * script nhờ `tabindex="-1"` TẠM (đánh dấu `FOCUS_PARK_ATTR`), rời focus là gỡ cả hai.
 * `<main>` vốn có `tabindex` của trang thì để nguyên, không gắn dấu.
 */
export const FOCUS_PARK_ATTR = 'data-admin-modal-focus-park'

export interface ParkableLike {
  hasAttribute: (name: string) => boolean
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  addEventListener: (type: 'blur', listener: () => void, options: { once: true }) => void
}

export function parkFocusOn<T extends ParkableLike>(main: T | null): T | null {
  if (!main) return null
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1')
    main.setAttribute(FOCUS_PARK_ATTR, '')
    main.addEventListener('blur', () => {
      main.removeAttribute('tabindex')
      main.removeAttribute(FOCUS_PARK_ATTR)
    }, { once: true })
  }
  return main
}

export function isFocusPark(el: unknown): boolean {
  const candidate = el as { hasAttribute?: (name: string) => boolean } | null
  return typeof candidate?.hasAttribute === 'function' && candidate.hasAttribute(FOCUS_PARK_ATTR)
}

/**
 * Phần tử đang giữ focus lúc mở hộp có đáng nhớ làm "nút mở" không. Không: `<body>`
 * (focus không ở đâu cả) và nơi đỗ tạm (thuộc tính tạm bị gỡ ngay khi focus vào hộp —
 * trả focus về đó là rơi xuống `<body>`).
 */
export function rememberableOpener<T>(el: T | null | undefined, body: unknown): T | null {
  if (!el || el === body || isFocusPark(el)) return null
  return el
}

/**
 * Focus đã rơi khỏi hộp đang mở (điều khiển đang giữ focus bị gỡ khỏi DOM hoặc bị
 * `disabled` → trình duyệt đẩy về `<body>`). Hộp đang bị phủ (`inert`, một hộp khác mở
 * đè) thì lớp trên quản focus — không giật.
 */
export function focusEscaped(input: { active: unknown; body: unknown; covered: boolean }): boolean {
  if (input.covered) return false
  return !input.active || input.active === input.body
}

/**
 * Đã đỗ focus ở `<main>` chờ danh sách tải lại; nút mở cùng khoá xuất hiện trở lại thì
 * chuyển focus về nó — chỉ khi focus vẫn đang đỗ (hoặc rơi về `<body>`), không giật
 * focus của người dùng đã tự đi chỗ khác.
 */
export function shouldMoveToReturnedOpener(input: { active: unknown; parked: unknown; body: unknown }): boolean {
  return !input.active || input.active === input.body || (input.parked != null && input.active === input.parked)
}

/** Thời gian chờ nút mở xuất hiện lại sau khi danh sách tải lại (ms). */
export const RETURNED_OPENER_WAIT_MS = 4000

/** Phần tử trong hộp được chỉ định nhận focus đầu tiên (vd. ô tìm kiếm của thư viện ảnh). */
export const ADMIN_MODAL_AUTOFOCUS_SELECTOR = '[data-autofocus], [autofocus]'

/**
 * Focus lúc mở: phần tử được chỉ định (`data-autofocus`/`autofocus`, đang hiện và Tab
 * tới được) → điều khiển đầu tiên của thân → của hàng nút → nút đóng → chính hộp.
 * `autofocus` gốc của trình duyệt chỉ chạy một lần mỗi tài liệu, không chạy cho phần
 * tử chèn sau — nên hộp phải tự làm.
 */
export function pickInitialFocus<T>(candidates: { designated: T | null; body: T | null; footer: T | null; close: T | null; root: T }): T {
  return candidates.designated ?? candidates.body ?? candidates.footer ?? candidates.close ?? candidates.root
}

/**
 * Đánh dấu nút mở bằng khoá ổn định qua các lần vẽ lại danh sách, vd.
 * `:data-admin-modal-opener="`submission-${s.id}`"`. Hộp nhớ khoá lúc mở; lúc đóng, nếu
 * nút cũ đã bị gỡ (danh sách tải lại sau một thao tác trong hộp) thì tìm lại theo khoá.
 */
export const ADMIN_MODAL_OPENER_ATTR = 'data-admin-modal-opener'

export interface OpenerKey {
  attr: 'id' | typeof ADMIN_MODAL_OPENER_ATTR
  value: string
}

export interface OpenerLike {
  id?: string
  closest?: (selector: string) => { getAttribute: (name: string) => string | null } | null
}

/** Khoá để tìm lại nút mở: thuộc tính đánh dấu (ưu tiên), rồi `id`. */
export function openerKeyOf(el: OpenerLike | null | undefined): OpenerKey | null {
  if (!el) return null
  const value = el.closest?.(`[${ADMIN_MODAL_OPENER_ATTR}]`)?.getAttribute(ADMIN_MODAL_OPENER_ATTR)
  if (value) return { attr: ADMIN_MODAL_OPENER_ATTR, value }
  if (el.id) return { attr: 'id', value: el.id }
  return null
}

/**
 * Nút mở không nhận lại được focus (đã rời tài liệu, bị `disabled`): tìm lại theo khoá;
 * không thấy (hàng đã rời bộ lọc, danh sách còn đang tải) thì về vùng nội dung chính —
 * không bao giờ để focus rơi ở `<body>`, nơi người dùng bàn phím phải Tab lại từ đầu
 * trang. `refound: false` = đang đỗ dự phòng; nơi gọi có thể chờ nút cùng khoá về.
 */
export function focusFallbackTarget<T>(key: OpenerKey | null, deps: { find: (key: OpenerKey) => T | null; main: () => T | null }): { target: T | null; refound: boolean } {
  const found = key ? deps.find(key) : null
  return found ? { target: found, refound: true } : { target: deps.main(), refound: false }
}

/** ConfirmModal dùng `z-[9999]`; mọi lớp AdminModal phải nằm dưới nó. */
export const ADMIN_MODAL_BASE_Z = 9000
const CONFIRM_MODAL_Z = 9999

/** z-index của hộp ở lớp `layer` (1 = hộp mở đầu tiên): hộp mở sau nằm trên. */
export function adminModalLayerZ(layer: number): number {
  return ADMIN_MODAL_BASE_Z + Math.min(Math.max(0, layer), CONFIRM_MODAL_Z - ADMIN_MODAL_BASE_Z - 1)
}

/**
 * Thứ tự mở của các AdminModal đang mở. Cần vì thứ tự trong `<body>` theo lúc MOUNT chứ
 * không theo lúc mở: thư viện ảnh mount sẵn trong layout (sớm nhất), nên cùng một z-index
 * thì nó luôn nằm DƯỚI một hộp của trang dù mở sau.
 */
export function createModalLayers() {
  let openCount = 0
  let seq = 0
  return {
    open(): number {
      openCount += 1
      seq += 1
      return seq
    },
    close(): void {
      openCount = Math.max(0, openCount - 1)
      if (openCount === 0) seq = 0
    },
  }
}

export const adminModalLayers = createModalLayers()
