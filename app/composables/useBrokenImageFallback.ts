import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { watchBrokenImages, type EventRootLike } from '~/utils/broken-image'

/**
 * Ẩn ảnh 404 trong một khối nội dung `v-html` (bài viết, khối rich-text). Chỉ chạy ở trình duyệt, sau mount.
 * Logic thuần nằm ở `app/utils/broken-image.ts` (kiểm được không cần mount).
 */
export function useBrokenImageFallback(root: Ref<HTMLElement | null | undefined>) {
  let stop: (() => void) | null = null
  onMounted(() => {
    if (root.value) stop = watchBrokenImages(root.value as unknown as EventRootLike)
  })
  onBeforeUnmount(() => { stop?.(); stop = null })
}
