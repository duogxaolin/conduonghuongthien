<script setup lang="ts">
/**
 * Hộp "Câu trả lời đã lưu": xem toàn văn, và (có quyền `chatbot_knowledge.update`) sửa nội dung +
 * câu hỏi gợi ý. Danh sách chỉ cho thấy đoạn đầu; đây là nơi duy nhất thấy cả câu.
 *
 * - Nội dung hiện bằng chữ thô (`whitespace-pre-wrap`, KHÔNG `v-html`): đó là markdown do model
 *   viết và sửa tay, widget dựng nó qua bộ lọc riêng; trang quản trị không dựng HTML từ nó.
 * - Tải = một lệnh GET; lỗi có `role="alert"` + "Thử lại" gọi lại `load` (hợp đồng tải/lỗi chung
 *   của trang quản trị, `tests/admin-error-retry-ui.test.ts`).
 * - Lưu = PUT; lỗi máy chủ hiện cạnh nút, hộp giữ nguyên để người sửa không mất chữ đã gõ.
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import type { AdminAnswerCacheDetailResponse, AdminAnswerCacheUpdateResponse } from '~/types/admin-chatbot-api'

const props = defineProps<{ cacheKey: string | null, canEdit: boolean, startEditing: boolean }>()
const emit = defineEmits<{ close: [], saved: [] }>()

const ANSWER_MAX = 10_000
const FOLLOW_UP_MAX_COUNT = 5
const FOLLOW_UP_MAX_CHARS = 200

type Detail = AdminAnswerCacheDetailResponse['item']

const toast = useToast()
const uid = useId()
const detail = ref<Detail | null>(null)
const loading = ref(false)
const loadError = ref('')
const editing = ref(false)
const saving = ref(false)
const saveError = ref('')
const draftAnswer = ref('')
const draftFollowUps = ref('')
let loadSeq = 0

const fmtDate = (v: string | Date | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')
const followUpLines = computed(() => draftFollowUps.value.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean))
const dirty = computed(() => !!detail.value && (
  draftAnswer.value.trim() !== detail.value.answer.trim()
  || JSON.stringify(followUpLines.value) !== JSON.stringify(detail.value.followUps)
))
const validation = computed(() => {
  if (!draftAnswer.value.trim()) return 'Câu trả lời không được để trống.'
  if (draftAnswer.value.trim().length > ANSWER_MAX) return `Câu trả lời tối đa ${ANSWER_MAX} ký tự.`
  if (followUpLines.value.length > FOLLOW_UP_MAX_COUNT) return `Tối đa ${FOLLOW_UP_MAX_COUNT} câu hỏi gợi ý.`
  if (followUpLines.value.some(l => l.length > FOLLOW_UP_MAX_CHARS)) return `Mỗi câu hỏi gợi ý tối đa ${FOLLOW_UP_MAX_CHARS} ký tự.`
  return ''
})

function fillDraft(item: NonNullable<Detail>) {
  draftAnswer.value = item.answer
  draftFollowUps.value = item.followUps.join('\n')
}

async function load() {
  const key = props.cacheKey
  if (!key) return
  const seq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const res = await adminFetch<AdminAnswerCacheDetailResponse>(`/api/admin/chatbot/answer-cache/${key}`)
    if (seq !== loadSeq) return
    detail.value = res.item
    fillDraft(res.item)
    editing.value = props.canEdit && props.startEditing
  } catch (err: unknown) {
    if (seq !== loadSeq) return
    detail.value = null
    loadError.value = errorMessage(err, 'Không thể tải câu trả lời này.')
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(() => props.cacheKey, (key) => {
  detail.value = null
  loadError.value = ''
  saveError.value = ''
  editing.value = false
  if (key) void load()
}, { immediate: true })

function startEdit() {
  if (!props.canEdit || !detail.value) return
  fillDraft(detail.value)
  saveError.value = ''
  editing.value = true
}

function cancelEdit() {
  if (saving.value) return
  if (detail.value) fillDraft(detail.value)
  saveError.value = ''
  editing.value = false
}

async function save() {
  const key = props.cacheKey
  if (!key || !props.canEdit || saving.value || validation.value || !dirty.value) return
  saving.value = true
  saveError.value = ''
  try {
    const res = await adminFetch<AdminAnswerCacheUpdateResponse>(`/api/admin/chatbot/answer-cache/${key}`, {
      method: 'PUT',
      body: { answer: draftAnswer.value, followUps: followUpLines.value },
    })
    if (res.item) {
      detail.value = res.item
      fillDraft(res.item)
    }
    editing.value = false
    toast.success('Đã lưu câu trả lời. Lượt hỏi giống hệt sẽ nhận bản này.')
    emit('saved')
  } catch (err: unknown) {
    saveError.value = errorMessage(err, 'Không thể lưu câu trả lời này.')
  } finally {
    saving.value = false
  }
}

const requestClose = () => { if (!saving.value) emit('close') }
</script>

<template>
  <AdminModal :open="!!cacheKey" title="Câu trả lời đã lưu" size="xl" :busy="saving" @close="requestClose">
    <SkeletonForm v-if="loading" label="Đang tải câu trả lời" :fields="3" />

    <div v-else-if="loadError" role="alert" class="rounded-xl border border-dashed border-danger-soft/45 bg-white px-6 py-8 text-center text-[0.9rem] text-danger-soft">
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ loadError }}
      <button type="button" class="ml-1 font-bold text-brand-700 underline" @click="load()">Thử lại</button>
    </div>

    <div v-else-if="detail" class="flex flex-col gap-4">
      <div>
        <p class="m-0 text-[0.78rem] font-bold text-ink-muted">Câu hỏi</p>
        <p class="m-0 mt-1 text-[0.95rem] font-bold text-brand-950">{{ detail.question }}</p>
        <p class="m-0 mt-1 text-[0.78rem] text-ink-muted">
          {{ detail.hits }} lần dùng · tạo {{ fmtDate(detail.createdAt) }} · dùng gần nhất {{ fmtDate(detail.lastUsedAt) }} · hết hạn {{ fmtDate(detail.expiresAt) }}
        </p>
      </div>

      <template v-if="!editing">
        <div>
          <p class="m-0 text-[0.78rem] font-bold text-ink-muted">Câu trả lời đang được phát lại</p>
          <div data-testid="answer-cache-answer" class="mt-1 max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface px-4 py-3 text-[0.9rem] leading-relaxed text-brand-950">{{ detail.answer }}</div>
        </div>
        <div v-if="detail.followUps.length">
          <p class="m-0 text-[0.78rem] font-bold text-ink-muted">Câu hỏi gợi ý</p>
          <ul class="m-0 mt-1 list-disc pl-5 text-[0.88rem] text-ink-secondary">
            <li v-for="(f, i) in detail.followUps" :key="i">{{ f }}</li>
          </ul>
        </div>
        <div v-if="detail.sources.length">
          <p class="m-0 text-[0.78rem] font-bold text-ink-muted">Nguồn trích dẫn ({{ detail.sources.length }})</p>
          <ul class="m-0 mt-1 list-disc pl-5 text-[0.85rem] text-ink-secondary">
            <li v-for="s in detail.sources" :key="`${s.kind}-${s.id}`">
              {{ s.source?.label || s.source?.reference || `${s.kind} #${s.id}` }}
              <span v-if="s.source?.reference && s.source?.label" class="text-ink-muted"> — {{ s.source.reference }}</span>
            </li>
          </ul>
        </div>
      </template>

      <form v-else class="flex flex-col gap-4" @submit.prevent="save">
        <div class="flex flex-col gap-1.5">
          <label :for="`${uid}-answer`" class="text-sm font-bold text-brand-950">Câu trả lời</label>
          <textarea
            :id="`${uid}-answer`"
            v-model="draftAnswer"
            rows="12"
            data-autofocus
            class="rounded-lg border border-line-strong px-3 py-2 text-[0.9rem] leading-relaxed outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
            :aria-invalid="!draftAnswer.trim() || draftAnswer.trim().length > ANSWER_MAX"
            :aria-describedby="`${uid}-answer-hint`"
          ></textarea>
          <span :id="`${uid}-answer-hint`" class="text-[0.75rem] text-ink-muted">{{ draftAnswer.trim().length }} / {{ ANSWER_MAX }} ký tự. Hỗ trợ markdown như câu trả lời của AI.</span>
        </div>
        <label class="flex flex-col gap-1.5 text-sm font-bold">
          <span class="text-brand-950">Câu hỏi gợi ý (mỗi dòng một câu, tối đa {{ FOLLOW_UP_MAX_COUNT }})</span>
          <textarea
            v-model="draftFollowUps"
            rows="4"
            class="rounded-lg border border-line-strong px-3 py-2 text-[0.88rem] font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/15"
          ></textarea>
        </label>
        <p class="m-0 rounded-lg bg-surface-tint px-3 py-2 text-[0.8rem] text-ink-muted">
          Bản sửa chỉ có hiệu lực tới khi kho kiến thức, bài viết hoặc cấu hình AI thay đổi (khi đó bộ đệm tự vô hiệu và câu hỏi được trả lời lại). Muốn câu trả lời bền, hãy thêm vào Kho kiến thức.
        </p>
        <p v-if="validation" class="m-0 text-[0.82rem] font-bold text-danger-soft" role="alert">{{ validation }}</p>
        <p v-else-if="saveError" class="m-0 rounded-lg border border-danger-soft/45 bg-danger-bg p-3 text-sm text-danger-soft" role="alert">{{ saveError }}</p>
      </form>
    </div>

    <template #footer>
      <template v-if="editing">
        <button type="button" class="rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-surface" :disabled="saving" @click="cancelEdit">Huỷ sửa</button>
        <button type="button" class="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60" :disabled="saving || !!validation || !dirty" @click="save">
          {{ saving ? 'Đang lưu…' : 'Lưu câu trả lời' }}
        </button>
      </template>
      <template v-else>
        <button v-if="canEdit && detail" type="button" class="rounded-lg border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-surface-tint" @click="startEdit">
          <i class="fa-solid fa-pen mr-1 text-[0.75rem]" aria-hidden="true"></i>Sửa
        </button>
        <button type="button" class="rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-surface" @click="requestClose">Đóng</button>
      </template>
    </template>
  </AdminModal>
</template>
