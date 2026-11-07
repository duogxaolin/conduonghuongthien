import type { AdminMediaItem } from '../types/admin-api'
import type { TinyMceEditorInstance } from '../types/tinymce'
import { videoEmbedHtml } from './video-embed-html'

/** The toolbar button's name; the toolbar strings of both editors list it next to `media`. */
export const VIDEO_LIBRARY_BUTTON = 'cdktvideo'

/**
 * Registers the "video from the library" toolbar button on a TinyMCE editor (both editors: the article
 * editor's init and `components/admin/TinyMceEditor.vue`). The button opens the video library; the chosen
 * item is inserted at the caret as the iframe `videoEmbedHtml` builds — the shape the HTML filter keeps.
 * An item that cannot be embedded (the modal does not offer one) inserts nothing.
 *
 * Pure (no auto-imports): `pickVideo` is the caller's `openVideoPicker`, so tests/tinymce-video-picker.test.ts
 * drives it with a fake editor.
 */
export function registerVideoLibraryButton(
  editor: TinyMceEditorInstance,
  pickVideo: (onPick: (item: AdminMediaItem) => void) => void,
): void {
  editor.ui?.registry.addButton(VIDEO_LIBRARY_BUTTON, {
    icon: 'embed',
    tooltip: 'Chèn video từ kho video',
    onAction: () => {
      pickVideo((item) => {
        const html = videoEmbedHtml(item)
        if (html) editor.insertContent(`<p>${html}</p>`)
      })
    },
  })
}
