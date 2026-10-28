<script setup lang="ts">
/**
 * Ngăn kéo "Phiên bản" của trình dựng trang — lưu bản sao lưu (tối đa 4), chỉ định bản gốc,
 * danh sách phiên bản với "Khôi phục"/xoá. Tách khỏi `pages/admin/content/pages/[id].vue`
 * (wave3 4.2): chỉ hiển thị — danh sách và trạng thái vào qua props, tên bản sao lưu là
 * `v-model:label`, mỗi nút phát sự kiện, trang (`usePageVersions`) làm việc.
 *
 * Danh sách đọc hỏng (`failed`): ô lỗi `role="alert"` + "Thử lại" do TRANG vẽ qua slot
 * `#error` (trang giữ lượt tải và nhánh lỗi), thay chỗ danh sách; "Lưu (n/4)" và nút bản
 * gốc chờ tới khi biết danh sách — trước đây lỗi trông như "chưa có phiên bản nào" và nút
 * bản gốc hỏi "Đặt … làm bản gốc" trong khi lượt đó ghi đè bản gốc đang có (FINDING-B1).
 */
import AdminModal from '~/components/admin/AdminModal.vue'
import { isDeliberateEnter } from '~/utils/admin-modal'
import { VERSION_KIND_META as kindMeta, formatVersionDate as fmtDate } from '~/utils/page-builder/versions'
import type { PageVersionRow } from '~/types/admin-api'

const props = defineProps<{
  open: boolean
  versions: PageVersionRow[]
  loading: boolean
  /** The last list load failed: the page's `#error` slot stands in for the list. */
  failed: boolean
  saving: boolean
  manualCount: number
  hasOrigin: boolean
}>()

const label = defineModel<string>('label', { required: true })

const emit = defineEmits<{
  'close': []
  'save': []
  'set-origin': []
  'restore': [version: PageVersionRow]
  'delete': [version: PageVersionRow]
}>()

/**
 * Enter trong ô tên bản sao lưu = bấm "Lưu". Bắt ở `keydown`, KHÔNG `keyup`: mở ngăn
 * kéo bằng Enter trên nút "Phiên bản" đưa focus vào ô này trước khi phím được thả —
 * `@keyup.enter` từng tự lưu một bản sao lưu không ai yêu cầu (mất 1/4 chỗ). Bỏ qua lúc
 * đang gõ dấu (IME tiếng Việt chốt chữ bằng Enter).
 */
const onBackupLabelEnter = (event: KeyboardEvent) => {
  // Phím lặp (giữ Enter) mỗi lần một bản sao lưu — chỉ nhận lần nhấn có chủ đích.
  if (!isDeliberateEnter(event)) return
  event.preventDefault()
  if (props.manualCount < 4 && !props.saving && !props.failed) emit('save')
}
</script>

<template>
  <AdminModal :open="open" title="Phiên bản" size="drawer" :busy="saving" @close="emit('close')">
      <p class="mb-4 mt-0 text-xs text-gray-500">1 bản gốc · tối đa 4 bản sao lưu · 5 bản tự động (cuộn vòng)</p>

      <!-- Actions -->
      <div class="mb-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div class="flex gap-2">
          <input
            v-model="label"
            type="text"
            placeholder="Tên bản sao lưu…"
            class="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
            @keydown.enter="onBackupLabelEnter"
          />
          <button
            class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            :disabled="saving || manualCount >= 4 || failed"
            :title="manualCount >= 4 ? 'Đã đạt tối đa 4 bản sao lưu' : 'Lưu nội dung đang dựng thành bản sao lưu'"
            @click="emit('save')"
          >
            <i :class="saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-bookmark'"></i> Lưu ({{ manualCount }}/4)
          </button>
        </div>
        <button class="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50" :disabled="failed" @click="emit('set-origin')">
          <i class="fa-solid fa-anchor"></i> {{ hasOrigin ? 'Cập nhật bản gốc' : 'Chỉ định làm bản gốc' }}
        </button>
      </div>

      <!-- List -->
      <div>
        <div v-if="loading" class="flex justify-center py-10 text-gray-400"><i class="fa-solid fa-spinner fa-spin text-xl"></i></div>
        <slot v-else-if="failed" name="error" />
        <p v-else-if="!versions.length" class="py-10 text-center text-sm text-gray-400">Chưa có phiên bản nào. Bấm Xuất bản để tạo bản tự động đầu tiên.</p>
        <template v-if="!failed">
        <div
          v-for="v in versions"
          :key="v.id"
          class="mb-2 rounded-lg border border-gray-200 p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                <i :class="[kindMeta[v.kind]?.icon, kindMeta[v.kind]?.color]"></i>
                <span class="truncate">{{ v.label || kindMeta[v.kind]?.label || v.kind }}</span>
              </p>
              <p class="mt-0.5 text-xs text-gray-400">{{ kindMeta[v.kind]?.label }} · {{ v.blockCount }} block · {{ v.createdAt ? fmtDate(v.createdAt) : '—' }}</p>
            </div>
            <span v-if="v.kind === 'origin'" class="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[0.65rem] font-semibold text-blue-600">KHÓA</span>
          </div>
          <div class="mt-2 flex gap-2">
            <button class="flex-1 rounded-md border border-green-200 bg-green-50 px-2 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100" @click="emit('restore', v)">
              <i class="fa-solid fa-rotate-left mr-1"></i> Khôi phục
            </button>
            <button
              v-if="v.kind !== 'origin'"
              class="rounded-md border border-gray-200 px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50"
              :aria-label="`Xóa phiên bản ${v.label || kindMeta[v.kind]?.label || v.kind}`"
              @click="emit('delete', v)"
            >
              <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        </template>
      </div>
  </AdminModal>
</template>
