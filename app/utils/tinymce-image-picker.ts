import type { MediaItem } from '../types/media'

/**
 * TinyMCE's `file_picker_callback` for the image dialog (both editors: the article editor's init and
 * `components/admin/TinyMceEditor.vue`): the browse button opens the media library, and the chosen
 * image fills the source field and the alt text. Other kinds the dialog may ask for (`media`, `file`)
 * get no picker from here.
 *
 * Pure on purpose (no auto-imports): `pickImage` is the caller's `openPicker({ onSelect })`, so the
 * behaviour is testable without a browser — tests/tinymce-image-picker.test.ts.
 */
export function imageFilePicker(pickImage: (onPick: (media: MediaItem) => void) => void) {
  return (callback: (url: string, meta?: Record<string, string>) => void, _value: string, meta: { filetype?: string }) => {
    if (meta.filetype !== 'image') return
    pickImage(media => callback(media.url, { alt: media.originalName }))
  }
}
