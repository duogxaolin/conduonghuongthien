<script setup lang="ts">
/**
 * Tab "Kiểm duyệt An ninh" của AI Panel — chỉ còn là BẢN TÓM TẮT (design D10, spec
 * `admin-moderation-ui`): số hàng đang chờ đối soát, số quy tắc đang bật, và liên kết
 * sang trang quản lý duy nhất `/admin/ai/moderation`.
 *
 * Trước đây tab này là bản chép thứ hai của trang kiểm duyệt (thêm/bật/tắt/xoá quy
 * tắc, duyệt/xoá/cấm IP hàng đối soát) — hai bản trôi khỏi nhau, và huy hiệu "chờ đối
 * soát" ở đây đếm trên trang 20 dòng đầu nên không bao giờ vượt 20. Mọi thao tác ghi
 * nay chỉ ở trang kiểm duyệt; tab chỉ ĐỌC hai endpoint sẵn có.
 *
 * Hợp đồng tải / lỗi giữ nguyên tên để guard và cha không đổi: `moderationLoading`
 * (khung chờ), `moderationError` (`role="alert"` + "Thử lại" gọi `loadModeration`),
 * `loadModeration` được expose cho `ai/index.vue` gọi khi chuyển sang tab.
 */
import { errorMessage } from '~/utils/errorMessage'
import { summarizeModeration, type ModerationSummary } from '~/utils/moderation-summary'

const moderationLoading = ref(false)
const moderationError = ref('')
const summary = ref<ModerationSummary | null>(null)

async function loadModeration() {
  moderationLoading.value = true
  moderationError.value = ''
  try {
    const [queue, rules] = await Promise.all([
      // Chỉ cần tổng: xin 1 dòng, đọc `total` (đếm trước LIMIT ở máy chủ).
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ total?: unknown }>)('/api/admin/ai/moderation/queue', {
        params: { status: 'pending', perPage: 1 },
      }),
      ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ rules?: Array<{ isEnabled?: unknown }> }>)('/api/admin/ai/moderation/rules'),
    ])
    summary.value = summarizeModeration(queue, rules)
  } catch (err: unknown) {
    summary.value = null
    moderationError.value = errorMessage(err, 'Không thể tải số liệu kiểm duyệt an ninh.')
  } finally {
    moderationLoading.value = false
  }
}

// Tự fetch khi mount — không phụ thuộc watch(activeTab) ở cha (ref assign sau patch).
onMounted(() => { void loadModeration() })

// Cha gọi khi tab được lazy-load.
defineExpose<{ loadModeration: typeof loadModeration }>({ loadModeration })
</script>

<template>
  <section class="flex flex-col gap-4" aria-labelledby="moderation-summary-title">
    <h2 id="moderation-summary-title" class="m-0 text-base font-bold text-[#122815]">Tóm tắt kiểm duyệt an ninh</h2>

    <div v-if="moderationLoading" role="status" aria-busy="true" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <span class="sr-only">Đang tải số liệu kiểm duyệt an ninh</span>
      <div v-for="n in 2" :key="n" class="h-24 rounded-xl bg-[#EEF2EC] animate-pulse motion-reduce:animate-none" aria-hidden="true"></div>
    </div>

    <div
      v-else-if="moderationError"
      role="alert"
      class="flex flex-col gap-2 rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924] sm:flex-row sm:items-center"
    >
      <span><strong>Lỗi:</strong> {{ moderationError }}</span>
      <button
        type="button"
        class="cursor-pointer rounded font-bold text-[#4A6741] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] sm:ml-auto"
        @click="loadModeration()"
      >Thử lại</button>
    </div>

    <dl v-else-if="summary" class="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
        <dt class="text-sm text-[#667768]">
          <i class="fa-solid fa-inbox mr-1.5" aria-hidden="true"></i>Nội dung đang chờ đối soát
        </dt>
        <dd class="m-0 mt-1 text-2xl font-extrabold text-[#122815]">
          <span data-moderation-count="pending">{{ summary.pendingCount }}</span>
        </dd>
      </div>
      <div class="rounded-xl border border-[#e2ece3] bg-white p-4">
        <dt class="text-sm text-[#667768]">
          <i class="fa-solid fa-list-check mr-1.5" aria-hidden="true"></i>Quy tắc an ninh đang bật
        </dt>
        <dd class="m-0 mt-1 text-2xl font-extrabold text-[#122815]">
          <span data-moderation-count="active-rules">{{ summary.activeRuleCount }}</span>
          <span class="text-sm font-semibold text-[#667768]"> / {{ summary.totalRuleCount }} quy tắc</span>
        </dd>
      </div>
    </dl>

    <p class="m-0 text-sm text-[#667768]">
      Xử lý nội dung bị ẩn, cài đặt kiểm duyệt AI và sửa quy tắc đều thực hiện trên trang Kiểm duyệt An ninh.
    </p>
    <NuxtLink
      to="/admin/ai/moderation"
      class="inline-flex items-center gap-2 self-start rounded-lg bg-[#2c6e33] px-4 py-2 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#1e4620] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741] focus-visible:ring-offset-2"
    >
      <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
      Mở trang Kiểm duyệt An ninh
    </NuxtLink>
  </section>
</template>
