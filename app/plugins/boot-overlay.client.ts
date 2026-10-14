import { hideBootOverlay } from '../utils/boot-overlay'

/**
 * Lỗi lúc khởi động/hydrate → ẩn ngay lớp phủ "Đang tải..." thay vì để nó che
 * trang tới khi hết thời hạn của script failsafe (xem `utils/boot-overlay.ts`).
 *
 * `enforce: 'pre'` để hook được gắn trước các plugin khác của ứng dụng — một
 * plugin sau ném lỗi vẫn được bắt. Lỗi xảy ra trước cả plugin này (plugin nội
 * bộ của Nuxt) vẫn có script failsafe đỡ.
 */
export default defineNuxtPlugin({
  name: 'cdkt:boot-overlay',
  enforce: 'pre',
  setup(nuxtApp) {
    const hide = () => {
      hideBootOverlay(document)
    }
    nuxtApp.hook('app:error', hide)
    nuxtApp.hook('vue:error', hide)
  },
})
