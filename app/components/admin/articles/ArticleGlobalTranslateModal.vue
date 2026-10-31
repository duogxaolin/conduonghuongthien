<script setup lang="ts">
/**
 * Modal "Dịch toàn bộ bài viết bằng AI" — tách khỏi `pages/admin/content/articles/index.vue`.
 *
 * Tự fetch `/api/admin/articles/translation-stats` khi mở. Có loading spinner
 * (`globalStatsLoading`). Lỗi fetch → toast + modal vẫn mở (không có error branch
 * trong template gốc — `globalStats` chỉ null khi chưa load xong, hiện nothing).
 * Theo coverage gate: fetch có nhưng error→toast (không render empty-state) →
 * `NO_CONTRACT_NEEDED`. Skeleton: chỉ spinner center, KHÔNG thay list → cũng
 * `NO_SKELETON_NEEDED`.
 *
 * Cha truyền `show` + `bulkLangs`. Con emit `close` (đóng) + `started` (khi đã
 * xếp lịch dịch xong, cha refresh bảng + poll).
 */
import type { AdminArticleListResponse, BulkTranslateResponse, TranslationStatsResponse } from '~/types/admin-articles-api'
import { errorMessage } from '~/utils/errorMessage'
import AdminModal from '~/components/admin/AdminModal.vue'

/** Derived from the handler (was hand-written): `GET /api/admin/articles/translation-stats`. */
type GlobalStats = Pick<TranslationStatsResponse, 'totalArticles' | 'aiPendingTranslations' | 'languages'>

const props = defineProps<{
  show: boolean
  bulkLangs: Array<{ code: string; label: string; flag: string }>
}>()

const emit = defineEmits<{
  'close': []
  'started': []
}>()

const globalStatsLoading = ref(false)
const globalStats = ref<GlobalStats | null>(null)
const selectedGlobalTargetLangs = ref<string[]>(['en'])
const globalTargetStatus = ref<'ai_draft' | 'published'>('ai_draft')
const globalTranslating = ref(false)
const toast = useToast()
const { confirm } = useConfirm()
// Leaving the page stops the queueing loop: nothing is POSTed for a page that is gone.
let disposed = false
onBeforeUnmount(() => { disposed = true })

/**
 * At most this many articles per language per click — the list endpoint's page, and the
 * spending decision of the batch-E verify: one click never queues more than 100 paid AI
 * translations per language without the officer clicking again (docs/decisions/fetch-rollout-d-fetch.md).
 */
const PER_CLICK = 100

// Watch: khi `show` true → fetch stats (cha bật modal bằng prop, con tự load).
watch(
  () => props.show,
  async (show) => {
    if (!show) return
    // Never the previous opening's numbers: after a failed load they stayed on screen with
    // "Bắt đầu dịch hàng loạt" enabled.
    globalStats.value = null
    globalStatsLoading.value = true
    try {
      const res = await adminFetch<TranslationStatsResponse>('/api/admin/articles/translation-stats')
      if (res.ok) {
        globalStats.value = {
          totalArticles: res.totalArticles,
          aiPendingTranslations: res.aiPendingTranslations,
          languages: res.languages,
        }
        if (res.languages.length > 0) {
          // Mặc định chọn các ngôn ngữ còn bài chưa dịch
          const missingLangs = res.languages.filter(l => l.missing > 0).map(l => l.code)
          selectedGlobalTargetLangs.value = missingLangs.length > 0 ? missingLangs : [res.languages[0]!.code]
        }
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể tải thống kê bản dịch.'))
    } finally {
      globalStatsLoading.value = false
    }
  },
  { immediate: true },
)

/** "en: 100/120" — what this click queues of what is missing, per language. */
const share = (lang: { code: string, queued: number, missing: number }) => `${lang.code}: ${lang.queued}/${lang.missing}`

async function startGlobalTranslation() {
  if (selectedGlobalTargetLangs.value.length === 0) {
    toast.warning('Vui lòng chọn ít nhất một ngôn ngữ.')
    return
  }
  // Ask first, with the numbers: every article is paid AI calls. The counts come from the stats
  // on screen (an upper bound — the list read next is what is actually sent).
  const planned = selectedGlobalTargetLangs.value.map((code) => {
    const missing = globalStats.value?.languages.find(l => l.code === code)?.missing ?? 0
    return { code, queued: Math.min(PER_CLICK, missing), missing }
  })
  const plannedCount = planned.reduce((sum, lang) => sum + lang.queued, 0)
  if (!await confirm({
    title: 'Xếp lịch dịch AI',
    message: `Xếp lịch dịch tối đa ${plannedCount} bài sang ${planned.length} ngôn ngữ (${planned.map(share).join(', ')})? Mỗi bài là các lượt gọi AI có tính phí; mỗi lượt bấm xếp tối đa ${PER_CLICK} bài cho mỗi ngôn ngữ.`,
    confirmLabel: 'Xếp lịch dịch',
  })) return

  globalTranslating.value = true
  let totalQueuedLangs = 0
  let totalQueuedArticles = 0
  const left: Array<{ code: string, queued: number, missing: number }> = []

  try {
    for (const langCode of selectedGlobalTargetLangs.value) {
      // One page of missing published articles: the per-click cap (no paging past it).
      const listRes = await adminFetch<AdminArticleListResponse>('/api/admin/articles', {
        query: { translation: `missing_${langCode}`, perPage: PER_CLICK, status: 'published' },
      })
      if (disposed) return
      const ids = (listRes.items || []).map(a => Number(a.id))
      if (ids.length > 0) {
        await adminFetch<BulkTranslateResponse>('/api/admin/articles/bulk-translate', {
          method: 'POST',
          body: { ids, langCode, targetStatus: globalTargetStatus.value },
        })
        totalQueuedLangs++
        totalQueuedArticles += ids.length
        const missing = Math.max(ids.length, listRes.pagination?.total ?? ids.length)
        if (missing > ids.length) left.push({ code: langCode, queued: ids.length, missing })
      }
      if (disposed) return
    }

    if (totalQueuedArticles === 0) {
      toast.info('Tất cả các bài viết đã có bản dịch cho các ngôn ngữ đã chọn!')
    } else if (left.length > 0) {
      // Never "done" while articles are left: say how many, and that another click queues them.
      toast.success(`Đã xếp lịch dịch ${totalQueuedArticles} lượt bài viết sang ${totalQueuedLangs} ngôn ngữ (${left.map(share).join(', ')}). Còn bài chưa xếp — bấm lại sau khi lượt dịch đang chạy xong để xếp tiếp.`)
      emit('started')
    } else {
      toast.success(`Đã xếp lịch dịch ${totalQueuedArticles} lượt bài viết sang ${totalQueuedLangs} ngôn ngữ! Hệ thống đang xử lý trong nền.`)
      emit('started')
    }
  } catch (err: unknown) {
    const reason = errorMessage(err, 'Không thể bắt đầu dịch toàn bộ.')
    if (totalQueuedArticles === 0) {
      toast.error(reason)
    } else {
      // The languages queued before the failure ARE translating in the background: say so and
      // let the page follow them — otherwise pressing again queues them a second time.
      toast.error(`${reason} Đã xếp lịch dịch ${totalQueuedArticles} lượt bài viết sang ${totalQueuedLangs} ngôn ngữ trước khi lỗi; các ngôn ngữ còn lại chưa được xếp.`)
      emit('started')
    }
  } finally {
    globalTranslating.value = false
  }
}
</script>

<template>
  <AdminModal
    :open="props.show"
    title="Dịch toàn bộ bài viết bằng AI"
    icon="fa-solid fa-globe"
    size="lg"
    :busy="globalTranslating"
    @close="emit('close')"
  >
      <div class="flex flex-col gap-4">
        <p class="m-0 text-xs text-ink-muted">Tự động quét và xếp lịch dịch cho các bài viết đã xuất bản chưa có bản dịch</p>
        <div v-if="globalStatsLoading" class="py-8 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
          <i class="fa-solid fa-circle-notch fa-spin text-sm text-brand-700"></i> Đang thống kê bài viết...
        </div>

        <template v-else-if="globalStats">
          <div class="p-3 bg-surface-tint border border-[#c8dcc9] rounded-lg text-xs text-brand-900">
            Tổng số bài viết đã xuất bản trên cổng: <strong class="text-sm font-extrabold">{{ globalStats.totalArticles }}</strong> bài viết.
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-brand-950">Chọn các ngôn ngữ muốn dịch toàn bộ:</label>
              <div class="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  class="text-brand-700 hover:underline bg-transparent border-0 cursor-pointer p-0 font-bold"
                  @click="selectedGlobalTargetLangs = globalStats!.languages.map(l => l.code)"
                >Chọn tất cả</button>
                <span class="text-line-strong">|</span>
                <button
                  type="button"
                  class="text-ink-muted hover:underline bg-transparent border-0 cursor-pointer p-0"
                  @click="selectedGlobalTargetLangs = []"
                >Bỏ chọn</button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              <label
                v-for="l in globalStats.languages"
                :key="l.code"
                class="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all"
                :class="selectedGlobalTargetLangs.includes(l.code) ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50'"
              >
                <div class="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    :value="l.code"
                    v-model="selectedGlobalTargetLangs"
                    class="h-4 w-4 accent-brand-700 rounded cursor-pointer"
                  />
                  <span class="text-base leading-none">{{ props.bulkLangs.find(b => b.code === l.code)?.flag || '🌐' }}</span>
                  <span class="text-xs font-bold text-brand-950">{{ l.name }}</span>
                </div>
                <span
                  class="px-2 py-0.5 rounded-full text-[0.65rem] font-bold"
                  :class="l.missing === 0 ? 'bg-[#e4f2e5] text-[#1e4620]' : 'bg-[#fff8e1] text-[#b78103]'"
                >
                  {{ l.missing === 0 ? 'Đã đủ' : `Thiếu ${l.missing} bài` }}
                </span>
              </label>
            </div>
          </div>
          <!-- Trạng thái sau khi dịch -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-brand-950">Trạng thái bản dịch sau khi AI dịch xong:</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label
                class="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all"
                :class="globalTargetStatus === 'ai_draft' ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50'"
              >
                <input type="radio" value="ai_draft" v-model="globalTargetStatus" class="accent-brand-700 mt-0.5" />
                <div class="flex flex-col">
                  <span class="text-xs font-bold text-brand-950">📝 Lưu làm Bản nháp AI</span>
                  <span class="text-[0.68rem] text-ink-muted mt-0.5">Rà soát, kiểm tra lại rồi mới xuất bản (Khuyên dùng)</span>
                </div>
              </label>

              <label
                class="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all"
                :class="globalTargetStatus === 'published' ? 'border-brand-700 bg-surface-tint ring-1 ring-brand-700' : 'border-line hover:bg-gray-50'"
              >
                <input type="radio" value="published" v-model="globalTargetStatus" class="accent-brand-700 mt-0.5" />
                <div class="flex flex-col">
                  <span class="text-xs font-bold text-brand-950">🚀 Xuất bản luôn</span>
                  <span class="text-[0.68rem] text-ink-muted mt-0.5">Hiển thị ngay lập tức ra trang công khai</span>
                </div>
              </label>
            </div>
          </div>

          <!-- Alert nhắc nhở kiểm duyệt -->
          <div class="p-3 bg-[#fff8e1] border border-[#ffe082] rounded-lg text-xs text-warn-ink flex items-start gap-2.5">
            <i class="fa-solid fa-triangle-exclamation text-base shrink-0 text-[#b78103] mt-0.5"></i>
            <div>
              <strong class="font-extrabold text-[#735100]">Lưu ý kiểm duyệt:</strong>
              {{ globalTargetStatus === 'ai_draft'
                ? 'Bản dịch AI sẽ được lưu ở trạng thái Bản nháp AI. Ban biên tập nên kiểm tra lại độ chuẩn xác của thuật ngữ trước khi bấm xuất bản.'
                : 'Bản dịch AI sẽ được tự động xuất bản công khai ngay khi hoàn tất. Bạn có thể vào chỉnh sửa thủ công bất kỳ lúc nào.' }}
            </div>
          </div>
        </template>
      </div>

    <template #footer>
        <button
          type="button"
          class="px-4 py-2 rounded-lg border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-gray-100 cursor-pointer"
          @click="emit('close')"
        >Hủy</button>
        <button
          type="button"
          class="px-5 py-2 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-2 shadow-xs disabled:opacity-50"
          :disabled="globalTranslating || !globalStats"
          @click="startGlobalTranslation"
        >
          <i class="fa-solid fa-wand-magic-sparkles text-xs" :class="globalTranslating ? 'animate-spin' : ''" aria-hidden="true"></i>
          <span>{{ globalTranslating ? 'Đang kích hoạt...' : 'Bắt đầu dịch hàng loạt' }}</span>
        </button>
    </template>
  </AdminModal>
</template>
