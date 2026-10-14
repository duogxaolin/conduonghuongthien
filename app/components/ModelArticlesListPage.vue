<template>
  <div class="min-h-screen bg-[#F7FAF6]">
    <!-- Page Header & Hero Section — hero text đơn giản trên nền gradient nhạt -->
    <PageHero>
      <!-- Breadcrumb navigation -->
      <nav aria-label="breadcrumb" class="mb-4">
        <ol class="flex items-center gap-1.5 text-xs text-[#6B7967] m-0 p-0 list-none flex-wrap">
          <li class="flex items-center gap-1.5">
            <nuxt-link to="/" class="hover:text-[#385932] transition-colors flex items-center gap-1">
              <i class="fa-solid fa-house text-[0.7rem] text-[#4A6741]" aria-hidden="true"></i>
              <span>{{ t('home') }}</span>
            </nuxt-link>
          </li>
          <li aria-hidden="true" class="text-[#A2B09F]">&rsaquo;</li>
          <li class="font-bold text-[#2A3B27] flex items-center gap-1">
            <span>{{ t(cfg.keys.breadcrumb) }}</span>
          </li>
        </ol>
      </nav>

      <div class="max-w-2xl">
        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
          <span class="w-2 h-2 rounded-full bg-[#4A6741] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
          <span>{{ t('n_portal_badge') }}</span>
        </div>
        <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-[#172516] tracking-tight leading-[1.2] m-0">
          {{ t(cfg.keys.title) }}
        </h1>
        <p class="text-[0.92rem] sm:text-base text-[#576653] mt-2 mb-0 leading-relaxed">
          {{ t(cfg.keys.desc) }}
        </p>
      </div>
    </PageHero>

    <!-- Search — đẩy ra khỏi hero, nằm ngay đầu nội dung -->
    <section class="pt-6 lg:pt-8">
      <div class="container">
        <div class="w-full lg:w-80 shrink-0">
          <form @submit.prevent="applySearch" class="relative flex items-center">
            <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7C8D78] pointer-events-none text-xs">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            </span>
            <input
              v-model="searchInput"
              type="text"
              :placeholder="t(cfg.keys.searchPlaceholder)"
              :aria-label="t(cfg.keys.searchAria)"
              class="w-full pl-9 pr-20 py-2.5 bg-white rounded-xl border border-[#D5E1D3] text-sm text-[#1E251C] placeholder-[#8A9986] focus:border-[#4A6741] focus:ring-2 focus:ring-[#7CB342]/30 focus:outline-none transition-all shadow-sm"
            />
            <button
              v-if="searchInput"
              type="button"
              @click="clearSearchInput"
              class="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[#97A593] hover:text-[#4A5545] text-xs transition-colors"
              :title="t(cfg.keys.clearSearch)"
              :aria-label="t(cfg.keys.clearSearch)"
            >
              ✕
            </button>
            <button
              type="submit"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-[#4A6741] hover:bg-[#365130] text-white text-xs font-bold transition-all shadow-sm"
            >
              {{ t('n_search_btn_short') }}
            </button>
          </form>
        </div>
      </div>
    </section>

    <!-- Main Content Section -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px] lg:gap-8 xl:gap-10 lg:items-start">
        <!-- Main Column (Left) -->
        <div class="flex flex-col gap-7 min-w-0">
          <!-- Mỏ neo cuộn trang khi phân trang -->
          <div :id="cfg.anchorId" class="scroll-mt-[100px]"></div>

          <!-- Active Search Filter Banner -->
          <div
            v-if="searchQuery"
            class="bg-white border-l-4 border-l-[#4A6741] border border-[#DDE6DC] p-4 rounded-xl shadow-sm flex items-center justify-between gap-3 flex-wrap"
          >
            <div class="flex items-center gap-2.5">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              </span>
              <span class="text-sm text-[#3E4D3C]">
                {{ t(cfg.keys.searchResult) }} <strong>&laquo;{{ searchQuery }}&raquo;</strong>
                <span v-if="!pending" class="text-[#5A6C58] ml-1.5">({{ t(cfg.keys.articlesCount).replace('{n}', String(pagination.total)) }})</span>
              </span>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D5E1D3] bg-[#F7FAF6] hover:bg-[#EBF3E8] text-xs font-bold text-[#4A6741] transition-all"
              @click="clearSearch"
            >
              <i class="fa-solid fa-xmark text-[0.7rem]" aria-hidden="true"></i>
              <span>{{ t('n_clear_filter') }}</span>
            </button>
          </div>

          <!-- Loading State (Skeleton) -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
            <span class="sr-only">{{ t(cfg.keys.listLoading) }}</span>
            <!-- Hero skeleton -->
            <div aria-hidden="true" class="bg-white overflow-hidden border border-[#DDE6DC] shadow-sm flex flex-col md:flex-row animate-pulse motion-reduce:animate-none">
              <div class="md:w-[48%] aspect-video bg-[#E5EDE3] shrink-0 rounded-none"></div>
              <div class="p-6 md:p-8 flex flex-col justify-between md:w-[52%] gap-4">
                <div class="flex items-center gap-3">
                  <div class="h-5 w-24 bg-[#E5EDE3] rounded-full"></div>
                  <div class="h-4 w-28 bg-[#E5EDE3] rounded"></div>
                </div>
                <div class="space-y-2">
                  <div class="h-6 w-full bg-[#E5EDE3] rounded"></div>
                  <div class="h-6 w-3/4 bg-[#E5EDE3] rounded"></div>
                </div>
                <div class="space-y-2">
                  <div class="h-3.5 w-full bg-[#E5EDE3] rounded"></div>
                  <div class="h-3.5 w-5/6 bg-[#E5EDE3] rounded"></div>
                </div>
                <div class="h-8 w-32 bg-[#E5EDE3] rounded-lg mt-2"></div>
              </div>
            </div>

            <!-- Grid skeleton (6 cards) -->
            <div aria-hidden="true" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              <div v-for="n in 6" :key="n" class="bg-white overflow-hidden border border-[#DDE6DC] shadow-sm animate-pulse motion-reduce:animate-none flex flex-col">
                <div class="w-full aspect-video bg-[#E5EDE3] rounded-none"></div>
                <div class="p-5 flex flex-col gap-3 flex-1">
                  <div class="h-3.5 w-24 bg-[#E5EDE3] rounded"></div>
                  <div class="h-5 w-full bg-[#E5EDE3] rounded"></div>
                  <div class="h-5 w-2/3 bg-[#E5EDE3] rounded"></div>
                  <div class="h-3.5 w-full bg-[#E5EDE3] rounded mt-1"></div>
                  <div class="h-3.5 w-4/5 bg-[#E5EDE3] rounded"></div>
                </div>
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
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">{{ t(cfg.keys.loadErrorTitle) }}</h3>
            <p class="text-sm text-[#667768] m-0 mb-4">{{ t(cfg.keys.loadErrorDesc) }}</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A6741] hover:bg-[#385130] text-white font-bold text-sm transition-all shadow-sm"
              @click="refresh()"
            >
              <i class="fa-solid fa-rotate-right text-xs" aria-hidden="true"></i>
              <span>{{ t('n_retry_now') }}</span>
            </button>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="articles.length === 0"
            class="bg-white border-2 border-dashed border-[#DDE6DC] px-6 py-14 rounded-2xl text-center shadow-sm"
          >
            <div class="w-14 h-14 rounded-full bg-[#EEF4EC] text-[#4A6741] flex items-center justify-center mx-auto mb-3.5 text-xl">
              <i :class="cfg.emptyIcon" aria-hidden="true"></i>
            </div>
            <template v-if="pageOutOfRange">
              <!-- `?page=` vượt trang cuối (link cũ, gõ tay): không phải "chưa có bài" —
                   đưa người đọc về trang đầu thay vì để kẹt ở một trang trắng. -->
              <p class="text-sm text-[#6E7D6B] max-w-md mx-auto m-0 mb-5">{{ t('list_page_out_of_range').replace('{total}', String(pagination.totalPages)) }}</p>
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A6741] hover:bg-[#385130] text-white font-bold text-sm transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] focus-visible:ring-offset-2"
                @click="goFirstPage"
              >
                <i class="fa-solid fa-arrow-left text-xs" aria-hidden="true"></i>
                <span>{{ t('list_back_first_page') }}</span>
              </button>
            </template>
            <template v-else>
              <h3 class="text-base font-extrabold text-[#233520] m-0 mb-1">{{ t(cfg.keys.emptyTitle) }}</h3>
              <p class="text-sm text-[#6E7D6B] max-w-md mx-auto m-0 mb-5">
                {{ t(cfg.keys.emptyDesc) }}
              </p>
              <button
                v-if="searchQuery"
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A6741] hover:bg-[#385130] text-white font-bold text-sm transition-all shadow-sm"
                @click="clearSearch"
              >
                <i class="fa-solid fa-arrow-rotate-left text-xs" aria-hidden="true"></i>
                <span>{{ t(cfg.keys.viewAll) }}</span>
              </button>
            </template>
          </div>

          <!-- Content Render -->
          <template v-else>
            <!-- Featured / Lead Story: chỉ hiển thị ở Trang 1 khi không tìm kiếm -->
            <article
              v-if="featured"
              :class="['group bg-white rounded-2xl overflow-hidden border shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-all duration-300 flex flex-col lg:flex-row lg:items-stretch mb-6', cfg.theme.featuredCard]"
            >
              <nuxt-link
                :to="detailPath(featured.slug)"
                class="block overflow-hidden lg:w-[42%] xl:w-[40%] shrink-0 relative bg-[#EBF1EA] no-underline"
              >
                <SafeImg
                  :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="featured.title" img-class="w-full h-[220px] sm:h-[250px] lg:h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                  loading="lazy"
                  decoding="async"
                  sizes="384px sm:512px lg:768px"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </nuxt-link>

              <div class="p-5 sm:p-6 lg:p-6 xl:p-7 flex flex-col justify-between flex-1 min-w-0 bg-white">
                <div>
                  <div class="flex items-center gap-2.5 mb-2.5 text-xs flex-wrap">
                    <span :class="['inline-block text-white font-extrabold px-2.5 py-0.5 rounded text-[0.7rem] uppercase tracking-wider shadow-sm', cfg.theme.featuredBadge]">
                      {{ t(cfg.keys.featuredBadge) }}
                    </span>
                    <span class="text-[#4A5545] font-semibold text-[0.82rem]">
                      {{ t(cfg.keys.categoryLabel) }}
                    </span>
                    <span class="text-[#5a6c58] text-[0.8rem] font-medium">
                      {{ formatDate(featured) }}
                    </span>
                  </div>

                  <h2 class="text-[1.15rem] sm:text-[1.28rem] lg:text-[1.32rem] font-black leading-[1.35] mb-2 m-0 text-[#172516]">
                    <nuxt-link
                      :to="detailPath(featured.slug)"
                      :class="['text-[#172516] no-underline transition-colors duration-200', cfg.theme.titleHover]"
                    >
                      {{ featured.title }}
                    </nuxt-link>
                  </h2>

                  <p v-if="featured.excerpt" class="text-[0.88rem] text-[#556450] leading-relaxed m-0 line-clamp-2 mb-3">
                    {{ cleanExcerpt(featured.excerpt) }}
                  </p>
                </div>

                <div>
                  <nuxt-link
                    :to="detailPath(featured.slug)"
                    :class="['inline-flex items-center gap-1.5 font-bold text-[0.88rem] transition-all no-underline group/link', cfg.theme.actionLink]"
                  >
                    <span>{{ t(cfg.keys.readMore) }}</span>
                    <i class="fa-solid fa-arrow-right text-[0.72rem] transition-transform duration-200 group-hover/link:translate-x-1" aria-hidden="true"></i>
                  </nuxt-link>
                </div>
              </div>
            </article>

            <!-- Section Title Divider -->
            <div v-if="rest.length" class="flex items-center justify-between pt-3 pb-3 border-b-2 border-[#E1EADF] mt-1 mb-5">
              <div class="flex items-center gap-2.5">
                <span :class="['w-2.5 h-6 rounded-sm', cfg.theme.dividerBar]" aria-hidden="true"></span>
                <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                  {{ t(cfg.keys.listTitle) }}
                </h2>
                <span :class="['text-xs font-extrabold px-2.5 py-0.5 rounded-full', cfg.theme.countPill]">
                  {{ t(cfg.keys.articlesCount).replace('{n}', String(pagination.total)) }}
                </span>
              </div>
              <span v-if="pagination.totalPages > 1" class="text-xs text-[#5A6C58] font-medium hidden sm:inline">
                {{ t('n_page_of').replace('{current}', String(pagination.page)).replace('{total}', String(pagination.totalPages)) }}
              </span>
            </div>

            <!-- Responsive 3-Column Magazine Grid -->
            <div v-if="rest.length" :class="articleGridClass">
              <article
                v-for="item in rest"
                :key="item.id"
                :class="['group bg-white rounded-2xl overflow-hidden border shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full', cfg.theme.card]"
              >
                <nuxt-link :to="detailPath(item.slug)" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
                  <SafeImg
                    :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                    :alt="item.title" img-class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                    sizes="256px sm:384px lg:512px"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </nuxt-link>

                <div class="p-4 sm:p-5 flex flex-col flex-1">
                  <div class="flex items-center gap-2 text-xs text-[#5A6C58] font-medium mb-2">
                    <span :class="['inline-block font-bold uppercase tracking-wider', cfg.theme.cardBadge]">
                      {{ t(cfg.keys.cardBadge) }}
                    </span>
                    <span class="flex items-center gap-1 text-[#5a6c58] text-[0.75rem]">
                      <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                      <span>{{ formatDate(item) }}</span>
                    </span>
                  </div>

                  <h3 :class="['text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0', cfg.theme.cardTitle]">
                    <nuxt-link :to="detailPath(item.slug)" :class="['text-[#172516] no-underline', cfg.theme.titleHover]">
                      {{ item.title }}
                    </nuxt-link>
                  </h3>

                  <p v-if="item.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                    {{ cleanExcerpt(item.excerpt) }}
                  </p>

                  <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#5A6C58]">
                    <nuxt-link
                      :to="detailPath(item.slug)"
                      :class="['inline-flex items-center gap-1.5 font-bold group-hover:translate-x-0.5 transition-all no-underline', cfg.theme.actionLink]"
                    >
                      <span>{{ t('n_view_details') }}</span>
                      <i class="fa-solid fa-arrow-right text-[0.68rem] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true"></i>
                    </nuxt-link>
                    <span class="text-[#6B7B68] font-medium text-[0.72rem]">{{ t(cfg.keys.cardFooterBadge) }}</span>
                  </div>
                </div>
              </article>
            </div>

            <!-- Enhanced Pagination -->
            <nav
              v-if="pagination.totalPages > 1"
              aria-label="pagination"
              class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-[#DDE6DC]"
            >
              <div class="text-xs text-[#6F7F6C] font-medium order-2 sm:order-1">
                {{ t('n_pagination_summary').replace('{current}', String(pagination.page)).replace('{total}', String(pagination.totalPages)) }}
              </div>

              <div class="flex items-center gap-1.5 flex-wrap justify-center order-1 sm:order-2">
                <button
                  type="button"
                  :class="['inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed', cfg.theme.pageStep]"
                  :disabled="pagination.page <= 1"
                  @click="setPage(pagination.page - 1)"
                  :aria-label="t('page_prev')"
                >
                  <i class="fa-solid fa-chevron-left text-[0.7rem]" aria-hidden="true"></i>
                </button>

                <template v-for="(p, i) in pageRange" :key="p">
                  <span
                    v-if="i > 0 && p - (pageRange[i - 1] ?? p) > 1"
                    class="text-[#8C9C88] text-xs px-1 select-none font-bold"
                    aria-hidden="true"
                  >&hellip;</span>
                  <button
                    type="button"
                    :aria-current="pagination.page === p ? 'page' : undefined"
                    :class="[
                      'inline-flex items-center justify-center min-w-9 h-9 px-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all duration-200',
                      pagination.page === p ? cfg.theme.pageActive : cfg.theme.pageIdle
                    ]"
                    @click="setPage(p)"
                  >{{ p }}</button>
                </template>

                <button
                  type="button"
                  :class="['inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed', cfg.theme.pageStep]"
                  :disabled="pagination.page >= pagination.totalPages"
                  @click="setPage(pagination.page + 1)"
                  :aria-label="t('page_next')"
                >
                  <i class="fa-solid fa-chevron-right text-[0.7rem]" aria-hidden="true"></i>
                </button>
              </div>
            </nav>
          </template>
        </div>

        <!-- Right Rail / Sidebar (Right) -->
        <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[90px]">
          <!-- Widget 1: Đọc nhiều -->
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm px-5 py-2">
            <h2 class="text-[0.8rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] pt-3 pb-2 border-b-2 border-[#E2E8DF] m-0">{{ t('n_most_read_short') }}</h2>

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
                    :to="detailPath(item.slug)"
                    class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741] line-clamp-2"
                  >{{ item.title }}</nuxt-link>
                </h3>
              </li>
            </ul>

            <p v-else class="text-[0.85rem] text-[#5A6C58] italic py-4 m-0">{{ t('n_no_views') }}</p>
          </div>

          <!-- Widget 2: Hotline & Hỗ Trợ 24/7 -->
          <div class="relative rounded-2xl overflow-hidden shadow-md text-white bg-gradient-to-br from-[#294B26] via-[#203D1E] to-[#162D15] p-6 border border-[#3E6539]">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-xs">
                <i class="fa-solid fa-shield-halved text-[#A8D59D]" aria-hidden="true"></i>
              </span>
              <span class="text-[0.7rem] font-black uppercase tracking-wider text-[#A8D59D]">{{ t('support_24_7') }}</span>
            </div>
            <h3 class="text-[1.05rem] font-black m-0 mb-1.5 leading-snug">{{ t('hotline_title') }}</h3>
            <p class="text-xs leading-relaxed m-0 mb-4 text-white/80">
              {{ t('hotline_desc') }}
            </p>

            <a
              href="tel:0903480985"
              class="flex items-center justify-center gap-2.5 w-full bg-[#4a7c1e] hover:bg-[#3d6b15] text-white py-2.5 px-4 rounded-xl text-sm font-black no-underline transition-all shadow-md mb-2.5"
            >
              <i class="fa-solid fa-phone" aria-hidden="true"></i>
              <span>{{ t('hotline') }}</span>
            </a>

            <nuxt-link
              to="/assistant"
              class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-xl no-underline transition-all border border-white/15"
            >
              <i class="fa-solid fa-robot text-[0.8rem]" aria-hidden="true"></i>
              <span>{{ t('ask_ai_24_7') }}</span>
            </nuxt-link>
          </div>

          <!-- Widget 3: Chuyên mục liên quan -->
          <div class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
            <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs shadow-sm">
                <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
              </span>
              <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
                {{ t(cfg.keys.relatedWidget) }}
              </h2>
            </div>
            <div class="flex flex-col gap-2 text-xs">
              <nuxt-link
                v-for="link in cfg.relatedLinks"
                :key="link.to"
                :to="link.to"
                class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]"
              >
                <span class="flex items-center gap-2">
                  <i :class="[link.icon, 'text-[#4A6741]']" aria-hidden="true"></i>
                  <span>{{ t(link.labelKey) }}</span>
                </span>
                <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
              </nuxt-link>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatDateVN } from '~/utils/formatDate'
import { cleanExcerpt } from '~/utils/article-excerpt'
import { MODEL_ARTICLE_VARIANTS, type ModelArticleVariant } from '~/utils/model-article-variants'
import { useI18n } from '~/composables/useI18n'
import { useLayoutConfig } from '~/composables/useLayoutConfig'
import { usePublicArticleList, usePublicMostRead } from '~/composables/usePublicArticleList'

/**
 * Trang danh sách dùng chung cho `/role-models` và `/reintegration-models`.
 * Mọi khác biệt giữa hai trang nằm trong `MODEL_ARTICLE_VARIANTS`
 * (`app/utils/model-article-variants.ts`); trang gọi giữ route và `useSeoMeta`.
 */
const props = defineProps<{ variant: ModelArticleVariant }>()

// Mỗi route một biến thể, cố định suốt vòng đời component — đọc một lần.
const cfg = MODEL_ARTICLE_VARIANTS[props.variant]

const { t, currentLang } = useI18n()
const { articleGridClass } = useLayoutConfig()

// Trạng thái đọc từ URL, khoá fetch dẫn xuất từ query (xem usePublicArticleList).
const {
  searchQuery,
  searchInput,
  articles,
  pagination,
  pageRange,
  pageOutOfRange,
  pending,
  loadError,
  refresh,
  featured,
  rest,
  setPage,
  goFirstPage,
  applySearch,
  clearSearch,
  clearSearchInput,
} = usePublicArticleList({
  type: cfg.type,
  perPage: 19,
  lang: currentLang,
  pathFor: () => cfg.basePath,
  scrollTargetId: cfg.anchorId,
})

const { mostRead, mostReadPending } = usePublicMostRead(cfg.type, currentLang)

const detailPath = (slug: string) => `${cfg.basePath}/${slug}`

const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)
</script>

