import type { AdminMediaItem } from '../types/admin-api'
import type { TinyMceEditorInstance } from '../types/tinymce'
import { stepOutOfFigure } from './tinymce-image-picker'
import { videoEmbedHtml } from './video-embed-html'

/** The toolbar button's name; the toolbar strings of both editors list it next to `media`. */
export const VIDEO_LIBRARY_BUTTON = 'cdktvideo'

/**
 * How a video frame looks INSIDE the editor, the same as on the public page (`iframe { width: 100%; aspect-ratio: 16 / 9 }`):
 * the column's width, 16:9, centred. Without it the editor's `iframe { height: auto }` left the frame at the browser's
 * default 150 px — a 574 × 150 strip for a 640 × 360 video (measured on TinyMCE 6.8.6). TinyMCE wraps a frame in
 * `span.mce-preview-object`, an inline box that shrinks to its content, so that is made a block too. Editor-only CSS
 * for `content_style` (CHANGELOG § 106).
 */
export const VIDEO_EDITOR_STYLE = `
      .mce-preview-object { display: block; max-width: 100%; margin: 1rem 0; }
      .mce-preview-object iframe { width: 100%; aspect-ratio: 16 / 9; height: auto; border: 0; }
`

/**
 * Registers the "video from the library" toolbar button on a TinyMCE editor (both editors: the article
 * editor's init and `components/admin/TinyMceEditor.vue`). The button opens the video library; the chosen
 * item is inserted at the caret as the iframe `videoEmbedHtml` builds — the shape the HTML filter keeps.
 * An item that cannot be embedded (the modal does not offer one) inserts nothing.
 *
 * Pure (no auto-imports): `pickVideo` is the caller's `openVideoPicker`, so tests/video-embed-html.test.ts
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
        if (!html) return
        stepOutOfFigure(editor) // never inside a captioned image's caption (CHANGELOG § 104)
        editor.insertContent(`<p>${html}</p>`)
      })
    },
  })
}
