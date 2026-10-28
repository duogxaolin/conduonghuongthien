<script setup lang="ts">
/**
 * Universal Translation Hub tab của trang Quản lý Ngôn ngữ — Quét & Dịch
 * toàn cục (UI + Blocks + Articles) qua AI Gateway. Tách khỏi
 * `pages/admin/languages/index.vue`.
 *
 * Self-contained: tự giữ state + fetch. Lỗi chỉ toast (không có danh sách
 * để lỗi thành "trống" — đây là tác vụ nền, cán bộ bấm nút rồi theo dõi
 * progress banner). Loading là spinner trong card "Trạng thái quét", không
 * có skeleton placeholder.
 */
import type {
  UniversalCancelResponse, UniversalCoverageResponse, UniversalStartResponse, UniversalStats, UniversalTask, UniversalTaskResponse,
} from '~/types/admin-languages-api'
import { errorMessage, errorStatus } from '~/utils/errorMessage'
import { getFlagEmoji } from '~/utils/language-flags'

const toast = useToast()

const universalStats = ref<UniversalStats | null>(null)
// Tab quét ngay khi mở: "Đang quét..." từ khung hình đầu, không phải "—".
const universalLoading = ref(true)
/** Một con số của lượt quét — chưa quét xong "Đang quét...", quét hỏng "—", không bao giờ một số tự đặt. */
const stat = (n: number | undefined) => (universalStats.value ? n : universalLoading.value ? 'Đang quét...' : '—')
const universalTask = ref<UniversalTask | null>(null)
const universalSelectedLangs = ref<string[]>([])
const universalOptions = reactive({
  includeUi: true,
  includeBlocks: true,
  includeArticles: true,
  articlesLimit: 20,
  publishImmediately: false,
})
const universalRunning = ref(false)
const universalCancelling = ref(false)
let universalPollTimer: number | undefined
// Rời tab khi một lượt đọc trạng thái còn bay: câu trả lời "đang chạy" về sau không được mở
// lại một vòng hỏi 2 s mà không gì dừng được nữa.
let disposed = false

async function loadCoverage() {
  universalLoading.value = true
  try {
    const res = await adminFetch<UniversalCoverageResponse>(`/api/admin/system/translation-coverage`)
    if (res.ok && res.stats) {
      universalStats.value = res.stats
      if (universalSelectedLangs.value.length === 0) {
        universalSelectedLangs.value = res.stats.languages.map((l) => l.code)
      }
    }
    await checkUniversalTaskStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể tải thống kê toàn cục.'))
  } finally {
    universalLoading.value = false
  }
}

async function checkUniversalTaskStatus() {
  try {
    const res = await adminFetch<UniversalTaskResponse>(`/api/admin/system/universal-translate-status`)
    if (res.ok && res.task) {
      universalTask.value = res.task
      if (res.task.active) {
        startUniversalPolling()
      } else {
        stopUniversalPolling()
      }
    }
  } catch {
    // Non-critical
  }
}

function startUniversalPolling() {
  if (universalPollTimer || disposed) return
  universalPollTimer = window.setInterval(async () => {
    await checkUniversalTaskStatus()
    const ended: UniversalTask | null = universalTask.value
    if (!ended?.active) {
      stopUniversalPolling()
      // Dừng không có nghĩa là xong: `completedAt` chỉ có khi xong, `error` khi hỏng giữa chừng.
      if (ended?.error) toast.error('Tác vụ dịch toàn cục gặp lỗi và đã dừng giữa chừng.')
      else if (ended?.completedAt) toast.success('Quá trình dịch toàn cục đã hoàn tất!')
      else toast.info('Đã dừng tác vụ dịch toàn cục.')
      await loadCoverage()
    }
  }, 2000)
}

function stopUniversalPolling() {
  if (universalPollTimer) {
    window.clearInterval(universalPollTimer)
    universalPollTimer = undefined
  }
}

async function cancelUniversalTranslate() {
  universalCancelling.value = true
  try {
    const res = await adminFetch<UniversalCancelResponse>(`/api/admin/system/universal-translate-cancel`, {
      method: 'POST',
    })
    toast.info(res.message || 'Đã gửi yêu cầu dừng tác vụ.')
    await checkUniversalTaskStatus()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khi dừng tác vụ.'))
  } finally {
    universalCancelling.value = false
  }
}

async function runUniversalTranslate() {
  if (universalSelectedLangs.value.length === 0) {
    toast.warning('Vui lòng chọn ít nhất một ngôn ngữ.')
    return
  }

  universalRunning.value = true
  try {
    const res = await adminFetch<UniversalStartResponse>(`/api/admin/system/universal-translate`, {
      method: 'POST',
      body: {
        targetLangs: universalSelectedLangs.value,
        includeUi: universalOptions.includeUi,
        includeBlocks: universalOptions.includeBlocks,
        includeArticles: universalOptions.includeArticles,
        articlesLimit: universalOptions.articlesLimit,
        publishImmediately: universalOptions.publishImmediately,
      },
    })
    toast.success(res.message || 'Đã bắt đầu tác vụ dịch toàn cục!')
    await checkUniversalTaskStatus()
    startUniversalPolling()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khi bắt đầu dịch toàn cục.'))
    // 409: một lượt khác đang chạy — đọc lại trạng thái để cán bộ thấy lượt đó và tiến độ của nó.
    if (errorStatus(err) === 409) await checkUniversalTaskStatus()
  } finally {
    universalRunning.value = false
  }
}

onMounted(() => {
  loadCoverage()
})

onUnmounted(() => {
  disposed = true
  stopUniversalPolling()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- 4 Pillars Coverage Stat Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Card 1: UI Strings -->
      <div class="bg-white p-5 rounded-xl border border-line shadow-xs flex flex-col justify-between gap-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink-muted uppercase tracking-wider">Từ điển UI (Hệ thống)</span>
          <span class="w-8 h-8 rounded-lg bg-[#e4f2e5] text-brand-900 flex items-center justify-center text-sm">
            <i class="fa-solid fa-language"></i>
          </span>
        </div>
        <div>
          <div class="text-2xl font-black text-brand-950">{{ stat(universalStats?.totalUiKeys) }}</div>
          <p class="m-0 text-xs text-ink-muted mt-1">Chuỗi văn bản nút bấm, nhãn, chân trang</p>
        </div>
      </div>

      <!-- Card 2: Page Builder Blocks -->
      <div class="bg-white p-5 rounded-xl border border-line shadow-xs flex flex-col justify-between gap-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink-muted uppercase tracking-wider">Khối trang tĩnh (Blocks)</span>
          <span class="w-8 h-8 rounded-lg bg-[#e3f2fd] text-[#1565c0] flex items-center justify-center text-sm">
            <i class="fa-solid fa-cubes"></i>
          </span>
        </div>
        <div>
          <div class="text-2xl font-black text-brand-950">{{ stat(universalStats?.totalBlocks) }}</div>
          <p class="m-0 text-xs text-ink-muted mt-1">Trang chủ, Giới thiệu, Liên hệ & trang tùy biến</p>
        </div>
      </div>

      <!-- Card 3: Articles -->
      <div class="bg-white p-5 rounded-xl border border-line shadow-xs flex flex-col justify-between gap-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-ink-muted uppercase tracking-wider">Bài viết đã xuất bản</span>
          <span class="w-8 h-8 rounded-lg bg-[#fff8e1] text-[#b78103] flex items-center justify-center text-sm">
            <i class="fa-solid fa-newspaper"></i>
          </span>
        </div>
        <div>
          <div class="text-2xl font-black text-brand-950">{{ stat(universalStats?.totalArticles) }}</div>
          <p class="m-0 text-xs text-ink-muted mt-1">Tin tức, tấm gương, mô hình, văn bản</p>
        </div>
      </div>

      <!-- Card 4: Action / Scan button -->
      <div class="bg-gradient-to-br from-brand-900 to-[#143516] text-white p-5 rounded-xl shadow-sm flex flex-col justify-between gap-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white/80 uppercase tracking-wider">Trạng thái quét</span>
          <span class="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-sm">
            <i class="fa-solid fa-radar" :class="universalLoading ? 'animate-spin' : ''"></i>
          </span>
        </div>
        <div>
          <button
            type="button"
            class="w-full py-2 px-3 rounded-lg bg-accent hover:bg-[#689F38] text-white font-extrabold text-xs cursor-pointer border-none transition-all flex items-center justify-center gap-1.5 shadow-sm"
            :disabled="universalLoading"
            @click="loadCoverage"
          >
            <i class="fa-solid fa-arrows-rotate text-xs" :class="universalLoading ? 'animate-spin' : ''"></i>
            <span>{{ universalLoading ? 'Đang quét CSDL...' : 'Quét lại hệ thống' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Main Action Box -->
    <div class="bg-white rounded-2xl border border-line-strong p-6 shadow-sm flex flex-col gap-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-surface-tint pb-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 text-white flex items-center justify-center text-xl shadow-sm">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
          </div>
          <div>
            <h3 class="m-0 text-lg font-black text-brand-950">⚡ Trình Dịch Toàn Cục Tự Động (1-Click Universal Auto-Translate)</h3>
            <p class="m-0 text-xs text-ink-muted mt-0.5">Tự động quét và phiên dịch tất cả các nội dung còn thiếu trên toàn Cổng thông tin bằng AI Gateway</p>
          </div>
        </div>
      </div>

      <!-- Description Note -->
      <div class="p-3.5 bg-surface-tint border border-[#c8dcc9] rounded-xl text-xs text-brand-900 flex items-start gap-2.5">
        <i class="fa-solid fa-circle-info text-base text-brand-700 shrink-0 mt-0.5"></i>
        <div>
          <strong>Cơ chế tự động hóa:</strong> Hệ thống sẽ tự động rà soát đồng thời 3 phần: (1) Từ điển UI, (2) Toàn bộ các khối trang tĩnh Page Builder (Trang chủ, Giới thiệu, Liên hệ...), và (3) Các bài viết đã xuất bản. Sau này cán bộ thêm bất kỳ trang mới hay bài mới nào, chỉ cần bấm nút này là hệ thống tự động quét và dịch bổ sung đầy đủ!
        </div>
      </div>

      <!-- Target Languages Selection -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold text-brand-950">Chọn các ngôn ngữ muốn dịch toàn bộ:</label>
          <div class="flex items-center gap-2 text-xs">
            <button
              type="button"
              class="text-brand-700 hover:underline bg-transparent border-0 cursor-pointer p-0 font-bold"
              @click="universalSelectedLangs = (universalStats?.languages || []).map((l) => l.code)"
            >Chọn tất cả</button>
            <span class="text-line-strong">|</span>
            <button
              type="button"
              class="text-ink-muted hover:underline bg-transparent border-0 cursor-pointer p-0"
              @click="universalSelectedLangs = []"
            >Bỏ chọn</button>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <label
            v-for="l in universalStats?.languages || []"
            :key="l.code"
            class="flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all"
            :class="universalSelectedLangs.includes(l.code) ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50'"
          >
            <div class="flex items-center gap-2 min-w-0">
              <input
                type="checkbox"
                :value="l.code"
                v-model="universalSelectedLangs"
                class="h-4 w-4 accent-brand-700 rounded cursor-pointer shrink-0"
              />
              <span class="text-lg leading-none shrink-0">{{ getFlagEmoji(l.code) }}</span>
              <span class="text-xs font-bold text-brand-950 truncate">{{ l.name }}</span>
            </div>
            <span
              class="px-1.5 py-0.5 rounded-full text-[0.62rem] font-bold shrink-0 ml-1"
              :class="l.percent === 100 ? 'bg-[#e4f2e5] text-[#1e4620]' : 'bg-[#fff8e1] text-[#b78103]'"
            >
              {{ l.percent }}%
            </span>
          </label>
        </div>
      </div>

      <!-- Scope & Options -->
      <div class="flex flex-col gap-2.5 bg-surface p-4 rounded-xl border border-surface-tint">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-brand-950">
            <input type="checkbox" v-model="universalOptions.includeUi" class="h-4 w-4 accent-brand-700 rounded" />
            <span>(1) Dịch chuỗi từ điển UI</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-brand-950">
            <input type="checkbox" v-model="universalOptions.includeBlocks" class="h-4 w-4 accent-brand-700 rounded" />
            <span>(2) Dịch khối trang tĩnh (Blocks)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-brand-950">
            <input type="checkbox" v-model="universalOptions.includeArticles" class="h-4 w-4 accent-brand-700 rounded" />
            <span>(3) Dịch bài viết</span>
          </label>
        </div>

        <div v-if="universalOptions.includeArticles" class="pt-2.5 border-t border-line flex flex-col gap-1.5 animate-fade-slide-up">
          <div class="flex items-center justify-between">
            <label class="text-[0.75rem] font-bold text-brand-950">Phạm vi số lượng bài viết dịch:</label>
            <span v-if="universalStats" class="text-[0.68rem] text-ink-muted">Kho CSDL có {{ universalStats.totalArticles }} bài viết</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              v-for="opt in [
                { val: 20, label: '20 bài mới nhất', desc: '~5-7 phút (Khuyên dùng)' },
                { val: 50, label: '50 bài mới nhất', desc: '~12-15 phút' },
                { val: 100, label: '100 bài mới nhất', desc: '~25-30 phút' },
                { val: 0, label: 'Tất cả bài viết', desc: 'Chạy ngầm dài hạn' },
              ]"
              :key="opt.val"
              class="p-2.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col gap-0.5"
              :class="universalOptions.articlesLimit === opt.val ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50 bg-white'"
              @click="universalOptions.articlesLimit = opt.val"
            >
              <span class="text-xs font-bold text-brand-950">{{ opt.label }}</span>
              <span class="text-[0.65rem] text-ink-muted">{{ opt.desc }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Publish Option -->
      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-bold text-brand-950">Trạng thái sau khi dịch xong:</label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <label
            class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all"
            :class="!universalOptions.publishImmediately ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50'"
          >
            <input type="radio" :value="false" v-model="universalOptions.publishImmediately" class="accent-brand-700 mt-0.5" />
            <div class="flex flex-col">
              <span class="text-xs font-bold text-brand-950">📝 Lưu làm Bản nháp AI</span>
              <span class="text-[0.68rem] text-ink-muted mt-0.5">Rà soát, kiểm tra lại rồi mới xuất bản (Khuyên dùng)</span>
            </div>
          </label>

          <label
            class="flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all"
            :class="universalOptions.publishImmediately ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50'"
          >
            <input type="radio" :value="true" v-model="universalOptions.publishImmediately" class="accent-brand-700 mt-0.5" />
            <div class="flex flex-col">
              <span class="text-xs font-bold text-brand-950">🚀 Xuất bản luôn</span>
              <span class="text-[0.68rem] text-ink-muted mt-0.5">Hiển thị ngay lập tức ra trang công khai</span>
            </div>
          </label>
        </div>
      </div>

      <!-- Action Button & Live Progress Banner if running -->
      <div class="flex flex-col gap-3 pt-2">
        <div
          v-if="universalTask?.active"
          class="bg-gradient-to-r from-surface-tint to-[#e4f2e5] border border-[#a2cca4] rounded-xl p-4 flex flex-col gap-2.5 animate-fade-slide-up shadow-sm"
        >
          <div class="flex items-center justify-between text-xs font-bold text-brand-900">
            <span class="flex items-center gap-2">
              <i class="fa-solid fa-spinner animate-spin text-sm text-brand-700"></i>
              <span>{{ universalTask.phase }}</span>
            </span>
            <div class="flex items-center gap-3">
              <span class="font-extrabold text-brand-700 text-sm">
                {{ universalTask.percent }}%
                <span v-if="universalTask.totalItems > 0" class="text-xs font-normal text-ink-muted">
                  ({{ universalTask.processedItems }}/{{ universalTask.totalItems }})
                </span>
              </span>
              <button
                type="button"
                class="px-2.5 py-1 rounded-md bg-[#d32f2f] hover:bg-[#b71c1c] text-white text-[0.7rem] font-bold border-none cursor-pointer flex items-center gap-1 transition-all"
                :disabled="universalCancelling"
                @click="cancelUniversalTranslate"
              >
                <i class="fa-solid fa-hand text-[0.65rem]"></i>
                <span>{{ universalCancelling ? 'Đang dừng...' : 'Dừng tác vụ' }}</span>
              </button>
            </div>
          </div>
          <div class="w-full bg-line-strong rounded-full h-2 overflow-hidden">
            <div
              class="bg-brand-700 h-full transition-all duration-300 rounded-full"
              :style="{ width: `${Math.max(2, universalTask.percent)}%` }"
            ></div>
          </div>
          <p v-if="universalTask.currentItem" class="m-0 text-xs text-brand-800 font-mono truncate" :title="universalTask.currentItem">
            > {{ universalTask.currentItem }}
          </p>
        </div>

        <div class="flex items-center justify-between flex-wrap gap-3">
          <span class="text-xs text-ink-muted">
            Đã chọn <strong>{{ universalSelectedLangs.length }}</strong> ngôn ngữ đích để tự động quét và dịch.
          </span>
          <button
            type="button"
            class="px-6 py-3 rounded-xl bg-brand-900 hover:bg-[#153317] text-white text-sm font-extrabold cursor-pointer border-none flex items-center gap-2 shadow-md disabled:opacity-50 transition-all hover:-translate-y-0.5"
            :disabled="universalRunning || !!universalTask?.active || universalSelectedLangs.length === 0"
            @click="runUniversalTranslate"
          >
            <i class="fa-solid fa-wand-magic-sparkles text-sm" :class="universalTask?.active ? 'animate-spin' : ''"></i>
            <span>{{ universalTask?.active ? 'Đang dịch toàn cục...' : '⚡ Bắt đầu Dịch Toàn Cục Tự Động' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Coverage Breakdown Table by Language -->
    <div class="bg-white rounded-2xl border border-line overflow-hidden shadow-xs">
      <div class="px-5 py-4 border-b border-surface-tint bg-surface flex items-center justify-between flex-wrap gap-2">
        <h4 class="m-0 text-sm font-bold text-brand-950">Bảng thống kê tỷ lệ hoàn thiện theo ngôn ngữ</h4>
        <span class="text-xs text-ink-muted">Cập nhật theo dữ liệu thực tế trong CSDL</span>
      </div>

      <!-- Mobile Card View -->
      <div class="md:hidden divide-y divide-surface-tint">
        <div
          v-for="l in universalStats?.languages || []"
          :key="'m-l-'+l.code"
          class="p-4 flex flex-col gap-2.5"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-2xl leading-none">{{ getFlagEmoji(l.code) }}</span>
              <div>
                <p class="m-0 font-bold text-brand-950 text-sm">{{ l.nativeName }}</p>
                <span class="text-xs text-ink-muted">{{ l.name }} ({{ l.code }})</span>
              </div>
            </div>
            <span class="text-sm font-bold" :class="l.percent === 100 ? 'text-[#2c6e33]' : 'text-[#b78103]'">
              {{ l.percent }}%
            </span>
          </div>

          <div class="w-full h-2 bg-line rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="l.percent === 100 ? 'bg-[#2c6e33]' : 'bg-[#b78103]'"
              :style="{ width: `${l.percent}%` }"
            ></div>
          </div>

          <div class="grid grid-cols-3 gap-1.5 text-center text-xs pt-1">
            <div class="bg-surface p-1.5 rounded-lg border border-surface-tint">
              <span class="block text-[0.65rem] text-ink-muted">UI</span>
              <span class="font-bold text-[0.72rem]" :class="l.uiMissing === 0 ? 'text-[#2c6e33]' : 'text-[#b78103]'">
                {{ l.uiMissing === 0 ? 'Đủ' : `-${l.uiMissing}` }}
              </span>
            </div>
            <div class="bg-surface p-1.5 rounded-lg border border-surface-tint">
              <span class="block text-[0.65rem] text-ink-muted">Khối</span>
              <span class="font-bold text-[0.72rem]" :class="l.blocksMissing === 0 ? 'text-[#2c6e33]' : 'text-[#b78103]'">
                {{ l.blocksMissing === 0 ? 'Đủ' : `-${l.blocksMissing}` }}
              </span>
            </div>
            <div class="bg-surface p-1.5 rounded-lg border border-surface-tint">
              <span class="block text-[0.65rem] text-ink-muted">Bài viết</span>
              <span class="font-bold text-[0.72rem]" :class="l.articlesMissing === 0 ? 'text-[#2c6e33]' : 'text-[#b78103]'">
                {{ l.articlesMissing === 0 ? 'Đủ' : `-${l.articlesMissing}` }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Desktop Table View -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface border-b border-line text-xs text-ink-muted">
            <tr>
              <th class="px-5 py-3 text-left font-bold text-brand-950">Ngôn ngữ</th>
              <th class="px-5 py-3 text-center font-bold text-brand-950">Từ điển UI</th>
              <th class="px-5 py-3 text-center font-bold text-brand-950">Khối trang tĩnh</th>
              <th class="px-5 py-3 text-center font-bold text-brand-950">Bài viết</th>
              <th class="px-5 py-3 text-center font-bold text-brand-950 w-[180px]">Tỷ lệ hoàn thành</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-tint">
            <tr v-for="l in universalStats?.languages || []" :key="l.code" class="hover:bg-surface">
              <td class="px-5 py-3 font-semibold text-brand-950 flex items-center gap-2.5">
                <span class="text-xl leading-none">{{ getFlagEmoji(l.code) }}</span>
                <div>
                  <span class="font-bold">{{ l.nativeName }}</span>
                  <span class="text-xs text-ink-muted ml-1.5">({{ l.name }} - {{ l.code }})</span>
                </div>
              </td>
              <td class="px-5 py-3 text-center">
                <span :class="l.uiMissing === 0 ? 'text-[#2c6e33] font-bold' : 'text-[#b78103] font-semibold'">
                  {{ l.uiMissing === 0 ? '✓ Đầy đủ' : `Thiếu ${l.uiMissing} key` }}
                </span>
              </td>
              <td class="px-5 py-3 text-center">
                <span :class="l.blocksMissing === 0 ? 'text-[#2c6e33] font-bold' : 'text-[#b78103] font-semibold'">
                  {{ l.blocksMissing === 0 ? '✓ Đầy đủ' : `Thiếu ${l.blocksMissing} khối` }}
                </span>
              </td>
              <td class="px-5 py-3 text-center">
                <span :class="l.articlesMissing === 0 ? 'text-[#2c6e33] font-bold' : 'text-[#b78103] font-semibold'">
                  {{ l.articlesMissing === 0 ? '✓ Đầy đủ' : `Thiếu ${l.articlesMissing} bài` }}
                </span>
              </td>
              <td class="px-5 py-3 text-center">
                <div class="flex items-center gap-2 justify-center">
                  <div class="w-24 h-2 bg-line rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                      :class="l.percent === 100 ? 'bg-[#2c6e33]' : 'bg-[#b78103]'"
                      :style="{ width: `${l.percent}%` }"
                    ></div>
                  </div>
                  <span class="text-xs font-bold" :class="l.percent === 100 ? 'text-[#2c6e33]' : 'text-[#b78103]'">
                    {{ l.percent }}%
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
