import { onUnmounted, ref } from 'vue'

// Relative paths, not `~/`: tests import this file for real (tests/_sfc-mount.ts), and the test
// loader (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { AdminMediaUploadResult } from '../types/admin-api'
import type { ArticleEditorForm } from '../types/admin-article-editor'
import type { MediaItem } from '../types/media'
import type { TinyMceEditorInstance, WindowWithTinyMce } from '../types/tinymce'
import { imageFilePicker, libraryImageHtml, registerImageLibraryButtons } from '../utils/tinymce-image-picker'
import { registerVideoLibraryButton } from '../utils/tinymce-video-picker'
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
}

const TINYMCE_EDITOR_ID = 'tinymce-content-editor'

// Byte for byte the string the page passed before the split — the indentation is part of it.
const CONTENT_STYLE = `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; padding: 12px; color: #1a1a1a; }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      iframe, video { max-width: 100%; height: auto; }
      pre[class*="language-"] { background: #2d2d2d; border-radius: 6px; padding: 1em; overflow-x: auto; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; }
      blockquote { border-left: 4px solid #2c6e33; margin: 1em 0; padding-left: 1em; color: #555; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
    `

export function useArticleEditorTinymce({ form, pickImage, pickVideo }: ArticleEditorTinymceDeps) {
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

  const insertMediaIntoEditor = (media: MediaItem) => {
    const imgHtml = `<p>${libraryImageHtml(media)}</p>`
    if ((window as WindowWithTinyMce).tinymce) {
      const ed = (window as WindowWithTinyMce).tinymce?.get(TINYMCE_EDITOR_ID)
      if (ed) { ed.insertContent(imgHtml); return }
    }
    form.content += '\n' + imgHtml
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
      content_css: 'default',
      relative_urls: false,
      remove_script_host: false,
      convert_urls: true,
      plugins: [
        'advlist', 'autolink', 'lists', 'link', 'image', 'charmap',
        'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
        'insertdatetime', 'media', 'table', 'wordcount', 'quickbars'
      ],
      toolbar: 'undo redo | blocks | ' +
        'bold italic underline strikethrough | forecolor backcolor | ' +
        'alignleft aligncenter alignright alignjustify | ' +
        'bullist numlist outdent indent | ' +
        'link cdktimage cdktimageedit cdktvideo | ' +
        'table | removeformat | fullscreen code',
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
    insertMediaIntoEditor, initTinyMCE, loadTinyMCEScript,
  }
}
