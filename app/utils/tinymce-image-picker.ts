import type { MediaItem } from '../types/media'
import type { TinyMceAstNode, TinyMceDomNode, TinyMceEditorInstance } from '../types/tinymce'

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
 * What every library insertion writes: a picture with its caption box already there (TinyMCE's own
 * `<figure class="image">` + `<figcaption>`, so the "Show caption" box of its image dialog is ticked), the full
 * width of the text column, height following the picture. TinyMCE's own dialog would write the file's pixel size
 * (an 1800-px photo is pushed to the column by CSS, a 300-px one sits small and ragged), which is what made
 * inserted images look wrong. The figure carries the width too: a figure shrinks to its content, so a small
 * picture's `width: 100%` would otherwise resolve to its own size. An officer who wants another size uses "Sửa ảnh".
 * The public pages cap `img` at the column (`max-width: 100%`), so nothing here can overflow it. A picture narrower than
 * the column is NOT stretched: both the figure and the picture carry `max-width: <its own width>px` (CHANGELOG § 106).
 *
 * `alt` starts empty and FOLLOWS THE CAPTION (`registerImageCaptionAlt`): the caption is what the officer types,
 * and the same words are the picture's text alternative. An unfilled caption leaves nothing on the public page
 * (`figcaption:empty` is hidden there) and the image is then treated as decorative — the file name was never a
 * description. Values are escaped: a URL may hold `"`.
 */
export function libraryImageHtml(media: Pick<MediaItem, 'url' | 'width'>): string {
  // Never wider than the file itself: `width: 100%` alone stretches a 400-px picture to the whole column, and an
  // enlarged picture is soft (CHANGELOG § 106). A file whose size is unknown keeps the old, uncapped style.
  const natural = typeof media.width === 'number' && Number.isFinite(media.width) && media.width > 0 ? Math.round(media.width) : null
  const cap = natural === null ? '' : ` max-width: ${natural}px;`
  return `<figure class="image" style="width: 100%;${cap}"><img src="${escapeAttribute(media.url)}" alt="" style="width: 100%;${cap} height: auto;"><figcaption></figcaption></figure>`
}

/**
 * Editor-only hint in an EMPTY caption (CSS in the editor's iframe; never part of the saved HTML — a
 * `data-placeholder` attribute would be serialised). The hint shows for a caption that has no words: truly empty
 * (`:empty`), or emptied by the officer — TinyMCE leaves a bogus `<br>` then, which CSS cannot tell from a caption that
 * has words AND a line break, so `registerImageCaptionAlt` keeps `data-mce-empty` on the caption from its words
 * (a serializer filter keeps it out of the saved HTML). Two separate rules on purpose. Colour by name: this
 * string is not a Tailwind class and carries no hex.
 */
export const IMAGE_CAPTION_EDITOR_STYLE = `
      figure.image figcaption:empty::before { content: 'Nhập chú thích ảnh — cũng là chữ thay thế (alt) của ảnh'; color: gray; font-style: italic; }
      figure.image figcaption[data-mce-empty]::before { content: 'Nhập chú thích ảnh — cũng là chữ thay thế (alt) của ảnh'; color: gray; font-style: italic; }
`

/** The words of a caption: markup gone, `&nbsp;` and runs of white space one space, trimmed. */
export const captionText = (text: string) => text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

/** The words under a serializer node: text nodes, with a line break (`<br>`) counted as a space so two lines do not run together. */
const astText = (node: TinyMceAstNode): string => {
  let text = ''
  for (let child = node.firstChild; child; child = child.next) {
    if (child.type === 3) text += child.value ?? ''
    else text += child.name === 'br' ? ' ' : astText(child)
  }
  return text
}

const directChild = (node: TinyMceAstNode, name: string): TinyMceAstNode | null => {
  for (let child = node.firstChild; child; child = child.next) if (child.name === name) return child
  return null
}

/** The figure's own picture: a direct `<img>`, or one inside the link that wraps it — never one in the caption or a nested figure. */
const figureImage = (figure: TinyMceAstNode): TinyMceAstNode | null => {
  for (let child = figure.firstChild; child; child = child.next) {
    if (child.name === 'img') return child
    if (child.name === 'a') { const inner = directChild(child, 'img'); if (inner) return inner }
  }
  return null
}

const IMAGE_FIGURE_CLASS = /(^|\s)image(\s|$)/

/**
 * The serializer's node filter for `<figure class="image">`: the picture's `alt` becomes the caption's words in what
 * `getContent()` returns, whichever way the caption got there (typing, the AI panel, the code view, an article
 * opened from the database). An EMPTY caption leaves `alt` as it is, so an old figure keeps what it had and a new
 * one stays `""`. Only the figure's OWN picture and caption count (direct children): a nested figure, or a picture
 * inside a caption, never lends its words to another. The unsaved-changes baseline is read through the same
 * serializer, so opening an article never looks edited. Exported for tests/tinymce-image-library-buttons.test.ts.
 */
export function figureCaptionAlt(figures: TinyMceAstNode[]): void {
  for (const figure of figures) {
    if (!IMAGE_FIGURE_CLASS.test(String(figure.attr('class') ?? ''))) continue
    const caption = directChild(figure, 'figcaption')
    const image = figureImage(figure)
    if (!caption || !image) continue
    const words = captionText(astText(caption))
    if (words) image.attr('alt', words)
  }
}

/** Is the node the picture the officer clicked: a bare `IMG`, or the `FIGURE.image` TinyMCE selects for a captioned one. */
export const isImageSelection = (node: TinyMceDomNode | null | undefined): boolean =>
  node?.nodeName === 'IMG' || (node?.nodeName === 'FIGURE' && IMAGE_FIGURE_CLASS.test(node.className ?? ''))

/** The words under a live DOM node, `<br>` counted as a space (the DOM twin of `astText`). */
const domText = (node: TinyMceDomNode): string => {
  let text = ''
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeType === 3) text += child.nodeValue ?? ''
    else text += child.nodeName === 'BR' ? ' ' : domText(child)
  }
  return text
}

const CAPTION_EMPTY_MARK = 'data-mce-empty'

/**
 * Alt follows caption: in the saved HTML (`figureCaptionAlt` on the serializer) and, while the officer types in a
 * caption, in the live DOM too, so the image dialog's "Alternative description" never shows a stale value.
 * Nothing is written when the editor loads or content is set: only typing in a caption moves the live `alt`.
 * Emptying a caption puts back the alt the picture had before the first key (`""` for a new one) — but only if `alt` is
 * still what typing wrote, never something the officer set in the dialog since.
 *
 * The serializer exists only from `PreInit`: TinyMCE calls `setup` from the editor's constructor, before it makes
 * the serializer, so a filter added right in `setup` is lost (measured on 6.8.6 — the saved HTML then ignored the
 * caption). It is added at once if the serializer is already there (a test double), else when `PreInit` fires.
 */
export function registerImageCaptionAlt(editor: TinyMceEditorInstance): void {
  const addFilters = () => {
    editor.serializer?.addNodeFilter('figure', figureCaptionAlt)
    // The hint's own mark is editor-only: TinyMCE's own mechanism for that keeps it out of the saved HTML, the code view
    // and the clipboard (it only drops the `data-mce-*` names it knows, and this one it did not).
    editor.serializer?.addTempAttr(CAPTION_EMPTY_MARK)
  }
  if (editor.serializer) addFilters()
  else editor.on('PreInit', addFilters)

  // Per picture: the alt it had before the first key in its caption, and what typing wrote since.
  const typed = new WeakMap<object, { before: string, written: string }>()
  editor.on('input', () => {
    const figure = editor.selection.getNode()?.closest?.('figure.image')
    const caption = figure?.querySelector?.(':scope > figcaption')
    const image = figure?.querySelector?.(':scope > img, :scope > a > img')
    if (!caption || !image) return
    const words = captionText(domText(caption))
    const current = image.getAttribute?.('alt') ?? ''
    const mine = typed.get(image)
    if (words) {
      if (current !== words) {
        typed.set(image, { before: mine?.before ?? current, written: words })
        image.setAttribute?.('alt', words)
      }
    } else if (mine && mine.written === current) {
      // Emptied again: what was there before typing comes back — "" for a new picture, an old alt for an old one.
      if (current !== mine.before) image.setAttribute?.('alt', mine.before)
      typed.delete(image)
    }
  })

  // The hint in an empty caption follows its words (see IMAGE_CAPTION_EDITOR_STYLE).
  const markEmptyCaptions = () => {
    for (const caption of Array.from(editor.getBody?.()?.querySelectorAll?.('figure.image > figcaption') ?? [])) {
      if (captionText(domText(caption))) caption.removeAttribute?.(CAPTION_EMPTY_MARK)
      else caption.setAttribute?.(CAPTION_EMPTY_MARK, '1')
    }
  }
  for (const event of ['input', 'NodeChange', 'SetContent']) editor.on(event, markEmptyCaptions)
}

/**
 * Where an insertion goes when the caret is in a captioned image (the caption is where it lands after an insertion)
 * or the picture itself is selected: AFTER that figure, in a new paragraph. Inserted at the caret, a second image
 * would nest one figure inside the first one's caption (or split the caption), and a selected figure would simply be
 * replaced. Used by every library insertion — images and videos.
 */
export function stepOutOfFigure(editor: TinyMceEditorInstance): void {
  const figure = editor.selection.getNode()?.closest?.('figure.image')
  if (!figure || !editor.dom) return
  const paragraph = editor.dom.create('p', null, '<br data-mce-bogus="1">')
  editor.dom.insertAfter(paragraph, figure)
  editor.selection.setCursorLocation?.(paragraph, 0)
}

/**
 * Puts library images into the editor in ONE insertion: after each `insertContent` TinyMCE selects the figure it
 * just wrote, so the next one would replace it (measured: three images chosen, one left). A single image also gets
 * the caret in its caption, ready to type; several do not (there is no one caption to fill).
 */
export function insertLibraryImages(editor: TinyMceEditorInstance, medias: Array<Pick<MediaItem, 'url' | 'width'>>): void {
  if (!medias.length) return
  stepOutOfFigure(editor)
  editor.insertContent(medias.map(libraryImageHtml).join(''))
  if (medias.length !== 1) return
  const caption = editor.selection.getNode()?.closest?.('figure.image')?.querySelector?.(':scope > figcaption')
  if (caption) editor.selection.setCursorLocation?.(caption, 0)
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
  registerImageCaptionAlt(editor)
  const insertFromLibrary = () => {
    pickImage(media => insertLibraryImages(editor, [media]))
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
      const sync = () => api.setEnabled(isImageSelection(editor.selection.getNode()))
      editor.on('NodeChange', sync)
      sync()
      return () => editor.off('NodeChange', sync)
    },
  })
}
