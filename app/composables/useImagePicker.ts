import type { MediaItem } from '~/types/media'

interface PickerOptions {
  multiple?: boolean
  onSelect?: (item: MediaItem) => void
  onSelectMultiple?: (items: MediaItem[]) => void
}

// Global singleton state — modal is rendered once in admin.vue layout
const isOpen = ref(false)
const isMultiple = ref(false)
const _onSelect = ref<((item: MediaItem) => void) | null>(null)
const _onSelectMultiple = ref<((items: MediaItem[]) => void) | null>(null)

export const useImagePicker = () => {
  /**
   * Open the global media picker modal.
   *
   * @example — single select
   * openPicker({ onSelect: (img) => form.thumbnail = img.url })
   *
   * @example — multi select
   * openPicker({ multiple: true, onSelectMultiple: (imgs) => gallery.push(...imgs) })
   */
  const openPicker = (opts: PickerOptions = {}) => {
    isMultiple.value = opts.multiple ?? false
    _onSelect.value = opts.onSelect ?? null
    _onSelectMultiple.value = opts.onSelectMultiple ?? null
    isOpen.value = true
  }

  const closePicker = () => {
    isOpen.value = false
    _onSelect.value = null
    _onSelectMultiple.value = null
  }

  const handleSelect = (item: MediaItem) => {
    _onSelect.value?.(item)
    closePicker()
  }

  const handleSelectMultiple = (items: MediaItem[]) => {
    _onSelectMultiple.value?.(items)
    closePicker()
  }

  return {
    // state (used by MediaLibraryModal)
    isOpen,
    isMultiple,
    // actions (used by pages/components)
    openPicker,
    closePicker,
    handleSelect,
    handleSelectMultiple,
  }
}
