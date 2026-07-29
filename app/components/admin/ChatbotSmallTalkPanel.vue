<script setup lang="ts">
const toast = useToast(); const { confirm } = useConfirm()
const items = ref<any[]>([]); const loading = ref(true); const error = ref('')
const search = ref(''); const category = ref(''); const enabled = ref('')
const pagination = ref({ page: 1, totalPages: 1, total: 0 }); const page = ref(1)

const CATEGORY_LABELS: Record<string, string> = {
  social: 'Xã giao', identity: 'Danh tính & năng lực', navigation: 'Điều hướng cổng',
  support: 'Hỗ trợ cảm xúc', portal_facts: 'Thường thức về cổng',
}
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

async function load(next = 1) {
  loading.value = true; error.value = ''; page.value = next
  try {
    const res = await $fetch<any>('/api/admin/chatbot/small-talk', { params: { page: next, perPage: 15, search: search.value, category: category.value, enabled: enabled.value } })
    items.value = res.items || []; pagination.value = res.pagination; selection.keepOnly(visibleIds.value)
  } catch (err: any) { error.value = err?.data?.statusMessage || 'Không thể tải kho trả lời thường nhật.' } finally { loading.value = false }
}

const selection = useBulkSelection(); const bulk = useBulkAction(selection)
const visibleIds = computed(() => items.value.filter((item: any) => !item.isSystem).map((item: any) => Number(item.id)))
function bulkDelete() {
  return bulk.run({ url: '/api/admin/chatbot/small-talk/bulk-delete', noun: 'mục trả lời', confirm: { title: 'Xóa mục trả lời', message: `Xóa ${selection.count.value} mục đã chọn? Thao tác không thể hoàn tác. Mục hệ thống sẽ bị bỏ qua.`, danger: true, confirmLabel: 'Xóa' }, reload: () => load(page.value) })
}
function bulkEnabled(isEnabled: boolean) {
  return bulk.run({ url: '/api/admin/chatbot/small-talk/bulk-enabled', body: { isEnabled }, noun: 'mục trả lời', confirm: { message: `${isEnabled ? 'Bật' : 'Tắt'} ${selection.count.value} mục đã chọn?`, confirmLabel: isEnabled ? 'Bật' : 'Tắt' }, reload: () => load(page.value) })
}
async function toggle(item: any) {
  try { await $fetch(`/api/admin/chatbot/small-talk/${item.id}/toggle`, { method: 'PATCH' }); toast.success(item.isEnabled ? 'Đã tắt mục.' : 'Đã bật mục.'); await load(page.value) }
  catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể đổi trạng thái mục.') }
}
async function remove(item: any) {
  const ok = await confirm({ title: 'Xóa mục trả lời', message: 'Xóa mục này? Thao tác không thể hoàn tác.', danger: true, confirmLabel: 'Xóa' }); if (!ok) return
  try { await $fetch(`/api/admin/chatbot/small-talk/${item.id}`, { method: 'DELETE' }); toast.success('Đã xóa mục.'); await load(page.value) }
  catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể xóa mục.') }
}

const showEditor = ref(false); const saving = ref(false); const editorError = ref(''); const editing = ref<any>(null)
const form = reactive({ category: 'social', question: '', answer: '', patternsText: '' })
function openCreate() { editing.value = null; form.category = 'social'; form.question = ''; form.answer = ''; form.patternsText = ''; editorError.value = ''; showEditor.value = true }
function openEdit(item: any) { editing.value = item; form.category = item.category; form.question = item.question; form.answer = item.answer; form.patternsText = (item.patterns || []).join('\n'); editorError.value = ''; showEditor.value = true }
function closeEditor() { showEditor.value = false; editing.value = null; editorError.value = '' }
async function saveEditor() {
  saving.value = true; editorError.value = ''; const patterns = form.patternsText.split('\n').map(line => line.trim()).filter(Boolean)
  const body = { category: form.category, question: form.question.trim(), answer: form.answer.trim(), patterns }
  try {
    if (editing.value) await $fetch(`/api/admin/chatbot/small-talk/${editing.value.id}`, { method: 'PUT', body })
    else await $fetch('/api/admin/chatbot/small-talk', { method: 'POST', body })
    toast.success(editing.value ? 'Đã cập nhật mục.' : 'Đã thêm mục mới.'); closeEditor(); await load(editing.value ? page.value : 1)
  } catch (err: any) { editorError.value = err?.data?.statusMessage || 'Không thể lưu mục.' } finally { saving.value = false }
}
watch([category, enabled], () => load(1)); onMounted(() => load())
</script>

<template>
  <section class="flex flex-col gap-5" aria-labelledby="small-talk-panel-title">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 id="small-talk-panel-title" class="m-0 text-lg font-extrabold text-[#122815]">Trả lời thường nhật</h2><p class="m-0 mt-1 text-sm text-[#667768]">Kho trả lời chào hỏi, điều hướng và hỗ trợ đời thường. Kho nghiệp vụ luôn được ưu tiên.</p></div>
      <button type="button" @click="openCreate" class="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white hover:bg-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30"><i class="fa-solid fa-plus" aria-hidden="true"></i> Thêm mục mới</button>
    </header>
    <div class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <label class="min-w-[220px] flex-1 text-sm font-bold">Tìm kiếm<input v-model="search" @keyup.enter="load(1)" type="search" placeholder="Câu hỏi hoặc câu trả lời" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" /></label>
      <label class="text-sm font-bold">Nhóm<select v-model="category" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]"><option value="">Tất cả nhóm</option><option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label>
      <label class="text-sm font-bold">Trạng thái<select v-model="enabled" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]"><option value="">Tất cả</option><option value="true">Đang bật</option><option value="false">Đã tắt</option></select></label>
      <button type="button" class="rounded-lg border border-[#c8d6c9] px-4 py-2.5 font-bold text-[#2c6e33] hover:bg-[#f0f7f1]" @click="load(1)">Lọc</button>
    </div>
    <AdminBulkActionBar v-if="selection.count.value" :count="selection.count.value" :busy="bulk.busy.value" noun="mục trả lời" @clear="selection.clear()"><button type="button" class="rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33]" @click="bulkEnabled(true)">Bật</button><button type="button" class="rounded-lg border border-[#b78103] bg-white px-3 py-2 text-sm font-bold text-[#765b00]" @click="bulkEnabled(false)">Tắt</button><button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white" @click="bulkDelete">Xóa</button></AdminBulkActionBar>
    <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }}</div>
    <div v-if="loading" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center text-sm text-[#667768]" aria-live="polite">Đang tải kho trả lời thường nhật...</div>
    <div v-else-if="!items.length" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center"><i class="fa-solid fa-comment-dots mb-3 text-3xl text-[#c8d6c9]" aria-hidden="true"></i><p class="m-0 font-semibold text-[#667768]">{{ search || category || enabled ? 'Không có kết quả phù hợp.' : 'Chưa có mục trả lời nào.' }}</p></div>
    <div v-else class="overflow-hidden rounded-xl border border-[#e2ece3] bg-white"><div class="overflow-x-auto"><table class="w-full min-w-[820px] border-collapse text-left text-sm"><caption class="sr-only">Danh sách kho trả lời thường nhật</caption><thead class="bg-[#f4f7f4] text-xs uppercase tracking-wide text-[#667768]"><tr><th class="w-10 px-4 py-3"><input type="checkbox" class="h-4 w-4 accent-[#2c6e33]" :checked="selection.allSelected(visibleIds)" :indeterminate="selection.someSelected(visibleIds)" aria-label="Chọn tất cả mục có thể xóa trên trang" @change="selection.toggleAll(visibleIds)" /></th><th class="px-4 py-3">Nhóm</th><th class="px-4 py-3">Câu hỏi</th><th class="px-4 py-3">Câu trả lời</th><th class="px-4 py-3">Pattern</th><th class="px-4 py-3">Trạng thái</th><th class="px-4 py-3">Thao tác</th></tr></thead><tbody><tr v-for="item in items" :key="item.id" class="border-t border-[#eef2ee] align-top" :class="selection.isSelected(Number(item.id)) ? 'bg-[#f0f7f1]' : ''"><td class="px-4 py-3"><input v-if="!item.isSystem" type="checkbox" class="h-4 w-4 accent-[#2c6e33]" :checked="selection.isSelected(Number(item.id))" :aria-label="`Chọn mục: ${item.question}`" @change="selection.toggle(Number(item.id))" /><span v-else class="text-[0.7rem] text-[#c8d6c9]" aria-hidden="true">—</span></td><td class="whitespace-nowrap px-4 py-3 text-[#667768]">{{ CATEGORY_LABELS[item.category] || item.category }}</td><td class="max-w-[260px] px-4 py-3 font-semibold text-[#2c3e2e]">{{ item.question }}<span v-if="item.isSystem" class="ml-2 rounded border border-[#c8d6c9] px-1.5 py-0.5 text-[0.7rem] font-normal text-[#667768]">Hệ thống</span></td><td class="max-w-[320px] px-4 py-3 text-[#667768]"><span class="line-clamp-2">{{ item.answer }}</span></td><td class="px-4 py-3 text-center text-[#667768]">{{ (item.patterns || []).length }}</td><td class="px-4 py-3"><span class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold" :class="item.isEnabled ? 'border-[#8ed694] bg-[#f0f7f1] text-[#1e4620]' : 'border-[#c8d6c9] bg-[#f4f7f4] text-[#667768]'"><span aria-hidden="true">{{ item.isEnabled ? '●' : '○' }}</span>{{ item.isEnabled ? 'Đang bật' : 'Đã tắt' }}</span></td><td class="px-4 py-3"><div class="flex flex-wrap gap-3"><button type="button" class="font-bold text-[#2c6e33]" @click="openEdit(item)">Sửa</button><button type="button" class="font-bold text-[#765b00]" @click="toggle(item)">{{ item.isEnabled ? 'Tắt' : 'Bật' }}</button><button v-if="!item.isSystem" type="button" class="font-bold text-[#d12420]" @click="remove(item)">Xóa</button></div></td></tr></tbody></table></div><nav v-if="pagination.totalPages > 1" class="flex items-center justify-between border-t border-[#eef2ee] p-4" aria-label="Phân trang"><span class="text-sm text-[#667768]">{{ pagination.total }} mục</span><div class="flex gap-2"><button type="button" :disabled="page <= 1" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="load(page - 1)">Trước</button><span class="px-2 py-1.5 text-sm font-bold">Trang {{ page }} / {{ pagination.totalPages }}</span><button type="button" :disabled="page >= pagination.totalPages" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="load(page + 1)">Sau</button></div></nav></div>
    <div v-if="showEditor" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" @click.self="closeEditor"><div class="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="small-talk-editor-title"><h2 id="small-talk-editor-title" class="m-0 text-lg font-extrabold text-[#122815]">{{ editing ? 'Sửa mục trả lời' : 'Thêm mục trả lời' }}</h2><p v-if="editing?.isSystem" class="m-0 mt-1 text-sm text-[#667768]">Đây là mục hệ thống: sửa được và bật/tắt được, nhưng không xóa được.</p><div v-if="editorError" class="mt-3 rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ editorError }}</div><div class="mt-4 flex flex-col gap-3"><label class="flex flex-col gap-1.5 text-sm font-bold">Nhóm<select v-model="form.category" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"><option v-for="opt in CATEGORY_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select></label><label class="flex flex-col gap-1.5 text-sm font-bold">Câu hỏi chuẩn<input v-model="form.question" maxlength="500" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal" /></label><label class="flex flex-col gap-1.5 text-sm font-bold">Câu trả lời<textarea v-model="form.answer" rows="4" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"></textarea></label><label class="flex flex-col gap-1.5 text-sm font-bold">Pattern khớp (mỗi dòng một pattern)<textarea v-model="form.patternsText" rows="4" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal"></textarea><span class="font-normal text-[#667768]">Hệ thống tự đưa pattern về dạng không dấu chữ thường. Khớp theo cụm từ trọn vẹn, ưu tiên kho nghiệp vụ trước.</span></label></div><div class="mt-5 flex justify-end gap-2"><button type="button" class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-bold" @click="closeEditor">Hủy</button><button type="button" :disabled="saving" class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white disabled:opacity-60" @click="saveEditor">{{ saving ? 'Đang lưu...' : 'Lưu' }}</button></div></div></div>
  </section>
</template>
