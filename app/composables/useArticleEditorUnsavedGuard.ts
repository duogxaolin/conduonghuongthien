import { onMounted, onUnmounted, ref, type Ref } from 'vue'

import type { ArticleEditorForm } from '../types/admin-article-editor'
import type { useConfirm } from './useConfirm'

/**
 * Unsaved-changes guard of the article editor (`pages/admin/content/articles/[id].vue`), moved
 * out of the page unchanged when it was split (wave3). Leaving the editor (another admin link,
 * back button, closing the tab) used to drop an unsaved article without a word. The baseline is
 * what was last loaded or saved: the fields here, the body as TinyMCE serialises it in
 * `useArticleEditorTinymce` (`markBodySaved`/`bodyChanged`).
 *
 * The route-leave hook itself (`onBeforeRouteLeave`, a Nuxt auto-import) is registered by the
 * page with `confirmLeave`; the tab-close warning (`beforeunload`) is registered here.
 */
export interface ArticleEditorUnsavedGuardDeps {
  form: ArticleEditorForm
  /** The article is being (re)loaded: nothing can be lost yet. */
  loading: Ref<boolean>
  markBodySaved: () => void
  bodyChanged: () => boolean
  confirm: ReturnType<typeof useConfirm>['confirm']
}

export function useArticleEditorUnsavedGuard({ form, loading, markBodySaved, bodyChanged, confirm }: ArticleEditorUnsavedGuardDeps) {
  const savedFields = ref('')

  function fieldsSnapshot(): string {
    const { title, type, category, categoryId, excerpt, thumbnailUrl, status } = form
    return JSON.stringify({ title, type, category, categoryId, excerpt, thumbnailUrl, status })
  }

  /** Record the current state as saved. The body baseline waits for the editor (see its `init`). */
  function markSaved(): void {
    savedFields.value = fieldsSnapshot()
    markBodySaved()
  }

  function hasUnsavedChanges(): boolean {
    if (loading.value || !savedFields.value) return false
    if (fieldsSnapshot() !== savedFields.value) return true
    return bodyChanged()
  }

  /** The page's `onBeforeRouteLeave` guard: leave freely, or ask first. */
  async function confirmLeave(): Promise<boolean> {
    if (!hasUnsavedChanges()) return true
    return await confirm({
      title: 'Rời trang?',
      message: 'Bài viết có thay đổi chưa lưu. Rời trang bây giờ sẽ mất các thay đổi này.',
      confirmLabel: 'Rời trang',
      cancelLabel: 'Ở lại',
      danger: true,
    })
  }

  // Closing the tab or reloading: browsers show their own generic prompt.
  function warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ''
  }
  onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
  onUnmounted(() => window.removeEventListener('beforeunload', warnBeforeUnload))

  return { markSaved, confirmLeave }
}
