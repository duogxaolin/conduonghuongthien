<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const toast = useToast(); const { confirm } = useConfirm(); const items = ref<any[]>([]); const loading = ref(true); const error = ref(''); const search = ref(''); const topic = ref(''); const status = ref(''); const pagination = ref({ page: 1, totalPages: 1, total: 0 }); const page = ref(1)
const statusLabel: Record<string, string> = { draft: 'Bản nháp', published: 'Đã xuất bản', archived: 'Đã lưu trữ' }
const statusTone: Record<string, string> = { draft: 'border-[#d8c99a] bg-[#fffaf0] text-[#765b00]', published: 'border-[#8ed694] bg-[#f0f7f1] text-[#1e4620]', archived: 'border-[#c8d6c9] bg-[#f4f7f4] text-[#667768]' }
async function load(next = 1) { loading.value = true; error.value = ''; page.value = next; try { const res = await $fetch<any>('/api/admin/chatbot/knowledge', { params: { page: next, perPage: 15, search: search.value, topic: topic.value, status: status.value } }); items.value = res.items || []; pagination.value = res.pagination } catch (err: any) { error.value = err?.data?.statusMessage || 'Không thể tải kho kiến thức.' } finally { loading.value = false } }
async function transition(item: any, action: 'publish' | 'archive') { const verb = action === 'publish' ? 'xuất bản' : 'lưu trữ'; const ok = await confirm({ message: `Bạn có chắc muốn ${verb} mục này?`, confirmLabel: verb === 'xuất bản' ? 'Xuất bản' : 'Lưu trữ' }); if (!ok) return; try { await $fetch(`/api/admin/chatbot/knowledge/${item.id}/${action}`, { method: 'POST' }); toast.success(`Đã ${verb} mục kiến thức.`); await load(page.value) } catch (err: any) { toast.error(err?.data?.statusMessage || `Không thể ${verb} mục kiến thức.`) } }
async function remove(item: any) { const ok = await confirm({ title: 'Xóa mục kiến thức', message: 'Xóa mục kiến thức này? Thao tác không thể hoàn tác.', danger: true, confirmLabel: 'Xóa' }); if (!ok) return; try { await $fetch(`/api/admin/chatbot/knowledge/${item.id}`, { method: 'DELETE' }); toast.success('Đã xóa mục kiến thức.'); await load(page.value) } catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể xóa mục kiến thức.') } }
// ── Excel/CSV import ──
const showImport = ref(false); const importFile = ref<File | null>(null); const importPublish = ref(false); const importTopic = ref(''); const importing = ref(false); const importResult = ref<any>(null)
function onImportFile(e: Event) { importFile.value = (e.target as HTMLInputElement).files?.[0] || null; importResult.value = null }
function closeImport() { showImport.value = false; importFile.value = null; importResult.value = null; importPublish.value = false; importTopic.value = '' }
async function runImport() {
  if (!importFile.value) { toast.error('Vui lòng chọn tệp .xlsx hoặc .csv.'); return }
  importing.value = true; importResult.value = null
  try {
    const fd = new FormData(); fd.append('file', importFile.value); fd.append('publish', importPublish.value ? '1' : '0'); if (importTopic.value.trim()) fd.append('topic', importTopic.value.trim())
    const res = await $fetch<any>('/api/admin/chatbot/knowledge/import', { method: 'POST', body: fd })
    importResult.value = res
    toast.success(`Đã nhập ${res.imported}/${res.total} mục${res.published ? `, xuất bản ${res.published}` : ''}.`)
    await load(1)
  } catch (err: any) { toast.error(err?.data?.statusMessage || 'Không thể nhập tệp.') } finally { importing.value = false }
}
watch([topic, status], () => load(1)); onMounted(() => load())
</script>
<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 class="m-0 text-[1.3rem] font-extrabold text-[#122815]">Kho kiến thức Chatbot</h1><p class="m-0 mt-1 text-sm text-[#667768]">Biên tập câu hỏi, câu trả lời và nguồn tham khảo đã được duyệt.</p></div><div class="flex flex-wrap gap-2"><button type="button" @click="showImport = true" class="inline-flex items-center justify-center gap-2 rounded-lg border border-[#2c6e33] px-4 py-2.5 font-bold text-[#2c6e33] hover:bg-[#f0f7f1]"><i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Nhập từ Excel</button><nuxt-link to="/admin/chatbot/knowledge/new" class="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white no-underline hover:bg-[#2c6e33]">Tạo mục mới</nuxt-link></div></header>
    <div class="flex flex-col gap-3 rounded-xl border border-[#e2ece3] bg-white p-4 sm:flex-row sm:flex-wrap"><label class="min-w-[220px] flex-1 text-sm font-bold">Tìm kiếm<input v-model="search" @keyup.enter="load(1)" type="search" placeholder="Câu hỏi, câu trả lời, từ khóa" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20" /></label><label class="text-sm font-bold">Chủ đề<input v-model="topic" @keyup.enter="load(1)" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]" /></label><label class="text-sm font-bold">Trạng thái<select v-model="status" class="mt-1 w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]"><option value="">Tất cả</option><option value="draft">Bản nháp</option><option value="published">Đã xuất bản</option><option value="archived">Đã lưu trữ</option></select></label><button type="button" class="self-end rounded-lg border border-[#c8d6c9] px-4 py-2.5 font-bold text-[#2c6e33]" @click="load(1)">Lọc</button></div>
    <div v-if="error" class="rounded-lg border border-[#f1b8b5] bg-[#fff4f3] p-3 text-sm text-[#a32924]" role="alert">{{ error }}</div><div v-if="loading" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center text-sm text-[#667768]" aria-live="polite">Đang tải kho kiến thức...</div><div v-else-if="!items.length" class="rounded-xl border border-[#e2ece3] bg-white p-12 text-center"><i class="fa-solid fa-book-open mb-3 text-3xl text-[#c8d6c9]" aria-hidden="true"></i><p class="m-0 font-semibold text-[#667768]">{{ search || topic || status ? 'Không có kết quả phù hợp.' : 'Chưa có mục kiến thức nào.' }}</p></div>
    <div v-else class="overflow-hidden rounded-xl border border-[#e2ece3] bg-white"><div class="overflow-x-auto"><table class="w-full min-w-[760px] border-collapse text-left text-sm"><caption class="sr-only">Danh sách kho kiến thức chatbot</caption><thead class="bg-[#f4f7f4] text-xs uppercase tracking-wide text-[#667768]"><tr><th class="px-4 py-3">Câu hỏi</th><th class="px-4 py-3">Chủ đề</th><th class="px-4 py-3">Trạng thái</th><th class="px-4 py-3">Cập nhật</th><th class="px-4 py-3">Thao tác</th></tr></thead><tbody><tr v-for="item in items" :key="item.id" class="border-t border-[#eef2ee] align-top"><td class="max-w-[360px] px-4 py-3 font-semibold text-[#2c3e2e]">{{ item.canonicalQuestion }}<span v-if="item.isQuickQuestion" class="ml-2 rounded border border-[#c8d6c9] px-1.5 py-0.5 text-[0.7rem] font-normal text-[#667768]">Câu hỏi nhanh</span></td><td class="px-4 py-3 text-[#667768]">{{ item.topic }}</td><td class="px-4 py-3"><span class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold" :class="statusTone[item.status]"><span aria-hidden="true">{{ item.status === 'published' ? '●' : item.status === 'draft' ? '◐' : '○' }}</span>{{ statusLabel[item.status] || item.status }}</span></td><td class="whitespace-nowrap px-4 py-3 text-[#667768]">{{ item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('vi-VN') : '—' }}</td><td class="px-4 py-3"><div class="flex flex-wrap gap-3"><nuxt-link :to="`/admin/chatbot/knowledge/${item.id}`" class="font-bold text-[#2c6e33]">Sửa</nuxt-link><button v-if="item.status === 'draft'" type="button" class="font-bold text-[#2c6e33]" @click="transition(item, 'publish')">Xuất bản</button><button v-if="item.status === 'published'" type="button" class="font-bold text-[#765b00]" @click="transition(item, 'archive')">Lưu trữ</button><button type="button" class="font-bold text-[#d12420]" @click="remove(item)">Xóa</button></div></td></tr></tbody></table></div><nav v-if="pagination.totalPages > 1" class="flex items-center justify-between border-t border-[#eef2ee] p-4" aria-label="Phân trang"><span class="text-sm text-[#667768]">{{ pagination.total }} mục</span><div class="flex gap-2"><button type="button" :disabled="page <= 1" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="load(page - 1)">Trước</button><span class="px-2 py-1.5 text-sm font-bold">Trang {{ page }} / {{ pagination.totalPages }}</span><button type="button" :disabled="page >= pagination.totalPages" class="rounded border border-[#c8d6c9] px-3 py-1.5 font-semibold disabled:opacity-40" @click="load(page + 1)">Sau</button></div></nav></div>

    <!-- Import Excel modal -->
    <div v-if="showImport" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" @click.self="closeImport">
      <div class="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <h2 class="m-0 text-lg font-extrabold text-[#122815]">Nhập câu hỏi từ Excel</h2>
        <p class="m-0 mt-1 text-sm text-[#667768]">Tệp <strong>.xlsx</strong> hoặc <strong>.csv</strong> với các cột: <strong>STT · Câu hỏi · Trả lời · Ghi chú</strong>. Hệ thống tự tách từ khoá để khớp câu hỏi đời thường.</p>
        <div class="mt-4 flex flex-col gap-3">
          <label class="flex flex-col gap-1.5 text-sm font-bold">Chọn tệp
            <input type="file" accept=".xlsx,.csv,.xls" @change="onImportFile" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal file:mr-3 file:rounded file:border-0 file:bg-[#f0f7f1] file:px-3 file:py-1.5 file:font-semibold file:text-[#2c6e33]" />
          </label>
          <label class="flex flex-col gap-1.5 text-sm font-bold">Chủ đề (topic)
            <input v-model="importTopic" placeholder="general" class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33]" />
          </label>
          <label class="flex items-start gap-2 text-sm font-semibold"><input v-model="importPublish" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#2c6e33]" /><span>Xuất bản ngay<br /><span class="font-normal text-[#667768]">Bỏ chọn để lưu Bản nháp chờ duyệt (khuyến nghị). Cần quyền “Xuất bản”.</span></span></label>
        </div>
        <div v-if="importResult" class="mt-3 rounded-lg border border-[#8ed694] bg-[#f0f7f1] p-3 text-sm text-[#1e4620]">
          Đã nhập <strong>{{ importResult.imported }}/{{ importResult.total }}</strong> mục<span v-if="importResult.published">, xuất bản {{ importResult.published }}</span><span v-if="importResult.skipped">, bỏ qua {{ importResult.skipped }}</span>.
          <ul v-if="importResult.errors?.length" class="m-0 mt-1 list-disc pl-5 text-[#a32924]"><li v-for="(e, i) in importResult.errors" :key="i">Dòng {{ e.row }}: {{ e.message }}</li></ul>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-bold text-[#2c3e2e] hover:bg-[#f0f7f1]" @click="closeImport">Đóng</button>
          <button type="button" :disabled="importing || !importFile" class="rounded-lg bg-[#1e4620] px-5 py-2.5 font-bold text-white hover:bg-[#2c6e33] disabled:cursor-not-allowed disabled:opacity-60" @click="runImport">{{ importing ? 'Đang nhập...' : 'Nhập' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
