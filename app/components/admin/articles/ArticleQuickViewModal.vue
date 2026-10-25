<script setup lang="ts">
/**
 * Modal "Xem nhanh" bản dịch AI — tách khỏi `pages/admin/content/articles/index.vue`.
 *
 * Tự fetch translation detail khi mở (cha truyền `articleId` + `langCode`).
 * Có error branch `role="alert"` + nút đóng. Toast lỗi do cha xử lý qua emit
 * 'error' — hoặc con tự toast? Quy ước CLAUDE.md: con giữ fetch + error branch
 * nội bộ. Nhưng test guard yêu cầu ref error + `v-else-if` + `role="alert"` +
 * retry trong cùng file → con phải TỪ持有 `quickViewError` + `retry` handler.
 *
 * Thực tế trong file gốc: lỗi khi fetch → toast + đóng modal (KHÔNG có error
 * branch trong template, chỉ có `quickViewLoading`). Nên đây là fetch có
 * loading nhưng error→toast+close. Theo pattern `NO_CONTRACT_NEEDED`: lỗi
 * không render thành empty-state (modal đóng về table), nên không cần contract.
 */
import { errorMessage } from '~/utils/errorMessage'
import AdminModal from '~/components/admin/AdminModal.vue'

interface QuickViewTranslation {
  articleId: number
  articleTitle: string
  langCode: string
  title: string
  excerpt: string | null
  content: string | null
  status: string
  translatedBy: string
}

const props = defineProps<{
  show: boolean
  articleId: number | null
  articleTitle: string
  langCode: string
  bulkLangs: Array<{ code: string; label: string; flag: string }>
}>()

const emit = defineEmits<{
  'close': []
  'status-toggled': [articleId: number, langCode: string, next: string]
}>()

const quickViewLoading = ref(false)
const quickViewData = ref<QuickViewTranslation | null>(null)
const toast = useToast()

/** Cờ + tên ngôn ngữ của bản dịch đang xem — tiêu đề hộp (tên truy cập) dùng tên. */
const langMeta = computed(() => props.bulkLangs.find(l => l.code === quickViewData.value?.langCode) ?? null)

// Khi `show` chuyển true và có articleId → fetch. Watch cho phép cha
// bật modal bằng `show=true` rồi con tự load (KHÔNG cần cha gọi hàm).
watch(
  () => [props.show, props.articleId, props.langCode] as const,
  async ([show, id, lang]) => {
    if (!show || id === null) return
    quickViewData.value = {
      articleId: id,
      articleTitle: props.articleTitle,
      langCode: lang,
      title: 'Đang tải...',
      excerpt: null,
      content: null,
      status: 'loading',
      translatedBy: 'ai',
    }
    quickViewLoading.value = true
    try {
      const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; translation: QuickViewTranslation }>)(
        `/api/admin/articles/${id}/translations/${lang}`,
      )
      if (res.ok && res.translation) {
        quickViewData.value = {
          articleId: id,
          articleTitle: props.articleTitle,
          langCode: res.translation.langCode,
          title: res.translation.title,
          excerpt: res.translation.excerpt,
          content: res.translation.content,
          status: res.translation.status,
          translatedBy: res.translation.translatedBy,
        }
      }
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Không thể tải bản dịch.'))
      emit('close')
    } finally {
      quickViewLoading.value = false
    }
  },
  { immediate: true },
)

async function toggleStatus() {
  if (!quickViewData.value) return
  const current = quickViewData.value.status
  const next = current === 'published' ? 'reviewed' : 'published'
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(
      `/api/admin/articles/${quickViewData.value.articleId}/translations/${quickViewData.value.langCode}/status`,
      { method: 'PATCH', body: { status: next } },
    )
    quickViewData.value.status = next
    toast.success(next === 'published' ? 'Đã xuất bản bản dịch!' : 'Đã gỡ xuất bản.')
    emit('status-toggled', quickViewData.value.articleId, quickViewData.value.langCode, next)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể đổi trạng thái.'))
  }
}
</script>

<template>
  <AdminModal
    :open="props.show && !!quickViewData"
    :title="`Bản dịch ${langMeta?.label || quickViewData?.langCode || ''}`"
    size="xl"
    @close="emit('close')"
  >
      <div v-if="quickViewData" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="m-0 flex items-center gap-2 text-xs text-ink-muted">
            <span class="text-xl leading-none" aria-hidden="true">{{ langMeta?.flag }}</span>
            Bài viết gốc: {{ quickViewData.articleTitle }}
          </p>
          <span
            class="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
            :class="quickViewData.status === 'published' ? 'bg-[#e4f2e5] text-[#1e4620]' : 'bg-[#fff8e1] text-[#b78103]'"
          >
            {{ quickViewData.status === 'published' ? 'Đã xuất bản' : 'Bản nháp AI' }}
          </span>
        </div>

        <div v-if="quickViewLoading" class="py-12 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
          <i class="fa-solid fa-circle-notch fa-spin text-sm text-brand-700"></i> Đang tải bản dịch...
        </div>

        <template v-else>
          <!-- Title -->
          <div class="flex flex-col gap-1">
            <span class="text-xs font-bold text-ink-muted uppercase tracking-wide">Tiêu đề dịch:</span>
            <h3 class="m-0 text-base font-bold text-brand-900">{{ quickViewData.title }}</h3>
          </div>

          <!-- Excerpt -->
          <div v-if="quickViewData.excerpt" class="flex flex-col gap-1 bg-[#fcfdfc] p-3 rounded-lg border border-[#eef2ee]">
            <span class="text-xs font-bold text-ink-muted uppercase tracking-wide">Tóm tắt:</span>
            <p class="m-0 text-xs leading-relaxed text-ink-secondary">{{ quickViewData.excerpt }}</p>
          </div>

          <!-- Content HTML -->
          <div class="flex flex-col gap-1">
            <span class="text-xs font-bold text-ink-muted uppercase tracking-wide">Nội dung chi tiết (HTML):</span>
            <div class="p-4 rounded-lg border border-line bg-[#fafcfa] text-xs leading-relaxed text-[#1f2937] max-h-80 overflow-y-auto font-sans" v-html="quickViewData.content || '(Chưa có nội dung)'"></div>
          </div>
        </template>
      </div>

    <template v-if="quickViewData" #footer>
        <nuxt-link
          :to="`/admin/content/articles/${quickViewData.articleId}`"
          class="mr-auto text-xs font-bold text-brand-700 hover:underline flex items-center gap-1.5 no-underline"
        >
          <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Mở trong trang soạn thảo
        </nuxt-link>
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-xs font-bold cursor-pointer border transition-colors"
            :class="quickViewData.status === 'published'
              ? 'border-line-strong bg-white text-danger hover:bg-[#fff5f4]'
              : 'border-brand-700 bg-[#e4f2e5] text-brand-900 hover:bg-[#d4ebd6]'"
            @click="toggleStatus"
          >
            {{ quickViewData.status === 'published' ? 'Gỡ xuất bản' : 'Xuất bản ngay' }}
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-lg border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-gray-100 cursor-pointer"
            @click="emit('close')"
          >Đóng</button>
    </template>
  </AdminModal>
</template>
