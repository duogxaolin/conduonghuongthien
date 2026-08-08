<script setup lang="ts">
import type { AdminKnowledgeImportError, AdminKnowledgeImportResult } from '~/types/admin-api'
import type { AdminKnowledgeRow } from '~/types/admin-api'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const route = useRoute(); const router = useRouter()
const activeTab = computed(() => route.query.tab === 'small-talk' ? 'small-talk' : 'knowledge')
function selectTab(tab: 'knowledge' | 'small-talk') { return router.replace({ query: tab === 'knowledge' ? {} : { tab } }) }
const toast = useToast(); const { confirm } = useConfirm(); const items = ref<AdminKnowledgeRow[]>([]); const loading = ref(true); const error = ref(''); const search = ref(''); const topic = ref(''); const status = ref(''); const quick = ref(''); const pagination = ref({ page: 1, totalPages: 1, total: 0 }); const page = ref(1)
const statusLabel: Record<string, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' }
const statusTone: Record<string, string> = { draft: 'border-[#d8c99a] bg-[#fffaf0] text-[#765b00]', published: 'border-[#8ed694] bg-[#f0f7f1] text-[#1e4620]', archived: 'border-[#c8d6c9] bg-[#f4f7f4] text-[#667768]' }
async function load(next = 1) { loading.value = true; error.value = ''; page.value = next; try { const res = await $fetch('/api/admin/chatbot/knowledge', { params: { page: next, perPage: 15, search: search.value, topic: topic.value, status: status.value, quick: quick.value } }); items.value = res.items || []; pagination.value = res.pagination; selection.keepOnly(visibleIds.value) } catch (err: unknown) { error.value = errorMessage(err, 'Không thể tải kho kiến thức.') } finally { loading.value = false } }

// ── Bulk selection ──
const selection = useBulkSelection()
const bulk = useBulkAction(selection)
const visibleIds = computed(() => items.value.map((item) => Number(item.id)))
function bulkDelete() {
  return bulk.run({
    url: '/api/admin/chatbot/knowledge/bulk-delete',
    noun: 'mục kiến thức',
    confirm: { title: 'Xóa mục kiến thức', message: `Xóa ${selection.count.value} mục kiến thức đã chọn? Thao tác không thể hoàn tác.`, danger: true, confirmLabel: 'Xóa' },
    reload: () => load(page.value),
  })
}
function bulkStatus(target: 'published' | 'archived') {
  const verb = target === 'published' ? 'Xuất bản' : 'Lưu trữ'
  return bulk.run({
    url: '/api/admin/chatbot/knowledge/bulk-status',
    body: { status: target },
    noun: 'mục kiến thức',
    confirm: { message: `${verb} ${selection.count.value} mục đã chọn?`, confirmLabel: verb },
    reload: () => load(page.value),
  })
}
function bulkQuickQuestion(target: boolean) {
  const verb = target ? 'Đưa vào câu hỏi nhanh' : 'Bỏ khỏi câu hỏi nhanh'
  return bulk.run({
    url: '/api/admin/chatbot/knowledge/bulk-quick-question',
    body: { isQuickQuestion: target },
    noun: 'mục kiến thức',
    confirm: { message: `${verb} cho ${selection.count.value} mục đã chọn?`, confirmLabel: target ? 'Đưa vào' : 'Bỏ ra' },
    reload: () => load(page.value),
  })
}
/**
 * Optimistic on purpose: the checkbox is the control the operator just clicked,
 * so it has to answer immediately. A failure puts the old value back and says
 * why, rather than reloading the page and losing their scroll position.
 */
async function toggleQuickQuestion(item: AdminKnowledgeRow) {
  const target = !(item.isQuickQuestion === true)
  item.isQuickQuestion = target
  try {
    await $fetch(`/api/admin/chatbot/knowledge/${item.id}`, { method: 'PUT', body: { isQuickQuestion: target } })
    toast.success(target ? 'Đã đưa vào câu hỏi nhanh.' : 'Đã bỏ khỏi câu hỏi nhanh.')
  } catch (err: unknown) {
    item.isQuickQuestion = !target
    toast.error(errorMessage(err, 'Không thể cập nhật câu hỏi nhanh.'))
  }
}
async function transition(item: AdminKnowledgeRow, action: 'publish' | 'archive') { const verb = action === 'publish' ? 'xuất bản' : 'lưu trữ'; const ok = await confirm({ message: `Bạn có chắc muốn ${verb} mục này?`, confirmLabel: verb === 'xuất bản' ? 'Xuất bản' : 'Lưu trữ' }); if (!ok) return; try { await $fetch(`/api/admin/chatbot/knowledge/${item.id}/${action}`, { method: 'POST' }); toast.success(`Đã ${verb} mục kiến thức.`); await load(page.value) } catch (err: unknown) { toast.error(errorMessage(err, 'Đã xảy ra lỗi.') || `Không thể ${verb} mục kiến thức.`) } }
async function remove(item: AdminKnowledgeRow) { const ok = await confirm({ title: 'Xóa mục kiến thức', message: 'Xóa mục kiến thức này? Thao tác không thể hoàn tác.', danger: true, confirmLabel: 'Xóa' }); if (!ok) return; try { await $fetch(`/api/admin/chatbot/knowledge/${item.id}`, { method: 'DELETE' }); toast.success('Đã xóa mục kiến thức.'); await load(page.value) } catch (err: unknown) { toast.error(errorMessage(err, 'Không thể xóa mục kiến thức.')) } }
// ── Excel/CSV import ──
const showImport = ref(false); const importFile = ref<File | null>(null); const importPublish = ref(false); const importTopic = ref(''); const importing = ref(false); const importResult = ref<AdminKnowledgeImportResult | null>(null)
const importStageLabel: Record<string, string> = { parse: 'Đọc tệp', save: 'Lưu dữ liệu', publish: 'Xuất bản' }
const importRawLabels: Record<string, string> = { stt: 'STT', question: 'Câu hỏi', answer: 'Trả lời', note: 'Ghi chú' }
function importRowLabel(item: AdminKnowledgeImportError) { return item.row === item.endRow ? `Dòng ${item.row}` : `Dòng ${item.row}–${item.endRow}` }
/**
 * Only the four mapped text fields belong in the scalar list. `rawExtraColumns`
 * is an array of `{ column, value }`, so leaving it here rendered it as raw JSON
 * under the literal key name — it gets its own readable list below.
 */
function importRawFields(item: AdminKnowledgeImportError) { return Object.entries(item.raw || {}).filter(([field, value]) => field !== 'rawExtraColumns' && String(value || '').length > 0) }
/**
 * Kept in server order WITHOUT filtering: the truncation markers are positional
 * (`rawExtraColumns.<index>.value`), so dropping an entry here would shift every
 * later index and pin the badge to the wrong column.
 */
function importExtraColumns(item: AdminKnowledgeImportError) { return (item.raw?.rawExtraColumns || []) as Array<{ column?: string; value?: string }> }
function importFieldTruncated(item: AdminKnowledgeImportError, field: string) { return (item.truncatedFields || []).includes(field) }
/** The whole list was cut short (more columns than the server previews). */
function importExtraColumnsTruncated(item: AdminKnowledgeImportError) { return importFieldTruncated(item, 'rawExtraColumns') }
/** This one column's value was cut short — server key is `rawExtraColumns.<index>.value`. */
function importExtraColumnTruncated(item: AdminKnowledgeImportError, index: number) { return importFieldTruncated(item, `rawExtraColumns.${index}.value`) }
function importExtraColumnLabel(entry: { column?: string }) { return `Cột ${entry?.column || '?'}` }
function onImportFile(e: Event) { importFile.value = (e.target as HTMLInputElement).files?.[0] || null; importResult.value = null }
const downloadingTemplate = ref(false)
/**
 * Fetched as a blob rather than linked with a plain <a href>: the endpoint is
 * behind the admin session, and on a permission failure a direct navigation
 * would leave the operator staring at raw JSON instead of a toast.
 */
async function downloadTemplate() {
  downloadingTemplate.value = true
  try {
    const blob = await $fetch<Blob>('/api/admin/chatbot/knowledge/template', { responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'mau-nhap-kho-kien-thuc.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (err: unknown) { toast.error(errorMessage(err, 'Không thể tải tệp mẫu.')) } finally { downloadingTemplate.value = false }
}
function closeImport() { showImport.value = false; importFile.value = null; importResult.value = null; importPublish.value = false; importTopic.value = '' }
async function runImport() {
  if (!importFile.value) { toast.error('Vui lòng chọn tệp .xlsx hoặc .csv.'); return }
  importing.value = true; importResult.value = null
  try {
    const fd = new FormData(); fd.append('file', importFile.value); fd.append('publish', importPublish.value ? '1' : '0'); if (importTopic.value.trim()) fd.append('topic', importTopic.value.trim())
    const res = await $fetch('/api/admin/chatbot/knowledge/import', { method: 'POST', body: fd })
    importResult.value = res
    const message = `Đã nhập ${res.imported}/${res.total} mục${res.published ? `, xuất bản ${res.published}` : ''}.`
    if (res.errors?.length) toast.warning(message, 'Nhập tệp chưa hoàn tất')
    else toast.success(message)
    await load(1)
  } catch (err: unknown) { toast.error(errorMessage(err, 'Không thể nhập tệp.')) } finally { importing.value = false }
}
watch([topic, status, quick], () => load(1)); onMounted(() => load())
</script>
<template>
  <div class="flex flex-col gap-5">
    <header><h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Kho nội dung Chatbot</h1><p class="m-0 mt-1 text-sm text-[#667768]">Quản lý riêng kho nghiệp vụ đã duyệt và kho trả lời thường nhật trên cùng một màn hình.</p></header>
    <div class="flex overflow-x-auto rounded-xl border border-[#d7e5d8] bg-white p-1" role="tablist" aria-label="Chọn kho nội dung chatbot">
      <button id="knowledge-tab" type="button" role="tab" :aria-selected="activeTab === 'knowledge'" aria-controls="knowledge-panel" class="min-w-max flex-1 rounded-lg px-4 py-3 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30" :class="activeTab === 'knowledge' ? 'bg-[#1e4620] text-white' : 'text-[#38553b] hover:bg-[#f0f7f1]'" @click="selectTab('knowledge')"><i class="fa-solid fa-book-open mr-2" aria-hidden="true"></i>Kho nghiệp vụ</button>
      <button id="small-talk-tab" type="button" role="tab" :aria-selected="activeTab === 'small-talk'" aria-controls="small-talk-panel" class="min-w-max flex-1 rounded-lg px-4 py-3 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30" :class="activeTab === 'small-talk' ? 'bg-[#1e4620] text-white' : 'text-[#38553b] hover:bg-[#f0f7f1]'" @click="selectTab('small-talk')"><i class="fa-solid fa-comment-dots mr-2" aria-hidden="true"></i>Trả lời thường nhật</button>
    </div>
    <section v-if="activeTab === 'knowledge'" id="knowledge-panel" role="tabpanel" aria-labelledby="knowledge-tab" class="flex flex-col gap-5">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 class="m-0 text-lg font-extrabold text-[#122815]">Kho nghiệp vụ</h2><p class="m-0 mt-1 text-sm text-[#667768]">Biên tập câu hỏi, câu trả lời và nguồn tham khảo theo quy trình nháp, duyệt và xuất bản.</p></div><div class="flex flex-wrap gap-2"><button type="button" @click="showImport = true" class="inline-flex items-center justify-center gap-2 rounded-lg border border-[#2c6e33] px-4 py-2.5 font-bold text-[#2c6e33] hover:bg-[#f0f7f1]"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Nhập từ Excel</button><nuxt-link to="/admin/chatbot/knowledge/new" class="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white no-underline hover:bg-[#2c6e33]">Tạo mục mới</nuxt-link></div></header>
    <div class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-4 sm:flex-row sm:flex-wrap"><label class="min-w-[220px] flex-1 text-sm font-bold">Tìm kiếm<input v-model="search" @keyup.enter="load(1)" type="search" placeholder="Câu hỏi, câu trả lời, từ khóa" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" /></label><label class="text-sm font-bold">Chủ đề<input v-model="topic" @keyup.enter="load(1)" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]" /></label><label class="text-sm font-bold">Trạng thái<select v-model="status" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]"><option value="">Tất cả</option><option value="draft">Bản nháp</option><option value="published">Đã xuất bản</option><option value="archived">Đã lưu trữ</option></select></label><label class="text-sm font-bold">Câu hỏi nhanh<select v-model="quick" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]"><option value="">Tất cả</option><option value="yes">Đang hiển thị</option><option value="no">Chưa hiển thị</option></select></label><button type="button" class="self-end rounded-lg border border-[#c8d6c9] px-4 py-2.5 font-bold text-[#2c6e33]" @click="load(1)">Lọc</button></div>
    <AdminBulkActionBar v-if="selection.count.value" :count="selection.count.value" :busy="bulk.busy.value" noun="mục kiến thức" @clear="selection.clear()">
      <button type="button" class="rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-white/70" @click="bulkStatus('published')">Xuất bản</button>
      <button type="button" class="rounded-lg border border-[#b78103] bg-white px-3 py-2 text-sm font-bold text-[#765b00] hover:bg-white/70" @click="bulkStatus('archived')">Lưu trữ (ẩn)</button>
      <button type="button" class="rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-white/70" @click="bulkQuickQuestion(true)">Đưa vào câu hỏi nhanh</button>
      <button type="button" class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-bold text-[#667768] hover:bg-white/70" @click="bulkQuickQuestion(false)">Bỏ khỏi câu hỏi nhanh</button>
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>
    <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }} Vui lòng <button type="button" class="font-bold underline text-[#4A6741]" @click="load(1)">thử lại</button>.</div><SkeletonTable v-if="loading" label="Đang tải kho kiến thức" :rows="6" :cols="7" /><div v-else-if="!items.length" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center"><i class="fa-solid fa-book-open mb-3 text-3xl text-[#c8d6c9]" aria-hidden="true"></i><p class="m-0 font-semibold text-[#667768]">{{ search || topic || status || quick ? 'Không có kết quả phù hợp.' : 'Chưa có mục kiến thức nào.' }}</p></div>
    <div v-else class="overflow-hidden rounded-xl border border-[#e2ece3] bg-white"><div class="overflow-x-auto"><table class="w-full min-w-[820px] border-collapse text-left text-sm"><caption class="sr-only">Danh sách kho kiến thức chatbot</caption><thead class="bg-[#f4f7f4] text-xs uppercase tracking-wide text-[#667768]"><tr><th class="w-10 px-4 py-3"><input type="checkbox" class="h-4 w-4 accent-[#2c6e33]" :checked="selection.allSelected(visibleIds)" :indeterminate="selection.someSelected(visibleIds)" aria-label="Chọn tất cả mục trên trang" @change="selection.toggleAll(visibleIds)" /></th><th class="px-4 py-3">Câu hỏi</th><th class="px-4 py-3">Chủ đề</th><th class="px-4 py-3">Trạng thái</th><th class="px-4 py-3">Câu hỏi nhanh</th><th class="px-4 py-3">Cập nhật</th><th class="px-4 py-3">Thao tác</th></tr></thead><tbody><tr v-for="item in items" :key="item.id" class="border-t border-[#eef2ee] align-top" :class="selection.isSelected(Number(item.id)) ? 'bg-[#f0f7f1]' : ''"><td class="px-4 py-3"><input type="checkbox" class="h-4 w-4 accent-[#2c6e33]" :checked="selection.isSelected(Number(item.id))" :aria-label="`Chọn mục: ${item.canonicalQuestion}`" @change="selection.toggle(Number(item.id))" /></td><td class="max-w-[360px] px-4 py-3 font-semibold text-[#2c3e2e]">{{ item.canonicalQuestion }}</td><td class="px-4 py-3 text-[#667768]">{{ item.topic }}</td><td class="px-4 py-3"><span class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold" :class="statusTone[item.status]"><span aria-hidden="true">{{ item.status === 'published' ? '●' : item.status === 'draft' ? '◐' : '○' }}</span>{{ statusLabel[item.status] || item.status }}</span></td><td class="px-4 py-3"><label class="inline-flex items-center gap-2 text-xs font-semibold text-[#2c3e2e]"><input type="checkbox" class="h-4 w-4 accent-[#2c6e33]" :checked="item.isQuickQuestion === true" :aria-label="`Bật/tắt câu hỏi nhanh: ${item.canonicalQuestion}`" @change="toggleQuickQuestion(item)" />{{ item.isQuickQuestion ? 'Đang hiển thị' : 'Chưa hiển thị' }}</label></td><td class="whitespace-nowrap px-4 py-3 text-[#667768]">{{ item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('vi-VN') : '—' }}</td><td class="px-4 py-3"><div class="flex flex-wrap gap-3"><nuxt-link :to="`/admin/chatbot/knowledge/${item.id}`" class="font-bold text-[#2c6e33]">Sửa</nuxt-link><button v-if="item.status === 'draft'" type="button" class="font-bold text-[#2c6e33]" @click="transition(item, 'publish')">Xuất bản</button><button v-if="item.status === 'published'" type="button" class="font-bold text-[#765b00]" @click="transition(item, 'archive')">Lưu trữ</button><button type="button" class="font-bold text-[#d12420]" @click="remove(item)">Xóa</button></div></td></tr></tbody></table></div><nav v-if="pagination.totalPages > 1" class="flex items-center justify-between border-t border-[#eef2ee] p-4" aria-label="Phân trang"><span class="text-sm text-[#667768]">{{ pagination.total }} mục</span><div class="flex gap-2"><button type="button" :disabled="page <= 1" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="load(page - 1)">Trước</button><span class="px-2 py-1.5 text-sm font-bold">Trang {{ page }} / {{ pagination.totalPages }}</span><button type="button" :disabled="page >= pagination.totalPages" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="load(page + 1)">Sau</button></div></nav></div>

    <!-- Import Excel modal -->
    <div v-if="showImport" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" @click.self="closeImport">
      <div class="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <h2 id="import-dialog-title" class="m-0 text-lg font-extrabold text-[#122815]">Nhập câu hỏi từ Excel</h2>
        <p class="m-0 mt-1 text-sm text-[#667768]">Tệp <strong>.xlsx</strong> hoặc <strong>.csv</strong> với các cột: <strong>STT · Câu hỏi · Trả lời · Ghi chú</strong>. Hệ thống tự tách từ khoá để khớp câu hỏi đời thường.</p>
        <p class="m-0 mt-1 text-sm text-[#667768]">Câu trả lời dài giữ nguyên định dạng xuống dòng. Có thể xuống dòng trong ô (Alt + Enter) hoặc viết tiếp ở dòng dưới và để trống ô Câu hỏi.</p>
        <button type="button" :disabled="downloadingTemplate" class="mt-3 inline-flex items-center gap-2 self-start rounded-lg border border-[#2c6e33] bg-white px-3 py-2 text-sm font-bold text-[#2c6e33] hover:bg-[#f0f7f1] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/30 disabled:cursor-not-allowed disabled:opacity-60" @click="downloadTemplate">
          <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> {{ downloadingTemplate ? 'Đang tạo tệp...' : 'Tải file mẫu (.xlsx)' }}
        </button>
        <div class="mt-4 flex flex-col gap-3">
          <label class="flex flex-col gap-1.5 text-sm font-bold">Chọn tệp
            <input type="file" accept=".xlsx,.csv,.xls" @change="onImportFile" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal file:mr-3 file:rounded file:border-0 file:bg-[#f0f7f1] file:px-3 file:py-1.5 file:font-semibold file:text-[#2c6e33]" />
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">Chủ đề (topic)
            <input v-model="importTopic" placeholder="general" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]" />
          </label>
          <label class="flex items-start gap-2 text-sm font-semibold"><input v-model="importPublish" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#2c6e33]" /><span>Xuất bản ngay<br /><span class="font-normal text-[#667768]">Bỏ chọn để lưu Bản nháp chờ duyệt (khuyến nghị). Cần quyền “Xuất bản”.</span></span></label>
        </div>
        <section
          v-if="importResult"
          class="mt-3 min-h-0 overflow-y-auto rounded-lg border p-3 text-sm"
          :class="importResult.errors?.length ? (importResult.imported ? 'border-[#e8c56f] bg-[#fffaf0] text-[#765b00]' : 'border-[#f1b8b5] bg-[#fff4f3] text-[#a32924]') : 'border-[#8ed694] bg-[#f0f7f1] text-[#1e4620]'"
          role="alert"
          aria-live="polite"
          aria-label="Kết quả nhập tệp"
        >
          <p class="m-0 font-semibold">
            Đã nhập <strong>{{ importResult.imported }}/{{ importResult.total }}</strong> mục<span v-if="importResult.published">, xuất bản {{ importResult.published }}</span><span v-if="importResult.skipped">, chưa nhập {{ importResult.skipped }}</span>.
          </p>
          <div v-if="importResult.errors?.length" class="mt-3 flex flex-col gap-3">
            <article v-for="e in importResult.errors" :key="`${e.row}-${e.endRow}-${e.stage}-${e.code}`" class="rounded-lg border border-[#e4a4a1] bg-white p-3 text-[#8f211d]">
              <header class="flex flex-wrap items-center gap-2">
                <strong>{{ importRowLabel(e) }}</strong>
                <span class="rounded-full border border-[#e4a4a1] bg-[#fff4f3] px-2 py-0.5 text-xs font-bold">{{ importStageLabel[e.stage] || e.stage }}</span>
              </header>
              <p class="m-0 mt-2 font-semibold">{{ e.message }}</p>
              <dl v-if="importRawFields(e).length" class="m-0 mt-3 flex flex-col gap-2 border-t border-[#f1d0ce] pt-3">
                <div v-for="([field, value]) in importRawFields(e)" :key="field">
                  <dt class="font-bold">
                    {{ importRawLabels[field] || field }}
                    <span v-if="importFieldTruncated(e, field)" class="ml-1 rounded bg-[#fbe5e3] px-1.5 py-0.5 text-xs font-semibold">đã rút gọn</span>
                  </dt>
                  <dd class="m-0 mt-0.5 whitespace-pre-wrap break-words rounded bg-[#fff8f7] px-2 py-1.5 font-mono text-xs text-[#6f1b18]">{{ value }}</dd>
                </div>
              </dl>
              <section v-if="importExtraColumns(e).length" class="mt-3 border-t border-[#f1d0ce] pt-3">
                <p class="m-0 text-xs font-bold uppercase tracking-wide">Cột chưa được ánh xạ</p>
                <dl class="m-0 mt-2 flex flex-col gap-2">
                  <div v-for="(entry, index) in importExtraColumns(e)" :key="`${entry.column}-${index}`">
                    <dt class="font-bold">
                      {{ importExtraColumnLabel(entry) }}
                      <span v-if="importExtraColumnTruncated(e, index)" class="ml-1 rounded bg-[#fbe5e3] px-1.5 py-0.5 text-xs font-semibold">đã rút gọn</span>
                    </dt>
                    <dd class="m-0 mt-0.5 whitespace-pre-wrap break-words rounded bg-[#fff8f7] px-2 py-1.5 font-mono text-xs text-[#6f1b18]">{{ entry.value }}</dd>
                  </div>
                </dl>
                <p v-if="importExtraColumnsTruncated(e)" class="m-0 mt-2 text-xs font-semibold">Danh sách cột đã rút gọn, còn cột khác không hiển thị.</p>
              </section>
            </article>
          </div>
        </section>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-bold text-[#2c3e2e] hover:bg-[#f0f7f1]" @click="closeImport">Đóng</button>
          <button type="button" :disabled="importing || !importFile" class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white hover:bg-[#2c6e33] disabled:cursor-not-allowed disabled:opacity-60" @click="runImport">{{ importing ? 'Đang nhập...' : 'Nhập' }}</button>
        </div>
      </div>
    </div>
    </section>
    <div v-else id="small-talk-panel" role="tabpanel" aria-labelledby="small-talk-tab">
      <AdminChatbotSmallTalkPanel />
    </div>
  </div>
</template>
