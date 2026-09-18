<template>
  <section class="section bg-[#F8FAF7] border-t border-[#E2E8DF] py-12 sm:py-16">
    <div class="container">
      <!-- Section Header with Left-Right Layout -->
      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 sm:mb-10 pb-4 border-b border-[#E2E8DF]">
        <div>
          <span class="block text-[0.78rem] font-extrabold text-[#7CB342] uppercase tracking-[1.2px] mb-1.5">
            Chỉ đạo & Điều hành
          </span>
          <h2 class="text-2xl sm:text-3xl font-black text-[#172516] tracking-tight m-0 mb-2">
            {{ d.title || 'Văn Bản Pháp Luật Mới Ban Hành' }}
          </h2>
          <p class="text-sm text-[#556450] max-w-2xl m-0 leading-relaxed">
            {{ d.description || 'Cập nhật các chỉ thị, nghị định của Chính phủ và thông tư của Bộ Công an về công tác thi hành án hình sự, hỗ trợ tái hòa nhập cộng đồng.' }}
          </p>
        </div>

        <nuxt-link
          :to="d.btnLink || '/documents'"
          class="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-[#D5E1D3] hover:border-[#4A6741] hover:bg-[#F2F7F0] text-[#385932] text-xs font-extrabold transition-all no-underline shrink-0 shadow-sm group/btn"
        >
          <span>{{ d.btnText || 'Tra cứu thư viện văn bản' }}</span>
          <i class="fa-solid fa-arrow-right text-[0.7rem] transition-transform duration-200 group-hover/btn:translate-x-1" aria-hidden="true"></i>
        </nuxt-link>
      </div>

      <!-- Loading State (Skeleton) -->
      <div v-if="pending" role="status" aria-busy="true" class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <span class="sr-only">Đang tải danh sách văn bản pháp luật</span>
        <div
          v-for="n in 4"
          :key="n"
          class="bg-white rounded-2xl border border-[#E2E8DF] p-5 flex gap-4 animate-pulse motion-reduce:animate-none shadow-sm"
        >
          <div class="w-12 h-12 rounded-xl bg-[#EEF2EC] shrink-0"></div>
          <div class="flex-1 space-y-2.5">
            <div class="h-3.5 w-28 bg-[#EEF2EC] rounded"></div>
            <div class="h-4.5 w-3/4 bg-[#EEF2EC] rounded"></div>
            <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
          </div>
        </div>
      </div>

      <!-- Documents Grid (2 Columns, Clean Cards) -->
      <div v-else-if="docs.length" class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <nuxt-link
          v-for="doc in docs"
          :key="doc.id"
          :to="`/news/${doc.slug}`"
          class="group bg-white rounded-2xl border border-[#E2E8DF] p-5 sm:p-6 flex gap-4 sm:gap-5 transition-all duration-300 hover:shadow-md hover:border-[#7CB342] hover:-translate-y-0.5 no-underline text-[#172516] relative overflow-hidden"
        >
          <!-- Left Icon Badge -->
          <div class="w-12 h-12 rounded-xl bg-[#EBF3E8] text-[#2D5A27] group-hover:bg-[#4A6741] group-hover:text-white flex items-center justify-center shrink-0 transition-colors duration-300 shadow-sm text-lg">
            <i class="fa-solid fa-file-shield" aria-hidden="true"></i>
          </div>

          <!-- Right Content Details -->
          <div class="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                <span class="inline-block bg-[#EEF4EC] text-[#2D5A27] text-[0.7rem] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  {{ doc.categoryName }}
                </span>
                <span class="text-xs text-[#889684] flex items-center gap-1.5 font-medium">
                  <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                  <span>{{ doc.date }}</span>
                </span>
              </div>

              <!-- Title -->
              <h3 class="text-[0.98rem] sm:text-[1.02rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors line-clamp-2 my-2 m-0">
                {{ doc.title }}
              </h3>

              <!-- Excerpt -->
              <p v-if="doc.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                {{ doc.excerpt }}
              </p>
            </div>

            <!-- Bottom Action Link: pinned to bottom -->
            <div class="mt-auto pt-3 border-t border-[#F5F8F4] flex items-center justify-between text-xs">
              <span class="text-[#385932] font-bold group-hover:text-[#1B3617] transition-colors flex items-center gap-1.5">
                <span>Xem toàn văn văn bản</span>
                <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true"></i>
              </span>
              <span class="text-[#9AABA0] font-medium text-[0.72rem] flex items-center gap-1">
                <i class="fa-solid fa-shield-halved text-[#7CB342] text-[0.7rem]" aria-hidden="true"></i>
                <span>Cơ quan ban hành</span>
              </span>
            </div>
          </div>
        </nuxt-link>
      </div>

      <!-- Empty State -->
      <div v-else class="bg-white rounded-2xl border border-[#E2E8DF] p-8 text-center text-sm text-[#7A8675] italic shadow-sm">
        <i class="fa-regular fa-folder-open text-2xl mb-2 text-[#BAC8B6] block" aria-hidden="true"></i>
        <span>Hiện tại chưa có văn bản quy phạm pháp luật mới được đăng.</span>
      </div>

      <!-- Mobile Action Button -->
      <div class="mt-7 text-center sm:hidden">
        <nuxt-link
          :to="d.btnLink || '/documents'"
          class="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#4A6741] text-white text-xs font-extrabold no-underline shadow-sm"
        >
          <span>{{ d.btnText || 'Tra cứu thư viện văn bản' }}</span>
          <i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i>
        </nuxt-link>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatDateVN } from '~/utils/formatDate'

const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const formatDate = (dateStr: string | null | undefined) => formatDateVN(dateStr)
const maxItems = computed(() => Number(d.value.maxItems) || 4)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data, pending } = await useAsyncData(
  `block-documents-${props.block.id}-${categorySlug.value}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'document',
      limit: maxItems.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  { lazy: true, default: () => ({ articles: [] }) }
)

const docs = computed(() =>
  ((data.value as { articles?: any[] })?.articles || []).map(a => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    date: formatDate(a.publishedAt || a.createdAt),
    excerpt: a.excerpt ? String(a.excerpt).replace(/<[^>]*>/g, ' ').slice(0, 180) : '',
    categoryName: a.categoryName || 'Văn bản pháp luật',
  }))
)
</script>
