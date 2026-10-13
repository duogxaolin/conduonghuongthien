import { ref, watch, onScopeDispose, type Ref } from 'vue'

/**
 * Kích thước khung chat toàn màn hình theo phần màn hình thật sự nhìn thấy khi
 * bàn phím điện thoại mở.
 *
 * Trên điện thoại khung chat cao `100dvh`, mà `dvh` **không** co lại khi bàn phím
 * mở — iOS Safari chỉ thu nhỏ *visual viewport* rồi kéo cả trang lên để ô nhập
 * còn thấy được. Kết quả: thanh nhập nằm dưới bàn phím, hoặc cả khung trượt lên
 * mất phần đầu. Đặt `top`/`height` theo `visualViewport` giữ đầu khung, nội dung
 * và ô nhập trong vùng người dùng đang nhìn.
 *
 * Chỉ áp dưới `md`: từ đó trở lên khung chat là panel nổi, không phải toàn màn
 * hình. Object rỗng trả quyền lại cho lớp `h-[100dvh]` mỗi khi không áp dụng.
 */
const DESKTOP_PANEL_QUERY = '(min-width: 768px)'

export function useKeyboardViewport(isOpen: Ref<boolean>) {
  const keyboardViewportStyle = ref<Record<string, string>>({})

  const sync = () => {
    const viewport = window.visualViewport
    if (!viewport || !isOpen.value || window.matchMedia(DESKTOP_PANEL_QUERY).matches) {
      keyboardViewportStyle.value = {}
      return
    }
    keyboardViewportStyle.value = { top: `${viewport.offsetTop}px`, height: `${viewport.height}px` }
  }

  const stop = () => {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    viewport?.removeEventListener('resize', sync)
    viewport?.removeEventListener('scroll', sync)
    keyboardViewportStyle.value = {}
  }

  const start = () => {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (!viewport) return
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    sync()
  }

  watch(isOpen, (open) => {
    stop()
    if (open) start()
  })
  onScopeDispose(stop)

  return { keyboardViewportStyle }
}
