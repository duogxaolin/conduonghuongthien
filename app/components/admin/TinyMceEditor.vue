<script setup lang="ts">
import type { AdminMediaUploadResult } from '~/types/admin-api'
import type { TinyMceEditorInstance, WindowWithTinyMce } from '~/types/tinymce'
import { IMAGE_CAPTION_EDITOR_STYLE, imageFilePicker, registerImageLibraryButtons } from '~/utils/tinymce-image-picker'
import { registerFullscreenButton } from '~/utils/tinymce-fullscreen-button'
import { compactEditorToolbar } from '~/utils/tinymce-compact-toolbar'
import { VIDEO_EDITOR_STYLE, registerVideoLibraryButton } from '~/utils/tinymce-video-picker'
// ─── Reusable TinyMCE rich-text editor (v-model) ─────────────────────────────
// Single source for TinyMCE in the admin. Used by the page builder's richtext
// fields (PropertyPanel) so the in-builder editing experience matches the
// article editor. CDN-loaded (cached on window.tinymce) with a self-hosted
// fallback; drag/paste image uploads go through the media upload endpoint.
import { onMounted, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  height?: number
  placeholder?: string
  /**
   * Adds "Lưu" to the toolbar, shown only in full screen (which covers the host's own Save button): it emits `save` after
   * the model is up to date. Opt-in — the Page Builder autosaves its draft and has no Save of its own.
   */
  saveButton?: boolean
}>(), { modelValue: '', height: 480, placeholder: '', saveButton: false })

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void, (e: 'save'): void }>()

const { openPicker } = useImagePicker()
const { openVideoPicker } = useVideoPicker()
// The video library's list needs `media_portal` read: without it the button is not registered (TinyMCE
// leaves out a toolbar name nothing registered) rather than opening a list the server refuses.
const { hasPermission } = useAdminAuth()

// Unique id per instance so multiple editors can coexist on one page.
const editorId = `tinymce-${Math.random().toString(36).slice(2, 10)}`


let editor: TinyMceEditorInstance | null = null
let internalUpdate = false
/** What the editor read back as the model last (after loading it, or after our own emit): the baseline of "changed". */
let lastEmitted = ''

// Load self-hosted first (instant, offline-safe, no external dependency for an
// auth-gated admin tool); fall back to the CDN only if the local asset is missing.
const loadScript = () => new Promise<void>((resolve) => {
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

onMounted(async () => {
  if (typeof window === 'undefined') return
  await loadScript()
  const win = window as WindowWithTinyMce
  if (!win.tinymce) return
  win.tinymce.init({
    selector: `#${editorId}`,
    height: props.height,
    menubar: false,
    promotion: false,
    branding: false,
    skin: 'oxide',
    content_css: 'default',
    placeholder: props.placeholder,
    relative_urls: false,
    remove_script_host: false,
    convert_urls: true,
    plugins: [
      'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'anchor',
      'searchreplace', 'visualblocks', 'code', 'fullscreen', 'insertdatetime',
      'media', 'table', 'wordcount', 'quickbars',
    ],
    toolbar: compactEditorToolbar(props.saveButton),
    toolbar_mode: 'sliding',
    quickbars_selection_toolbar: 'bold italic | quicklink h2 h3 blockquote',
    // Images go in from the media library (see useArticleEditorTinymce.ts) — no `quickimage` (OS file chooser).
    quickbars_insert_toolbar: 'cdktimage quicktable',
    quickbars_image_toolbar: 'cdktimageedit | alignleft aligncenter alignright',
    contextmenu: 'link image table',
    // The image dialog offers "Show caption" (as in the article editor); library insertions already carry one (CHANGELOG § 104).
    image_caption: true,
    // No "Upload" tab (OS file chooser): pictures come from the media library (CHANGELOG § 106).
    image_uploadtab: false,
    // Raw characters, not named entities (see useArticleEditorTinymce.ts): a caption becomes the picture's alt.
    entity_encoding: 'raw',
    automatic_uploads: true,
    paste_data_images: true,
    file_picker_types: 'image',
    file_picker_callback: imageFilePicker(onPick => openPicker({ onSelect: onPick })),
    images_upload_handler: (blobInfo: { blob: () => Blob, filename: () => string }) => new Promise<string>((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', blobInfo.blob(), blobInfo.filename())
      void adminFetch<AdminMediaUploadResult>('/api/admin/media/upload', { method: 'POST', body: formData })
        .then((res: AdminMediaUploadResult) => {
          if (res.ok && res.media?.url) resolve(res.media.url)
          else reject('Upload thất bại')
        })
        .catch((err: unknown) => reject(errorMessage(err, 'Upload thất bại')))
    }),
    setup: (ed: TinyMceEditorInstance) => {
      editor = ed
      // The model first, then the host's save: it must not save a model one input behind.
      registerFullscreenButton(ed, props.saveButton ? () => { push(); emit('save') } : undefined)
      registerImageLibraryButtons(ed, onPick => openPicker({ onSelect: onPick }))
      if (hasPermission('media_portal', 'read')) registerVideoLibraryButton(ed, openVideoPicker)
      // `getContent()` normalises what it was given (characters instead of named entities, an alt that follows the
      // caption…), so a key that changes nothing — `keyup` fires on an arrow key — must not look like an edit: the
      // model it emitted would differ from the saved block and the page would save a draft (CHANGELOG § 104).
      ed.on('init', () => { ed.setContent(props.modelValue || ''); lastEmitted = ed.getContent() })
      const push = () => {
        const html = ed.getContent()
        if (html === lastEmitted) return
        lastEmitted = html
        internalUpdate = true
        emit('update:modelValue', html)
      }
      ed.on('input change undo redo keyup', push)
    },
    content_style: `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; padding: 12px; color: #1a1a1a; }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      iframe, video { max-width: 100%; height: auto; }
      blockquote { border-left: 4px solid #2c6e33; margin: 1em 0; padding-left: 1em; color: #555; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
${IMAGE_CAPTION_EDITOR_STYLE}${VIDEO_EDITOR_STYLE}`,
  })
})

// Reflect external model changes (e.g. version restore) without clobbering the
// caret while the user is typing (internalUpdate guards our own emits).
watch(() => props.modelValue, (val) => {
  if (internalUpdate) { internalUpdate = false; return }
  if (!editor) return
  if (val !== editor.getContent()) editor.setContent(val || '')
  lastEmitted = editor.getContent()
})

onBeforeUnmount(() => {
  if (editor) { editor.remove(); editor = null }
})
</script>

<template>
  <!-- Editor full container — không giới hạn chiều ngang. Ảnh/video chèn vào
       bị giới hạn trong content_style (max-width:100%) để preview khớp render
       công khai, còn editor chiếm trọn vẹn section để thao tác thoải mái. -->
  <div class="overflow-hidden rounded-lg border border-gray-300">
    <textarea :id="editorId"></textarea>
  </div>
</template>
