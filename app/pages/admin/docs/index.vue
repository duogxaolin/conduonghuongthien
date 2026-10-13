<script setup lang="ts">
import { ADMIN_DOCS, ADMIN_DOC_CATEGORIES, docsByCategory, type AdminDoc } from '~/utils/docs/admin-docs-index'
import { searchDocs, suggestQuestions, type SearchResult } from '~/utils/docs/search'
import { DOC_PREVIEWS } from '~/utils/docs/previews'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const searchQuery = ref('')
const searchResults = ref<SearchResult<AdminDoc>[]>([])
const isSearching = computed(() => searchQuery.value.trim().length > 0)
const hasResults = computed(() => searchResults.value.length > 0)

const suggestedQuestions = computed(() => suggestQuestions(ADMIN_DOCS, 6))

const handleResults = (results: SearchResult<AdminDoc>[]) => {
  searchResults.value = results
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Page header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Tài liệu hệ thống</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Tra cứu hướng dẫn sử dụng toàn bộ cổng — tìm kiếm, duyệt theo nhóm, hoặc xem trước trang.</p>
    </div>

    <!-- Smart search -->
    <div>
      <AdminDocsSearchBar v-model="searchQuery" :docs="ADMIN_DOCS" @results="handleResults" />

      <!-- Search results -->
      <div v-if="isSearching" class="mt-4">
        <div v-if="hasResults" class="flex flex-col gap-2">
          <NuxtLink
            v-for="result in searchResults"
            :key="result.slug"
            :to="`/admin/docs/${result.slug}`"
            class="flex items-start gap-3 bg-white rounded-lg border border-[#e2ece3] p-4 hover:border-[#2c6e33] hover:shadow-sm transition-all no-underline"
          >
            <div class="shrink-0 w-9 h-9 rounded-lg bg-[#f0f7f1] flex items-center justify-center text-[#2c6e33]">
              <i :class="result.icon" class="text-base" aria-hidden="true"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-[0.88rem] font-bold text-[#122815] m-0 mb-0.5">{{ result.title }}</h3>
              <p class="text-[0.78rem] text-[#425845] m-0">{{ result.summary }}</p>
            </div>
            <span class="shrink-0 text-[0.68rem] text-[#667768] mt-1.5">Điểm: {{ result.score }}</span>
          </NuxtLink>
        </div>
        <div v-else class="bg-white rounded-lg border border-dashed border-[#c8d6c9] p-8 text-center">
          <i class="fa-solid fa-magnifying-glass-minus text-2xl text-[#c8d6c9] mb-2" aria-hidden="true"></i>
          <p class="text-[0.88rem] text-[#425845] m-0 mb-2">Không tìm thấy tài liệu phù hợp</p>
          <p class="text-[0.78rem] text-[#667768] m-0 mb-3">Thử các câu hỏi phổ biến:</p>
          <div class="flex flex-wrap justify-center gap-2">
            <span
              v-for="q in suggestedQuestions"
              :key="q"
              class="inline-block px-3 py-1.5 bg-[#f0f7f1] border border-[#e2ede3] rounded-full text-[0.75rem] text-[#2c6e33] font-semibold"
            >
              {{ q }}
            </span>
          </div>
        </div>
      </div>

      <!-- Hub content (when not searching) -->
      <div v-else class="flex flex-col gap-8 mt-2">
        <!-- Suggested questions -->
        <div>
          <h2 class="text-[0.92rem] font-bold text-[#122815] m-0 mb-3">Câu hỏi phổ biến</h2>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="q in suggestedQuestions"
              :key="q"
              class="inline-block px-3.5 py-2 bg-white border border-[#e2ece3] rounded-full text-[0.78rem] text-[#2c6e33] font-semibold cursor-pointer hover:border-[#2c6e33] hover:bg-[#f0f7f1] transition-colors"
              @click="searchQuery = q"
            >
              {{ q }}
            </span>
          </div>
        </div>

        <!-- Category grid -->
        <div>
          <h2 class="text-[0.92rem] font-bold text-[#122815] m-0 mb-3">Duyệt theo nhóm</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div v-for="cat in ADMIN_DOC_CATEGORIES" :key="cat.key" class="bg-white rounded-xl border border-[#e2ece3] p-5">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-lg bg-[#f0f7f1] flex items-center justify-center text-[#2c6e33]">
                  <i :class="cat.icon" class="text-lg" aria-hidden="true"></i>
                </div>
                <div>
                  <h3 class="text-[0.95rem] font-bold text-[#122815] m-0">{{ cat.label }}</h3>
                  <span class="text-[0.72rem] text-[#667768]">{{ docsByCategory(cat.key).length }} tài liệu</span>
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <NuxtLink
                  v-for="doc in docsByCategory(cat.key)"
                  :key="doc.slug"
                  :to="`/admin/docs/${doc.slug}`"
                  class="text-[0.78rem] text-[#425845] hover:text-[#2c6e33] font-medium no-underline hover:underline"
                >
                  {{ doc.title }}
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <!-- Preview entry cards -->
        <div>
          <h2 class="text-[0.92rem] font-bold text-[#122815] m-0 mb-3">Xem trước trang & tìm vị trí cần sửa</h2>
          <p class="text-[0.82rem] text-[#667768] mt-0 mb-3">Không biết tính năng tên gì? Mở trang xem trước và bấm vào vùng cần sửa.</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <NuxtLink
              v-for="preview in DOC_PREVIEWS"
              :key="preview.slug"
              :to="`/admin/docs/preview/${preview.slug}`"
              class="block bg-white rounded-xl border border-[#e2ece3] p-4 hover:border-[#2c6e33] hover:shadow-sm transition-all no-underline"
            >
              <div class="flex items-start gap-2.5">
                <i class="fa-solid fa-eye text-[#2c6e33] text-sm mt-1" aria-hidden="true"></i>
                <div>
                  <h3 class="text-[0.88rem] font-bold text-[#122815] m-0 mb-0.5">{{ preview.title }}</h3>
                  <p class="text-[0.78rem] text-[#667768] m-0">{{ preview.description }}</p>
                </div>
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
