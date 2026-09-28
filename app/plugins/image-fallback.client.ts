import { handleImageError } from '../utils/image-fallback'

/**
 * Plugin Nuxt client-side tự động bắt mọi sự kiện lỗi tải ảnh (HTTP 404, network error, die CDN/local)
 * trên toàn bộ trang web thông qua capture phase của window error listener.
 * Tự động trỏ sang ảnh mặc định của hệ thống mà không cần sửa từng component.
 */
export default defineNuxtPlugin(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('error', handleImageError, true)
  }
})
