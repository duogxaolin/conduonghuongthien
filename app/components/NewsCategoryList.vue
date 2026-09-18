<template>
  <div class="bg-[#F8FAF7]">
    <!-- Page Header (đồng bộ 100% với /news) -->
    <section class="border-b border-[#E2E8DF] bg-white">
      <div class="container pt-7 sm:pt-9 pb-5">
        <nav aria-label="Đường dẫn trang" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-3">
          <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>Trang chủ</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <nuxt-link to="/news" class="hover:text-[#4A6741] transition-colors no-underline text-[#556450]">
            <span>Bản tin</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">{{ heading }}</span>
        </nav>

        <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.2px] text-[#7CB342] m-0 mb-1">Chuyên mục bản tin</p>
        <h1 class="text-[1.65rem] sm:text-[2.05rem] font-extrabold text-[#1E251C] leading-[1.2] m-0">{{ heading }}</h1>
        <p v-if="subheading" class="text-[0.95rem] text-[#5A6655] mt-2 mb-5 leading-relaxed">{{ subheading }}</p>

        <!-- Category Nav Chips -->
        <nav aria-label="Điều hướng chuyên mục bản tin" class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <nuxt-link
            to="/news"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 no-underline bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]"
          >
            <i class="fa-solid fa-layer-group text-[0.7rem]" aria-hidden="true"></i>
            <span>Tất cả bản tin</span>
          </nuxt-link>
          <nuxt-link
            v-for="cat in categoryNavList"
            :key="cat.slug"
            :to="cat.url"
            :class="[
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 no-underline',
              categorySlug === cat.slug
                ? 'bg-[#4A6741] text-white border-[#4A6741] shadow-sm'
                : 'bg-white text-[#4A5545] border-[#DCE5DB] hover:border-[#4A6741] hover:bg-[#F2F7F0]'
            ]"
          >
            <i :class="cat.icon" class="text-[0.7rem]" aria-hidden="true"></i>
            <span>{{ cat.label }}</span>
          </nuxt-link>
        </nav>
      </div>
    </section>

    <!-- Main Content Grid with Sidebar -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_340px] gap-8 lg:gap-10 items-start">
        <!-- Left Content Area -->
        <div class="flex flex-col gap-7 min-w-0">
          <!-- Section Divider Header -->
          <div class="flex items-center justify-between pt-1 pb-3 border-b-2 border-[#E1EADF] mb-1">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
              <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                {{ heading }}
              </h2>
              <span v-if="!pending" class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
                {{ newsList.length }} tin
              </span>
            </div>
            <nuxt-link to="/news" class="text-xs text-[#4A6741] font-bold hover:underline flex items-center gap-1 no-underline">
              <span>Xem tất cả</span>
              <i class="fa-solid fa-arrow-right text-[0.65rem]" aria-hidden="true"></i>
            </nuxt-link>
          </div>

          <!-- Loading (Skeleton) -->
          <div v-if="pending" role="status" aria-busy="true" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <span class="sr-only">Đang tải danh sách bản tin</span>
            <div v-for="n in 6" :key="n" class="bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none flex flex-col">
              <div class="aspect-video bg-[#EEF2EC]"></div>
              <div class="p-4 sm:p-5 flex flex-col gap-3 flex-1">
                <div class="h-3.5 w-24 bg-[#EEF2EC] rounded"></div>
                <div class="h-5 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
          </div>

          <!-- Error State -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center text-[#B04A4A] shadow-sm"
          >
            <div class="w-12 h-12 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải danh sách bản tin</h3>
            <p class="text-sm text-[#667768] m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu máy chủ.</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all cursor-pointer border-none"
              @click="() => refresh()"
            >
              <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              <span>Thử lại</span>
            </button>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="newsList.length === 0"
            class="bg-white border border-[#E2E8DF] rounded-2xl p-10 text-center shadow-sm"
          >
            <div class="w-16 h-16 rounded-full bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-2xl">
              <i class="fa-regular fa-newspaper" aria-hidden="true"></i>
            </div>
            <h3 class="text-lg font-extrabold text-[#172516] m-0 mb-2">{{ emptyText }}</h3>
            <p class="text-sm text-[#556450] m-0 mb-5">Hiện tại chuyên mục này chưa có bài viết mới cập nhật.</p>
            <nuxt-link
              to="/news"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4A6741] text-white text-xs font-bold hover:bg-[#385132] transition-all no-underline"
            >
              <span>Xem tất cả bản tin</span>
              <i class="fa-solid fa-arrow-right text-xs" aria-hidden="true"></i>
            </nuxt-link>
          </div>

          <!-- Responsive 3-Column Magazine Grid -->
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <article
              v-for="item in newsList"
              :key="item.id"
              class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full"
            >
              <!-- Thumbnail: strictly 16:9 -->
              <nuxt-link :to="'/news/' + item.slug" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
                <img
                  :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="item.title"
                  loading="lazy"
                  decoding="async"
                  class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </nuxt-link>

              <!-- Card Content -->
              <div class="p-4 sm:p-5 flex flex-col flex-1">
                <div class="flex items-center gap-2 text-xs text-[#7A8A76] font-medium mb-2">
                  <span class="inline-block bg-[#EEF4EC] text-[#3A6033] font-bold text-[0.68rem] px-2 py-0.5 rounded uppercase tracking-wider">
                    {{ item.categoryName || categoryLabel }}
                  </span>
                  <span class="flex items-center gap-1 text-[#889684] text-[0.75rem]">
                    <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                    <span>{{ formatDateVN(item.publishedAt || item.createdAt) }}</span>
                  </span>
                </div>

                <!-- Title: line-clamp-2 cắt ngắn nếu quá dài -->
                <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0">
                  <nuxt-link :to="'/news/' + item.slug" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                    {{ item.title }}
                  </nuxt-link>
                </h3>

                <!-- Excerpt: line-clamp-2 -->
                <p v-if="item.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                  {{ item.excerpt }}
                </p>

                <!-- Footer Action: pinned to bottom with mt-auto -->
                <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#7A8A76]">
                  <nuxt-link
                    :to="'/news/' + item.slug"
                    class="inline-flex items-center gap-1.5 font-bold text-[#385932] hover:text-[#1B3617] group-hover:translate-x-0.5 transition-all no-underline"
                  >
                    <span>Chi tiết</span>
                    <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
                  </nuxt-link>
                  <span class="text-[#8E9F8B] font-medium text-[0.72rem]">Bản tin C11</span>
                </div>
              </div>
            </article>
          </div>
        </div>

        <!-- Right Rail / Sidebar (Right) -->
        <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[90px]">
          <!-- Widget 1: Đọc nhiều (thiết kế nguyên bản tinh tế) -->
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
            <h2 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">Đọc nhiều</h2>

            <div v-if="mostReadPending" role="status" aria-busy="true" class="py-2">
              <span class="sr-only">Đang tải tin đọc nhiều</span>
              <div aria-hidden="true" class="flex flex-col">
                <div v-for="n in 6" :key="n" class="flex gap-3 py-3 border-b border-[#E2E8DF] last:border-b-0">
                  <div class="w-7 h-6 bg-[#EEF2EC] rounded shrink-0 animate-pulse motion-reduce:animate-none"></div>
                  <div class="flex-1 space-y-1.5">
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
                    :to="`/news/${item.slug}`"
                    class="text-[#1E251C] hover:text-[#4A6741] transition-colors no-underline line-clamp-2"
                  >{{ item.title }}</nuxt-link>
                </h3>
              </li>
            </ul>

            <p v-else class="text-[0.85rem] text-[#7A8675] italic py-4 m-0">Chưa có dữ liệu lượt xem.</p>
          </div>

          <!-- Widget 2: Hotline & Hỗ Trợ 24/7 -->
          <div class="bg-gradient-to-br from-[#2D5A27] to-[#1E3E1A] rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
            <div class="absolute -right-4 -bottom-6 text-white/5 text-8xl pointer-events-none">
              <i class="fa-solid fa-headset" aria-hidden="true"></i>
            </div>
            <div class="relative z-10">
              <span class="inline-block px-2.5 py-0.5 rounded-full bg-white/15 text-[#A5D6A7] text-[0.68rem] font-extrabold uppercase tracking-wider mb-3">
                Tư vấn tái hòa nhập
              </span>
              <h3 class="text-lg font-black leading-tight mb-2 m-0 text-white">
                Cần hỗ trợ thông tin hoặc giải đáp pháp lý?
              </h3>
              <p class="text-xs text-white/80 leading-relaxed mb-4 m-0">
                Đội ngũ cán bộ và chuyên gia tư vấn sẵn sàng đồng hành, hỗ trợ thủ tục tái hòa nhập cộng đồng.
              </p>
              <a
                href="tel:0903480985"
                class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7CB342] hover:bg-[#689F38] text-white font-extrabold text-xs transition-all no-underline shadow-sm"
              >
                <i class="fa-solid fa-phone" aria-hidden="true"></i>
                <span>Hotline: 0903.480.985</span>
              </a>
            </div>
          </div>
        </aside>
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
  limit: { type: Number, default: 24 },
})

const categoryNavList = [
  { slug: 'tin-noi-bat', label: 'Tin nổi bật', url: '/news/featured-news', icon: 'fa-solid fa-fire' },
  { slug: 'tin-hoat-dong', label: 'Tin hoạt động', url: '/news/activity-news', icon: 'fa-solid fa-bolt' },
  { slug: 'tin-dia-phuong', label: 'Tin địa phương', url: '/news/local-news', icon: 'fa-solid fa-map-location-dot' },
]

const { data, pending, error, refresh } = await useFetch('/api/public/articles', {
  lazy: true,
  key: () => `news-category-${props.categorySlug}`,
  query: { type: 'news', categorySlug: props.categorySlug, limit: props.limit },
  default: () => ({ ok: true, articles: [], pagination: {} }),
})

const newsList = computed(() => (data.value as { articles?: any[] })?.articles || [])
const loadError = computed(() => !!error.value || (data.value as { ok?: boolean })?.ok === false)

const { data: mostReadData, pending: mostReadPending } = await useFetch('/api/public/articles', {
  lazy: true,
  key: () => 'news-category-most-read',
  query: { type: 'news', sort: 'views', limit: 6 },
  default: () => ({ ok: true, articles: [], pagination: {} }),
})

const mostRead = computed(() => (mostReadData.value as { articles?: any[] })?.articles || [])
</script>
