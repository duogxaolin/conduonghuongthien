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
import type { AdminArticleRow } from '~/types/admin-api'
import { errorMessage } from '~/utils/errorMessage'

interface GlobalStats {
  totalArticles: number
  aiPendingTranslations: number
  languages: Array<{ code: string; name: string; nativeName: string; translated: number; missing: number }>
}

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

// Watch: khi `show` true → fetch stats (cha bật modal bằng prop, con tự load).
watch(
  () => props.show,
  async (show) => {
    if (!show) return
    globalStatsLoading.value = true
    try {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean } & GlobalStats>)('/api/admin/articles/translation-stats')
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

async function startGlobalTranslation() {
  if (selectedGlobalTargetLangs.value.length === 0) {
    toast.warning('Vui lòng chọn ít nhất một ngôn ngữ.')
    return
  }

  globalTranslating.value = true
  let totalQueuedLangs = 0
  let totalQueuedArticles = 0

  try {
    for (const langCode of selectedGlobalTargetLangs.value) {
      const listRes = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: AdminArticleRow[] }>)('/api/admin/articles', {
        params: { translation: `missing_${langCode}`, perPage: 100, status: 'published' },
      })
      const targetArticles = listRes.items || []
      if (targetArticles.length > 0) {
        const ids = targetArticles.map(a => Number(a.id))
        await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)('/api/admin/articles/bulk-translate', {
          method: 'POST',
          body: { ids, langCode, targetStatus: globalTargetStatus.value },
        })
        totalQueuedLangs++
        totalQueuedArticles += ids.length
      }
    }

    if (totalQueuedArticles === 0) {
      toast.info('Tất cả các bài viết đã có bản dịch cho các ngôn ngữ đã chọn!')
    } else {
      toast.success(`Đã xếp lịch dịch ${totalQueuedArticles} lượt bài viết sang ${totalQueuedLangs} ngôn ngữ! Hệ thống đang xử lý trong nền.`)
      emit('started')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể bắt đầu dịch toàn bộ.'))
  } finally {
    globalTranslating.value = false
  }
}
</script>

<template>
  <div
    v-if="props.show"
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-xl rounded-xl border border-[#e2ece3] bg-white shadow-xl overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between gap-3 border-b border-[#eef2ee] px-5 py-4 bg-[#f8faf8]">
        <div class="flex items-center gap-2">
          <span class="w-8 h-8 rounded-lg bg-[#1e4620] text-white flex items-center justify-center text-sm shadow-xs">
            <i class="fa-solid fa-globe"></i>
          </span>
          <div>
            <h2 class="m-0 text-base font-extrabold text-[#122815]">Dịch toàn bộ bài viết bằng AI</h2>
            <p class="m-0 text-xs text-[#667768]">Tự động quét và xếp lịch dịch cho các bài viết đã xuất bản chưa có bản dịch</p>
          </div>
        </div>
        <button
          type="button"
          class="rounded-lg border-0 bg-none p-1.5 text-[#667768] hover:text-[#122815] cursor-pointer"
          @click="emit('close')"
        ><i class="fa-solid fa-xmark text-sm"></i></button>
      </div>

      <!-- Body -->
      <div class="px-6 py-5 flex flex-col gap-4">
        <div v-if="globalStatsLoading" class="py-8 text-center text-xs text-[#667768] flex items-center justify-center gap-2">
          <i class="fa-solid fa-circle-notch fa-spin text-sm text-[#2c6e33]"></i> Đang thống kê bài viết...
        </div>

        <template v-else-if="globalStats">
          <div class="p-3 bg-[#f0f7f1] border border-[#c8dcc9] rounded-lg text-xs text-[#1e4620]">
            Tổng số bài viết đã xuất bản trên cổng: <strong class="text-sm font-extrabold">{{ globalStats.totalArticles }}</strong> bài viết.
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-[#122815]">Chọn các ngôn ngữ muốn dịch toàn bộ:</label>
              <div class="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  class="text-[#2c6e33] hover:underline bg-transparent border-0 cursor-pointer p-0 font-bold"
                  @click="selectedGlobalTargetLangs = globalStats!.languages.map(l => l.code)"
                >Chọn tất cả</button>
                <span class="text-[#c8d6c9]">|</span>
                <button
                  type="button"
                  class="text-[#667768] hover:underline bg-transparent border-0 cursor-pointer p-0"
                  @click="selectedGlobalTargetLangs = []"
                >Bỏ chọn</button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              <label
                v-for="l in globalStats.languages"
                :key="l.code"
                class="flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all"
                :class="selectedGlobalTargetLangs.includes(l.code) ? 'border-[#2c6e33] bg-[#f0f7f1] ring-1 ring-[#2c6e33]' : 'border-[#e2ece3] hover:bg-gray-50'"
              >
                <div class="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    :value="l.code"
                    v-model="selectedGlobalTargetLangs"
                    class="h-4 w-4 accent-[#2c6e33] rounded cursor-pointer"
                  />
                  <span class="text-base leading-none">{{ props.bulkLangs.find(b => b.code === l.code)?.flag || '🌐' }}</span>
                  <span class="text-xs font-bold text-[#122815]">{{ l.name }}</span>
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
            <label class="text-xs font-bold text-[#122815]">Trạng thái bản dịch sau khi AI dịch xong:</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label
                class="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all"
                :class="globalTargetStatus === 'ai_draft' ? 'border-[#2c6e33] bg-[#f0f7f1] ring-1 ring-[#2c6e33]' : 'border-[#e2ece3] hover:bg-gray-50'"
              >
                <input type="radio" value="ai_draft" v-model="globalTargetStatus" class="accent-[#2c6e33] mt-0.5" />
                <div class="flex flex-col">
                  <span class="text-xs font-bold text-[#122815]">📝 Lưu làm Bản nháp AI</span>
                  <span class="text-[0.68rem] text-[#667768] mt-0.5">Rà soát, kiểm tra lại rồi mới xuất bản (Khuyên dùng)</span>
                </div>
              </label>

              <label
                class="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all"
                :class="globalTargetStatus === 'published' ? 'border-[#2c6e33] bg-[#f0f7f1] ring-1 ring-[#2c6e33]' : 'border-[#e2ece3] hover:bg-gray-50'"
              >
                <input type="radio" value="published" v-model="globalTargetStatus" class="accent-[#2c6e33] mt-0.5" />
                <div class="flex flex-col">
                  <span class="text-xs font-bold text-[#122815]">🚀 Xuất bản luôn</span>
                  <span class="text-[0.68rem] text-[#667768] mt-0.5">Hiển thị ngay lập tức ra trang công khai</span>
                </div>
              </label>
            </div>
          </div>

          <!-- Alert nhắc nhở kiểm duyệt -->
          <div class="p-3 bg-[#fff8e1] border border-[#ffe082] rounded-lg text-xs text-[#8a6500] flex items-start gap-2.5">
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

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 border-t border-[#eef2ee] px-6 py-4 bg-[#f8faf8]">
        <button
          type="button"
          class="px-4 py-2 rounded-lg border border-[#c8d6c9] bg-white text-xs font-semibold text-[#667768] hover:bg-gray-100 cursor-pointer"
          @click="emit('close')"
        >Hủy</button>
        <button
          type="button"
          class="px-5 py-2 rounded-lg bg-[#1e4620] hover:bg-[#153317] text-white text-xs font-bold border-none cursor-pointer flex items-center gap-2 shadow-xs disabled:opacity-50"
          :disabled="globalTranslating || !globalStats"
          @click="startGlobalTranslation"
        >
          <i class="fa-solid fa-wand-magic-sparkles text-xs" :class="globalTranslating ? 'animate-spin' : ''"></i>
          <span>{{ globalTranslating ? 'Đang kích hoạt...' : 'Bắt đầu dịch hàng loạt' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
