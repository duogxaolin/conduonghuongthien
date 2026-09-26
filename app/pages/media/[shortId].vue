<!--
  Trang chi tiết một video, theo slug.

  ## Ràng buộc bao trùm: tuyến này chạy `swr: 60`

  `nuxt.config.ts` phục vụ `/media` và `/media/**` qua `swr: 60` (task 14.1). Nghĩa
  là HTML dựng phía máy chủ được **phát lại cho người kế tiếp** ghé vào trong cùng
  cửa sổ 60 giây. Hệ quả trực tiếp, và đây là lý do tệp này được viết theo cách nó
  được viết:

  • **Luồng bình luận KHÔNG được dựng phía máy chủ.** `ArticleComments` đã tự nạp
    sau mount (nó không nằm trong `routeRules` và không dùng `useFetch` trần), nên
    chỉ cần không đưa nó vào một nhánh SSR nào — nó tự lo phần đó.

  • **Lượt đếm xem đi từ trình duyệt, không từ SSR.** Cùng lý do: người đọc thứ
    hai trở đi trong cửa sổ 60 giây **không chạm vào mã máy chủ nào**, nên đếm
    phía máy chủ sẽ thiếu đúng bằng phần mà bộ nhớ đệm đang phát huy tác dụng.

  • **`useFetch` ở đây là hợp lệ** vì nó chỉ đọc **nội dung công khai** của video —
    tiêu đề, mô tả, đường dẫn phát. Không có danh tính người đọc nào trong đó, nên
    phát lại cho người kế tiếp là đúng chứ không phải rò rỉ. Đây là ranh giới phải
    giữ: thêm một trường phụ thuộc người đọc vào lượt fetch này là biến bộ nhớ đệm
    thành lỗi.

  ## Vì sao `lazy: true`

  Cùng lý do như `ArticleDetail.vue`: `lazy` chỉ bỏ chặn điều hướng **phía client**
  — lượt dựng phía máy chủ vẫn chờ dữ liệu, nên HTML đầu tiên và thẻ SEO không đổi.
  Không có nó thì bấm từ danh sách sang chi tiết trông như bấm hụt cho tới khi
  video về, và khung xương bên dưới **không bao giờ được vẽ**.
-->
<template>
  <div class="bg-[#F8FAF7]">
    <section class="border-b border-[#E2E8DF] bg-white">
      <div class="container pt-7 sm:pt-9 pb-5">
        <nav :aria-label="t('breadcrumb_aria')" class="flex items-center gap-2 text-xs text-[#7A8A76] mb-3">
          <nuxt-link to="/" class="hover:text-[#4A6741] transition-colors flex items-center gap-1.5 no-underline text-[#556450]">
            <i class="fa-solid fa-house text-[0.7rem]" aria-hidden="true"></i>
            <span>{{ t('home') }}</span>
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <nuxt-link to="/media" class="hover:text-[#4A6741] transition-colors no-underline text-[#556450]">
            {{ t('m_video_library') }}
          </nuxt-link>
          <span class="text-[#BAC8B6]">&rsaquo;</span>
          <span class="text-[#2D5A27] font-bold">{{ t('m_detail_breadcrumb') }}</span>
        </nav>
      </div>
    </section>

    <section class="py-8 lg:py-10">
      <div class="container grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 items-start">
        <div class="flex flex-col gap-6 min-w-0">
          <!-- 1. Đang tải -->
          <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-4">
            <span class="sr-only">{{ t('m_detail_loading') }}</span>
            <div aria-hidden="true" class="w-full aspect-video bg-[#EEF2EC] rounded-xl animate-pulse motion-reduce:animate-none"></div>
            <div aria-hidden="true" class="flex flex-col gap-2.5 animate-pulse motion-reduce:animate-none">
              <div class="h-5 w-3/4 bg-[#EEF2EC] rounded"></div>
              <div class="h-3.5 w-40 bg-[#EEF2EC] rounded"></div>
              <div class="h-3.5 w-full bg-[#EEF2EC] rounded"></div>
              <div class="h-3.5 w-2/3 bg-[#EEF2EC] rounded"></div>
            </div>
          </div>

          <!-- 2. Lỗi. Nút thử lại gọi lại chính lượt fetch đã hỏng, không tải lại
               trang: không có gì khác trên trang này để mất, nhưng một cú tải lại
               trang là mất luôn bộ đệm trình duyệt cho mọi tài nguyên đã tải. -->
          <div
            v-else-if="loadError"
            role="alert"
            class="bg-white border-2 border-dashed border-[#F0B8B8] px-6 py-12 rounded-2xl text-center shadow-sm"
          >
            <div class="w-12 h-12 rounded-full bg-[#FCE8E8] text-[#C62828] flex items-center justify-center mx-auto mb-3 text-lg">
              <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#992222] m-0 mb-1">{{ t('m_detail_error_title') }}</h3>
            <p class="text-sm text-[#667768] m-0 mb-4">{{ t('m_detail_error_desc') }}</p>
            <button
              type="button"
              class="bg-[#4A6741] hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all border-none inline-flex items-center gap-2"
              @click="reload"
            >
              <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
              <span>{{ t('m_retry') }}</span>
            </button>
          </div>

          <!-- 3. Không tìm thấy. Không có nút thử lại: một slug không tồn tại sẽ
               không tồn tại ở lần thử sau, và mời thử lại là mời một việc vô ích. -->
          <div v-else-if="!item" class="bg-white border border-[#E2E8DF] rounded-2xl px-6 py-14 text-center shadow-sm">
            <div class="w-14 h-14 rounded-full bg-[#EEF4EC] text-[#4A6741] flex items-center justify-center mx-auto mb-4 text-xl">
              <i class="fa-solid fa-video-slash" aria-hidden="true"></i>
            </div>
            <h3 class="text-base font-extrabold text-[#1E251C] m-0 mb-1">{{ t('m_not_found_title') }}</h3>
            <p class="text-sm text-[#5A6655] m-0 mb-5">{{ t('m_not_found_desc') }}</p>
            <nuxt-link
              to="/media"
              class="inline-flex items-center gap-2 bg-[#4A6741] hover:bg-[#385132] text-white px-6 py-2.5 rounded-lg text-xs font-extrabold no-underline transition-all"
            >
              <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
              <span>{{ t('m_back_to_library') }}</span>
            </nuxt-link>
          </div>

          <!-- 4. Video -->
          <template v-else>
            <MediaPlayer :item="item" />

            <div class="bg-white border border-[#E2E8DF] rounded-2xl p-5 sm:p-6 shadow-sm">
              <div class="flex flex-wrap items-center gap-2 mb-3">
                <span
                  v-if="item.categoryName"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EBF3E8] text-[#385932] text-[0.72rem] font-extrabold uppercase tracking-wide"
                >
                  <i class="fa-solid fa-tag text-[0.65rem]" aria-hidden="true"></i>
                  {{ item.categoryName }}
                </span>
                <!--
                  Nhãn "Nguồn ngoài" dùng icon họ `solid`, **không** logo thương hiệu
                  của nền tảng.

                  `ICON_FAMILIES` trong `nuxt.config.ts` chỉ nạp `solid` + `regular`, và
                  đó là chủ đích: mỗi họ thêm vào là một tệp CSS cộng một webfont mà
                  **mọi trang** của cổng phải tải. Một logo thương hiệu ở đây đổi lấy
                  20KB CSS + một woff2 trên toàn cổng, cho một huy hiệu trang trí trên
                  một trang. `tests/asset-pipeline.test.ts` chặn đúng việc đó, và nó
                  đúng: thứ cần nói là "nguồn ngoài", không phải tên nền tảng.
                -->
                <span
                  v-if="item.source === 'youtube'"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FDECEC] text-[#B03A3A] text-[0.72rem] font-extrabold uppercase tracking-wide"
                >
                  <i class="fa-solid fa-arrow-up-right-from-square text-[0.65rem]" aria-hidden="true"></i>
                  {{ t('m_external_source') }}
                </span>
              </div>

              <h1 class="text-[1.35rem] sm:text-[1.6rem] font-extrabold text-[#1E251C] leading-[1.3] m-0">
                {{ item.title }}
              </h1>

              <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-xs text-[#7A8A76] font-medium">
                <span v-if="publishedLabel" class="inline-flex items-center gap-1.5">
                  <i class="fa-regular fa-calendar" aria-hidden="true"></i>
                  {{ publishedLabel }}
                </span>
                <span v-if="durationLabel" class="inline-flex items-center gap-1.5">
                  <i class="fa-regular fa-clock" aria-hidden="true"></i>
                  {{ durationLabel }}
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <i class="fa-regular fa-eye" aria-hidden="true"></i>
                  {{ t('m_views_count_short').replace('{n}', String(item.viewCount)) }}
                </span>
              </div>

              <!-- Mô tả là chữ do cán bộ gõ: `{{ }}` + `whitespace-pre-line`, không `v-html`. -->
              <p
                v-if="item.description"
                class="mt-4 mb-0 text-[0.95rem] text-[#5A6655] leading-relaxed whitespace-pre-line break-words"
              >{{ item.description }}</p>
            </div>

            <!--
              Luồng bình luận, nạp từ trình duyệt sau khi mount.

              `mediaItemId` là công tắc nói cho component biết đây là mục media
              chứ không phải bài viết — slug một mình không nói được điều đó vì
              hai bảng có hai không gian tên riêng. Truyền `item.id` chứ không
              truyền một cờ boolean: component cần đúng con số đó để đối chiếu
              với bình luận trả về, và một cờ sẽ buộc nó phải suy lại từ slug.
            -->
            <ArticleComments :slug="item.shortId" :media-item-id="item.id" />
          </template>
        </div>

        <!-- Cột phụ: video cùng chuyên mục -->
        <aside class="flex flex-col gap-5 min-w-0">
          <div class="bg-white border border-[#E2E8DF] rounded-2xl p-5 shadow-sm">
            <h2 class="text-sm font-black text-[#1A2A17] uppercase tracking-tight m-0 mb-4 flex items-center gap-2">
              <i class="fa-solid fa-film text-[#7CB342]" aria-hidden="true"></i>
              {{ t('m_related') }}
            </h2>

            <div v-if="relatedPending" role="status" aria-busy="true" class="flex flex-col gap-3">
              <span class="sr-only">{{ t('m_related_loading') }}</span>
              <div
                v-for="n in 4"
                :key="n"
                aria-hidden="true"
                class="flex gap-3 animate-pulse motion-reduce:animate-none"
              >
                <div class="w-24 h-14 rounded-lg bg-[#EEF2EC] shrink-0"></div>
                <div class="flex-grow flex flex-col gap-2 pt-1">
                  <div class="h-3 w-full bg-[#EEF2EC] rounded"></div>
                  <div class="h-3 w-2/3 bg-[#EEF2EC] rounded"></div>
                </div>
              </div>
            </div>

            <!--
              Lỗi ở cột phụ KHÔNG phải lỗi của trang: video chính vẫn phát được.
              Nên nhánh này là một dòng nhỏ có nút thử lại, không phải một khối
              đỏ chiếm chỗ — biến một danh sách gợi ý hỏng thành "trang bị hỏng"
              là dạy người đọc bỏ đi khi video họ muốn vẫn đang ở đó.
            -->
            <div v-else-if="relatedError" role="alert" class="text-center py-3">
              <p class="text-xs text-[#B04A4A] m-0 mb-2">{{ t('m_related_error') }}</p>
              <button
                type="button"
                class="text-xs font-extrabold text-[#4A6741] hover:text-[#385132] bg-transparent border-none cursor-pointer inline-flex items-center gap-1.5"
                @click="loadRelated"
              >
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                <span>{{ t('m_retry') }}</span>
              </button>
            </div>

            <p v-else-if="!related.length" class="text-xs text-[#8A9A88] m-0">
              {{ t('m_related_empty') }}
            </p>

            <ul v-else class="list-none m-0 p-0 flex flex-col gap-3">
              <li v-for="entry in related" :key="entry.id">
                <nuxt-link
                  :to="`/media/${entry.shortId}`"
                  class="flex gap-3 no-underline group"
                >
                  <span class="w-24 h-14 rounded-lg bg-[#EEF2EC] shrink-0 overflow-hidden">
                    <img
                      v-if="entry.thumbnailUrl"
                      :src="entry.thumbnailUrl"
                      :alt="entry.title"
                      loading="lazy"
                      class="w-full h-full object-cover"
                    />
                  </span>
                  <span class="flex-grow min-w-0">
                    <span class="block text-[0.8rem] font-bold text-[#1E251C] leading-snug line-clamp-2 group-hover:text-[#4A6741] transition-colors">
                      {{ entry.title }}
                    </span>
                    <span v-if="formatMediaDuration(entry.durationSeconds)" class="block text-[0.7rem] text-[#8A9A88] mt-1">
                      {{ formatMediaDuration(entry.durationSeconds) }}
                    </span>
                  </span>
                </nuxt-link>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { formatDateVN } from '~/utils/formatDate'
import { formatMediaDuration } from '~/utils/media-duration'
import { useI18n } from '~/composables/useI18n'
import type { PublicMediaItem, PublicMediaListItem } from '~/types/public-api'

const { t } = useI18n()

const route = useRoute()
const shortId = computed(() => String(route.params.shortId || ''))

/**
 * Chi tiết video. Chỉ đọc nội dung **công khai** — xem đầu tệp về ràng buộc
 * `swr: 60`. Không có trường nào phụ thuộc người đọc trong lượt gọi này.
 */
const { data, pending, error, refresh } = useAsyncData(
  () => `media-detail-${shortId.value}`,
  () =>
    ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; item: PublicMediaItem | null }>)(`/api/public/media/${encodeURIComponent(shortId.value)}`),
  {
    lazy: true,
    default: () => ({ ok: false, item: null }),
  },
)

const item = computed<PublicMediaItem | null>(() => data.value?.item ?? null)

/**
 * 404 là một câu trả lời hợp lệ, không phải một lượt hỏng.
 *
 * Phân biệt được hai thứ này là điều kiện để nhánh "không tìm thấy" không mời
 * người đọc bấm "Thử lại" cho một slug sẽ không bao giờ tồn tại.
 */
const loadError = computed(() => !!error.value)

const publishedLabel = computed(() => {
  const value = item.value?.publishedAt
  if (!value) return ''
  // `formatDateVN` đọc bằng `getUTC*` — bắt buộc ở đây: giá trị đến từ cột
  // DATETIME và trang được dựng ở cả hai phía, nên một bộ định dạng theo giờ cục
  // bộ sẽ cho ra hai ngày khác nhau giữa HTML máy chủ và trình duyệt.
  return formatDateVN(value)
})

/** `durationSeconds` → "12:34" hoặc "1:02:03". Chuỗi rỗng khi chưa đo được. */
const durationLabel = computed(() => formatMediaDuration(item.value?.durationSeconds))

function reload() {
  // Gọi lại **chính lượt fetch đã hỏng**. `refresh()` của `useFetch` làm đúng
  // việc đó; `location.reload()` sẽ ném đi mọi khung khác trên trang.
  refresh()
}

// ─── Video cùng chuyên mục ───────────────────────────────────────────────────

const related = ref<PublicMediaListItem[]>([])
const relatedPending = ref(false)
const relatedError = ref(false)

/**
 * Nạp sau mount, không qua `useFetch`.
 *
 * Cột phụ là một tiện ích, không phải nội dung chính: đưa nó vào lượt dựng phía
 * máy chủ là bắt HTML đầu tiên chờ thêm một truy vấn nữa cho một khối mà người
 * đọc có thể không cuộn tới. Và nó cũng **không được** vào HTML đệm — cùng ràng
 * buộc `swr: 60` như phần còn lại của trang.
 *
 * Lỗi bị nuốt thành một cờ: một danh sách gợi ý hỏng không có tư cách làm hỏng
 * trang đang phát video.
 */
async function loadRelated() {
  const current = item.value
  if (!current) {
    related.value = []
    return
  }
  relatedPending.value = true
  relatedError.value = false
  try {
    const query = current.categorySlug ? { category: current.categorySlug, limit: 6 } : { limit: 6 }
    const response = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: PublicMediaListItem[] }>)(
      '/api/public/media',
      { query, retry: 0 },
    )
    // Loại chính nó ra: một video nằm trong danh sách "video cùng chuyên mục" của
    // chính nó là một liên kết dẫn tới đúng trang đang mở.
    related.value = (response.items ?? []).filter(entry => entry.id !== current.id).slice(0, 5)
  } catch {
    relatedError.value = true
    related.value = []
  } finally {
    relatedPending.value = false
  }
}

/**
 * Đếm lượt xem — từ trình duyệt, sau mount, và **không bao giờ** từ SSR.
 *
 * Trang này phục vụ qua `swr: 60`, nên người đọc thứ hai trở đi trong mỗi cửa sổ
 * 60 giây không chạm vào mã máy chủ nào. Đếm phía máy chủ sẽ thiếu đúng bằng phần
 * mà bộ nhớ đệm đang phát huy tác dụng — và con số thiếu đó trông vẫn hợp lý.
 *
 * Mọi lỗi bị nuốt: một bộ đếm không có tư cách làm hỏng trang của khách, và máy
 * chủ cố ý trả **cùng một mã 202** ở mọi nhánh nên ở đây cũng không có gì để
 * phân biệt.
 */
const countedSlug = ref('')
function pingView(target: string) {
  if (!target || countedSlug.value === target) return
  countedSlug.value = target
  void ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/public/media/${encodeURIComponent(target)}/view`, {
    method: 'POST',
    keepalive: true,
    retry: 0,
    timeout: 1500,
  }).catch(() => {})
}

// Điều hướng phía client giữa hai video dùng lại chính component này, nên
// `onMounted` chỉ chạy một lần cho cả chuỗi. Theo `item` chứ không theo `slug`:
// `lazy: true` nghĩa là dữ liệu về **sau** mount, nên đếm lúc mount sẽ đếm một
// slug chưa chắc đã tồn tại.
//
// `immediate: true` phủ cả hai trường hợp và vì thế **không cần `onMounted`**:
// lượt chạy đầu (dữ liệu về sau, `item` còn `null` nên thoát sớm rồi chạy lại
// khi dữ liệu tới) và điều hướng phía client sang video kế tiếp. Hai lối vào
// cho cùng một việc là hai chỗ để chúng lệch nhau.
//
// ⚠️ **Chốt `import.meta.client` là bắt buộc, không phải cho gọn.** `lazy: true`
// chỉ bỏ chặn điều hướng **phía client** — lượt dựng phía máy chủ vẫn chờ dữ
// liệu, nên `item` đã khác `null` khi `immediate` chạy trên máy chủ. Thiếu chốt
// này thì **mỗi lượt dựng HTML đều gửi một lượt đếm** từ địa chỉ IP của chính
// máy chủ, và lượt nạp cột phụ chạy thêm một truy vấn nữa cho mọi khách — đúng
// hai thứ mà `swr: 60` tồn tại để tránh. Không có gì đỏ ở đâu cả: trang vẫn
// đúng, chỉ là con số lượt xem cao hơn sự thật và mỗi lượt tải nặng hơn.
watch(item, value => {
  if (!value) return
  if (!import.meta.client) return
  pingView(value.shortId)
  loadRelated()
}, { immediate: true })
</script>
