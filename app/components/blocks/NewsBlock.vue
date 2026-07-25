<template>
  <section class="section bg-white py-[60px]">
    <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[2.1fr_0.9fr]">
      <!-- Left column -->
      <div>
        <SectionBar :title="d.title || 'Tin nổi bật'" icon="★" to="/news" viewall-text="Tất cả tin tức →" />

        <template v-if="featured">
          <!-- Main featured -->
          <div class="mb-6">
            <nuxt-link :to="`/news/${featured.slug}`" class="block no-underline group">
              <div class="relative h-[300px] rounded-lg overflow-hidden sm:h-[420px] shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <img :src="featured.thumbnailUrl || '/assets/news_danang.jpg'" :alt="featured.title" class="w-full h-full object-cover transition-transform duration-[0.6s] ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-[1.03]" />
                <div class="absolute bottom-0 left-0 right-0 h-[60%] z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.95) 0%, rgba(16,28,16,0.4) 60%, rgba(16,28,16,0) 100%);"></div>
                <div class="absolute bottom-0 left-0 right-0 p-6 text-white z-[2]">
                  <span class="inline-block bg-[#7CB342] text-white px-2 py-[3px] text-[0.65rem] font-extrabold rounded-sm mb-2">TIN NỔI BẬT</span>
                  <span class="text-[0.75rem] opacity-85 ml-3">📅 {{ formatDate(featured.publishedAt || featured.createdAt) }}</span>
                  <h3 class="text-[1.45rem] sm:text-[1.12rem] font-extrabold leading-[1.3] my-[6px_0_10px] text-white transition-colors group-hover:text-[#c5e1a5]">{{ featured.title }}</h3>
                  <p class="text-[0.88rem] sm:text-[0.82rem] leading-[1.5] opacity-[0.88] m-0 line-clamp-2">{{ featured.excerpt }}</p>
                </div>
              </div>
            </nuxt-link>
          </div>

          <!-- Sub cards -->
          <div class="grid grid-cols-1 gap-[14px] sm:grid-cols-2 sm:gap-5">
            <div v-for="item in subCards" :key="item.id" class="flex gap-4 py-3 border-t border-dashed border-[#E2E8DF] group">
              <nuxt-link :to="`/news/${item.slug}`" class="w-[130px] h-[85px] rounded-lg overflow-hidden flex-shrink-0 shadow-sm">
                <img :src="item.thumbnailUrl || '/assets/news_quangninh.jpg'" :alt="item.title" class="w-full h-full object-cover transition group-hover:scale-[1.05]" />
              </nuxt-link>
              <div class="flex flex-col">
                <span class="text-[0.72rem] text-[#7A8675] font-bold mb-1">{{ formatDate(item.publishedAt || item.createdAt) }}</span>
                <h4 class="text-[0.88rem] font-bold leading-[1.35] m-0">
                  <nuxt-link :to="`/news/${item.slug}`" class="text-[#1E251C] no-underline transition hover:text-[#4A6741]">{{ item.title }}</nuxt-link>
                </h4>
              </div>
            </div>
          </div>
        </template>

        <p v-else class="text-[0.9rem] text-[#7A8675] italic py-6">Chưa có tin tức nào được đăng.</p>
      </div>

      <!-- Right column -->
      <div>
        <SectionBar title="Chỉ đạo &amp; Hoạt động" icon="⚑" />

        <div class="flex flex-col">
          <div v-for="item in trending" :key="item.id" class="flex gap-3 py-[14px] border-b border-[#E2E8DF] last:border-b-0">
            <div class="w-[6px] h-[6px] rounded-full bg-[#4A6741] mt-2 flex-shrink-0"></div>
            <div>
              <h4 class="text-[0.88rem] font-bold leading-[1.4] m-0 mb-[6px]">
                <nuxt-link :to="`/news/${item.slug}`" class="text-[#1E251C] no-underline transition hover:text-[#4A6741]">{{ item.title }}</nuxt-link>
              </h4>
              <span class="text-[0.72rem] text-[#7A8675] font-semibold">📅 {{ formatDate(item.publishedAt || item.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Side banner -->
        <div class="relative rounded-lg p-6 text-white mt-6 overflow-hidden shadow-sm" style="background: url('/assets/hero_banner.jpg') center/cover no-repeat;">
          <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)] z-[1]"></div>
          <div class="relative z-[2]">
            <h3 class="text-[1rem] font-extrabold mt-0 mb-2 uppercase">Hotline Cảnh Sát QLHC</h3>
            <p class="text-[0.78rem] leading-[1.4] m-0 mb-4 opacity-90">Hỗ trợ giải đáp thủ tục cấp CCCD &amp; Lý lịch tư pháp cho người hoàn lương</p>
            <span class="inline-block bg-[#7CB342] text-white px-[14px] py-[6px] text-[0.9rem] font-extrabold rounded">📞 1900.0368</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { formatDateVN } from '~/utils/formatDate'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const formatDate = (dateStr) => formatDateVN(dateStr)

const maxItems = computed(() => Number(d.value.maxItems) || 5)
const categorySlug = computed(() => d.value.categorySlug || '')

const { data } = await useAsyncData(
  `block-news-${props.block.id}`,
  () => $fetch('/api/public/articles', {
    params: {
      type: 'news',
      limit: maxItems.value,
      ...(categorySlug.value ? { categorySlug: categorySlug.value } : {}),
    },
  }),
  { default: () => ({ articles: [] }) }
)

const articles = computed(() => data.value?.articles || [])
const featured = computed(() => articles.value[0] || null)
const subCards = computed(() => articles.value.slice(1, 3))
// Trending list on the right = the remaining items (or first few if only one column of data).
const trending = computed(() => articles.value.slice(0, Math.min(articles.value.length, maxItems.value)))
</script>
