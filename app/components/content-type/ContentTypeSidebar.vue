<script setup lang="ts">
import type { PublicArticleListItem } from '~/utils/public-types'
import { useI18n } from '~/composables/useI18n'

/**
 * Cột bên phải của trang list một Content-Type: Đọc nhiều, Chuyên mục, Hotline 24/7,
 * Tra cứu nhanh. Tách nguyên văn khỏi `ContentTypeListSection.vue` (705 dòng): toàn
 * trình bày, không có trạng thái riêng — dữ liệu và việc đổi chuyên mục vẫn do cha giữ.
 */
defineProps<{
  /** Slug content-type: dựng link `/<type>/<bài>` cho mục Đọc nhiều. */
  typeSlug: string
  mostRead: Pick<PublicArticleListItem, 'id' | 'slug' | 'title'>[]
  mostReadPending: boolean
  rootCategories: { id: number, name: string, slug: string }[]
  /** `'all'` hoặc slug chuyên mục đang chọn. */
  activeCategory: string
}>()
defineEmits<{ 'select-category': [slug: string] }>()

const { t } = useI18n()

/** Giống `categoryIcon` ở cha: chưa có icon riêng theo chuyên mục. */
const CATEGORY_ICON = 'fa-solid fa-folder'
</script>

<template>
  <!-- Right Rail / Sidebar -->
  <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[90px]">
    <!-- Widget 1: Đọc nhiều -->
    <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
      <h2 class="text-[0.8rem] font-extrabold text-brand-600 uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">{{ t('n_most_read_short') }}</h2>
      <div v-if="mostReadPending" role="status" aria-busy="true" class="py-2">
        <span class="sr-only">{{ t('n_loading_most_read') }}</span>
        <div aria-hidden="true" class="flex flex-col">
          <div v-for="n in 6" :key="n" class="flex gap-3 py-3 border-b border-[#E2E8DF] last:border-b-0">
            <div class="h-6 w-6 bg-[#EEF2EC] rounded shrink-0 animate-pulse motion-reduce:animate-none"></div>
            <div class="flex-1 flex flex-col gap-1.5 pt-0.5">
              <div class="h-3.5 w-full bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none"></div>
              <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded animate-pulse motion-reduce:animate-none"></div>
            </div>
          </div>
        </div>
      </div>
      <ul v-else-if="mostRead.length" class="list-none p-0 m-0">
        <li
          v-for="(item, i) in mostRead"
          :key="item.id"
          class="flex gap-3 py-[13px] border-b border-[#E2E8DF] last:border-b-0"
        >
          <span class="w-7 shrink-0 text-right text-[1.45rem] leading-[1.15] font-extrabold" :class="i < 3 ? 'text-[#7CB342]' : 'text-[#C7D2C2]'">{{ i + 1 }}</span>
          <h3 class="text-[0.9rem] font-bold leading-[1.4] m-0 min-w-0">
            <nuxt-link
              :to="`/${typeSlug}/${item.slug}`"
              class="text-ink no-underline transition-colors duration-300 hover:text-brand-600 line-clamp-2"
            >{{ item.title }}</nuxt-link>
          </h3>
        </li>
      </ul>
      <p v-else class="text-[0.85rem] text-[#5A6C58] italic py-4 m-0">{{ t('n_no_views') }}</p>
    </div>

    <!-- Widget 2: Chuyên mục -->
    <div v-if="rootCategories.length" class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
      <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
        <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-brand-600 flex items-center justify-center text-xs shadow-sm">
          <i class="fa-solid fa-folder-open" aria-hidden="true"></i>
        </span>
        <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
          {{ t('n_category_widget') }}
        </h2>
      </div>
      <div class="flex flex-col divide-y divide-[#F2F6F0]">
        <button
          type="button"
          class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
          :class="activeCategory === 'all' ? 'text-[#385932]' : 'text-[#4A5746] hover:text-[#385932]'"
          @click="$emit('select-category', 'all')"
        >
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-layer-group text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
            <span>{{ t('n_all_news') }}</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
        </button>
        <button
          v-for="cat in rootCategories"
          :key="cat.id"
          type="button"
          class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
          :class="activeCategory === cat.slug ? 'text-[#385932]' : 'text-[#4A5746] hover:text-[#385932]'"
          @click="$emit('select-category', cat.slug)"
        >
          <span class="flex items-center gap-2">
            <i :class="CATEGORY_ICON" class="text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
            <span>{{ cat.name }}</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- Widget 3: Hotline & Hỗ Trợ 24/7 -->
    <div class="relative rounded-2xl overflow-hidden shadow-md text-white bg-gradient-to-br from-[#294B26] via-[#203D1E] to-[#162D15] p-6 border border-[#3E6539]">
      <div class="flex items-center gap-2 mb-2">
        <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-xs">
          <i class="fa-solid fa-shield-halved text-[#A8D59D]" aria-hidden="true"></i>
        </span>
        <span class="text-[0.7rem] font-black uppercase tracking-wider text-[#A8D59D]">{{ t('support_24_7') }}</span>
      </div>
      <h3 class="text-[1.05rem] font-black m-0 mb-1.5 leading-snug">{{ t('hotline_title') }}</h3>
      <p class="text-xs leading-relaxed m-0 mb-4 text-white/80">{{ t('hotline_desc') }}</p>
      <a
        href="tel:0903480985"
        class="flex items-center justify-center gap-2.5 w-full bg-[#4a7c1e] hover:bg-[#3d6b15] text-white py-2.5 px-4 rounded-xl text-sm font-black no-underline transition-all shadow-md mb-2.5"
      >
        <i class="fa-solid fa-phone" aria-hidden="true"></i>
        <span>0903.480.985</span>
      </a>
      <nuxt-link
        to="/assistant"
        class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-xl no-underline transition-all border border-white/15"
      >
        <i class="fa-solid fa-robot text-[0.8rem]" aria-hidden="true"></i>
        <span>{{ t('ask_ai_24_7') }}</span>
      </nuxt-link>
    </div>

    <!-- Widget 4: Tra cứu nhanh -->
    <div class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
      <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
        <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-brand-600 flex items-center justify-center text-xs shadow-sm">
          <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
        </span>
        <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
          {{ t('quick_tools') }}
        </h2>
      </div>
      <div class="flex flex-col gap-2 text-xs">
        <nuxt-link to="/documents" class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]">
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-file-contract text-brand-600" aria-hidden="true"></i>
            <span>Văn bản pháp luật</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
        </nuxt-link>
        <nuxt-link to="/legal-qa" class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]">
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-circle-question text-brand-600" aria-hidden="true"></i>
            <span>Giải đáp pháp luật</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
        </nuxt-link>
        <nuxt-link to="/reintegration-models" class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]">
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-people-group text-brand-600" aria-hidden="true"></i>
            <span>Mô hình tái hòa nhập</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
        </nuxt-link>
      </div>
    </div>
  </aside>
</template>
