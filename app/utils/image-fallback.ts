/**
 * Tiện ích xử lý thay thế ảnh mặc định khi ảnh ở local (/uploads/...) hoặc CDN/R2 bị chết link, lỗi 404.
 */
export const DEFAULT_FALLBACK_IMAGE = '/assets/hero_banner.jpg'

export interface ImageFallbackTarget {
  tagName?: string
  getAttribute?: (name: string) => string | null
  src?: string
  dataset?: Record<string, string | undefined>
}

/**
 * Xử lý sự kiện lỗi tải ảnh, chuyển hướng sang ảnh mặc định của hệ thống.
 * Trả về true nếu đã áp dụng ảnh thay thế, false nếu bỏ qua (tránh lặp vô hạn).
 */
export function handleImageError(event: { target?: unknown } | Event, customFallback?: string): boolean {
  const target = event?.target as (HTMLImageElement & ImageFallbackTarget) | null
  if (!target) return false

  // Chỉ áp dụng cho thẻ <img>
  const tag = (target.tagName || '').toUpperCase()
  if (tag !== 'IMG') return false

  if (!target.dataset) {
    target.dataset = {}
  }

  // Đã từng áp dụng fallback rồi thì không thử lại để tránh vòng lặp vô hạn
  if (target.dataset.fallbackApplied === 'true') {
    return false
  }

  const currentSrc = (typeof target.getAttribute === 'function' ? target.getAttribute('src') : target.src) || ''
  const fallback = customFallback || target.dataset.fallback || DEFAULT_FALLBACK_IMAGE

  // Nếu src hiện tại đã là fallback rồi thì thôi
  if (currentSrc === fallback || currentSrc.endsWith(fallback)) {
    return false
  }

  target.dataset.fallbackApplied = 'true'
  target.src = fallback
  return true
}

/**
 * Hàm trợ giúp gắn trực tiếp vào sự kiện @error của thẻ <img> (nếu muốn gọi tường minh).
 */
export function onImageError(event: Event, customFallback?: string): void {
  handleImageError(event, customFallback)
}
