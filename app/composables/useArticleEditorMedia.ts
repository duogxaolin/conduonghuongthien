import type { ArticleEditorForm } from '../types/admin-article-editor'
import type { MediaItem } from '../types/media'
import type { useImagePicker } from './useImagePicker'
import type { useUpload } from './useUpload'

/**
 * Images in the article editor (`pages/admin/content/articles/[id].vue`), moved out of the page
 * unchanged when it was split (wave3): the media library into the body (several at once, in
 * order) or as the thumbnail, and the thumbnail's direct upload. The picker and the uploader
 * are the page's (`useImagePicker()`/`useUpload()`, handed in); the uploader's `uploading` flag
 * drives the upload control and stays with the page.
 */
export interface ArticleEditorMediaDeps {
  form: ArticleEditorForm
  openPicker: ReturnType<typeof useImagePicker>['openPicker']
  uploadFile: ReturnType<typeof useUpload>['uploadFile']
  /** Into the editor at the cursor — all of them in one insertion — or appended to the body without an editor (`useArticleEditorTinymce`). */
  insertMediasIntoEditor: (medias: MediaItem[]) => void
}

export function useArticleEditorMedia({ form, openPicker, uploadFile, insertMediasIntoEditor }: ArticleEditorMediaDeps) {
  const openMediaPicker = (target: 'thumbnail' | 'content') => {
    if (target === 'thumbnail') {
      openPicker({ onSelect: (media) => { form.thumbnailUrl = media.url } })
    } else {
      // Multiple-select: chọn nhiều ảnh cùng lúc rồi chèn hết vào editor theo thứ tự.
      openPicker({
        multiple: true,
        onSelectMultiple: items => insertMediasIntoEditor(items),
      })
    }
  }

  const uploadThumbnailFromInput = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const media = await uploadFile(file)
    if (media) form.thumbnailUrl = media.url
    ;(e.target as HTMLInputElement).value = ''
  }

  return { openMediaPicker, uploadThumbnailFromInput }
}
