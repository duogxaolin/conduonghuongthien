/**
 * Quyết định thuần của khung hộp thoại quản trị `AdminModal.vue` (design D-MODAL,
 * spec `admin-dialogs`). Tách khỏi component để kiểm được không cần DOM — cùng lý do
 * với `focus-return.ts`: component chỉ đọc sự kiện rồi hỏi các hàm này nên làm gì.
 */

export const ADMIN_MODAL_SIZES = ['sm', 'md', 'lg', 'xl', 'drawer'] as const
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
