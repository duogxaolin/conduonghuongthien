import { ref } from 'vue'
import type { AdminMediaItem } from '../types/admin-api'

/**
 * The video library's picker, the twin of `useImagePicker`: ONE modal in the admin layout
 * (`components/admin/VideoLibraryModal.vue`), opened from anywhere with a callback that gets the chosen
 * item. Global singleton state — the modal reads it, the editors write it.
 */
const isOpen = ref(false)
const onSelect = ref<((item: AdminMediaItem) => void) | null>(null)

export const useVideoPicker = () => {
  const openVideoPicker = (callback: (item: AdminMediaItem) => void) => {
    onSelect.value = callback
    isOpen.value = true
  }
  const closeVideoPicker = () => {
    isOpen.value = false
    onSelect.value = null
  }
  const selectVideo = (item: AdminMediaItem) => {
    const callback = onSelect.value
    closeVideoPicker()
    callback?.(item)
  }
  return { isOpen, openVideoPicker, closeVideoPicker, selectVideo }
}
