<script setup lang="ts">
import type { AdminKnowledgeDetail } from '~/types/admin-api'
import type { AdminKnowledgeCreateResponse, AdminKnowledgeTransitionResponse, AdminKnowledgeUpdateResponse } from '~/types/admin-chatbot-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirm()
const isNew = computed(() => route.params.id === 'new')
const loading = ref(!isNew.value)
const saving = ref(false)
const transitioning = ref<'publish' | 'archive' | null>(null)
/** A failed LOAD only — the one failure "thử lại" (re-read the entry) answers. */
const error = ref('')
/**
 * A failed save/publish/archive (or the "required" check): its sentence, no reload — a
 * reload replaces what the officer typed with the stored row (tests/admin-fetch-rollout-knowledge-editor.test.ts).
 */
const actionError = ref('')
/**
 * The form holds the entry. A new entry always; an existing one only after a load filled it —
 * a failed load used to leave an empty, saveable form (with "Xuất bản" from the default
 * status) that PUT over the real entry.
 */
const loaded = ref(isNew.value)
const lifecycleStatus = ref<'draft' | 'published' | 'archived'>('draft')
const statusLabel = computed(() => ({ draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' })[lifecycleStatus.value])
const statusTone = computed(() => ({
  draft: 'border-[#d8c99a] bg-[#fffaf0] text-[#765b00]',
  published: 'border-[#8ed694] bg-surface-tint text-brand-900',
  archived: 'border-line-strong bg-[#f4f7f4] text-ink-muted',
})[lifecycleStatus.value])
const form = reactive({
  canonicalQuestion: '',
  approvedAnswer: '',
  topic: 'general',
  aliases: '',
  keywords: '',
  sourceLabel: '',
  sourceUrl: '',
  sourceReference: '',
  internalNotes: '',
  priority: 0,
  isQuickQuestion: false,
})

const split = (value: string) => value.split(/[\n,]/u).map(item => item.trim()).filter(Boolean)

function applyItem(item: NonNullable<AdminKnowledgeDetail['item']>) {
  form.canonicalQuestion = item.canonicalQuestion || ''
  form.approvedAnswer = item.approvedAnswer || ''
  form.topic = item.topic || 'general'
  form.aliases = (item.aliases || []).join('\n')
  form.keywords = (item.keywords || []).join('\n')
  form.sourceLabel = item.sourceLabel || ''
  form.sourceUrl = item.sourceUrl || ''
  form.sourceReference = item.sourceReference || ''
  form.internalNotes = item.internalNotes || ''
  form.priority = Number(item.priority) || 0
  form.isQuickQuestion = item.isQuickQuestion === true
  lifecycleStatus.value = item.status || 'draft'
}

function contentPayload() {
  return {
    canonicalQuestion: form.canonicalQuestion,
    approvedAnswer: form.approvedAnswer,
    topic: form.topic,
    aliases: split(form.aliases),
    keywords: split(form.keywords),
    sourceLabel: form.sourceLabel,
    sourceUrl: form.sourceUrl,
    sourceReference: form.sourceReference,
    internalNotes: form.internalNotes,
    priority: Number(form.priority),
    isQuickQuestion: form.isQuickQuestion,
  }
}

async function load() {
  if (isNew.value) return
  loading.value = true
  loaded.value = false
  error.value = ''
  try {
    const response = await adminFetch<AdminKnowledgeDetail>(`/api/admin/chatbot/knowledge/${route.params.id}`)
    if (!response?.item) throw createError({ statusCode: 404, statusMessage: 'Mục kiến thức không tồn tại.' })
    applyItem(response.item)
    loaded.value = true
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không thể tải mục kiến thức.')
  } finally {
    loading.value = false
  }
}

async function save() {
  actionError.value = ''
  if (!form.canonicalQuestion.trim() || !form.approvedAnswer.trim()) {
    actionError.value = 'Câu hỏi và câu trả lời là bắt buộc.'
    return
  }
  saving.value = true
  try {
    const response = await adminFetch<AdminKnowledgeCreateResponse | AdminKnowledgeUpdateResponse>(isNew.value ? '/api/admin/chatbot/knowledge' : `/api/admin/chatbot/knowledge/${route.params.id}`, {
      method: isNew.value ? 'POST' : 'PUT',
      body: contentPayload(),
    })
    /**
     * `adminKnowledge()` trả `null` khi không tìm thấy hàng, nên phản hồi khai
     * `item: … | null`. Trước đây `$fetch<any>` che chỗ này: `response.item.id`
     * trên một `null` sẽ ném **trong khối `try`**, nên nó hiện ra dưới dạng
     * "Không thể lưu mục kiến thức" — tức là báo lưu thất bại cho một lượt lưu
     * đã thành công, và cán bộ sẽ đi bấm lưu lần nữa.
     */
    if (!response?.item) throw createError({ statusCode: 500, statusMessage: 'Máy chủ không trả về nội dung vừa lưu.' })
    applyItem(response.item)
    toast.success(isNew.value ? 'Đã tạo bản nháp kiến thức.' : 'Đã cập nhật nội dung kiến thức.')
    if (isNew.value) await navigateTo(`/admin/chatbot/knowledge/${response.item.id}`)
    else await load()
  } catch (err: unknown) {
    actionError.value = errorMessage(err, 'Không thể lưu mục kiến thức.')
  } finally {
    saving.value = false
  }
}

async function transition(action: 'publish' | 'archive') {
  if (isNew.value) return
  const publishing = action === 'publish'
  const confirmation = publishing
    ? 'Xuất bản nội dung đã lưu? Câu trả lời và thông tin nguồn phải đầy đủ.'
    : 'Lưu trữ mục kiến thức này? Mục sẽ không còn được dùng cho trả lời công khai.'
  const confirmLabel = publishing ? 'Xuất bản' : 'Lưu trữ'
  const ok = await confirm({ message: confirmation, confirmLabel })
  if (!ok) return

  actionError.value = ''
  transitioning.value = action
  try {
    await adminFetch<AdminKnowledgeTransitionResponse>(`/api/admin/chatbot/knowledge/${route.params.id}/${action}`, { method: 'POST' })
    toast.success(publishing ? 'Đã xuất bản mục kiến thức.' : 'Đã lưu trữ mục kiến thức.')
    await load()
  } catch (err: unknown) {
    // The action's own sentence IS the fallback: `errorMessage` never returns '', so an
    // `errorMessage(err, 'Đã xảy ra lỗi.') || …` branch was dead.
    actionError.value = errorMessage(err, publishing ? 'Không thể xuất bản mục kiến thức.' : 'Không thể lưu trữ mục kiến thức.')
  } finally {
    transitioning.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="m-0 text-[1.3rem] font-extrabold text-brand-950">{{ isNew ? 'Tạo mục kiến thức' : 'Chỉnh sửa mục kiến thức' }}</h1>
        <p class="m-0 mt-1 text-sm text-ink-muted">Tách bạch nội dung công khai, nguồn tham khảo và ghi chú nội bộ.</p>
      </div>
      <nuxt-link to="/admin/chatbot/knowledge" class="font-bold text-brand-700">Quay lại danh sách</nuxt-link>
    </header>

    <!-- "thử lại" only for a failed load: after a failed action it would replace the typed text with the stored row. -->
    <div v-if="error || actionError" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error || actionError }}<template v-if="error"> Vui lòng <button type="button" class="font-bold underline text-brand-600" @click="load()">thử lại</button>.</template></div>
    <div v-if="loading" class="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
      <SkeletonForm label="Đang tải mục kiến thức" :fields="4" />
      <SkeletonForm label="Đang tải mục kiến thức" :fields="3" :has-action="false" />
    </div>

    <form v-else-if="loaded" class="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]" @submit.prevent="save">
      <section class="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
        <h2 class="m-0 text-base font-extrabold text-brand-950">Nội dung công khai</h2>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Câu hỏi chính<input v-model="form.canonicalQuestion" required class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Câu trả lời đã duyệt<textarea v-model="form.approvedAnswer" required rows="10" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"></textarea></label>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-sm font-bold">Chủ đề<input v-model="form.topic" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal" /></label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">Độ ưu tiên<input v-model.number="form.priority" type="number" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal" /></label>
        </div>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Bí danh <span class="font-normal text-ink-muted">Mỗi dòng một bí danh</span><textarea v-model="form.aliases" rows="3" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal"></textarea></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Từ khóa <span class="font-normal text-ink-muted">Mỗi dòng một từ khóa</span><textarea v-model="form.keywords" rows="3" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal"></textarea></label>
      </section>

      <aside class="flex flex-col gap-4 rounded-xl border border-line bg-white p-5">
        <h2 class="m-0 text-base font-extrabold text-brand-950">Nguồn và duyệt</h2>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Nhãn nguồn<input v-model="form.sourceLabel" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">URL nguồn<input v-model="form.sourceUrl" type="url" placeholder="https://..." class="rounded-lg border border-line-strong px-3 py-2.5 font-normal" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Số hiệu / tham chiếu<textarea v-model="form.sourceReference" rows="3" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal"></textarea></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Ghi chú nội bộ <span class="font-normal text-ink-muted">Không bao giờ hiển thị công khai.</span><textarea v-model="form.internalNotes" rows="5" class="rounded-lg border border-line-strong px-3 py-2.5 font-normal"></textarea></label>

        <div class="flex flex-col gap-2 text-sm font-bold">
          <span>Trạng thái hiện tại</span>
          <span class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-bold" :class="statusTone" aria-live="polite">{{ statusLabel }}</span>
          <span class="font-normal text-ink-muted">Lưu chỉ cập nhật nội dung. Trạng thái chỉ đổi bằng thao tác duyệt riêng.</span>
        </div>

        <label class="flex items-center gap-2 text-sm font-semibold"><input v-model="form.isQuickQuestion" type="checkbox" class="h-4 w-4 accent-brand-700" /> Đưa vào câu hỏi nhanh</label>
        <button type="submit" :disabled="saving || transitioning !== null" class="rounded-lg bg-brand-900 px-5 py-2.5 font-bold text-white disabled:opacity-60">{{ saving ? 'Đang lưu...' : 'Lưu nội dung' }}</button>
        <button v-if="!isNew && lifecycleStatus === 'draft'" type="button" :disabled="saving || transitioning !== null" class="rounded-lg border border-brand-700 px-5 py-2.5 font-bold text-brand-700 disabled:opacity-60" @click="transition('publish')">{{ transitioning === 'publish' ? 'Đang xuất bản...' : 'Xuất bản' }}</button>
        <button v-if="!isNew && lifecycleStatus === 'published'" type="button" :disabled="saving || transitioning !== null" class="rounded-lg border border-[#d8c99a] px-5 py-2.5 font-bold text-[#765b00] disabled:opacity-60" @click="transition('archive')">{{ transitioning === 'archive' ? 'Đang lưu trữ...' : 'Lưu trữ' }}</button>
      </aside>
    </form>
  </div>
</template>
