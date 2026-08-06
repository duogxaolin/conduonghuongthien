<script setup lang="ts">
import type { AdminMediaUploadResult } from '~/types/admin-api'
import type { TinyMceEditorInstance, WindowWithTinyMce } from '~/types/tinymce'
// ─── Reusable TinyMCE rich-text editor (v-model) ─────────────────────────────
// Single source for TinyMCE in the admin. Used by the page builder's richtext
// fields (PropertyPanel) so the in-builder editing experience matches the
// article editor. CDN-loaded (cached on window.tinymce) with a self-hosted
// fallback; drag/paste image uploads go through the media upload endpoint.
import { onMounted, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  height?: number
  placeholder?: string
}>(), { modelValue: '', height: 320, placeholder: '' })

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

// Unique id per instance so multiple editors can coexist on one page.
const editorId = `tinymce-${Math.random().toString(36).slice(2, 10)}`


let editor: TinyMceEditorInstance | null = null
let internalUpdate = false

// Load self-hosted first (instant, offline-safe, no external dependency for an
// auth-gated admin tool); fall back to the CDN only if the local asset is missing.
const loadScript = () => new Promise<void>((resolve) => {
  if ((window as WindowWithTinyMce).tinymce) { resolve(); return }
  const script = document.createElement('script')
  script.src = '/assets/tinymce/tinymce.min.js'
  script.onload = () => resolve()
  script.onerror = () => {
    const fallback = document.createElement('script')
    fallback.src = 'https://cdnjs.cloudflare.com/ajax/libs/tinymce/6.8.6/tinymce.min.js'
    fallback.referrerPolicy = 'no-referrer'
    fallback.onload = () => resolve()
    document.head.appendChild(fallback)
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
    toolbar: 'undo redo | blocks | bold italic underline | forecolor backcolor | ' +
      'alignleft aligncenter alignright | bullist numlist outdent indent | ' +
      'link image table | removeformat | code fullscreen',
    toolbar_mode: 'sliding',
    quickbars_selection_toolbar: 'bold italic | quicklink h2 h3 blockquote',
    quickbars_insert_toolbar: 'quickimage quicktable',
    contextmenu: 'link image table',
    automatic_uploads: true,
    paste_data_images: true,
    file_picker_types: 'image',
    images_upload_handler: (blobInfo: { blob: () => Blob, filename: () => string }) => new Promise<string>((resolve, reject) => {
      const formData = new FormData()
      formData.append('file', blobInfo.blob(), blobInfo.filename())
      $fetch('/api/admin/media/upload', { method: 'POST', body: formData })
        .then((res: AdminMediaUploadResult) => {
          if (res.ok && res.media?.url) resolve(res.media.url)
          else reject('Upload thất bại')
        })
        .catch((err: unknown) => reject(errorMessage(err, 'Upload thất bại')))
    }),
    setup: (ed: TinyMceEditorInstance) => {
      editor = ed
      ed.on('init', () => { ed.setContent(props.modelValue || '') })
      const push = () => {
        internalUpdate = true
        emit('update:modelValue', ed.getContent())
      }
      ed.on('input change undo redo keyup', push)
    },
    content_style: `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; padding: 12px; color: #1a1a1a; }
      img { max-width: 100%; height: auto; border-radius: 8px; }
      blockquote { border-left: 4px solid #2c6e33; margin: 1em 0; padding-left: 1em; color: #555; }
      table { border-collapse: collapse; width: 100%; }
      table td, table th { border: 1px solid #ddd; padding: 8px; }
    `,
  })
})

// Reflect external model changes (e.g. version restore) without clobbering the
// caret while the user is typing (internalUpdate guards our own emits).
watch(() => props.modelValue, (val) => {
  if (internalUpdate) { internalUpdate = false; return }
  if (editor && val !== editor.getContent()) editor.setContent(val || '')
})

onBeforeUnmount(() => {
  if (editor) { editor.remove(); editor = null }
})
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-gray-300">
    <textarea :id="editorId"></textarea>
  </div>
</template>
