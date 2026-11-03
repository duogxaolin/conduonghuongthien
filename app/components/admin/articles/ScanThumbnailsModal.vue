<script setup lang="ts">
/**
 * Modal quét ảnh thumbnail hỏng + thay bằng ảnh mặc định.
 *
 * Gọi `POST /api/admin/articles/scan-thumbnails`:
 *   - `dryRun: true` → quét, hiện danh sách bài hỏng.
 *   - `dryRun: false` + `fixIds` → UPDATE `thumbnail_url` trong SQL → IPX/NuxtImg
 *     không còn fetch URL hỏng → console hết 404.
 *
 * Khớp `DEFAULT_IMAGES` với `MediaLibraryModal.vue` + `server/services/articles-thumbnail-scan.ts`.
 */
import { computed, ref, watch } from 'vue'
import { errorMessage } from '~/utils/errorMessage'
import type { ArticleScanThumbnailsResponse as ScanResponse } from '~/types/admin-articles-api'

type BrokenArticle = ScanResponse['broken'][number]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'fixed'): void
}>()

const toast = useToast()

const loading = ref(false)
const fixing = ref(false)
const error = ref('')
const report = ref<ScanResponse | null>(null)
const selectedIds = ref<Set<number>>(new Set())

/**
 * Ảnh mặc định — khớp `DEFAULT_IMAGES` trong `MediaLibraryModal.vue` +
 * `DEFAULT_COVER` trong `server/services/articles-thumbnail-scan.ts`.
 */
const DEFAULT_COVER_OPTIONS = [
  { url: '/assets/default_cover_light.png', label: 'Ảnh bìa mặc định' },
  { url: '/assets/hero_banner.jpg', label: 'Banner trang chủ' },
  { url: '/assets/placeholder_c11.png', label: 'Placeholder C11' },
]
const defaultCover = ref('/assets/default_cover_light.png')

const broken = computed<BrokenArticle[]>(() => report.value?.broken ?? [])
const allSelected = computed(() =>
  broken.value.length > 0 && broken.value.every((b) => selectedIds.value.has(b.id)),
)
const someSelected = computed(() => selectedIds.value.size > 0)
const selectedCount = computed(() => selectedIds.value.size)

const reasonLabel = (reason: BrokenArticle['reason']) =>
  reason === 'r2_404' ? 'R2 404' : 'File local thiếu'

const toggleAll = () => {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(broken.value.map((b) => b.id))
  }
}

const toggle = (id: number, checked: boolean) => {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

const runScan = async () => {
  loading.value = true
  error.value = ''
  report.value = null
  selectedIds.value = new Set()
  try {
    const res = await adminFetch<ScanResponse>(
      '/api/admin/articles/scan-thumbnails',
      { method: 'POST', body: { dryRun: true } },
    )
    report.value = res
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Lỗi quét ảnh thumbnail')
    toast.error(error.value)
  } finally {
    loading.value = false
  }
}

const runFix = async () => {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  // Xác nhận trước khi sửa SQL hàng loạt.
  const { confirm } = useConfirm()
  let yes = false
  try {
    yes = await confirm(
      `Sửa ${ids.length} bài viết — đổi thumbnail_url sang "${defaultCover.value}" trong CSDL?`,
    )
  } catch { /* user cancel */ return }
  if (!yes) return

  fixing.value = true
  error.value = ''
  try {
    const res = await adminFetch<ScanResponse>(
      '/api/admin/articles/scan-thumbnails',
      { method: 'POST', body: { dryRun: false, fixIds: ids, defaultCover: defaultCover.value } },
    )
    report.value = res
    selectedIds.value = new Set()
    if (res.fixedCount && res.fixedCount > 0) {
      toast.success(`Đã sửa ${res.fixedCount} bài viết.`)
      emit('fixed')
      // Quét lại idempotent — danh sách hỏng giảm.
      await runScan()
    } else {
      toast.info(res.message || 'Không có bài nào được sửa.')
      // Cập nhật lại danh sách dù không sửa gì — có thể bài đã được sửa ở nơi khác.
      await runScan()
    }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Lỗi sửa thumbnail')
    toast.error(error.value)
  } finally {
    fixing.value = false
  }
}

const close = () => {
  if (loading.value || fixing.value) return
  report.value = null
  selectedIds.value = new Set()
  error.value = ''
  emit('close')
}

watch(() => props.open, (v) => {
  if (v) {
    report.value = null
    selectedIds.value = new Set()
    error.value = ''
    void runScan()
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[99999] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Quét ảnh thumbnail hỏng"
      @keydown.escape="close"
    >
      <div class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" @click="close"></div>
      <div class="flex min-h-screen items-center justify-center p-4">
        <div class="relative w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl" @click.stop>

          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 pb-4">
            <h3 class="flex items-center gap-2 text-base font-semibold text-gray-900">
              <i class="fa-solid fa-wand-magic-sparkles text-green-700"></i>
              Quét ảnh thumbnail hỏng
            </h3>
            <button
              class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition disabled:opacity-50"
              :disabled="loading || fixing"
              @click="close"
            >
              <i class="fa-regular fa-xmark text-xl"></i>
            </button>
          </div>

          <!-- Body -->
          <div class="max-h-[65vh] overflow-y-auto py-4">
            <!-- Loading -->
            <div v-if="loading" class="flex flex-col items-center justify-center py-16 gap-3" role="status" aria-busy="true">
              <i class="fa-regular fa-spinner animate-spin text-4xl text-green-700"></i>
              <p class="text-sm text-gray-500 sr-only">Đang quét ảnh thumbnail...</p>
              <p class="text-sm text-gray-600">Đang quét tất cả bài viết...</p>
            </div>

            <!-- Error -->
            <div v-else-if="error" role="alert" class="py-12 text-center">
              <i class="fa-solid fa-triangle-exclamation text-4xl text-red-400" aria-hidden="true"></i>
              <p class="mt-4 text-sm text-red-600">{{ error }}</p>
              <button
                type="button"
                class="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
                @click="runScan"
              >
                Thử lại
              </button>
            </div>

            <!-- Report -->
            <div v-else-if="report">
              <!-- Summary -->
              <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-3 text-sm">
                <span class="font-semibold text-gray-700">
                  Đã quét: <span class="text-brand-900">{{ report.scanned }}</span> bài
                </span>
                <span class="text-gray-300">·</span>
                <span class="font-semibold" :class="report.brokenCount > 0 ? 'text-red-600' : 'text-green-700'">
                  Ảnh hỏng: {{ report.brokenCount }}
                </span>
                <button
                  type="button"
                  class="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                  :disabled="loading"
                  @click="runScan"
                >
                  <i class="fa-solid fa-rotate" aria-hidden="true"></i> Quét lại
                </button>
              </div>

              <!-- No broken -->
              <div v-if="report.brokenCount === 0" class="py-12 text-center">
                <i class="fa-regular fa-circle-check text-5xl text-green-600" aria-hidden="true"></i>
                <p class="mt-4 text-sm text-gray-600">Tất cả ảnh thumbnail đều tốt — không có bài nào hỏng.</p>
              </div>

              <!-- Broken list -->
              <div v-else>
                <!-- Bulk action bar -->
                <div class="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                  <label class="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      class="h-4 w-4 accent-green-700"
                      :checked="allSelected"
                      :aria-label="allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'"
                      @change="toggleAll"
                    />
                    <span>{{ allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả' }}</span>
                  </label>

                  <label class="flex items-center gap-2 text-sm text-gray-600">
                    <span class="font-medium">Ảnh thay:</span>
                    <select
                      v-model="defaultCover"
                      aria-label="Chọn ảnh mặc định thay thế"
                      class="h-8 rounded-lg border border-gray-200 px-2 text-sm outline-none focus:border-green-600"
                    >
                      <option v-for="opt in DEFAULT_COVER_OPTIONS" :key="opt.url" :value="opt.url">{{ opt.label }}</option>
                    </select>
                  </label>

                  <button
                    type="button"
                    class="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-900 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    :disabled="!someSelected || fixing"
                    @click="runFix"
                  >
                    <i class="fa-regular" :class="fixing ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'"></i>
                    {{ fixing ? 'Đang sửa...' : `Thay ${selectedCount} bài đã chọn` }}
                  </button>
                </div>

                <!-- Table -->
                <div class="overflow-x-auto rounded-lg border border-gray-200">
                  <table class="w-full text-sm">
                    <thead class="bg-gray-50 text-left text-[0.78rem] uppercase text-gray-500">
                      <tr>
                        <th class="px-3 py-2 w-10"></th>
                        <th class="px-3 py-2">Ảnh</th>
                        <th class="px-3 py-2">Bài viết</th>
                        <th class="px-3 py-2">Lý do</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                      <tr v-for="b in broken" :key="b.id" class="hover:bg-gray-50">
                        <td class="px-3 py-2">
                          <input
                            type="checkbox"
                            class="h-4 w-4 accent-green-700"
                            :checked="selectedIds.has(b.id)"
                            :aria-label="`Chọn bài: ${b.title}`"
                            @change="toggle(b.id, ($event.target as HTMLInputElement).checked)"
                          />
                        </td>
                        <td class="px-3 py-2">
                          <div class="h-12 w-16 flex-shrink-0 rounded border border-gray-200 bg-gray-100 flex items-center justify-center overflow-hidden">
                            <i class="fa-regular fa-image text-xl text-gray-300" aria-hidden="true"></i>
                          </div>
                        </td>
                        <td class="px-3 py-2 max-w-[320px]">
                          <span class="block truncate font-medium text-gray-800" :title="b.title">{{ b.title }}</span>
                          <span class="block truncate text-[0.72rem] text-gray-400" :title="b.thumbnailUrl">{{ b.thumbnailUrl }}</span>
                          <nuxt-link :to="`/admin/content/articles/${b.id}`" target="_blank" class="text-[0.72rem] text-green-700 hover:underline">Sửa bài →</nuxt-link>
                        </td>
                        <td class="px-3 py-2">
                          <span
                            class="inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-bold"
                            :class="b.reason === 'r2_404' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'"
                          >
                            {{ reasonLabel(b.reason) }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="mt-2 text-[0.72rem] text-gray-400">
                  Quét tối đa 500 bài hỏng. Nếu nhiều hơn, dùng «Tự vá ảnh R2» ở /admin/settings/media-storage.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
