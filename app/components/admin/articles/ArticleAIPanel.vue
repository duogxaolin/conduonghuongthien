<script setup lang="ts">
/**
 * Trợ lý AI Biên tập (gợi ý tiêu đề / tóm tắt / soát lỗi) — tách khỏi
 * `pages/admin/content/articles/[id].vue`.
 *
 * Tự fetch `/api/admin/ai/editorial`. KHÔNG có error branch (toast only — AI là
 * best-effort, lỗi không blank form đang soạn). KHÔNG có skeleton (toolbar luôn
 * render, drawer preview hiện khi có kết quả). → `NO_CONTRACT_NEEDED` +
 * `NO_SKELETON_NEEDED` ở test guard.
 *
 * Cha truyền `formTitle` + `getEditorContent`/`setEditorContent` callbacks (vì
 * TinyMCE editor state sống ở cha — `TINYMCE_EDITOR_ID` + `tinymceReady`). Con
 * emit `update:title` / `update:excerpt` khi áp dụng gợi ý.
 */
interface PolishChangeItem {
  original: string
  suggested: string
  reason: string
  applied?: boolean
}

const props = defineProps<{
  formTitle: string
  getEditorContent: () => string
  setEditorContent: (html: string) => void
}>()

const emit = defineEmits<{
  'update:title': [title: string]
  'update:excerpt': [excerpt: string]
}>()

const aiLoading = ref(false)
const aiLoadingText = ref('')
const suggestedTitles = ref<string[]>([])
const suggestedSummaries = ref<string[]>([])
const polishedPreview = ref<{
  content: string
  summaryNotes?: string
  changes: PolishChangeItem[]
} | null>(null)

const toast = useToast()

function applyTitle(title: string) {
  emit('update:title', title)
  suggestedTitles.value = []
  toast.success('Đã áp dụng tiêu đề!')
}

function applySummary(summary: string) {
  // Clean any "Phương án 1:" prefix if present
  const cleanSummary = summary.replace(/^Phương án\s*\d+[^:]*:\s*/i, '').replace(/^Option\s*\d+[^:]*:\s*/i, '').trim()
  emit('update:excerpt', cleanSummary)
  suggestedSummaries.value = []
  toast.success('Đã áp dụng tóm tắt bài viết!')
}

function applySingleChange(change: PolishChangeItem) {
  const current = props.getEditorContent()
  if (!change.original) return
  // `replaceFirstLiteral`, không `String.replace(chuỗi, chuỗi)`: vế thay thế của
  // `replace` hiểu `$&`/`` $` ``/`$'` là mẫu — một gợi ý chứa chúng sẽ chèn lại
  // một phần bài viết thay vì đúng chữ AI đề xuất.
  const direct = replaceFirstLiteral(current, change.original, change.suggested)
  if (direct === null) {
    const plainOrig = change.original.replace(/<[^>]*>/g, '').trim()
    const cleanSug = change.suggested.replace(/<[^>]*>/g, '').trim()
    const plain = replaceFirstLiteral(current, plainOrig, cleanSug)
    if (plain === null) {
      toast.error(`Không tìm thấy đoạn "${change.original.slice(0, 35)}..." trong bài viết hiện tại.`)
      return
    }
    props.setEditorContent(plain)
  } else {
    props.setEditorContent(direct)
  }
  change.applied = true
  toast.success(`Đã sửa: "${change.suggested.slice(0, 30)}..."`)
}

function applyAllPolishedChanges() {
  if (!polishedPreview.value) return
  if (polishedPreview.value.content) {
    props.setEditorContent(polishedPreview.value.content)
  } else {
    let html = props.getEditorContent()
    for (const c of polishedPreview.value.changes) {
      const next = replaceFirstLiteral(html, c.original, c.suggested)
      if (next !== null) {
        html = next
        c.applied = true
      }
    }
    props.setEditorContent(html)
  }
  if (polishedPreview.value.changes) {
    polishedPreview.value.changes.forEach(c => { c.applied = true })
  }
  toast.success('Đã áp dụng toàn bộ sửa đổi vào bài viết!')
}

async function callAiEditorial(action: 'summary' | 'suggest_titles' | 'polish') {
  const content = props.getEditorContent()
  if (!content && !props.formTitle) {
    toast.error('Vui lòng nhập tiêu đề hoặc nội dung bài viết trước khi dùng Trợ lý AI.')
    return
  }

  aiLoading.value = true
  if (action === 'summary') aiLoadingText.value = 'Trợ lý AI đang đề xuất các phương án tóm tắt...'
  else if (action === 'suggest_titles') aiLoadingText.value = 'Trợ lý AI đang sáng tạo các tiêu đề hay...'
  else aiLoadingText.value = 'Trợ lý AI đang rà soát chính tả và văn phong...'

  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{
      ok: boolean
      action: string
      options?: string[]
      titles?: string[]
      polishedContent?: string
      notes?: string[]
      rawText?: string
      changes?: PolishChangeItem[]
      summaryNotes?: string
    }>)('/api/admin/ai/editorial', {
      method: 'POST',
      body: { action, title: props.formTitle, content },
    })

    if (action === 'summary') {
      suggestedSummaries.value = res.options && res.options.length > 0 ? res.options : [res.rawText || '']
      toast.success('Đã có đề xuất tóm tắt, mời bạn xem và chọn bên dưới!')
    } else if (action === 'suggest_titles') {
      suggestedTitles.value = res.titles && res.titles.length > 0 ? res.titles : (res.rawText || '').split('\n').filter(Boolean)
      toast.success('Đã có đề xuất tiêu đề, mời bạn bấm chọn bên dưới!')
    } else if (action === 'polish') {
      polishedPreview.value = {
        // Chỉ `polishedContent` — máy chủ đã lọc qua sanitizeHtml (kể cả khi đó là
        // câu trả lời thô của model). KHÔNG lùi về `rawText`: chuỗi đó chưa lọc mà
        // ô xem trước hiển thị bằng v-html.
        content: res.polishedContent || '',
        summaryNotes: res.summaryNotes || (res.notes?.join(' • ')) || 'Đã rà soát chính tả, ngữ pháp và thuật ngữ pháp lý.',
        changes: Array.isArray(res.changes)
          ? res.changes.map(c => ({ ...c, applied: false }))
          : [],
      }
      toast.success('Đã rà soát xong, mời bạn xem các điểm sửa đổi bên dưới!')
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Lỗi khi gọi Trợ lý AI.'))
  } finally {
    aiLoading.value = false
  }
}
</script>

<template>
  <div class="rounded-xl border border-[#c8dcc9] bg-surface-tint p-3.5 flex flex-col gap-2.5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="w-6 h-6 rounded-md bg-brand-900 text-white flex items-center justify-center text-xs shadow-xs">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
        </span>
        <span class="text-xs font-bold text-brand-900 uppercase tracking-wide">Trợ lý AI Biên tập & Dịch thuật</span>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="px-2.5 py-1 rounded-lg border border-[#a2cca4] bg-white text-xs font-semibold text-brand-900 hover:bg-[#e4ece4] transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
          :disabled="aiLoading"
          @click="callAiEditorial('suggest_titles')"
        >
          <i class="fa-regular fa-lightbulb text-[0.7rem]"></i>
          Gợi ý tiêu đề
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded-lg border border-[#a2cca4] bg-white text-xs font-semibold text-brand-900 hover:bg-[#e4ece4] transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
          :disabled="aiLoading"
          @click="callAiEditorial('summary')"
        >
          <i class="fa-regular fa-file-lines text-[0.7rem]"></i>
          Tự động viết tóm tắt
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded-lg border border-[#a2cca4] bg-white text-xs font-semibold text-brand-900 hover:bg-[#e4ece4] transition-all flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
          :disabled="aiLoading"
          @click="callAiEditorial('polish')"
        >
          <i class="fa-solid fa-spell-check text-[0.7rem]"></i>
          Soát lỗi & Văn phong
        </button>
        <!-- Dịch bài viết đã được chuyển vào phần Quản lý Bản dịch chuyên biệt -->
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="aiLoading" class="flex items-center gap-2 py-1 text-xs text-brand-700 font-semibold animate-pulse motion-reduce:animate-none">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <span>{{ aiLoadingText }}</span>
    </div>

    <!-- Suggested Titles Drawer -->
    <div v-if="suggestedTitles.length > 0" class="rounded-lg bg-white border border-line-strong p-3 flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-brand-900">💡 Đề xuất tiêu đề từ AI (Bấm vào tiêu đề để chọn):</span>
        <button type="button" class="text-xs text-ink-muted hover:text-danger border-none bg-transparent cursor-pointer" @click="suggestedTitles = []">Đóng</button>
      </div>
      <div class="flex flex-col gap-1.5">
        <button
          v-for="(t, idx) in suggestedTitles"
          :key="idx"
          type="button"
          class="w-full text-left p-2 rounded-lg border border-line hover:border-brand-700 hover:bg-surface-tint text-xs font-semibold text-brand-950 transition-colors cursor-pointer"
          @click="applyTitle(t)"
        >
          {{ t }}
        </button>
      </div>
    </div>

    <!-- Suggested Summaries Drawer -->
    <div v-if="suggestedSummaries.length > 0" class="rounded-lg bg-white border border-line-strong p-3.5 flex flex-col gap-2.5">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-brand-900">📝 Đề xuất tóm tắt từ AI (Chọn phương án bạn ưng ý nhất):</span>
        <button type="button" class="text-xs text-ink-muted hover:text-danger border-none bg-transparent cursor-pointer" @click="suggestedSummaries = []">Đóng</button>
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="(s, idx) in suggestedSummaries"
          :key="idx"
          class="p-3 rounded-lg border border-line hover:border-brand-700 bg-[#fcfdfc] hover:bg-surface-tint transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p class="m-0 text-xs text-[#2d3748] leading-relaxed flex-1">{{ s }}</p>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold shrink-0 transition-colors border-none cursor-pointer self-start sm:self-auto"
            @click="applySummary(s)"
          >
            <i class="fa-solid fa-check mr-1"></i> Áp dụng vào Tóm tắt
          </button>
        </div>
      </div>
    </div>

    <!-- Polished Content Preview Drawer -->
    <div v-if="polishedPreview" class="rounded-xl bg-white border border-line-strong p-4 flex flex-col gap-3 shadow-md">
      <div class="flex items-center justify-between border-b border-line pb-2.5">
        <div class="flex items-center gap-2">
          <span class="w-7 h-7 rounded-lg bg-surface-tint text-brand-700 flex items-center justify-center text-xs">
            <i class="fa-solid fa-spell-check"></i>
          </span>
          <span class="text-sm font-extrabold text-brand-950">Kết quả rà soát & đề xuất sửa lỗi:</span>
          <span v-if="polishedPreview.changes?.length" class="text-xs font-bold px-2 py-0.5 rounded-full bg-surface-tint text-brand-700">
            {{ polishedPreview.changes.length }} điểm cần sửa
          </span>
        </div>
        <button type="button" class="text-xs text-ink-muted hover:text-danger border-none bg-transparent cursor-pointer p-1" @click="polishedPreview = null">
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>

      <!-- Summary note -->
      <div v-if="polishedPreview.summaryNotes" class="text-xs font-medium text-brand-700 bg-surface-tint p-2.5 rounded-lg border border-line-strong flex items-start gap-2">
        <i class="fa-solid fa-lightbulb text-sm mt-0.5 shrink-0 text-[#7CB342]"></i>
        <span>{{ polishedPreview.summaryNotes }}</span>
      </div>

      <!-- List of specific changes (Cái nào sai đổi thành cái nào) -->
      <div v-if="polishedPreview.changes && polishedPreview.changes.length > 0" class="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1">
        <div
          v-for="(change, idx) in polishedPreview.changes"
          :key="idx"
          class="rounded-xl border p-3 flex flex-col gap-2 transition-all text-xs"
          :class="change.applied ? 'border-green-300 bg-green-50/50 opacity-75' : 'border-[#e2ece3] bg-white hover:border-brand-700/40 shadow-xs'"
        >
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="font-bold text-ink-muted text-[0.72rem]">Lỗi #{{ idx + 1 }}: {{ change.reason || 'Chuẩn hóa câu từ' }}</span>
            <span v-if="change.applied" class="text-[0.7rem] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
              <i class="fa-solid fa-check"></i> Đã áp dụng
            </span>
            <button
              v-else
              type="button"
              class="px-2.5 py-1 rounded-md bg-brand-700 hover:bg-brand-900 text-white text-[0.72rem] font-bold cursor-pointer border-none flex items-center gap-1 transition-all active:scale-95"
              @click="applySingleChange(change)"
            >
              <i class="fa-solid fa-check"></i> Áp dụng sửa đổi này
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <!-- Đoạn sai / cũ -->
            <div class="p-2 rounded-lg bg-red-50 border border-red-200 text-red-900 flex flex-col gap-0.5">
              <span class="text-[0.65rem] font-extrabold uppercase tracking-wide text-red-700 flex items-center gap-1">
                <i class="fa-solid fa-xmark"></i> Đoạn văn bản gốc:
              </span>
              <span class="line-through decoration-red-400 font-medium break-words leading-relaxed">{{ change.original }}</span>
            </div>

            <!-- Đoạn sửa / mới -->
            <div class="p-2 rounded-lg bg-green-50 border border-green-200 text-green-900 flex flex-col gap-0.5">
              <span class="text-[0.65rem] font-extrabold uppercase tracking-wide text-green-700 flex items-center gap-1">
                <i class="fa-solid fa-check"></i> Đề xuất chuẩn hóa:
              </span>
              <span class="font-bold break-words leading-relaxed">{{ change.suggested }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Nếu không có danh sách chi tiết mà chỉ có nội dung đã sửa -->
      <div v-else class="max-h-60 overflow-y-auto p-3 rounded-lg border border-line bg-[#fcfdfc] text-xs leading-relaxed text-[#2d3748]">
        <!-- eslint-disable-next-line vue/no-v-html -- đầu ra AI, đã sanitizeHtml ở server/api/admin/ai/editorial.post.ts -->
        <div v-html="polishedPreview.content"></div>
      </div>

      <!-- Footer actions -->
      <div class="flex items-center justify-between pt-2 border-t border-line flex-wrap gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-md border border-line-strong bg-white text-xs font-semibold text-ink-muted hover:bg-[#f8faf8] cursor-pointer"
          @click="polishedPreview = null"
        >
          Đóng
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-brand-900 hover:bg-[#153317] text-white text-xs font-bold cursor-pointer border-none flex items-center gap-2 shadow-xs transition-all active:scale-95"
          @click="applyAllPolishedChanges"
        >
          <i class="fa-solid fa-check-double"></i> Áp dụng tất cả sửa đổi vào bài viết
        </button>
      </div>
    </div>
  </div>
</template>
