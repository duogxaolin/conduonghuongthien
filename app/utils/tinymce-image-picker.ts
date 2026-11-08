import type { MediaItem } from '../types/media'
import type { TinyMceEditorInstance } from '../types/tinymce'

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

/** The toolbar / Insert menu / quick-bar entry that puts an image in from the media library. */
export const IMAGE_LIBRARY_BUTTON = 'cdktimage'
/** The labelled "Sửa ảnh" entry: toolbar (greyed until an image is selected) and the bar over a selected image. */
export const IMAGE_EDIT_BUTTON = 'cdktimageedit'

const escapeAttribute = (value: string) => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The `<img>` every library insertion writes: the full width of the text column, height following the
 * picture. TinyMCE's own dialog would write the file's pixel size (an 1800-px photo is pushed to the
 * column by CSS, a 300-px one sits small and ragged), which is what made inserted images look wrong.
 * An officer who wants another size uses "Sửa ảnh". The public pages cap `img` at the column
 * (`max-width: 100%`), so nothing here can overflow it. Values are escaped: a file name may hold `"`.
 */
export function libraryImageHtml(media: Pick<MediaItem, 'url' | 'originalName'>): string {
  return `<img src="${escapeAttribute(media.url)}" alt="${escapeAttribute(media.originalName)}" style="width: 100%; height: auto;">`
}

/**
 * Registers the image entries on a TinyMCE editor (both editors) in place of TinyMCE's own
 * "Insert/edit image", whose dialog asked for a URL (or an upload) and only offered the library behind a
 * small browse button:
 *   - `cdktimage` opens the media library at once and inserts the choice at the caret (`libraryImageHtml`);
 *     it is also the Insert menu item and the button of the bar that appears in an empty paragraph;
 *   - `cdktimageedit` ("Sửa ảnh") opens TinyMCE's image dialog for the selected image — alt text, size,
 *     caption, style. It is greyed while no image is selected, and the same button is in the bar that floats
 *     over a selected image, so where to click is visible.
 * The image plugin stays loaded: it provides the dialog (`mceImage`) and its browse button still goes
 * through `imageFilePicker`.
 *
 * Pure (no auto-imports), like `registerVideoLibraryButton`.
 */
export function registerImageLibraryButtons(
  editor: TinyMceEditorInstance,
  pickImage: (onPick: (media: MediaItem) => void) => void,
): void {
  const registry = editor.ui?.registry
  if (!registry) return
  const insertFromLibrary = () => {
    pickImage(media => editor.insertContent(`<p>${libraryImageHtml(media)}</p>`))
  }
  registry.addButton(IMAGE_LIBRARY_BUTTON, {
    icon: 'image',
    tooltip: 'Chèn ảnh từ thư viện',
    onAction: insertFromLibrary,
  })
  registry.addMenuItem?.(IMAGE_LIBRARY_BUTTON, {
    icon: 'image',
    text: 'Chèn ảnh từ thư viện…',
    onAction: insertFromLibrary,
  })
  registry.addButton(IMAGE_EDIT_BUTTON, {
    icon: 'edit-image',
    text: 'Sửa ảnh',
    tooltip: 'Sửa ảnh đang chọn (chữ thay thế, kích thước, căn lề)',
    onAction: () => editor.execCommand('mceImage'),
    onSetup: (api) => {
      const sync = () => api.setEnabled(editor.selection.getNode()?.nodeName === 'IMG')
      editor.on('NodeChange', sync)
      sync()
      return () => editor.off('NodeChange', sync)
    },
  })
}
