<template>
  <div class="bg-[#F8FAF7]">
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover py-20 text-center text-white">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[2.2rem] font-extrabold mb-2">{{ heading }}</h2>
        <p class="text-base opacity-90">{{ subheading }}</p>
      </div>
    </section>

    <section class="py-12">
      <div class="container">
        <!-- Loading -->
        <div v-if="pending" class="grid grid-cols-1 md:grid-cols-2 gap-[30px] max-w-[1000px] mx-auto">
          <div v-for="n in 4" :key="n" class="bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] animate-pulse motion-reduce:animate-none">
            <div class="h-[220px] bg-[#EEF2EC]"></div>
            <div class="p-6 flex flex-col gap-3">
              <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
              <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
              <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="max-w-[1000px] mx-auto bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]">
          <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
          Không thể tải tin tức. Vui lòng <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
        </div>

        <!-- Empty -->
        <div v-else-if="newsList.length === 0" class="max-w-[1000px] mx-auto bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]">
          {{ emptyText }} Xem <nuxt-link to="/news" class="text-[#4A6741] font-bold">tất cả bản tin</nuxt-link>.
        </div>

        <!-- List -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-[30px] max-w-[1000px] mx-auto">
          <div
            v-for="item in newsList"
            :key="item.id"
            class="bg-white rounded-lg overflow-hidden shadow-sm border border-[#E2E8DF] transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-[#7CB342]"
          >
            <div class="h-[220px] overflow-hidden">
              <img :src="item.thumbnailUrl || '/assets/hero_banner.jpg'" :alt="item.title" loading="lazy" decoding="async" class="w-full h-full object-cover" />
            </div>
            <div class="p-6">
              <span class="block text-[0.8rem] text-[#7A8675] font-semibold mb-2">{{ formatDateVN(item.publishedAt || item.createdAt) }} • {{ item.categoryName || categoryLabel }}</span>
              <h3 class="text-[1.15rem] font-bold leading-[1.4] mb-2.5">
                <nuxt-link
                  :to="'/news/' + item.slug"
                  class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                >{{ item.title }}</nuxt-link>
              </h3>
              <p class="text-[0.9rem] text-[#4A5545] leading-[1.5] mb-4">{{ item.excerpt }}</p>
              <nuxt-link :to="'/news/' + item.slug" class="text-[#7CB342] font-bold no-underline text-[0.88rem]">Chi tiết &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * Shared listing for a single news category.
 *
 * /news/local-news, /news/activity-news and /news/featured-news were three
 * near-identical 87-line copies that had already drifted apart (different
 * section padding, different margin utility, three private copies of a
 * local-time date formatter that could render a different day than SSR).
 * They are now thin wrappers around this component, so the markup, the states
 * and the UTC-safe date formatting stay in one place.
 */
import { computed } from 'vue'
import { formatDateVN } from '~/utils/formatDate'

const props = defineProps({
  heading: { type: String, required: true },
  subheading: { type: String, default: '' },
  categorySlug: { type: String, required: true },
  categoryLabel: { type: String, default: 'Bản tin' },
  emptyText: { type: String, default: 'Chưa có bản tin nào.' },
  limit: { type: Number, default: 20 },
})

const { data, pending, error, refresh } = await useFetch('/api/public/articles', {
  // `lazy: true` để router chuyển trang ngay, khung xương (v-if="pending") được
  // vẽ thật — thay vì giữ nguyên trang cũ tới khi dữ liệu về (trông như bấm hụt).
  // SSR vẫn chờ dữ liệu nên HTML đầu tiên và thẻ SEO không đổi.
  lazy: true,
  key: () => `news-category-${props.categorySlug}`,
  query: { type: 'news', categorySlug: props.categorySlug, limit: props.limit },
  default: () => ({ ok: true, articles: [], pagination: {} }),
})

const newsList = computed(() => data.value?.articles || [])
const loadError = computed(() => !!error.value || data.value?.ok === false)
</script>
