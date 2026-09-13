<template>
  <div class="bg-[#F8FAF7]">
    <!-- Page header — gọn nhẹ trên nền sáng, không khối hero xanh gây lướt giật.
         Chips danh mục nằm ngay dưới tiêu đề: đây là phần điều hướng chính của
         trang, nên phải ở vị trí đầu tiên mắt người đọc chạm tới, không bị ảnh
         hero lấn át. Danh mục con của mục đang chọn hiện thành hàng chips thứ
         hai, nhỏ hơn. -->
    <section class="border-b border-[#E2E8DF] bg-white">
      <div class="container pt-7 sm:pt-9 pb-5">
        <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.2px] text-[#7CB342] m-0 mb-1">Bản tin</p>
        <h1 class="text-[1.65rem] sm:text-[2.05rem] font-extrabold text-[#1E251C] leading-[1.2] m-0">{{ pageTitle }}</h1>
        <p class="text-[0.95rem] text-[#5A6655] mt-2 mb-5">Cập nhật tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương trên toàn quốc</p>

        <nav aria-label="Lọc bản tin theo chuyên mục">
          <!-- Skeleton chips — chỉ thấy khi điều hướng client (SSR vẫn chờ dữ liệu) -->
          <div v-if="catPending" role="status" aria-busy="true" class="flex gap-2">
            <span class="sr-only">Đang tải danh mục bản tin</span>
            <div
              v-for="n in 6"
              :key="n"
              aria-hidden="true"
              class="h-[30px] w-24 rounded-full bg-[#EEF2EC] animate-pulse motion-reduce:animate-none"
            ></div>
          </div>

          <template v-else>
            <div class="flex items-center gap-2 overflow-x-auto sm:flex-wrap -mx-6 px-6 sm:mx-0 sm:px-0">
              <button
                type="button"
                :aria-pressed="activeCategory === 'all'"
                :class="chipClass(activeCategory === 'all')"
                @click="setCategory('all')"
              >Tất cả bản tin</button>
              <button
                v-for="cat in rootCategories"
                :key="cat.id"
                type="button"
                :aria-pressed="activeCategory === cat.slug"
                :class="chipClass(activeCategory === cat.slug)"
                @click="setCategory(cat.slug)"
              >{{ cat.name }}</button>
            </div>
            <div v-if="activeChildren.length" class="flex items-center gap-2 overflow-x-auto sm:flex-wrap pt-3 -mx-6 px-6 sm:mx-0 sm:px-0">
              <button
                v-for="child in activeChildren"
                :key="child.id"
                type="button"
                :aria-pressed="activeCategory === child.slug"
                :class="chipClass(activeCategory === child.slug, true)"
                @click="setCategory(child.slug)"
              >{{ child.name }}</button>
            </div>
          </template>
        </nav>
      </div>
    </section>

    <!-- Main Content Grid -->
    <section class="py-8 lg:py-10">
      <!-- `minmax(0,1fr)` chứ không `1fr`: một tiêu đề dài không có chỗ ngắt sẽ đẩy
           cột tin rộng hơn khung chứa nó và làm CẢ TRANG cuộn ngang được — `1fr` có
           sàn là `auto`, tức là kích thước nội dung tối thiểu. Cột phải 320px khớp
           cột phải của trang chi tiết bài viết, nên hai trang cùng một nhịp lưới. -->
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-[34px] lg:items-start">
        <!-- News Column -->
        <div class="flex flex-col gap-6 min-w-0">
          <!-- Mỏ neo cho "đổi trang cuộn lên đầu danh sách" — `setPage` cuộn tới đây. -->
          <div id="news-list-top" class="scroll-mt-[100px]"></div>
          <!-- Search result banner -->
          <div
            v-if="searchQuery"
            class="bg-[#F8FAF7] border border-[#E2E8DF] border-l-4 border-l-[#7CB342] px-[18px] py-[14px] rounded text-[0.92rem] text-[#4A5545] flex items-center justify-between gap-3 flex-wrap"
          >
            Kết quả tìm kiếm cho từ khóa: <strong>&laquo;{{ searchQuery }}&raquo;</strong>
            <button
              class="bg-transparent border border-[#E2E8DF] rounded-[20px] px-3 py-[5px] text-[0.8rem] font-bold text-[#4A5545] cursor-pointer transition-all duration-300 hover:bg-[#4A6741] hover:border-[#4A6741] hover:text-white"
              @click="clearSearch"
            >✕ Bỏ tìm kiếm</button>
          </div>

          <!-- Loading state — hình dạng khớp bố cục thật: một tin chủ đạo (ảnh trái +
               nội dung phải), rồi lưới thẻ bên dưới. Cột phải "Đọc nhiều" có
               skeleton riêng của nó trong aside. -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-8">
            <span class="sr-only">Đang tải bản tin hoạt động</span>
            <div aria-hidden="true" class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col sm:flex-row animate-pulse motion-reduce:animate-none">
              <div class="sm:w-[44%] shrink-0 h-[220px] sm:h-[260px] bg-[#EEF2EC]"></div>
              <div class="p-5 sm:p-6 flex flex-col gap-3 sm:w-[56%]">
                <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
                <div class="h-5 w-4/5 bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
              </div>
            </div>
            <div aria-hidden="true" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <div v-for="n in 4" :key="n" class="bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm animate-pulse motion-reduce:animate-none">
                <div class="aspect-video bg-[#EEF2EC]"></div>
                <div class="p-4 flex flex-col gap-3">
                  <div class="h-3 w-24 bg-[#EEF2EC] rounded"></div>
                  <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
                  <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Error state -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border border-dashed border-[#E2A0A0] px-6 py-10 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
          >
            <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            Không thể tải bản tin. Vui lòng
            <button type="button" class="text-[#4A6741] font-bold underline" @click="refresh()">thử lại</button>.
          </div>

          <!-- Empty state -->
          <div
            v-else-if="newsList.length === 0"
            class="bg-white border border-dashed border-[#E2E8DF] px-6 py-10 rounded-lg text-center text-[#7A8675] text-[0.95rem]"
          >
            Không tìm thấy bản tin phù hợp. Vui lòng thử từ khóa khác hoặc xem
            <button type="button" class="text-[#4A6741] font-bold underline" @click="setCategory('all')">tất cả bản tin</button>.
          </div>

          <template v-else>
            <!-- Tin chủ đạo: bài lớn dùng bố cục editorial — ảnh trái, nội dung
                 phải trên nền trắng — thay vì chữ trắng chèn trên gradient tối.
                 Cùng hình dạng mà `NewsBlock.vue` ở trang chủ đã dùng. Từng có cột
                 "Tin tiếp theo" bên cạnh nhưng đã xoá: nhịp quét tiêu đề bị trùng lặp
                 với cả lưới "Các bản tin khác" bên dưới, và cột phải "Đọc nhiều" đã
                 đảm nhiệm việc liệt kê tin kế tiếp. -->
            <article v-if="featured" class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col sm:flex-row transition-all duration-300 hover:shadow-md hover:border-[#7CB342]">
              <nuxt-link :to="`/news/${featured.slug}`" class="block overflow-hidden sm:w-[44%] shrink-0 no-underline">
                <img
                  :src="featured.thumbnailUrl || '/assets/hero_banner.jpg'"
                  :alt="featured.title"
                  class="w-full h-[220px] sm:h-full object-cover transition-transform duration-[0.6s] ease-[cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-[1.04]"
                  loading="lazy"
                  decoding="async"
                />
              </nuxt-link>
              <div class="p-5 sm:p-6 flex flex-col justify-center sm:w-[56%] min-w-0">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
                  <span class="inline-block bg-[#7CB342] text-white px-2 py-[3px] text-[0.65rem] font-extrabold rounded-sm uppercase tracking-[0.4px]">Tin nổi bật</span>
                  <span v-if="featured.categoryName" class="text-[0.74rem] font-semibold text-[#4A6741]">{{ featured.categoryName }}</span>
                  <span class="text-[0.74rem] text-[#7A8675]">{{ formatDate(featured) }}</span>
                </div>
                <h2 class="text-[1.25rem] sm:text-[1.5rem] font-extrabold leading-[1.3] mb-3 m-0">
                  <nuxt-link
                    :to="`/news/${featured.slug}`"
                    class="text-[#1E251C] no-underline transition-colors duration-300 hover:text-[#4A6741]"
                  >{{ featured.title }}</nuxt-link>
                </h2>
                <p v-if="featured.excerpt" class="text-[0.9rem] text-[#4A5545] leading-[1.6] m-0 line-clamp-3">{{ featured.excerpt }}</p>
                <nuxt-link
                  :to="`/news/${featured.slug}`"
                  class="inline-flex items-center gap-1.5 mt-4 text-[0.84rem] font-bold text-[#4A6741] no-underline transition-colors duration-300 hover:text-[#385130] w-fit"
                >Đọc tiếp <i class="fa-solid fa-arrow-right text-[0.72rem]" aria-hidden="true"></i></nuxt-link>
              </div>
            </article>

            <!-- Lưới tin còn lại — bốn bài trở đi xếp lưới (đường 2→3→4 cột), tham chiếu
                 bố cục danh mục của cand.vn: ảnh tỉ lệ 16:9 phía trên, tiêu đề,
                 thời gian, mô tả ngắn phía dưới. `minmax(0,1fr)` (không phải `1fr`
                 trần) giữ tiêu đề dài không đẩy CẢ TRANG cuộn ngang. -->
            <template v-if="rest.length">
              <h2 class="text-[0.85rem] font-extrabold text-[#4A6741] uppercase tracking-[0.6px] border-b-2 border-[#7CB342] pb-2 m-0">Các bản tin khác</h2>
              <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <article
                  v-for="item in rest"
                  :key="item.id"
                  class="group bg-white rounded-lg overflow-hidden border border-[#E2E8DF] shadow-sm flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:border-[#7CB342]"
                >
                  <nuxt-link :to="`/news/${item.slug}`" class="block overflow-hidden">
                    <img
                      :src="item.thumbnailUrl || '/assets/hero_banner.jpg'"
                      :alt="item.title"
                      class="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      loading="lazy"
                      decoding="async"
                    />
                  </nuxt-link>
                  <div class="p-4 flex flex-col gap-2 flex-1">
                    <span v-if="item.categoryName" class="inline-block self-start bg-[#EDF3EA] text-[#4A6741] text-[0.68rem] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-sm">{{ item.categoryName }}</span>
                    <span class="text-[0.75rem] text-[#7A8675] font-semibold">{{ formatDate(item) }}</span>
                    <h3 class="text-[0.95rem] font-bold leading-[1.4] m-0">
                      <nuxt-link
                        :to="`/news/${item.slug}`"
                        class="no-underline text-[#1E251C] transition-colors duration-300 hover:text-[#4A6741]"
                      >{{ item.title }}</nuxt-link>
                    </h3>
                    <p v-if="item.excerpt" class="text-[0.85rem] text-[#4A5545] leading-[1.55] m-0 line-clamp-2">{{ item.excerpt }}</p>
                  </div>
                </article>
              </div>
            </template>

            <!-- Phân trang — chỉ hiện khi thực sự có nhiều hơn 1 trang. 1,085 bài
                 news / 20 mỗi trang = ~55 trang, nên đây là điều kiện tiên quyết để
                 khách tới được bài cũ. Dải số trang dùng `pageRange` (đầu/cuối + ±2)
                 với dấu "…" giữa các khoảng trống. -->
            <nav
              v-if="pagination.totalPages > 1"
              :aria-label="'Phân trang bản tin'"
              class="flex items-center justify-center gap-2 mt-8 flex-wrap"
            >
              <button
                type="button"
                class="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#E2E8DF] text-[#4A5545] text-[0.82rem] font-bold cursor-pointer transition-all duration-300 hover:border-[#7CB342] hover:text-[#4A6741] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E2E8DF] disabled:hover:text-[#4A5545]"
                :disabled="pagination.page <= 1"
                @click="setPage(pagination.page - 1)"
                aria-label="Trang trước"
              >&larr;</button>

              <template v-for="(p, i) in pageRange" :key="p">
                <!-- Dấu "…" giữa 1 và dải giữa, hoặc giữa dải giữa và cuối. `i > 0`
                     để tránh "…" ngay sau 1 khi dải bắt đầu từ 2. -->
                <span
                  v-if="i > 0 && p - (pageRange[i - 1] ?? p) > 1"
                  class="text-[#7A8675] text-[0.85rem] px-1 select-none"
                  aria-hidden="true"
                >&hellip;</span>
                <button
                  type="button"
                  :aria-current="pagination.page === p ? 'page' : undefined"
                  :class="[
                    'inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-md text-[0.82rem] font-bold cursor-pointer transition-all duration-300',
                    pagination.page === p
                      ? 'bg-[#7CB342] text-white border border-[#7CB342]'
                      : 'border border-[#E2E8DF] text-[#4A5545] hover:border-[#7CB342] hover:text-[#4A6741]'
                  ]"
                  @click="setPage(p)"
                >{{ p }}</button>
              </template>

              <button
                type="button"
                class="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#E2E8DF] text-[#4A5545] text-[0.82rem] font-bold cursor-pointer transition-all duration-300 hover:border-[#7CB342] hover:text-[#4A6741] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#E2E8DF] disabled:hover:text-[#4A5545]"
                :disabled="pagination.page >= pagination.totalPages"
                @click="setPage(pagination.page + 1)"
                aria-label="Trang tiếp"
              >&rarr;</button>
            </nav>
          </template>
        </div>

        <!-- Right Rail — kiểu cand.vn: "Đọc nhiều" đánh số + banner hỗ trợ.
             `lg:items-start` ở lưới cha là điều kiện tiên quyết của `lg:sticky`:
             mặc định `stretch` kéo ô cao bằng cả cột tin, và sticky trong một ô cao
             bằng cả vùng cuộn thì không bao giờ dính. -->
        <aside class="flex flex-col gap-6 min-w-0 lg:sticky lg:top-[100px]">
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

          <!-- Banner hotline — cùng hình dạng banner bên phải của `NewsBlock.vue`
               ở trang chủ, nên hai trang nói cùng một điều về nơi được hỗ trợ. -->
          <div class="relative rounded-lg overflow-hidden shadow-sm text-white bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover">
            <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]" aria-hidden="true"></div>
            <div class="relative p-6">
              <h3 class="text-[1rem] font-extrabold uppercase m-0 mb-2">Hotline hỗ trợ</h3>
              <p class="text-[0.78rem] leading-[1.5] m-0 mb-4 opacity-90">Tư vấn thủ tục và hỗ trợ người hoàn lương — mọi lúc, mọi nơi.</p>
              <a
                href="tel:0903480985"
                class="inline-flex items-center gap-2 bg-[#7CB342] text-white px-[14px] py-[6px] text-[0.9rem] font-extrabold rounded no-underline transition-colors duration-300 hover:bg-[#689F38]"
              ><i class="fa-solid fa-phone" aria-hidden="true"></i>0903.480.985</a>
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
// Số trang đọc từ URL — chia sẻ được, F5 không mất. `page=abc`/`page=0` lùi về 1
// qua `finitePositive` phía server; client chỉ hiển thị trang hợp lệ.
const PER_PAGE = 20
const currentPage = ref(Math.max(1, Math.floor(Number(route.query.page) || 1)) || 1)

// Category chips — DB-driven via /api/public/categories?type=news
// Không `await` ở lượt nào: trang này có BA lượt fetch độc lập với nhau (danh mục,
// danh sách bài, tin đọc nhiều), nên `await` chỉ có tác dụng bắt ba lượt xếp hàng
// đợi nhau. Bỏ đi thì cả ba khởi động cùng lúc, thời gian chờ là lượt chậm hơn
// chứ không phải tổng ba lượt.
const { data: catData, pending: catPending } = useFetch('/api/public/categories', {
  query: { type: 'news' },
  lazy: true,
  default: () => ({ ok: true, items: [] })
})
const allCategories = computed(() => catData.value?.items || [])
const rootCategories = computed(() => allCategories.value.filter((c) => c.parentId === null))
const childrenOf = (parentId: number) => allCategories.value.filter((c) => c.parentId === parentId)

// Mục đang chọn: trả về chính nó nếu là danh mục gốc, hoặc cha của nó nếu là mục
// con — để hàng chips thứ hai luôn là các mục con CÙA một gốc, bất kể người dùng
// đang đứng ở gốc hay ở con.
const activeRoot = computed(() => {
  if (activeCategory.value === 'all') return null
  const direct = allCategories.value.find((c) => c.slug === activeCategory.value)
  if (!direct) return null
  if (direct.parentId === null) return direct
  return allCategories.value.find((c) => c.id === direct.parentId) ?? null
})
const activeChildren = computed(() => (activeRoot.value ? childrenOf(activeRoot.value.id) : []))

// Tiêu đề trang đổi theo chuyên mục đang chọn — cùng hành vi trang chuyên đề
// cand.vn. Slug lạ (liên kết cũ, gõ tay) lùi về tiêu đề mặc định thay vì hiện trống.
const pageTitle = computed(() => {
  if (activeCategory.value === 'all') return 'Bản tin hoạt động'
  return allCategories.value.find((c) => c.slug === activeCategory.value)?.name ?? 'Bản tin hoạt động'
})

// Chip class dùng chuỗi literal thay vì nội suy `bg-${color}`: Tailwind v3 quét
// VĂN BẢN mã nguồn lúc build, một class nội suy sẽ không bao giờ được sinh CSS.
// Chips nằm trên header nền sáng nên inactive dùng viền xám + chữ đậm; active
// nền accent xanh lá để nổi mà không cần báo hiệu quá gắt.
const chipClass = (active: boolean, small = false) => [
  'shrink-0 whitespace-nowrap rounded-full border cursor-pointer transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]',
  small ? 'px-3 py-[5px] text-[0.78rem] font-semibold' : 'px-4 py-[7px] text-[0.82rem] font-semibold',
  active
    ? 'bg-[#7CB342] border-[#7CB342] text-white'
    : 'bg-white border-[#E2E8DF] text-[#4A5545] hover:border-[#7CB342] hover:text-[#4A6741] hover:bg-[#EDF3EA]',
]

// Article list — DB-driven, refetches reactively when category/search/page change
const articlesQuery = computed(() => {
  // Khai tường minh: object literal suy ra `{type,limit}` nên hai phép gán bên
  // dưới không biên dịch được. Tuỳ chọn để khoá được bỏ hẳn khi không dùng.
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

// "Đọc nhiều" — xếp theo tổng lượt xem hiển thị (thật + ảo) qua `sort=views`.
// Cố ý KHÔNG lọc theo `?cat=`: khối này trả lời "cổng đang đọc gì", không phải
// "chuyên mục này đang đọc gì" — và giữ query tĩnh thì bấm chips không kích thêm
// một lượt fetch nào, cột phải đứng yên trong khi danh sách chính tải lại.
const { data: mostReadData, pending: mostReadPending } = useFetch('/api/public/articles', {
  query: { type: 'news', limit: 6, sort: 'views' },
  lazy: true,
  default: () => ({ ok: true, articles: [], pagination: {} })
})
const mostRead = computed(() => mostReadData.value?.articles || [])

// Hai khu của bố cục tin, cắt từ MỘT danh sách đã tải. Cố ý không gọi thêm lượt
// fetch nào: `/api/public/articles` đã sắp theo `publishedAt` giảm dần, nên "tin
// chủ đạo" là tin mới nhất — một truy vấn thứ hai cho cùng dữ liệu là một lượt đi
// mạng nữa và một cơ hội để hai khu nói hai điều khác nhau. Từng có ba khu (tin
// chủ đạo + cột "Tin tiếp theo" + lưới còn lại); cột "Tin tiếp theo" đã xoá nên
// bốn tin kế tiếp gộp vào lưới "Các bản tin khác" bên dưới.
const featured = computed(() => newsList.value[0] ?? null)
const rest = computed(() => newsList.value.slice(1))

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
  // Đổi chuyên mục = đổi tập bài, nên phải về trang 1 — trang 5 của chuyên mục
  // A không nhất quyết là trang 5 của chuyên mục B.
  currentPage.value = 1
  syncUrl()
}

const clearSearch = () => {
  searchQuery.value = ''
  currentPage.value = 1
  syncUrl()
}

// Đổi trang: cuộn lên đầu danh sách rồi cập nhật URL. Không gọi navigateTo cấp
// trang vì cột phải "Đọc nhiều" phải đứng yên — `navigateTo` giữ query còn
// `pageToTop` cuộn mượt.
const setPage = (page: number) => {
  if (page < 1 || page > pagination.value.totalPages) return
  currentPage.value = page
  syncUrl()
  // Cuộn lên đầu khối tin — `featured` là mỏ neo gần nhất.
  if (import.meta.client) {
    const el = document.getElementById('news-list-top')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

// Dải số trang hiển thị trên thanh phân trang — giới hạn ±2 quanh trang hiện
// tại + luôn có đầu/cuối, tránh thanh dài 55 nút khi DB có 1,085 bài.
const pageRange = computed(() => {
  const total = pagination.value.totalPages
  const cur = pagination.value.page
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, cur, cur - 1, cur + 1])
  for (const p of pages) if (p < 1 || p > total) pages.delete(p)
  return [...pages].sort((a, b) => a - b)
})
</script>
