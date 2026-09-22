<template>
  <div class="min-h-screen bg-[#F7FAF6]">
    <!-- Page Header & Hero Section — hero text đơn giản trên nền gradient nhạt -->
    <PageHero>
      <!-- Breadcrumb navigation -->
      <nav aria-label="Đường dẫn trang" class="mb-4">
        <ol class="flex items-center gap-1.5 text-xs text-[#6B7967] m-0 p-0 list-none flex-wrap">
          <li class="flex items-center gap-1.5">
            <nuxt-link to="/" class="hover:text-[#385932] transition-colors flex items-center gap-1">
              <i class="fa-solid fa-house text-[0.7rem] text-[#4A6741]" aria-hidden="true"></i>
              <span>Trang chủ</span>
            </nuxt-link>
          </li>
          <li aria-hidden="true" class="text-[#A2B09F]">&rsaquo;</li>
          <li class="font-bold text-[#2A3B27] flex items-center gap-1">
            <span>Bản tin</span>
            <span v-if="activeCategory !== 'all' && activeCategoryName" class="font-normal text-[#6B7967]">
              &rsaquo; <span class="font-bold text-[#2A3B27]">{{ activeCategoryName }}</span>
            </span>
          </li>
        </ol>
      </nav>

      <div class="max-w-2xl">
        <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#E4EEE2] border border-[#D0DFCE] text-[#365730] text-[0.72rem] font-extrabold uppercase tracking-wider mb-2.5 shadow-sm">
          <span class="w-2 h-2 rounded-full bg-[#4A6741] animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
          <span>Cổng Thông Tin Điện Tử C11 &bull; Bộ Công An</span>
        </div>
        <h1 class="text-2xl sm:text-3xl lg:text-[2.2rem] font-black text-[#172516] tracking-tight leading-[1.2] m-0">
          {{ pageTitle }}
        </h1>
        <p class="text-[0.92rem] sm:text-base text-[#576653] mt-2 mb-0 leading-relaxed">
          Cập nhật thông tin chỉ đạo điều hành, hoạt động cơ sở và công tác hỗ trợ hoàn lương trên toàn quốc.
        </p>
      </div>
    </PageHero>

    <!-- Search + Category Pills — đẩy ra khỏi hero, nằm ngay đầu nội dung -->
    <section class="pt-6 lg:pt-8">
      <div class="container">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <!-- Search Box -->
          <div class="w-full lg:w-80 shrink-0">
            <form @submit.prevent="applySearch" class="relative flex items-center">
              <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7C8D78] pointer-events-none text-xs">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              </span>
              <input
                v-model="searchInput"
                type="text"
                placeholder="Tìm kiếm bản tin..."
                aria-label="Tìm kiếm bản tin"
                class="w-full pl-9 pr-20 py-2.5 bg-white rounded-xl border border-[#D5E1D3] text-sm text-[#1E251C] placeholder-[#8A9986] focus:border-[#4A6741] focus:ring-2 focus:ring-[#7CB342]/30 focus:outline-none transition-all shadow-sm"
              />
              <button
                v-if="searchInput"
                type="button"
                @click="clearSearchInput"
                class="absolute right-12 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[#97A593] hover:text-[#4A5545] text-xs transition-colors"
                title="Xóa chữ"
                aria-label="Xóa từ khóa tìm kiếm"
              >
                ✕
              </button>
              <button
                type="submit"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-[#4A6741] hover:bg-[#365130] text-white text-xs font-bold transition-all shadow-sm"
              >
                Tìm
              </button>
            </form>
          </div>

          <!-- Category Pills Filter Bar -->
          <nav aria-label="Lọc bản tin theo chuyên mục" class="flex-1 min-w-0">
            <!-- Skeleton chips — khi chuyển chuyên mục trên client -->
            <div v-if="catPending" role="status" aria-busy="true" class="flex gap-2 py-1">
              <span class="sr-only">Đang tải danh mục bản tin</span>
              <div
                v-for="n in 5"
                :key="n"
                aria-hidden="true"
                class="h-[34px] w-28 rounded-full bg-[#E2EBE0] animate-pulse motion-reduce:animate-none"
              ></div>
            </div>

            <template v-else>
              <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none flex-wrap">
                <button
                  type="button"
                  :aria-pressed="activeCategory === 'all'"
                  :class="pillClass(activeCategory === 'all')"
                  @click="setCategory('all')"
                >
                  <i class="fa-solid fa-layer-group text-xs" aria-hidden="true"></i>
                  <span>Tất cả bản tin</span>
                </button>
                <button
                  v-for="cat in rootCategories"
                  :key="cat.id"
                  type="button"
                  :aria-pressed="activeCategory === cat.slug"
                  :class="pillClass(activeCategory === cat.slug)"
                  @click="setCategory(cat.slug)"
                >
                  <i :class="categoryIcon(cat.slug)" aria-hidden="true"></i>
                  <span>{{ cat.name }}</span>
                </button>
              </div>

              <div v-if="activeChildren.length" class="flex items-center gap-2 overflow-x-auto pt-2.5 pb-1 sm:flex-wrap text-xs">
                <span class="text-[#7A8A76] font-semibold flex items-center gap-1 shrink-0">
                  <i class="fa-solid fa-turn-down text-[0.65rem] rotate-[-90deg]" aria-hidden="true"></i>
                  Chuyên đề:
                </span>
                <button
                  v-for="child in activeChildren"
                  :key="child.id"
                  type="button"
                  :aria-pressed="activeCategory === child.slug"
                  :class="subPillClass(activeCategory === child.slug)"
                  @click="setCategory(child.slug)"
                >
                  {{ child.name }}
                </button>
              </div>
            </template>
          </nav>
        </div>
      </div>
    </section>

    <!-- Main Content Section -->
    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px] lg:gap-8 xl:gap-10 lg:items-start">
        <!-- Main News Column (Left) -->
        <div class="flex flex-col gap-7 min-w-0">
          <!-- Mỏ neo cuộn trang khi phân trang hoặc lọc -->
          <div id="news-list-top" class="scroll-mt-[100px]"></div>

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
                Kết quả tìm kiếm cho: <strong>&laquo;{{ searchQuery }}&raquo;</strong>
                <span v-if="!pending" class="text-[#7A8A76] ml-1.5">({{ pagination.total }} bài viết)</span>
              </span>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D5E1D3] bg-[#F7FAF6] hover:bg-[#EBF3E8] text-xs font-bold text-[#4A6741] transition-all"
              @click="clearSearch"
            >
              <i class="fa-solid fa-xmark text-[0.7rem]" aria-hidden="true"></i>
              <span>Xóa bộ lọc</span>
            </button>
          </div>

          <!-- Loading State (Skeleton) -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
            <span class="sr-only">Đang tải danh sách bản tin</span>
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
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">Không thể tải danh sách bản tin</h3>
            <p class="text-sm text-[#667768] m-0 mb-4">Đã xảy ra lỗi khi kết nối dữ liệu. Vui lòng kiểm tra lại kết nối mạng.</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A6741] hover:bg-[#385130] text-white font-bold text-sm transition-all shadow-sm"
              @click="refresh()"
            >
              <i class="fa-solid fa-rotate-right text-xs" aria-hidden="true"></i>
              <span>Thử lại ngay</span>
            </button>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="newsList.length === 0"
            class="bg-white border-2 border-dashed border-[#DDE6DC] px-6 py-14 rounded-2xl text-center shadow-sm"
          >
            <div class="w-14 h-14 rounded-full bg-[#EEF4EC] text-[#4A6741] flex items-center justify-center mx-auto mb-3.5 text-xl">
              <i class="fa-regular fa-newspaper" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#233520] m-0 mb-1">Chưa có bản tin phù hợp</h3>
            <p class="text-sm text-[#6E7D6B] max-w-md mx-auto m-0 mb-5">
              Không tìm thấy bài viết nào theo tiêu chí lựa chọn hiện tại. Anh/Chị có thể thử từ khóa khác hoặc quay lại tất cả bản tin.
            </p>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4A6741] hover:bg-[#385130] text-white font-bold text-sm transition-all shadow-sm"
              @click="resetFilter"
            >
              <i class="fa-solid fa-arrow-rotate-left text-xs" aria-hidden="true"></i>
              <span>Xem tất cả bản tin</span>
            </button>
          </div>

          <!-- Content Render -->
          <template v-else>
            <!-- Featured / Lead Article: Kích thước chuẩn gọn gàng theo Image #1, không bị zoom vỡ ảnh -->
            <article
              v-if="featured"
              class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_4px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_30px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col lg:flex-row lg:items-stretch mb-6"
            >
              <nuxt-link
                :to="`/news/${featured.slug}`"
                class="block overflow-hidden lg:w-[42%] xl:w-[40%] shrink-0 relative bg-[#EBF1EA] no-underline"
              >
                <img
                  :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="featured.title"
                  class="w-full h-[220px] sm:h-[250px] lg:h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </nuxt-link>

              <div class="p-5 sm:p-6 lg:p-6 xl:p-7 flex flex-col justify-between flex-1 min-w-0 bg-white">
                <div>
                  <div class="flex items-center gap-2.5 mb-2.5 text-xs flex-wrap">
                    <span class="inline-block bg-[#689F38] text-white font-extrabold px-2.5 py-0.5 rounded text-[0.7rem] uppercase tracking-wider shadow-sm">
                      Nổi bật
                    </span>
                    <span
                      v-if="featured.categoryName"
                      class="text-[#4A5545] font-semibold text-[0.82rem]"
                    >
                      {{ featured.categoryName }}
                    </span>
                    <span class="text-[#889684] text-[0.8rem] font-medium">
                      {{ formatDate(featured) }}
                    </span>
                  </div>

                  <h2 class="text-[1.15rem] sm:text-[1.28rem] lg:text-[1.32rem] font-black leading-[1.35] mb-2 m-0 text-[#172516]">
                    <nuxt-link
                      :to="`/news/${featured.slug}`"
                      class="text-[#172516] no-underline transition-colors duration-200 hover:text-[#2D5A27]"
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
                    :to="`/news/${featured.slug}`"
                    class="inline-flex items-center gap-1.5 text-[#385932] hover:text-[#1B3617] font-bold text-[0.88rem] transition-all no-underline group/link"
                  >
                    <span>Đọc tiếp</span>
                    <i class="fa-solid fa-arrow-right text-[0.72rem] transition-transform duration-200 group-hover/link:translate-x-1" aria-hidden="true"></i>
                  </nuxt-link>
                </div>
              </div>
            </article>

            <!-- Section Title Divider -->
            <div v-if="rest.length" class="flex items-center justify-between pt-3 pb-3 border-b-2 border-[#E1EADF] mt-1 mb-5">
              <div class="flex items-center gap-2.5">
                <span class="w-2.5 h-6 rounded-sm bg-[#4A6741]" aria-hidden="true"></span>
                <h2 class="text-base sm:text-lg font-black text-[#1A2A17] tracking-tight uppercase m-0">
                  Danh sách bản tin
                </h2>
                <span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-[#EBF3E8] text-[#385932]">
                  {{ pagination.total }} tin
                </span>
              </div>
              <span v-if="pagination.totalPages > 1" class="text-xs text-[#7A8A76] font-medium hidden sm:inline">
                Trang {{ pagination.page }} / {{ pagination.totalPages }}
              </span>
            </div>

            <!-- Responsive 3-Column Magazine Grid -->
            <div v-if="rest.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <article
                v-for="item in rest"
                :key="item.id"
                class="group bg-white rounded-2xl overflow-hidden border border-[#E2E8DF] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_24px_rgba(74,103,65,0.12)] hover:border-[#7CB342] transition-all duration-300 flex flex-col hover:-translate-y-1 h-full"
              >
                <!-- Thumbnail: strictly 16:9 -->
                <nuxt-link :to="`/news/${item.slug}`" class="block relative w-full aspect-video overflow-hidden bg-[#EEF4EC] no-underline shrink-0">
                  <img
                    :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                    :alt="item.title"
                    class="w-full h-full aspect-video object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                </nuxt-link>

                <!-- Card Content: flex-1 flex-col justify-between -->
                <div class="p-4 sm:p-5 flex flex-col flex-1">
                  <div class="flex items-center gap-2 text-xs text-[#7A8A76] font-medium mb-2">
                    <span
                      v-if="item.categoryName"
                      class="inline-block bg-[#EEF4EC] text-[#3A6033] font-bold text-[0.68rem] px-2 py-0.5 rounded uppercase tracking-wider"
                    >
                      {{ item.categoryName }}
                    </span>
                    <span class="flex items-center gap-1 text-[#889684] text-[0.75rem]">
                      <i class="fa-regular fa-calendar-days text-[0.72rem]" aria-hidden="true"></i>
                      <span>{{ formatDate(item) }}</span>
                    </span>
                  </div>

                  <h3 class="text-[0.95rem] sm:text-[0.98rem] font-bold leading-snug text-[#172516] group-hover:text-[#2D5A27] transition-colors duration-200 line-clamp-2 min-h-[2.6rem] mb-2 m-0">
                    <nuxt-link :to="`/news/${item.slug}`" class="text-[#172516] hover:text-[#2D5A27] no-underline">
                      {{ item.title }}
                    </nuxt-link>
                  </h3>

                  <p v-if="item.excerpt" class="text-[0.84rem] text-[#556450] leading-relaxed line-clamp-2 mb-3 m-0">
                    {{ cleanExcerpt(item.excerpt) }}
                  </p>

                  <!-- Footer action pinned to bottom of card with mt-auto -->
                  <div class="mt-auto pt-3 border-t border-[#F0F5EE] flex items-center justify-between text-xs text-[#7A8A76]">
                    <nuxt-link
                      :to="`/news/${item.slug}`"
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
            <!-- Enhanced Pagination -->
            <nav
              v-if="pagination.totalPages > 1"
              aria-label="Phân trang bản tin"
              class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-[#DDE6DC]"
            >
              <div class="text-xs text-[#6F7F6C] font-medium order-2 sm:order-1">
                Hiển thị trang <strong>{{ pagination.page }}</strong> trên tổng số <strong>{{ pagination.totalPages }}</strong> trang
              </div>

              <div class="flex items-center gap-1.5 flex-wrap justify-center order-1 sm:order-2">
                <button
                  type="button"
                  class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all duration-200 hover:border-[#4A6741] hover:text-[#4A6741] hover:bg-[#F2F7F0] disabled:opacity-30 disabled:cursor-not-allowed"
                  :disabled="pagination.page <= 1"
                  @click="setPage(pagination.page - 1)"
                  aria-label="Trang trước"
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
                      pagination.page === p
                        ? 'bg-[#4A6741] text-white shadow-sm border border-[#4A6741]'
                        : 'bg-white border border-[#D5E1D3] text-[#4A5545] hover:border-[#4A6741] hover:text-[#4A6741] hover:bg-[#F2F7F0]'
                    ]"
                    @click="setPage(p)"
                  >{{ p }}</button>
                </template>

                <button
                  type="button"
                  class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#D5E1D3] bg-white text-[#4A5545] text-xs font-bold cursor-pointer transition-all duration-200 hover:border-[#4A6741] hover:text-[#4A6741] hover:bg-[#F2F7F0] disabled:opacity-30 disabled:cursor-not-allowed"
                  :disabled="pagination.page >= pagination.totalPages"
                  @click="setPage(pagination.page + 1)"
                  aria-label="Trang tiếp"
                >
                  <i class="fa-solid fa-chevron-right text-[0.7rem]" aria-hidden="true"></i>
                </button>
              </div>
            </nav>
          </template>
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
                    :to="`/news/${item.slug}`"
                    class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741] line-clamp-2"
                  >{{ item.title }}</nuxt-link>
                </h3>
              </li>
            </ul>

            <p v-else class="text-[0.85rem] text-[#7A8675] italic py-4 m-0">Chưa có dữ liệu lượt xem.</p>
          </div>

          <!-- Widget 2: Chuyên mục bản tin -->
          <div v-if="rootCategories.length" class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
            <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs shadow-sm">
                <i class="fa-solid fa-folder-open" aria-hidden="true"></i>
              </span>
              <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
                Chuyên mục
              </h2>
            </div>
            <div class="flex flex-col divide-y divide-[#F2F6F0]">
              <button
                type="button"
                class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
                :class="activeCategory === 'all' ? 'text-[#385932]' : 'text-[#4A5746] hover:text-[#385932]'"
                @click="setCategory('all')"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-layer-group text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
                  <span>Tất cả bản tin</span>
                </span>
                <i class="fa-solid fa-chevron-right text-[0.65rem] text-[#A0B09C]" aria-hidden="true"></i>
              </button>
              <button
                v-for="cat in rootCategories"
                :key="cat.id"
                type="button"
                class="flex items-center justify-between py-2.5 text-xs font-extrabold text-left transition-colors"
                :class="activeCategory === cat.slug ? 'text-[#385932]' : 'text-[#4A5746] hover:text-[#385932]'"
                @click="setCategory(cat.slug)"
              >
                <span class="flex items-center gap-2">
                  <i :class="categoryIcon(cat.slug)" class="text-[0.7rem] text-[#8CA088]" aria-hidden="true"></i>
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
              <span class="text-[0.7rem] font-black uppercase tracking-wider text-[#A8D59D]">Hỗ trợ 24/7</span>
            </div>
            <h3 class="text-[1.05rem] font-black m-0 mb-1.5 leading-snug">Đường Dây Nóng Tư Vấn</h3>
            <p class="text-xs leading-relaxed m-0 mb-4 text-white/80">
              Tư vấn pháp lý, thủ tục cư trú và việc làm tái hòa nhập cộng đồng cho người hoàn lương.
            </p>

            <a
              href="tel:0903480985"
              class="flex items-center justify-center gap-2.5 w-full bg-[#7CB342] hover:bg-[#689F38] text-white py-2.5 px-4 rounded-xl text-sm font-black no-underline transition-all shadow-md mb-2.5"
            >
              <i class="fa-solid fa-phone" aria-hidden="true"></i>
              <span>0903.480.985</span>
            </a>

            <nuxt-link
              to="/assistant"
              class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-2 px-3 rounded-xl no-underline transition-all border border-white/15"
            >
              <i class="fa-solid fa-robot text-[0.8rem]" aria-hidden="true"></i>
              <span>Hỏi Trợ Lý AI 24/7</span>
            </nuxt-link>
          </div>

          <!-- Widget 4: Tra cứu nhanh -->
          <div class="bg-white rounded-2xl border border-[#DDE6DC] shadow-sm p-5">
            <div class="flex items-center gap-2 pb-3 border-b border-[#EEF3ED] mb-3">
              <span class="w-7 h-7 rounded-lg bg-[#EBF3E8] text-[#4A6741] flex items-center justify-center text-xs shadow-sm">
                <i class="fa-solid fa-bookmark" aria-hidden="true"></i>
              </span>
              <h2 class="text-[0.92rem] font-black text-[#172516] uppercase tracking-wide m-0">
                Tiện ích tra cứu
              </h2>
            </div>
            <div class="flex flex-col gap-2 text-xs">
              <nuxt-link
                to="/documents"
                class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-scale-balanced text-[#4A6741]" aria-hidden="true"></i>
                  <span>Văn bản pháp luật</span>
                </span>
                <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
              </nuxt-link>
              <nuxt-link
                to="/legal-qa"
                class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-circle-question text-[#4A6741]" aria-hidden="true"></i>
                  <span>Hỏi đáp pháp luật</span>
                </span>
                <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
              </nuxt-link>
              <nuxt-link
                to="/role-models"
                class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-award text-[#4A6741]" aria-hidden="true"></i>
                  <span>Tấm gương hoàn lương</span>
                </span>
                <i class="fa-solid fa-arrow-right text-[0.65rem] text-[#8CA088]" aria-hidden="true"></i>
              </nuxt-link>
              <nuxt-link
                to="/reintegration-models"
                class="flex items-center justify-between p-2.5 rounded-xl bg-[#F7FAF6] hover:bg-[#EEF4EC] text-[#2C3E29] font-bold no-underline transition-all border border-[#E4EDE2]"
              >
                <span class="flex items-center gap-2">
                  <i class="fa-solid fa-people-group text-[#4A6741]" aria-hidden="true"></i>
                  <span>Mô hình tái hòa nhập</span>
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
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { formatDateVN } from '~/utils/formatDate'

useSeoMeta({
  title: 'Bản tin hoạt động | Con Đường Hướng Thiện',
  description: 'Tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương, tái hòa nhập cộng đồng trên toàn quốc.'
})

const route = useRoute()
const activeCategory = ref(route.query.cat ? String(route.query.cat) : 'all')
const searchQuery = ref(route.query.q ? String(route.query.q) : '')
const searchInput = ref(searchQuery.value)

const PER_PAGE = 19
const currentPage = ref(Math.max(1, Math.floor(Number(route.query.page) || 1)) || 1)

// Category chips — DB-driven via /api/public/categories?type=news
const { data: catData, pending: catPending } = useFetch('/api/public/categories', {
  query: { type: 'news' },
  lazy: true,
  default: () => ({ ok: true, items: [] })
})
const allCategories = computed(() => catData.value?.items || [])
const rootCategories = computed(() => allCategories.value.filter((c) => c.parentId === null))
const childrenOf = (parentId: number) => allCategories.value.filter((c) => c.parentId === parentId)

const activeRoot = computed(() => {
  if (activeCategory.value === 'all') return null
  const direct = allCategories.value.find((c) => c.slug === activeCategory.value)
  if (!direct) return null
  if (direct.parentId === null) return direct
  return allCategories.value.find((c) => c.id === direct.parentId) ?? null
})
const activeChildren = computed(() => (activeRoot.value ? childrenOf(activeRoot.value.id) : []))

const activeCategoryName = computed(() => {
  if (activeCategory.value === 'all') return ''
  return allCategories.value.find((c) => c.slug === activeCategory.value)?.name ?? ''
})

const pageTitle = computed(() => {
  if (activeCategory.value === 'all') return 'Bản tin hoạt động'
  return activeCategoryName.value || 'Bản tin hoạt động'
})

// Visual pill classes
const pillClass = (active: boolean) => [
  'inline-flex items-center gap-2 shrink-0 whitespace-nowrap rounded-full border cursor-pointer px-4 py-2 text-[0.82rem] font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]',
  active
    ? 'bg-[#4A6741] border-[#4A6741] text-white shadow-sm shadow-[#4A6741]/25'
    : 'bg-white border-[#D5E1D3] text-[#485645] hover:border-[#4A6741] hover:text-[#385932] hover:bg-[#F2F7F0]'
]

const subPillClass = (active: boolean) => [
  'shrink-0 whitespace-nowrap rounded-lg border cursor-pointer px-3 py-1 font-bold transition-all duration-200 text-xs',
  active
    ? 'bg-[#385932] border-[#385932] text-white shadow-sm'
    : 'bg-white border-[#DDE6DC] text-[#556350] hover:border-[#385932] hover:text-[#385932] hover:bg-[#F0F5EE]'
]

const categoryIcon = (slug: string) => {
  if (slug.includes('noi-bat') || slug.includes('tieu-diem')) return 'fa-solid fa-star text-xs'
  if (slug.includes('dia-phuong') || slug.includes('tinh')) return 'fa-solid fa-location-dot text-xs'
  return 'fa-solid fa-newspaper text-xs'
}

// Huy hiệu danh mục tự động khớp theo dữ liệu thực tế của từng bài viết (không bao giờ gán bừa "Tin nổi bật")
const categoryBadge = (item: { categorySlug?: string | null; categoryName?: string | null } | null | undefined) => {
  if (!item) return { label: 'Bản tin', bg: 'bg-[#4A6741]', icon: 'fa-solid fa-newspaper' }
  const slug = item.categorySlug || ''
  const label = item.categoryName || 'Bản tin'
  if (slug === 'tin-noi-bat') {
    return { label, bg: 'bg-[#C62828]', icon: 'fa-solid fa-star' }
  }
  if (slug === 'tin-dia-phuong') {
    return { label, bg: 'bg-[#1565C0]', icon: 'fa-solid fa-location-dot' }
  }
  if (slug === 'tin-hoat-dong') {
    return { label, bg: 'bg-[#2D5A27]', icon: 'fa-solid fa-newspaper' }
  }
  return { label, bg: 'bg-[#4A6741]', icon: 'fa-solid fa-tag' }
}

// Khử thẻ HTML và giải mã toàn bộ thực thể HTML tiếng Việt (ngăn lỗi Ng&agrave;y, C&ocirc;ng an...)
const cleanExcerpt = (html: string | null | undefined): string => {
  if (!html) return ''
  let text = String(html).replace(/<[^>]*>/g, ' ')
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  const map: Record<string, string> = {
    '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
    '&Agrave;': 'À', '&Aacute;': 'Á', '&Acirc;': 'Â', '&Atilde;': 'Ã',
    '&Egrave;': 'È', '&Eacute;': 'É', '&Ecirc;': 'Ê',
    '&Igrave;': 'Ì', '&Iacute;': 'Í',
    '&Ograve;': 'Ò', '&Oacute;': 'Ó', '&Ocirc;': 'Ô', '&Otilde;': 'Õ',
    '&Ugrave;': 'Ù', '&Uacute;': 'Ú',
    '&Yacute;': 'Ý',
    '&agrave;': 'à', '&aacute;': 'á', '&acirc;': 'â', '&atilde;': 'ã',
    '&egrave;': 'è', '&eacute;': 'é', '&ecirc;': 'ê',
    '&igrave;': 'ì', '&iacute;': 'í',
    '&ograve;': 'ò', '&oacute;': 'ó', '&ocirc;': 'ô', '&otilde;': 'õ',
    '&ugrave;': 'ù', '&uacute;': 'ú',
    '&yacute;': 'ý', '&yuml;': 'ÿ'
  }
  text = text.replace(/&[a-zA-Z]+;/g, (m) => map[m] || m)
  return text.replace(/\s+/g, ' ').trim()
}

// Article list query
const articlesQuery = computed(() => {
  const q: { type: string; limit: number; page: number; categorySlug?: string; search?: string } =
    { type: 'news', limit: PER_PAGE, page: currentPage.value }
  if (activeCategory.value !== 'all') q.categorySlug = activeCategory.value
  if (searchQuery.value) q.search = searchQuery.value
  return q
})

const { data: articlesData, pending, error, refresh } = useFetch('/api/public/articles', {
  query: articlesQuery,
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: { page: 1, limit: PER_PAGE, total: 0, totalPages: 1 } })
})
const newsList = computed(() => articlesData.value?.articles || [])
const loadError = computed(() => !!error.value || articlesData.value?.ok === false)
const pagination = computed(() => articlesData.value?.pagination || { page: 1, limit: PER_PAGE, total: 0, totalPages: 1 })

// Most Read
const { data: mostReadData, pending: mostReadPending } = useFetch('/api/public/articles', {
  query: { type: 'news', limit: 6, sort: 'views' },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const mostRead = computed(() => mostReadData.value?.articles || [])

// Featured & Rest — chỉ hiện bài tiêu điểm ở Trang 1 khi không tìm kiếm
const isLeadPage = computed(() => currentPage.value === 1 && !searchQuery.value)
const featured = computed(() => (isLeadPage.value ? newsList.value[0] ?? null : null))
const rest = computed(() => (isLeadPage.value ? newsList.value.slice(1) : newsList.value))
const formatDate = (item: { publishedAt?: string | null; createdAt?: string | null }) =>
  formatDateVN(item.publishedAt || item.createdAt)

const syncUrl = () => {
  const query: { cat?: string; q?: string; page?: number } = {}
  if (activeCategory.value !== 'all') query.cat = activeCategory.value
  if (searchQuery.value) query.q = searchQuery.value
  if (currentPage.value > 1) query.page = currentPage.value
  navigateTo({ path: '/news', query })
}

const setCategory = (cat: string) => {
  activeCategory.value = cat
  currentPage.value = 1
  syncUrl()
}

const applySearch = () => {
  searchQuery.value = searchInput.value.trim()
  currentPage.value = 1
  syncUrl()
}

const clearSearchInput = () => {
  searchInput.value = ''
  if (searchQuery.value) {
    clearSearch()
  }
}

const clearSearch = () => {
  searchQuery.value = ''
  searchInput.value = ''
  currentPage.value = 1
  syncUrl()
}

const resetFilter = () => {
  activeCategory.value = 'all'
  searchQuery.value = ''
  searchInput.value = ''
  currentPage.value = 1
  syncUrl()
}

const setPage = (page: number) => {
  if (page < 1 || page > pagination.value.totalPages) return
  currentPage.value = page
  syncUrl()
  if (import.meta.client) {
    const el = document.getElementById('news-list-top')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const pageRange = computed(() => {
  const total = pagination.value.totalPages
  const cur = pagination.value.page
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, cur, cur - 1, cur + 1])
  for (const p of pages) if (p < 1 || p > total) pages.delete(p)
  return [...pages].sort((a, b) => a - b)
})
</script>
