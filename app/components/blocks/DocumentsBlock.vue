<template>
  <section class="section bg-[#F8FAF7] border-t border-[#E2E8DF] py-12 sm:py-16">
    <div class="container">
      <!-- Section Header with Left-Right Layout -->
      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 sm:mb-10 pb-4 border-b border-[#E2E8DF]">
        <div>
          <span class="block text-[0.78rem] font-extrabold text-[#7CB342] uppercase tracking-[1.2px] mb-1.5">
            {{ t('guidance_and_direction') || 'Chỉ đạo & Điều hành' }}
          </span>
          <h2 class="text-2xl sm:text-3xl font-black text-[#172516] tracking-tight m-0 mb-2">
            {{ d.title || t('block_docs_title') }}
          </h2>
          <p class="text-sm text-[#556450] max-w-2xl m-0 leading-relaxed">
            {{ d.description || t('block_docs_desc') }}
          </p>
        </div>

        <nuxt-link
          :to="d.btnLink || '/documents'"
          class="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-[#D5E1D3] hover:border-[#4A6741] hover:bg-[#F2F7F0] text-[#385932] text-xs font-extrabold transition-all no-underline shrink-0 shadow-sm group/btn"
        >
          <span>{{ d.btnText || t('block_docs_btn') }}</span>
          <i class="fa-solid fa-arrow-right text-[0.7rem] transition-transform duration-200 group-hover/btn:translate-x-1" aria-hidden="true"></i>
        </nuxt-link>
      </div>

      <!-- Loading State (Skeleton 3 cards) -->
      <div v-if="pending" role="status" aria-busy="true" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
        <span class="sr-only">{{ t('block_docs_loading') }}</span>
        <div
          v-for="n in 3"
          :key="n"
          class="bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none flex flex-col"
        >
          <div class="aspect-video bg-[#EEF2EC]"></div>
          <div class="p-4 sm:p-5 flex flex-col gap-3 flex-1">
            <div class="h-3.5 w-24 bg-[#EEF2EC] rounded"></div>
            <div class="h-5 w-full bg-[#EEF2EC] rounded"></div>
            <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
          </div>
        </div>
      </div>

      <!-- Documents Grid (Giống hệt card bài viết news) -->
      <div v-else-if="docs.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
        <article
          v-for="doc in docs"
          :key="doc.id"
          class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full"
        >
          <!-- Thumbnail: strictly 16:9 với hover zoom -->
          <nuxt-link :to="`/news/${doc.slug}`" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
            <img
              :src="doc.thumbnailUrl || '/assets/hero_banner.jpg'"
              :alt="doc.title"
              class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
              loading="lazy"
              decoding="async"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </nuxt-link>

          <!-- Card Content: flex-1 justify-between -->
          <div class="p-4 sm:p-5 flex flex-col flex-1">
            <!-- Meta row -->
            <div class="flex items-center gap-2 text-xs text-[#7A8A76] font-medium mb-2">
              <span class="inline-block bg-[#EEF4EC] text-[#2D5A27] font-bold text-[0.68rem] px-2 py-0.5 rounded uppercase tracking-wider">
                {{ doc.categoryName }}
              </span>
              <span class="flex items-center gap-1 text-[#889684] text-[0.75rem]">
                <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                <span>{{ doc.date }}</span>
              </span>
            </div>

            <!-- Title: line-clamp-2 min-h -->
            <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0">
              <nuxt-link :to="`/news/${doc.slug}`" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                {{ doc.title }}
              </nuxt-link>
            </h3>

            <!-- Excerpt: line-clamp-2 -->
            <p v-if="doc.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
              {{ doc.excerpt }}
            </p>

            <!-- Footer: pinned with mt-auto -->
            <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#7A8A76]">
              <nuxt-link
                :to="`/news/${doc.slug}`"
                class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] group-hover:translate-x-0.5 transition-all no-underline"
              >
                <span>{{ t('view_details') || 'Chi tiết' }}</span>
                <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
              </nuxt-link>
              <span class="text-[#8E9F8B] font-medium text-[0.72rem]">{{ t('documents') || 'Văn bản pháp luật' }}</span>
            </div>
          </div>
        </article>
      </div>

      <!-- Empty State -->
      <div v-else class="bg-white rounded-2xl border border-[#E2E8DF] p-8 text-center text-sm text-[#7A8675] italic shadow-sm">
        <i class="fa-regular fa-folder-open text-2xl mb-2 text-[#BAC8B6] block" aria-hidden="true"></i>
        <span>{{ t('block_docs_empty') }}</span>
      </div>

      <!-- Mobile Action Button -->
      <div class="mt-7 text-center sm:hidden">
        <nuxt-link
          :to="d.btnLink || '/documents'"
          class="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#4A6741] text-white text-xs font-extrabold no-underline shadow-sm"
        >
          <span>{{ d.btnText || t('block_docs_btn') }}</span>
          <i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i>
        </nuxt-link>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { formatDateVN } from '~/utils/formatDate'
import { useI18n } from '~/composables/useI18n'

const { t, currentLang } = useI18n()
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const formatDate = (dateStr: string | null | undefined) => formatDateVN(dateStr)
const maxItems = computed(() => Number(d.value.maxItems) || 3)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data, pending, refresh } = await useAsyncData(
  `block-documents-${props.block.id}-${categorySlug.value}-${currentLang.value}`,
  () => ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<{ articles: Array<{ id: number; title: string; slug: string; excerpt: string | null; featuredImage: string | null; thumbnailUrl?: string | null; publishedAt: string | null; createdAt?: string | null; category?: { name: string; slug: string } | null }> }>)('/api/public/articles', {
    params: {
      type: 'document',
      limit: maxItems.value,
      lang: currentLang.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  { lazy: true, default: () => ({ articles: [] }) }
)

watch(currentLang, () => {
  void refresh()
})

onMounted(() => {
  if (currentLang.value !== 'vi') {
    void refresh()
  }
})
const docs = computed(() =>
  ((data.value as { articles?: any[] })?.articles || []).map(a => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    thumbnailUrl: a.thumbnailUrl || null,
    date: formatDate(a.publishedAt || a.createdAt),
    excerpt: a.excerpt ? String(a.excerpt).replace(/<[^>]*>/g, ' ').slice(0, 180) : '',
    categoryName: a.categoryName || t('block_docs_default_category'),
  }))
)
</script>
