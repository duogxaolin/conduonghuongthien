import { onUnmounted, ref } from 'vue'

// Relative paths, not `~/`: tests import this file for real (tests/_sfc-mount.ts), and the test
// loader (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { AdminMediaUploadResult } from '../types/admin-api'
import type { ArticleEditorForm } from '../types/admin-article-editor'
import type { MediaItem } from '../types/media'
import type { TinyMceEditorInstance, WindowWithTinyMce } from '../types/tinymce'
import { IMAGE_CAPTION_EDITOR_STYLE, imageFilePicker, insertLibraryImages, libraryImageHtml, registerImageLibraryButtons } from '../utils/tinymce-image-picker'
import { registerFullscreenButton } from '../utils/tinymce-fullscreen-button'
import { VIDEO_EDITOR_STYLE, registerVideoLibraryButton } from '../utils/tinymce-video-picker'
import { WEB_PAGE_EDITOR_STYLE, registerZoomControl } from '../utils/tinymce-web-page'
import type { AdminMediaItem } from '../types/admin-api'

/**
 * The article editor's TinyMCE (`pages/admin/content/articles/[id].vue`) — the project's SECOND
 * init path; the other is `components/admin/TinyMceEditor.vue` (CLAUDE.md "TinyMCE admin
 * editor"). Moved out of the page unchanged when it was split (wave3): the config (height 700,
 * `content_style` with `img/iframe/video { max-width: 100% }` — tests/admin-article-editor.test.ts
 * compares it byte for byte), the self-hosted script, the bridge the page and the AI panel use
 * to read/write the body, image insertion, and the body's "saved" baseline as TinyMCE
 * serialises it (for the unsaved-changes guard). The editor is destroyed with the page.
 *
 * `window` is the global: this runs in the browser only (every caller is behind `onMounted`, a
 * click or a TinyMCE callback), and the functions that may run earlier check for it.
 */
export interface ArticleEditorTinymceDeps {
  /** The page's form: the editor starts from `content`, and `content` follows the editor on `change`. */
  form: ArticleEditorForm
  /**
   * Opens the media library for ONE image (the admin layout's global modal) and hands the choice back.
   * TinyMCE's image dialog gets a browse button that calls it (`file_picker_callback`); without it the
   * dialog only offers an upload or a typed URL.
   */
  pickImage: (onPick: (media: MediaItem) => void) => void
  /**
   * Same for the video library: the toolbar's "video from the library" button inserts the chosen item's player
   * frame. `null` for an account that cannot read the video library (`media_portal` read — its list is refused):
   * the button is then not registered, and TinyMCE leaves out a toolbar name nothing registered.
   */
  pickVideo: ((onPick: (item: AdminMediaItem) => void) => void) | null
  /**
   * The page's save, for the "Lưu" button inside full screen (which covers the page's own button). Called lazily, at
   * click time — the page builds its save after this composable, from this composable's `getEditorContent`.
   */
  save: () => void
}

const TINYMCE_EDITOR_ID = 'tinymce-content-editor'

// The article as the public page shows it: a sheet as wide as the public text column in the portal's type
// (`WEB_PAGE_EDITOR_STYLE`, CHANGELOG § 108), then the frame and caption rules the editor adds.
const CONTENT_STYLE = `${WEB_PAGE_EDITOR_STYLE}
      iframe, video { max-width: 100%; height: auto; }
${IMAGE_CAPTION_EDITOR_STYLE}${VIDEO_EDITOR_STYLE}`

export function useArticleEditorTinymce({ form, pickImage, pickVideo, save }: ArticleEditorTinymceDeps) {
  const tinymceReady = ref(false)
  // Body baseline as TinyMCE serialises it — setContent() normalises HTML, and `form.content`
  // only follows the editor on `change`. Null until the editor's `init` takes it.
  const savedContent = ref<string | null>(null)

  function setEditorContent(html: string): void {
    form.content = html
    if (tinymceReady.value && (window as WindowWithTinyMce).tinymce) {
      const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
      if (ed) ed.setContent(html)
    }
  }

  // Before the editor's `init` the body is the form's: a started-but-not-initialised editor
  // throws from `getContent()` (TypeError … 'serialize'), which dropped a save clicked in that
  // moment without a word (verifier Low 1, tests/admin-article-editor-findings.test.ts).
  function getEditorContent(): string {
    if (tinymceReady.value && typeof window !== 'undefined' && (window as WindowWithTinyMce).tinymce) {
      const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
      if (ed) {
        const c = ed.getContent()
        if (c && c.trim()) return c
      }
    }
    return form.content || ''
  }

  /** The editor's current HTML, or null before TinyMCE has initialised. */
  function editorHtml(): string | null {
    if (typeof window === 'undefined' || !tinymceReady.value) return null
    return (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)?.getContent() ?? null
  }

  /** Record the body as saved. Before the editor exists this is null, and `init` takes the baseline. */
  function markBodySaved(): void {
    savedContent.value = editorHtml()
  }

  /** The body differs from its saved baseline — false while either side is not known yet. */
  function bodyChanged(): boolean {
    const html = editorHtml()
    return savedContent.value !== null && html !== null && html !== savedContent.value
  }

  // Run each time THIS page's editor has just been handed the form's body (its `init`, or a
  // reload with the editor up): the body as it now reads back is TinyMCE's serialisation.
  const bodyShownHandlers: Array<() => void> = []
  function onBodyShown(handler: () => void): void {
    bodyShownHandlers.push(handler)
  }

  /** A (re)loaded article into a live editor; on the first load there is none yet and `init` does it. */
  function showLoadedContent(): void {
    if (tinymceReady.value) {
      (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)?.setContent(form.content)
      for (const handler of bodyShownHandlers) handler()
    }
  }

  /** The sidebar's "Chèn ảnh từ thư viện": every chosen image in ONE insertion (CHANGELOG § 104 — see `insertLibraryImages`). */
  const insertMediasIntoEditor = (medias: MediaItem[]) => {
    if (!medias.length) return
    const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
    if (ed) { insertLibraryImages(ed, medias); return }
    form.content += '\n' + medias.map(libraryImageHtml).join('')
  }

  const initTinyMCE = () => {
    if (typeof window === 'undefined') return
    const win = window as WindowWithTinyMce
    if (!win.tinymce) return
    // Not ready until the new editor's `init`: in between `get()` already answers it and it
    // reads back '' — a "Thử lại" (the page starts the editor again) would otherwise see the
    // body as changed and warn on leaving with nothing edited (KNOWN 5 of the split).
    tinymceReady.value = false
    // Lấy một lần rồi dùng: gọi `.get()` hai lần thì lời gọi thứ hai có thể trả
    // `undefined` khi trình soạn thảo bị gỡ giữa hai lần — và `.remove()` trên
    // undefined là một lỗi lúc chạy ngay giữa lượt điều hướng.
    win.tinymce?.get(TINYMCE_EDITOR_ID)?.remove()
    win.tinymce.init({
      selector: `#${TINYMCE_EDITOR_ID}`,
      height: 700,
      menubar: true,
      promotion: false,
      branding: false,
      skin: 'oxide',
      // Inter, the portal's font (self-hosted; a 404 here just leaves the editor in the system font).
      content_css: ['default', '/assets/fonts/inter.css'],
      relative_urls: false,
      remove_script_host: false,
      convert_urls: true,
      plugins: [
        'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
        'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
        'insertdatetime', 'media', 'table', 'wordcount', 'quickbars'
      ],
      // `cdktfullscreen` (+ "Lưu", visible only in full screen) is first so the sliding toolbar never folds it into "…";
      // the list buttons come after the insert group (link, image, video, table) — CHANGELOG § 105, § 106.
      toolbar: 'cdktfullscreen cdktsave | undo redo | blocks | ' +
        'bold italic underline strikethrough | forecolor backcolor | ' +
        'alignleft aligncenter alignright alignjustify | ' +
        'link cdktimage cdktimageedit cdktvideo | ' +
        'table | removeformat | ' +
        'bullist numlist outdent indent | code',
      toolbar_mode: 'sliding',
      quickbars_selection_toolbar: 'bold italic | quicklink h2 h3 blockquote',
      // Images go in from the media library, never from TinyMCE's own "Insert image" (a URL box / the OS file
      // chooser): `cdktimage` is the button in an empty paragraph, the Insert menu item and the toolbar button.
      // The bar over a selected image says "Sửa ảnh" (CHANGELOG § 102).
      quickbars_insert_toolbar: 'cdktimage quicktable',
      quickbars_image_toolbar: 'cdktimageedit | alignleft aligncenter alignright',
      menu: { insert: { title: 'Insert', items: 'cdktimage link inserttable | charmap hr | anchor | insertdatetime' } },
      contextmenu: 'link image table',
      // TinyMCE's own Media dialog takes any typed URL, and the HTML filter keeps only two frame shapes, so
      // anything else vanished on save. Videos go in from the video library (`cdktvideo`); the plugin stays
      // so frames already in a body keep their placeholder.
      removed_menuitems: 'media',
      image_advtab: true,
      image_caption: true,
      // Pictures come from the media library (`cdktimage`, and the dialog's browse button): no "Upload" tab with the OS file chooser (CHANGELOG § 106).
      image_uploadtab: false,
      // Raw characters, not `&aacute;`: the sanitizer re-escapes the `&` of a named entity inside an attribute value, so a
      // caption typed into `alt` would reach the public page as the literal text `C&aacute;n` (CHANGELOG § 104).
      entity_encoding: 'raw',
      automatic_uploads: true,
      paste_data_images: true,
      paste_merge_formats: true,
      file_picker_types: 'image',
      file_picker_callback: imageFilePicker(pickImage),
      images_upload_handler: (blobInfo: { blob: () => Blob, filename: () => string }) => new Promise<string>((resolve, reject) => {
        const formData = new FormData()
        formData.append('file', blobInfo.blob(), blobInfo.filename())
        void adminFetch<AdminMediaUploadResult>(`/api/admin/media/upload`, { method: 'POST', body: formData })
          .then((res) => {
            if (res.ok && res.media?.url) resolve(res.media.url)
            else reject('Upload thất bại')
          })
          .catch((err) => reject(errorMessage(err, 'Upload thất bại')))
      }),
      setup: (editor: TinyMceEditorInstance) => {
        registerFullscreenButton(editor, save)
        registerZoomControl(editor, window)
        registerImageLibraryButtons(editor, pickImage)
        if (pickVideo) registerVideoLibraryButton(editor, pickVideo)
        editor.on('init', () => {
          tinymceReady.value = true
          if (form.content) editor.setContent(form.content)
          // Body baseline as the editor serialises the loaded content.
          if (savedContent.value === null) savedContent.value = editor.getContent()
          for (const handler of bodyShownHandlers) handler()
        })
        editor.on('change', () => { form.content = editor.getContent() })
      },
      content_style: CONTENT_STYLE,
    })
  }

  const loadTinyMCEScript = () => new Promise<void>((resolve) => {
    if ((window as WindowWithTinyMce).tinymce) { resolve(); return }
    // Self-host only — TinyMCE đã có đủ 28 file trong public/assets/tinymce/.
    // Không fallback ra cdnjs.cloudflare.com: cổng Bộ Công an không nên tải JS
    // từ bên thứ ba, và file local luôn có (đã commit vào repo).
    const script = document.createElement('script')
    script.src = '/assets/tinymce/tinymce.min.js'
    script.onload = () => resolve()
    script.onerror = () => {
      console.error('TinyMCE local assets missing — chạy npm run build lại, hoặc kiểm public/assets/tinymce/')
      resolve()
    }
    document.head.appendChild(script)
  })

  onUnmounted(() => {
    if ((window as WindowWithTinyMce).tinymce) {
      const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
      if (ed) ed.destroy()
    }
  })

  return {
    editorId: TINYMCE_EDITOR_ID,
    setEditorContent, getEditorContent, markBodySaved, bodyChanged, showLoadedContent, onBodyShown,
    insertMediasIntoEditor, initTinyMCE, loadTinyMCEScript,
  }
}
