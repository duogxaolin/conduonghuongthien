<script setup lang="ts">
/**
 * Modal thống kê lượt xem + tăng lượt xem ảo — tách khỏi
 * `pages/admin/content/articles/index.vue`.
 *
 * Tự fetch `/api/admin/articles/:id/stats` khi mở. CÓ error branch (`statsError`
 * ref + `role="alert"` + nút "Thử lại" gọi `loadStats`) + loading branch. Đó là
 * hợp đồng test guard ghim: `VIEWS_WITH_ERROR_BRANCH` + `VIEWS_WITH_LOADING_BRANCH`.
 *
 * Con giữ toàn bộ boost state (mode/amount/minutes/submitting) + handlers
 * (`submitBoost`/`cancelBoost`). Cha chỉ truyền `article` (cần id+title) + emit
 * 'close' + 'boost-applied' (cha refresh table sau khi boost).
 */
import type { AdminArticleRow, AdminArticleStats, AdminArticleBoost, AdminArticleStatsResult } from '~/types/admin-api'
import type { ArticleBoostCancelResponse, ArticleBoostResponse } from '~/types/admin-articles-api'
import { errorMessage } from '~/utils/errorMessage'

const props = defineProps<{
  article: AdminArticleRow | null
}>()

const emit = defineEmits<{
  'close': []
  'boost-applied': []
}>()

const statsLoading = ref(false)
const statsError = ref('')
const statsData = ref<AdminArticleStats | null>(null)
const runningBoost = ref<AdminArticleBoost>(null)

const boostMode = ref<'instant' | 'gradual'>('instant')
const boostAmount = ref<number | null>(null)
const boostMinutes = ref<number | null>(60)
const boostSubmitting = ref(false)

const toast = useToast()
const { confirm } = useConfirm()

const formatViews = (value: unknown) => Number(value || 0).toLocaleString('vi-VN')

const sourceLabels: Record<string, string> = {
  direct: 'Truy cập trực tiếp',
  search: 'Từ công cụ tìm kiếm',
  social: 'Từ mạng xã hội',
  referral: 'Từ trang khác dẫn sang',
  email: 'Từ thư điện tử',
  other: 'Nguồn khác',
}

/** Phần trăm đã giao của lượt tăng dần đang chạy, để thanh tiến độ có ý nghĩa. */
const boostProgress = computed(() => {
  const job = runningBoost.value
  if (!job || !Number(job.totalAmount)) return 0
  return Math.min(100, Math.round((Number(job.appliedAmount) / Number(job.totalAmount)) * 100))
})

/** Cột cao nhất trong biểu đồ ngày, dùng làm mốc quy đổi chiều cao các cột còn lại. */
const dailyPeak = computed(() => {
  const rows = statsData.value?.daily || []
  return rows.reduce((max: number, row: { total?: number }) => Math.max(max, Number(row.total || 0)), 0)
})

/**
 * Mã lượt: chỉ câu trả lời của lượt đọc MỚI NHẤT cho bài ĐANG MỞ được ghi. Đóng/đổi bài cấp mã
 * mới — trước đây mở "Bài 3" (chậm), đóng, mở "Bài 4": số liệu và lượt tăng dần của Bài 3 về
 * sau hiện dưới tên Bài 4 (tests/admin-fetch-rollout-article-stats-translate.test.ts).
 */
let statsRequest = 0
const loadStats = async () => {
  if (!props.article) return
  const ticket = ++statsRequest
  statsLoading.value = true
  statsError.value = ''
  try {
    const res = await adminFetch<AdminArticleStatsResult>(`/api/admin/articles/${props.article.id}/stats`)
    if (ticket !== statsRequest) return
    statsData.value = res.stats
    runningBoost.value = res.boost
  } catch (err: unknown) {
    if (ticket !== statsRequest) return
    // Giữ lại lỗi trên màn hình kèm nút thử lại: một modal trống không nói được
    // là "bài này chưa có lượt xem" hay "không tải được số liệu".
    statsError.value = errorMessage(err, 'Không tải được số liệu lượt xem.')
    statsData.value = null
    runningBoost.value = null
  } finally {
    if (ticket === statsRequest) statsLoading.value = false
  }
}

// Khi `article` thay đổi (cha gán bài mới để mở modal) → fetch. Cha điều khiển
// modal bằng `article` ref (null = đóng, non-null = mở). Không cần `show` riêng.
watch(
  () => props.article,
  async (art) => {
    if (!art) {
      statsRequest++ // lượt đọc của bài vừa đóng không còn ai chờ
      statsLoading.value = false
      statsData.value = null
      runningBoost.value = null
      statsError.value = ''
      return
    }
    statsData.value = null
    runningBoost.value = null
    statsError.value = ''
    boostMode.value = 'instant'
    boostAmount.value = null
    boostMinutes.value = 60
    await loadStats()
  },
  { immediate: true },
)

const submitBoost = async () => {
  if (!props.article || boostSubmitting.value) return
  const amount = Number(boostAmount.value)
  if (!Number.isInteger(amount) || amount < 1) {
    toast.error('Vui lòng nhập số lượt xem là số nguyên lớn hơn 0.')
    return
  }
  const minutes = Number(boostMinutes.value)
  if (boostMode.value === 'gradual' && (!Number.isInteger(minutes) || minutes < 1)) {
    toast.error('Vui lòng nhập thời lượng là số nguyên phút lớn hơn 0.')
    return
  }

  const ok = await confirm({
    title: 'Tăng lượt xem ảo',
    message: boostMode.value === 'instant'
      ? `Cộng ngay ${amount.toLocaleString('vi-VN')} lượt xem ảo cho bài "${props.article.title}"? Thao tác này được ghi vào nhật ký hoạt động kèm tên tài khoản của bạn.`
      : `Cộng dần ${amount.toLocaleString('vi-VN')} lượt xem ảo trong ${minutes.toLocaleString('vi-VN')} phút cho bài "${props.article.title}"? Thao tác này được ghi vào nhật ký hoạt động kèm tên tài khoản của bạn.`,
    confirmLabel: 'Xác nhận',
  })
  if (!ok) return

  boostSubmitting.value = true
  try {
    const body: Record<string, unknown> = { mode: boostMode.value, amount }
    if (boostMode.value === 'gradual') body.minutes = minutes
    await adminFetch<ArticleBoostResponse>(`/api/admin/articles/${props.article.id}/boost`, { method: 'POST', body })
    toast.success(boostMode.value === 'instant' ? 'Đã cộng lượt xem ảo.' : 'Đã tạo lượt tăng dần.')
    boostAmount.value = null
    await loadStats()
    emit('boost-applied')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thực hiện được thao tác tăng lượt xem.'))
  } finally {
    boostSubmitting.value = false
  }
}

const cancelBoost = async () => {
  if (!props.article || !runningBoost.value) return
  const ok = await confirm({
    title: 'Huỷ lượt tăng dần',
    // Nói rõ phần đã cộng vẫn giữ: người vận hành cần biết huỷ là dừng phần còn
    // lại, không phải hoàn tác phần đã chạy.
    message: `Dừng lượt tăng dần đang chạy? Phần đã cộng (${formatViews(runningBoost.value.appliedAmount)} lượt) vẫn được giữ nguyên.`,
    danger: true,
    confirmLabel: 'Huỷ lượt tăng',
  })
  if (!ok) return
  try {
    await adminFetch<ArticleBoostCancelResponse>(`/api/admin/articles/${props.article.id}/boost`, { method: 'DELETE' })
    toast.success('Đã huỷ lượt tăng dần.')
    await loadStats()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không huỷ được lượt tăng dần.'))
  }
}
</script>

<template>
  <div
    v-if="props.article"
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
    role="dialog"
    aria-modal="true"
    aria-labelledby="stats-modal-title"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl rounded-xl border border-line bg-white shadow-lg">
      <div class="flex items-start justify-between gap-3 border-b border-surface-tint px-5 py-4">
        <div class="min-w-0">
          <h2 id="stats-modal-title" class="m-0 text-[1.05rem] font-extrabold text-brand-950">Thống kê lượt xem</h2>
          <p class="m-0 mt-1 line-clamp-2 text-[0.82rem] text-ink-muted">{{ props.article.title }}</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-lg border-0 bg-none p-1.5 text-ink-muted hover:text-brand-950 cursor-pointer"
          aria-label="Đóng"
          @click="emit('close')"
        ><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>

      <div class="px-5 py-4">
        <div v-if="statsLoading" class="py-10 text-center text-[0.85rem] text-ink-muted">Đang tải số liệu lượt xem...</div>

        <div v-else-if="statsError" role="alert" class="rounded-lg border border-dashed border-[#e2b3b3] bg-[#fdf6f6] px-4 py-6 text-center">
          <p class="m-0 text-[0.85rem] font-semibold text-[#b01f1b]">{{ statsError }}</p>
          <button
            type="button"
            class="mt-3 rounded-lg border border-brand-700 bg-white px-3 py-2 text-sm font-bold text-brand-700 cursor-pointer hover:bg-surface-tint"
            @click="loadStats"
          >Thử lại</button>
        </div>

        <div v-else-if="statsData" class="flex flex-col gap-5">
          <!--
            Ba ô, không bao giờ chỉ một. Con số công khai là tổng, nhưng cán bộ
            phải đọc được ngay phần nào là thật và phần nào do quản trị viên
            cộng vào.
          -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="rounded-lg border border-line bg-surface px-4 py-3">
              <p class="m-0 text-[0.72rem] font-bold uppercase tracking-wide text-ink-muted">Tổng hiển thị</p>
              <p class="m-0 mt-1 text-[1.35rem] font-extrabold text-brand-950">{{ formatViews(statsData.totalDisplayed) }}</p>
            </div>
            <div class="rounded-lg border border-[#cfe4d1] bg-surface-tint px-4 py-3">
              <p class="m-0 text-[0.72rem] font-bold uppercase tracking-wide text-brand-700">Lượt xem thật</p>
              <p class="m-0 mt-1 text-[1.35rem] font-extrabold text-brand-900">{{ formatViews(statsData.totalReal) }}</p>
            </div>
            <div class="rounded-lg border border-[#f0dcae] bg-[#fff8e1] px-4 py-3">
              <p class="m-0 text-[0.72rem] font-bold uppercase tracking-wide text-[#b78103]">Lượt xem ảo</p>
              <p class="m-0 mt-1 text-[1.35rem] font-extrabold text-[#765b00]">{{ formatViews(statsData.totalFabricated) }}</p>
            </div>
          </div>

          <!-- Lượt tăng dần đang chạy -->
          <div v-if="runningBoost" class="rounded-lg border border-[#f0dcae] bg-[#fffdf6] px-4 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="m-0 text-[0.82rem] font-bold text-[#765b00]">
                Đang cộng dần: {{ formatViews(runningBoost.appliedAmount) }} / {{ formatViews(runningBoost.totalAmount) }} lượt
                ({{ formatViews(runningBoost.durationMinutes) }} phút)
              </p>
              <button
                type="button"
                class="rounded-lg border border-danger bg-white px-3 py-1.5 text-[0.8rem] font-bold text-danger cursor-pointer hover:bg-[#fdf6f6]"
                @click="cancelBoost"
              >Huỷ lượt tăng</button>
            </div>
            <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#f0e6c8]">
              <div class="h-full rounded-full bg-[#b78103] transition-all" :style="{ width: `${boostProgress}%` }"></div>
            </div>
            <p class="m-0 mt-1.5 text-[0.75rem] text-[#8a7a4a]">Kết thúc lúc {{ new Date(runningBoost.endsAt).toLocaleString('vi-VN') }}</p>
          </div>

          <!-- Nguồn truy cập (chỉ lượt xem thật) -->
          <div>
            <h3 class="m-0 mb-2 text-[0.85rem] font-extrabold text-brand-950">
              Nguồn truy cập <span class="font-medium text-ink-muted">— {{ statsData.days }} ngày gần nhất, chỉ tính lượt xem thật</span>
            </h3>
            <table v-if="statsData.bySource.length" class="w-full border-collapse text-left text-[0.82rem]">
              <thead>
                <tr>
                  <th class="border-b border-line bg-surface px-3 py-2 font-bold text-ink-muted">Nguồn</th>
                  <th class="border-b border-line bg-surface px-3 py-2 text-right font-bold text-ink-muted">Lượt xem</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in statsData.bySource" :key="row.sourceCategory">
                  <td class="border-b border-surface-tint px-3 py-2 text-[#445546]">{{ sourceLabels[row.sourceCategory] || row.sourceCategory }}</td>
                  <td class="border-b border-surface-tint px-3 py-2 text-right font-bold text-brand-950">{{ formatViews(row.views) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="m-0 rounded-lg border border-dashed border-line px-3 py-4 text-center text-[0.82rem] text-[#8a9f8c]">
              Chưa ghi nhận lượt xem thật nào trong khoảng thời gian này.
            </p>
          </div>

          <!-- Diễn biến theo ngày -->
          <div>
            <h3 class="m-0 mb-2 text-[0.85rem] font-extrabold text-brand-950">Diễn biến theo ngày</h3>
            <ul v-if="statsData.daily.length" class="m-0 flex list-none flex-col gap-1.5 p-0">
              <li v-for="row in statsData.daily" :key="row.day" class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-[0.78rem] text-ink-muted">{{ new Date(row.day).toLocaleDateString('vi-VN') }}</span>
                <span class="h-2 flex-1 overflow-hidden rounded-full bg-surface-tint">
                  <span class="block h-full rounded-full bg-brand-700" :style="{ width: dailyPeak ? `${(row.total / dailyPeak) * 100}%` : '0%' }"></span>
                </span>
                <span class="w-32 shrink-0 text-right text-[0.78rem] text-[#445546]">
                  <strong class="text-brand-950">{{ formatViews(row.total) }}</strong>
                  <span class="text-[#8a9f8c]"> ({{ formatViews(row.real) }} thật / {{ formatViews(row.fabricated) }} ảo)</span>
                </span>
              </li>
            </ul>
            <p v-else class="m-0 rounded-lg border border-dashed border-line px-3 py-4 text-center text-[0.82rem] text-[#8a9f8c]">
              Bài viết chưa có lượt xem nào được ghi nhận.
            </p>
          </div>

          <!-- Tăng lượt xem ảo -->
          <div class="rounded-lg border border-line bg-surface px-4 py-4">
            <h3 class="m-0 text-[0.85rem] font-extrabold text-brand-950">Tăng lượt xem ảo</h3>
            <p class="m-0 mt-1 text-[0.78rem] text-ink-muted">
              Lượt xem ảo được lưu tách khỏi lượt xem thật và mọi thao tác đều ghi vào nhật ký hoạt động kèm tên tài khoản thực hiện.
            </p>
            <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label class="flex flex-col gap-1">
                <span class="text-[0.75rem] font-bold text-ink-muted">Chế độ</span>
                <select
                  v-model="boostMode"
                  class="rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
                >
                  <option value="instant">Cộng ngay</option>
                  <option value="gradual">Cộng dần theo thời gian</option>
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[0.75rem] font-bold text-ink-muted">Số lượt xem</span>
                <input
                  v-model.number="boostAmount"
                  type="number"
                  min="1"
                  max="1000000"
                  step="1"
                  placeholder="Ví dụ: 500"
                  class="w-40 rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
                />
              </label>
              <label v-if="boostMode === 'gradual'" class="flex flex-col gap-1">
                <span class="text-[0.75rem] font-bold text-ink-muted">Thời lượng (phút)</span>
                <input
                  v-model.number="boostMinutes"
                  type="number"
                  min="1"
                  max="10080"
                  step="1"
                  class="w-40 rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
                />
              </label>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-lg border-0 bg-brand-700 px-4 py-2.5 font-bold text-white transition-colors hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="boostSubmitting"
                @click="submitBoost"
              >
                <i class="fa-solid fa-arrow-up-right-dots" aria-hidden="true"></i>
                {{ boostSubmitting ? 'Đang thực hiện...' : 'Thực hiện' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
