import { ref } from 'vue'

import { adminFetch } from './adminFetch'
import type { AdminCategoryRow, AdminContentTypeRow } from '../types/admin-api'
import type { AdminCategoriesResponse, AdminContentTypesResponse } from '../types/admin-taxonomy-api'

/**
 * The two lookups behind the article editor's "Thể loại bài viết" and "Danh mục" selects
 * (`pages/admin/content/articles/[id].vue`), moved out of the page unchanged when it was split
 * (wave3). Both degrade silently: a failed read leaves the select empty (types) or hidden
 * (categories) and the article stays editable — no error branch, nothing an officer could
 * mistake for "there is none".
 *
 * The request counter is per editor (inside the function), not per module: two mounts must not
 * share "the latest request".
 */
export function useArticleEditorTaxonomy() {
  // Dynamic categories for the selected article type
  const availableCategories = ref<AdminCategoryRow[]>([])

  // Content types from DB — drives the Type <select> so a type created in
  // /admin/content/content-types shows up here too (not just the 5 hardcoded ones).
  const contentTypes = ref<AdminContentTypeRow[]>([])

  const fetchContentTypes = async () => {
    try {
      contentTypes.value = (await adminFetch<AdminContentTypesResponse>('/api/admin/content-types')).items
    } catch { /* keep empty — select falls back to nothing */ }
  }

  // Chỉ lượt mới nhất được ghi: danh mục của thể loại chọn trước, về sau, không lấp ô "Danh mục".
  let categoriesRequest = 0
  const fetchCategories = async (type: string) => {
    const ticket = ++categoriesRequest
    try {
      const { items } = await adminFetch<AdminCategoriesResponse>('/api/admin/categories', { query: { type } })
      if (ticket === categoriesRequest) availableCategories.value = items
    } catch { if (ticket === categoriesRequest) availableCategories.value = [] }
  }

  return { availableCategories, contentTypes, fetchContentTypes, fetchCategories }
}
