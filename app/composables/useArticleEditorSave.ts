import { ref, type Ref } from 'vue'

import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { ArticleCreateResponse, ArticleTranslateResponse, ArticleUpdateResponse } from '../types/admin-articles-api'
import type { ArticleEditorForm, ArticleRetranslateStatus } from '../types/admin-article-editor'
import type { useToast } from './useToast'

/**
 * Saving in the article editor (`pages/admin/content/articles/[id].vue`), moved out of the page
 * unchanged when it was split (wave3):
 *   - `handleSave` — "Đăng Bài Mới" POSTs, starts the chosen auto-translations one language at
 *     a time, then goes to the new article; "Cập Nhật Bài Viết" PUTs. The form goes as it is,
 *     with the body read from the editor at that moment;
 *   - the re-translate prompt: after a PUT that changed the Vietnamese title, excerpt or body,
 *     ask whether to re-translate every language (as AI drafts, or published at once).
 *
 * Two guards against overwriting a stored article with an empty form (FINDING of 7.1 batch D):
 * the page's save button is disabled until `loaded`, AND `handleSave` itself refuses until then
 * — a click that reaches it past the button sends nothing. Each layer has its own test
 * (tests/admin-fetch-rollout-article-editor.test.ts "guard 1"/"guard 2").
 *
 * Everything from the Nuxt runtime is the page's, handed in (`toast`, `navigate`), and so is
 * the translation panel's `translateAll` (a template ref of the page).
 */
export interface ArticleEditorSaveDeps {
  form: ArticleEditorForm
  isNew: Readonly<Ref<boolean>>
  articleId: Readonly<Ref<number | null>>
  /** The form holds the real article (a new one: always). Before that, saving would blank it. */
  loaded: Ref<boolean>
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error' | 'warning'>
  getEditorContent: () => string
  markSaved: () => void
  navigate: (to: string) => unknown
  translateAll: (targetStatus: ArticleRetranslateStatus) => Promise<void>
}

export function useArticleEditorSave(deps: ArticleEditorSaveDeps) {
  const { form, isNew, articleId, loaded, toast, getEditorContent, markSaved, navigate, translateAll } = deps
  const saving = ref(false)
  // Lưu hỏng → `saveError` (không có "Thử lại": tải lại sẽ đè chữ đang gõ — nút lưu là lần thử lại).
  const saveError = ref('')
  const autoTranslateLangs = ref<string[]>(['en'])

  // ─── Initial Content Snapshot & Re-translation Prompt ─────────────────
  const initialContentSnapshot = ref<{ title: string; excerpt: string; content: string } | null>(null)
  const showReTranslateModal = ref(false)
  const reTranslatePublishImmediately = ref(false)
  const reTranslateRunning = ref(false)

  function recordInitialSnapshot() {
    initialContentSnapshot.value = {
      title: form.title.trim(),
      excerpt: form.excerpt.trim(),
      content: form.content.trim(),
    }
  }

  function checkAndPromptReTranslation() {
    if (!initialContentSnapshot.value) return
    const currentTitle = form.title.trim()
    const currentExcerpt = form.excerpt.trim()
    const currentContent = form.content.trim()

    const hasContentChanged =
      currentTitle !== initialContentSnapshot.value.title ||
      currentExcerpt !== initialContentSnapshot.value.excerpt ||
      currentContent !== initialContentSnapshot.value.content

    if (hasContentChanged) {
      recordInitialSnapshot()
      showReTranslateModal.value = true
    }
  }

  async function confirmReTranslation() {
    reTranslateRunning.value = true
    try {
      const targetStatus = reTranslatePublishImmediately.value ? 'published' : 'ai_draft'
      await translateAll(targetStatus)
      showReTranslateModal.value = false
    } finally {
      reTranslateRunning.value = false
    }
  }

  const handleSave = async () => {
    if (!loaded.value) return // bài chưa tải xong (hỏng / đang tải / đang thử lại): không ghi đè
    if (!form.title.trim()) {
      toast.warning('Tiêu đề bài viết không được để trống'); return
    }
    form.content = getEditorContent()
    saveError.value = ''
    saving.value = true
    try {
      if (isNew.value) {
        const res = await adminFetch<ArticleCreateResponse>('/api/admin/articles', { method: 'POST', body: form })
        if (res.ok) {
          toast.success('Tạo bài viết mới thành công!')
          // Saved: the redirect to the new article's page must not ask "leave without saving?".
          markSaved()
          const newId = res.id
          if (autoTranslateLangs.value.length > 0 && newId) {
            try {
              for (const langCode of autoTranslateLangs.value) {
                await adminFetch<ArticleTranslateResponse>(`/api/admin/articles/${newId}/translations/translate`, { method: 'POST', body: { langCode } })
              }
              toast.success(`Đã kích hoạt dịch tự động sang ${autoTranslateLangs.value.length} ngôn ngữ trong nền!`)
            } catch { /* Non-blocking */ }
          }
          navigate(`/admin/content/articles/${newId}`)
        }
      } else {
        // Máy chủ chỉ trả `{ ok: true }` — từ chối là ném lỗi, nên không còn nhánh `ok` để kiểm.
        await adminFetch<ArticleUpdateResponse>(`/api/admin/articles/${articleId.value}`, { method: 'PUT', body: form })
        toast.success('Đã cập nhật bài viết thành công!')
        markSaved()
        checkAndPromptReTranslation()
      }
    } catch (err: unknown) {
      saveError.value = errorMessage(err, 'Lỗi lưu bài viết')
      toast.error(saveError.value)
    } finally {
      saving.value = false
    }
  }

  return {
    saving, saveError, autoTranslateLangs, handleSave,
    showReTranslateModal, reTranslatePublishImmediately, reTranslateRunning, recordInitialSnapshot, confirmReTranslation,
  }
}
