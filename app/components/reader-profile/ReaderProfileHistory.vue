<template>
  <section class="rounded-xl border border-line bg-white p-6">
    <header class="mb-2 flex items-center justify-between gap-3">
      <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
        <i class="fa-solid fa-book-open mr-2 text-accent" aria-hidden="true"></i>Bài đã đọc
      </h2>
      <button
        v-if="entries.length"
        type="button"
        class="shrink-0 text-[0.8rem] font-semibold text-ink-soft underline transition-colors hover:text-danger-soft"
        @click="emit('clear')"
      >{{ t('profile_clear_history') }}</button>
    </header>

    <!--
      Câu này phải hiện ra, không phải để người đọc tự suy ra.

      Lịch sử đọc lưu trong trình duyệt này chứ không trên máy chủ — cổ ý,
      để không tồn tại bảng nào ghi "công dân nào đã đọc bài nào, lúc
      nào" (xem app/composables/useReadingHistory.ts). Hệ quả là đổi máy
      hay xoá dữ liệu trình duyệt là mất, và một người tưởng nó theo tài
      khoản sẽ kết luận cổng đã làm mất dữ liệu của họ.
    -->
    <p class="mb-4 mt-0 flex items-start gap-2 rounded-lg bg-surface-tint px-3 py-2.5 text-[0.8rem] leading-relaxed text-ink-secondary">
      <i class="fa-solid fa-circle-info mt-0.5 text-accent" aria-hidden="true"></i>
      <span>
        Danh sách này được lưu trên <strong>thiết bị này</strong>, không lưu trên máy chủ và không gắn với
        tài khoản của bạn. Cổng thông tin không ghi lại việc bạn đã đọc những bài nào.
      </span>
    </p>

    <p v-if="!entries.length" class="m-0 rounded-lg border border-dashed border-line px-4 py-8 text-center text-[0.9rem] text-ink-soft">
      Chưa có bài viết nào được đọc trên thiết bị này.
    </p>

    <ul v-else class="m-0 flex list-none flex-col divide-y divide-surface-tint p-0">
      <li v-for="item in entries" :key="item.slug" class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
        <nuxt-link
          :to="`/news/${item.slug}`"
          class="flex min-w-0 flex-1 items-start justify-between gap-3 no-underline"
        >
          <span class="min-w-0 flex-1 text-[0.9rem] font-semibold leading-snug text-ink transition-colors hover:text-brand-600">
            {{ item.title || item.slug }}
          </span>
          <span v-if="item.readAt" class="shrink-0 text-[0.76rem] text-ink-soft">{{ formatReadAt(item.readAt) }}</span>
        </nuxt-link>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-[#9ca3af] transition-colors hover:bg-[#fee2e2] hover:text-[#b42318]"
          :aria-label="`${t('profile_remove_aria')} ${item.title || item.slug}`"
          :title="t('profile_remove_title')"
          @click="emit('remove', item.slug)"
        >
          <i class="fa-solid fa-xmark text-[0.8rem]" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * `/profile`, Khối 4 "Bài đã đọc" — the reading history of THIS device
 * (`useReadingHistory`, localStorage only; the page holds it and does the removing).
 * Rendered only by app/pages/profile.vue, inside its `<client-only>`
 * (tests/public-pages-structure.test.ts pins both, because `formatReadAt` below reads
 * the runtime timezone). Display only.
 */
import { useI18n } from '~/composables/useI18n'
import type { ReadingHistoryEntry } from '~/composables/useReadingHistory'

defineProps<{ entries: ReadingHistoryEntry[] }>()
const emit = defineEmits<{ remove: [slug: string]; clear: [] }>()

const { t } = useI18n()

/**
 * Ngày đọc, định dạng theo múi giờ CỦA MÁY người đọc — cố ý không dùng
 * `formatDateVN`.
 *
 * `formatDateVN` đọc bằng `getUTC*`, đúng cho các cột DATETIME mà Drizzle ghi
 * dưới dạng giờ treo tường UTC và cần khớp giữa lượt dựng phía máy chủ với trình
 * duyệt. Nhưng `readAt` ở đây là một mốc thời gian thật do `Date.now()` sinh ra
 * ngay trên máy này, nên đọc nó bằng UTC là **lùi 7 giờ**: một bài đọc lúc 6 giờ
 * sáng ở Việt Nam sẽ hiện ngày hôm trước.
 *
 * Không có vấn đề khớp SSR để lo: cả khối này nằm trong `<client-only>` và dữ
 * liệu chỉ tồn tại trong `localStorage` của chính trình duyệt đang xem.
 */
function formatReadAt(epochMs: number | null | undefined) {
  if (!epochMs) return ''
  const d = new Date(epochMs)
  if (Number.isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}
</script>
