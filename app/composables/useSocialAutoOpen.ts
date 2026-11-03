import { onBeforeUnmount } from 'vue'

/**
 * Khi nào bảng "Kênh mạng xã hội" (`SocialBubble.client.vue`) được TỰ mở.
 *
 * Tự mở là chủ đích — cài đặt `socialAutoOpen` ("Tự mở khi tải trang",
 * /admin/settings/social-links) — nhưng `openspec/ui-dna.md` nói nút nổi "mặc định đóng để
 * không che chắn nội dung trang". Bản cũ mở ở MỌI lượt tải: che nút hero ở đầu trang chủ
 * (1366×768: bảng x 24–339 / y 304–688, nút "Về chúng tôi" x 95–269 / y 615–668), và đổi
 * ngôn ngữ (`setLang` tải lại trang) là bật lại dù khách vừa đóng. Bản sửa đầu chỉ đợi ở
 * trang chủ — trang khác vẫn mở ngay và che h1, ô tìm kiếm, dòng thông tin ở 1366–1440
 * (/news, /about, /contact; kiểm chứng độc lập W1). Luật:
 *   - MỌI trang: chỉ mở khi khách đã cuộn quá `FIRST_SCREEN_SHARE` chiều cao màn hình (phần
 *     đầu trang đã trôi lên, khỏi vùng bảng). Điều hướng phía client (layout không gắn lại)
 *     không mở: vẫn đợi, trang mới về đầu trang, khách cuộn ở trang mới thì mở. Tải lại ở
 *     vị trí đã cuộn quá ngưỡng thì mở ngay (phần đầu trang không còn trong khung);
 *   - tối đa MỘT lần mỗi phiên trình duyệt: `sessionStorage[SOCIAL_AUTO_OPEN_KEY]` ghi khi tự
 *     mở, và khi khách tự mở/đóng/thu gọn (`handled()`) — tải lại, đổi ngôn ngữ không bật lại;
 *   - kiểu bảng nổi trên điện thoại (< 768px) không bao giờ tự mở; tắt `socialAutoOpen` thì
 *     không tự mở ở đâu — kiểm cả lúc bắt đầu đợi lẫn lúc sắp mở (cài đặt bố cục có thể tới
 *     sau `onMounted`, cửa sổ có thể đổi cỡ);
 *   - sessionStorage hỏng/bị chặn: không lỗi, coi như đã mở — không nhớ được thì không làm phiền.
 * Chỉ chạy ở trình duyệt (`start()` gọi từ `onMounted` của component `.client`).
 * tests/social-bubble-auto-open.test.ts.
 */
export const SOCIAL_AUTO_OPEN_KEY = 'cdkt_social_auto_opened'

/** Phần màn hình đầu phải cuộn qua trước khi bảng được tự mở (đo trên 1366×768). */
export const FIRST_SCREEN_SHARE = 0.6

const DESKTOP_MIN_WIDTH = 768

function alreadyDone(): boolean {
  try {
    return window.sessionStorage.getItem(SOCIAL_AUTO_OPEN_KEY) === '1'
  } catch {
    return true
  }
}

function markDone(): void {
  try {
    window.sessionStorage.setItem(SOCIAL_AUTO_OPEN_KEY, '1')
  } catch {
    // Không ghi được thì `alreadyDone()` cũng không đọc được: nó đã trả `true`.
  }
}

export interface SocialAutoOpenOptions {
  /** `socialAutoOpen` của cài đặt bố cục (vắng = bật). */
  enabled: () => boolean
  /** Kiểu "nút tròn rời" (mở cả trên điện thoại) thay vì bảng nổi. */
  floating: () => boolean
  /** Việc tự mở làm: bảng mở / cột nút tròn mở rộng. */
  reveal: () => void
}

export function useSocialAutoOpen(options: SocialAutoOpenOptions) {
  let waiting = false

  const pastFirstScreen = () => window.scrollY >= window.innerHeight * FIRST_SCREEN_SHARE
  const allowed = () => options.enabled() && (options.floating() || window.innerWidth >= DESKTOP_MIN_WIDTH)

  function stopWaiting() {
    if (!waiting) return
    waiting = false
    window.removeEventListener('scroll', onScroll)
  }

  function reveal() {
    stopWaiting()
    if (!allowed() || alreadyDone()) return
    markDone()
    options.reveal()
  }

  function onScroll() {
    if (pastFirstScreen()) reveal()
  }

  /** Gọi một lần từ `onMounted`. */
  function start() {
    if (!allowed() || alreadyDone()) return
    if (pastFirstScreen()) {
      reveal()
      return
    }
    waiting = true
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  /** Khách tự mở, đóng hay thu gọn: phiên này không tự mở nữa. */
  function handled() {
    stopWaiting()
    markDone()
  }

  onBeforeUnmount(stopWaiting)

  return { start, handled }
}
