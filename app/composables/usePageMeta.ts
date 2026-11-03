import { reactive, ref, type Ref } from 'vue'

// Relative paths, not `~/`: tests import this file directly, and the test loader
// (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { AdminPageDetail, AdminPageUpdateResult } from '../types/admin-api'
import type { useToast } from './useToast'

/**
 * "Cấu hình trang" of the page builder (`pages/admin/content/pages/[id].vue`): title, slug (not
 * for a system page), SEO title and description. Moved out of the page when it was split
 * (wave3 4.2), unchanged. `toast` is the page's own, handed in.
 */
export interface PageMetaDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>
  pageId: Ref<number>
  /** The page as the builder loaded it; the header reads it, so a save updates it in place. */
  page: Ref<AdminPageDetail['page'] | null>
  /** The page is loaded (the builder's positive flag): before that the form would open empty (FINDING-B2). */
  loaded: Ref<boolean>
}

export function usePageMeta({ toast, pageId, page, loaded }: PageMetaDeps) {
  const showMeta = ref(false)
  const savingMeta = ref(false)
  const metaForm = reactive({ title: '', slug: '', seoTitle: '', seoDescription: '' })
  const openMeta = () => {
    if (!loaded.value) return // "Lưu" of an empty form would write blank SEO fields over the page's
    metaForm.title = page.value?.title || ''
    metaForm.slug = page.value?.slug || ''
    metaForm.seoTitle = page.value?.seoTitle || ''
    metaForm.seoDescription = page.value?.seoDescription || ''
    showMeta.value = true
  }
  const saveMeta = async () => {
    savingMeta.value = true
    try {
      const body: Record<string, unknown> = { title: metaForm.title, seoTitle: metaForm.seoTitle, seoDescription: metaForm.seoDescription }
      if (!page.value?.isSystem) body.slug = metaForm.slug
      const res = await adminFetch<AdminPageUpdateResult>(`/api/admin/pages/${pageId.value}`, { method: 'PUT', body })
      // `page.value` đọc lại sau `await`: điều hướng khỏi trang giữa lúc lưu sẽ
      // gỡ nó về null, và gán vào null là một lỗi thật chứ không phải giả định.
      if (res.ok && page.value) {
        page.value.title = metaForm.title
        page.value.slug = res.slug
        page.value.seoTitle = metaForm.seoTitle
        page.value.seoDescription = metaForm.seoDescription
        toast.success('Đã lưu cấu hình trang.')
        showMeta.value = false
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không lưu được cấu hình.'))
    } finally {
      savingMeta.value = false
    }
  }

  return { showMeta, savingMeta, metaForm, openMeta, saveMeta }
}
