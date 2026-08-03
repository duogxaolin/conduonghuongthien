<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirm()
const isNew = computed(() => route.params.id === 'new')
const loading = ref(!isNew.value)
const saving = ref(false)
const transitioning = ref<'publish' | 'archive' | null>(null)
const error = ref('')
const lifecycleStatus = ref<'draft' | 'published' | 'archived'>('draft')
const statusLabel = computed(() => ({ draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' })[lifecycleStatus.value])
const statusTone = computed(() => ({
  draft: 'border-[#d8c99a] bg-[#fffaf0] text-[#765b00]',
  published: 'border-[#8ed694] bg-[#f0f7f1] text-[#1e4620]',
  archived: 'border-[#c8d6c9] bg-[#f4f7f4] text-[#667768]',
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

function applyItem(item: any) {
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
  error.value = ''
  try {
    const response = await $fetch<any>(`/api/admin/chatbot/knowledge/${route.params.id}`)
    applyItem(response.item)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không thể tải mục kiến thức.'
  } finally {
    loading.value = false
  }
}

async function save() {
  error.value = ''
  if (!form.canonicalQuestion.trim() || !form.approvedAnswer.trim()) {
    error.value = 'Câu hỏi và câu trả lời là bắt buộc.'
    return
  }
  saving.value = true
  try {
    const response = await $fetch<any>(isNew.value ? '/api/admin/chatbot/knowledge' : `/api/admin/chatbot/knowledge/${route.params.id}`, {
      method: isNew.value ? 'POST' : 'PUT',
      body: contentPayload(),
    })
    applyItem(response.item)
    toast.success(isNew.value ? 'Đã tạo bản nháp kiến thức.' : 'Đã cập nhật nội dung kiến thức.')
    if (isNew.value) await navigateTo(`/admin/chatbot/knowledge/${response.item.id}`)
    else await load()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Không thể lưu mục kiến thức.'
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

  error.value = ''
  transitioning.value = action
  try {
    await $fetch(`/api/admin/chatbot/knowledge/${route.params.id}/${action}`, { method: 'POST' })
    toast.success(publishing ? 'Đã xuất bản mục kiến thức.' : 'Đã lưu trữ mục kiến thức.')
    await load()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || (publishing ? 'Không thể xuất bản mục kiến thức.' : 'Không thể lưu trữ mục kiến thức.')
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
        <h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">{{ isNew ? 'Tạo mục kiến thức' : 'Chỉnh sửa mục kiến thức' }}</h1>
        <p class="m-0 mt-1 text-sm text-[#667768]">Tách bạch nội dung công khai, nguồn tham khảo và ghi chú nội bộ.</p>
      </div>
      <nuxt-link to="/admin/chatbot/knowledge" class="font-bold text-[#2c6e33]">Quay lại danh sách</nuxt-link>
    </header>

    <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }}<template v-if="!isNew && !saving"> Vui lòng <button type="button" class="font-bold underline text-[#4A6741]" @click="load()">thử lại</button>.</template></div>
    <div v-if="loading" class="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
      <SkeletonForm label="Đang tải mục kiến thức" :fields="4" />
      <SkeletonForm label="Đang tải mục kiến thức" :fields="3" :has-action="false" />
    </div>

    <form v-else class="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]" @submit.prevent="save">
      <section class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-5">
        <h2 class="m-0 text-base font-extrabold text-[#122815]">Nội dung công khai</h2>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Câu hỏi chính<input v-model="form.canonicalQuestion" required class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Câu trả lời đã duyệt<textarea v-model="form.approvedAnswer" required rows="10" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"></textarea></label>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-sm font-bold">Chủ đề<input v-model="form.topic" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal" /></label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">Độ ưu tiên<input v-model.number="form.priority" type="number" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal" /></label>
        </div>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Bí danh <span class="font-normal text-[#667768]">Mỗi dòng một bí danh</span><textarea v-model="form.aliases" rows="3" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"></textarea></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Từ khóa <span class="font-normal text-[#667768]">Mỗi dòng một từ khóa</span><textarea v-model="form.keywords" rows="3" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"></textarea></label>
      </section>

      <aside class="flex flex-col gap-4 rounded-xl border border-[#e2ece3] bg-white p-5">
        <h2 class="m-0 text-base font-extrabold text-[#122815]">Nguồn và duyệt</h2>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Nhãn nguồn<input v-model="form.sourceLabel" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">URL nguồn<input v-model="form.sourceUrl" type="url" placeholder="https://..." class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Số hiệu / tham chiếu<textarea v-model="form.sourceReference" rows="3" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"></textarea></label>
        <label class="flex flex-col gap-1.5 text-sm font-bold">Ghi chú nội bộ <span class="font-normal text-[#667768]">Không bao giờ hiển thị công khai.</span><textarea v-model="form.internalNotes" rows="5" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"></textarea></label>

        <div class="flex flex-col gap-2 text-sm font-bold">
          <span>Trạng thái hiện tại</span>
          <span class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-bold" :class="statusTone" aria-live="polite">{{ statusLabel }}</span>
          <span class="font-normal text-[#667768]">Lưu chỉ cập nhật nội dung. Trạng thái chỉ đổi bằng thao tác duyệt riêng.</span>
        </div>

        <label class="flex items-center gap-2 text-sm font-semibold"><input v-model="form.isQuickQuestion" type="checkbox" class="h-4 w-4 accent-[#2c6e33]" /> Đưa vào câu hỏi nhanh</label>
        <button type="submit" :disabled="saving || transitioning !== null" class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white disabled:opacity-60">{{ saving ? 'Đang lưu...' : 'Lưu nội dung' }}</button>
        <button v-if="!isNew && lifecycleStatus === 'draft'" type="button" :disabled="saving || transitioning !== null" class="rounded-lg border border-[#2c6e33] px-5 py-2.5 font-bold text-[#2c6e33] disabled:opacity-60" @click="transition('publish')">{{ transitioning === 'publish' ? 'Đang xuất bản...' : 'Xuất bản' }}</button>
        <button v-if="!isNew && lifecycleStatus === 'published'" type="button" :disabled="saving || transitioning !== null" class="rounded-lg border border-[#d8c99a] px-5 py-2.5 font-bold text-[#765b00] disabled:opacity-60" @click="transition('archive')">{{ transitioning === 'archive' ? 'Đang lưu trữ...' : 'Lưu trữ' }}</button>
      </aside>
    </form>
  </div>
</template>
