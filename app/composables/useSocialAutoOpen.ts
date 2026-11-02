import { onBeforeUnmount, watch } from 'vue'

/**
 * Khi nào bảng "Kênh mạng xã hội" (`SocialBubble.client.vue`) được TỰ mở.
 *
 * Tự mở là chủ đích — cài đặt `socialAutoOpen` ("Tự mở khi tải trang",
 * /admin/settings/social-links) — nhưng `openspec/ui-dna.md` nói nút nổi "mặc định đóng để
 * không che chắn nội dung trang". Bản cũ mở ở MỌI lượt tải: che nút hero ở đầu trang chủ
 * (1366×768: bảng x 24–339 / y 304–688, nút "Về chúng tôi" x 95–269 / y 615–668), và đổi
 * ngôn ngữ (`setLang` tải lại trang) là bật lại dù khách vừa đóng. Luật:
 *   - tối đa MỘT lần mỗi phiên trình duyệt: `sessionStorage[SOCIAL_AUTO_OPEN_KEY]` ghi khi tự
 *     mở, và khi khách tự mở/đóng/thu gọn (`handled()`) — tải lại, đổi ngôn ngữ không bật lại;
 *   - trang chủ: đợi khách cuộn quá `FIRST_SCREEN_SHARE` chiều cao màn hình (hero đã trôi
 *     lên, khỏi vùng bảng) hoặc rời trang chủ; trang khác: mở ngay khi tải;
 *   - kiểu bảng nổi trên điện thoại (< 768px) không bao giờ tự mở (như trước);
 *   - sessionStorage hỏng/bị chặn: không lỗi, coi như đã mở — không nhớ được thì không làm phiền.
 * Chỉ chạy ở trình duyệt (`start()` gọi từ `onMounted` của component `.client`).
 * tests/social-bubble-auto-open.test.ts.
 */
export const SOCIAL_AUTO_OPEN_KEY = 'cdkt_social_auto_opened'

/** Phần màn hình đầu phải cuộn qua trước khi bảng được mở trên trang chủ. */
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
  /** Đường dẫn hiện tại (`useRoute().path`). */
  path: () => string
  /** Việc tự mở làm: bảng mở / cột nút tròn mở rộng. */
  reveal: () => void
}

export function useSocialAutoOpen(options: SocialAutoOpenOptions) {
  let waiting = false

  const pastFirstScreen = () => window.scrollY >= window.innerHeight * FIRST_SCREEN_SHARE
  const onHome = () => options.path() === '/'

  function stopWaiting() {
    if (!waiting) return
    waiting = false
    window.removeEventListener('scroll', onScroll)
  }

  function reveal() {
    stopWaiting()
    markDone()
    options.reveal()
  }

  function onScroll() {
    if (pastFirstScreen()) reveal()
  }

  /** Gọi một lần từ `onMounted`. */
  function start() {
    if (!options.enabled() || alreadyDone()) return
    if (!options.floating() && window.innerWidth < DESKTOP_MIN_WIDTH) return
    if (onHome() && !pastFirstScreen()) {
      waiting = true
      window.addEventListener('scroll', onScroll, { passive: true })
      return
    }
    reveal()
  }

  /** Khách tự mở, đóng hay thu gọn: phiên này không tự mở nữa. */
  function handled() {
    stopWaiting()
    markDone()
  }

  // Rời trang chủ (điều hướng phía client, layout không gắn lại) khi đang đợi cuộn.
  watch(options.path, () => {
    if (waiting && !onHome()) reveal()
  })
  onBeforeUnmount(stopWaiting)

  return { start, handled }
}
