<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">Quản lý Trang</h1>
        <p class="text-sm text-gray-500 mt-1">Tạo và chỉnh sửa các trang bằng trình dựng block kéo-thả.</p>
      </div>
      <button
        class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800"
        @click="openCreate"
      >
        <i class="fa-solid fa-plus"></i>
        Tạo trang mới
      </button>
    </div>

    <!-- Loading -->
    <SkeletonTable v-if="loading" label="Đang tải danh sách trang" :rows="5" :cols="6" />

    <!-- Error -->
    <div v-else-if="loadError" role="alert" class="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600">
      <p>{{ loadError }}</p>
      <button class="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100" @click="fetchPages">Thử lại</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!pages.length" class="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
      <i class="fa-solid fa-file-lines text-4xl text-gray-300"></i>
      <p class="mt-3">Chưa có trang nào. Nhấn "Tạo trang mới" để bắt đầu.</p>
    </div>

    <!-- Bulk action bar -->
    <AdminBulkActionBar
      v-if="selection.count.value"
      :count="selection.count.value"
      :busy="bulk.busy.value"
      noun="trang"
      class="mb-4"
      @clear="selection.clear()"
    >
      <button type="button" class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b]" @click="bulkDelete">Xóa</button>
    </AdminBulkActionBar>

    <!-- List. Condition spelled out rather than chained with v-else: the bulk bar
         sits between the empty state and this table, which would break a chain. -->
    <div v-if="!loading && !loadError && pages.length" class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <!-- Mobile Card View: Hiển thị dạng thẻ tiện thao tác trên điện thoại -->
      <div class="md:hidden divide-y divide-gray-100">
        <div
          v-for="p in pages"
          :key="'m-'+p.id"
          class="p-4 flex flex-col gap-2.5 transition active:bg-gray-50"
          :class="selection.isSelected(Number(p.id)) ? 'bg-[#f0f7f1]' : ''"
        >
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex items-center gap-2.5 min-w-0">
              <input
                v-if="!p.isSystem"
                type="checkbox"
                class="h-4 w-4 shrink-0 accent-[#2c6e33]"
                :checked="selection.isSelected(Number(p.id))"
                :aria-label="`Chọn trang ${p.title}`"
                @change="selection.toggle(Number(p.id))"
              />
              <div class="min-w-0">
                <p class="m-0 font-bold text-gray-900 text-[0.92rem] truncate">{{ p.title }}</p>
                <code class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 mt-1 inline-block">/{{ p.slug === 'home' ? '' : p.slug }}</code>
              </div>
            </div>
            <span v-if="p.isSystem" class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-600 shrink-0">
              <i class="fa-solid fa-lock text-[0.65rem]"></i> Hệ thống
            </span>
            <span v-else class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500 shrink-0">Tùy chỉnh</span>
          </div>

          <div class="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
            <span>{{ p.blockCount }} blocks nội dung</span>
            <div class="flex items-center gap-2">
              <nuxt-link :to="`/admin/content/pages/${p.id}`" class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-600 hover:text-green-700 no-underline">
                <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa
              </nuxt-link>
              <button
                v-if="!p.isSystem"
                class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 cursor-pointer bg-white"
                @click="removePage(p)"
              >
                <i class="fa-solid fa-trash mr-1"></i> Xóa
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Desktop Table View: Bảng đầy đủ trên máy tính -->
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th class="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.allSelected(visibleIds)"
                  :indeterminate="selection.someSelected(visibleIds)"
                  aria-label="Chọn tất cả trang có thể xóa"
                  @change="selection.toggleAll(visibleIds)"
                />
              </th>
              <th class="px-5 py-3 font-semibold">Tiêu đề</th>
              <th class="px-5 py-3 font-semibold">Đường dẫn</th>
              <th class="px-5 py-3 font-semibold text-center">Số block</th>
              <th class="px-5 py-3 font-semibold text-center">Loại</th>
              <th class="px-5 py-3 font-semibold text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="p in pages"
              :key="p.id"
              class="transition hover:bg-gray-50"
              :class="selection.isSelected(Number(p.id)) ? 'bg-[#f0f7f1]' : ''"
            >
              <td class="px-5 py-3.5">
                <input
                  v-if="!p.isSystem"
                  type="checkbox"
                  class="h-4 w-4 accent-[#2c6e33]"
                  :checked="selection.isSelected(Number(p.id))"
                  :aria-label="`Chọn trang ${p.title}`"
                  @change="selection.toggle(Number(p.id))"
                />
              </td>
              <td class="px-5 py-3.5 font-semibold text-gray-800">{{ p.title }}</td>
              <td class="px-5 py-3.5 text-gray-500"><code class="rounded bg-gray-100 px-2 py-0.5 text-xs">/{{ p.slug === 'home' ? '' : p.slug }}</code></td>
              <td class="px-5 py-3.5 text-center text-gray-600">{{ p.blockCount }}</td>
              <td class="px-5 py-3.5 text-center">
                <span v-if="p.isSystem" class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600">
                  <i class="fa-solid fa-lock text-[0.65rem]"></i> Hệ thống
                </span>
                <span v-else class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">Tùy chỉnh</span>
              </td>
              <td class="px-5 py-3.5 text-right">
                <div class="flex items-center justify-end gap-2">
                  <nuxt-link :to="`/admin/content/pages/${p.id}`" class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-600 hover:text-green-700">
                    <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa
                  </nuxt-link>
                  <button
                    v-if="!p.isSystem"
                    class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                    @click="removePage(p)"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create modal -->
    <AdminModal :open="showCreate" title="Tạo trang mới" size="sm" :busy="creating" @close="showCreate = false">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Tiêu đề trang *</label>
            <input v-model="createForm.title" type="text" placeholder="VD: Chương trình hỗ trợ" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Đường dẫn (slug)</label>
            <input v-model="createForm.slug" type="text" placeholder="tự động tạo từ tiêu đề nếu để trống" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
        </div>
        <template #footer>
          <button type="button" class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="showCreate = false">Hủy</button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            :disabled="creating || !createForm.title.trim()"
            @click="createPage"
          >
            <i v-if="creating" class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            Tạo trang
          </button>
        </template>
    </AdminModal>
  </div>
</template>

<script setup lang="ts">
import type { AdminPageRow } from '~/types/admin-api'
import AdminModal from '~/components/admin/AdminModal.vue'
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { confirm } = useConfirm()

const pages = ref<AdminPageRow[]>([])
const loading = ref(true)
const loadError = ref('')

const showCreate = ref(false)
const creating = ref(false)
const createForm = reactive({ title: '', slug: '' })

const fetchPages = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: AdminPageRow[] }>)(`/api/admin/pages`)
    if (res.ok) {
      pages.value = res.items
      selection.keepOnly(visibleIds.value)
    }
  } catch (err: unknown) {
    loadError.value = errorMessage(err, 'Không tải được danh sách trang.')
  } finally {
    loading.value = false
  }
}

// ─── Bulk selection ───────────────────────────────────────────────────────────
const selection = useBulkSelection()
const bulk = useBulkAction(selection)

/**
 * System pages back fixed public routes and can never be deleted, so they are
 * left out of the selectable set entirely rather than offered and then refused.
 */
const visibleIds = computed(() => pages.value.filter((p) => !p.isSystem).map((p) => Number(p.id)))

const bulkDelete = () => bulk.run({
  url: '/api/admin/pages/bulk-delete',
  noun: 'trang',
  confirm: {
    title: 'Xóa trang',
    message: `Xóa ${selection.count.value} trang đã chọn? Toàn bộ block của các trang này sẽ bị xóa. Thao tác không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa',
  },
  reload: fetchPages,
})

const openCreate = () => {
  createForm.title = ''
  createForm.slug = ''
  showCreate.value = true
}

const createPage = async () => {
  if (!createForm.title.trim()) return
  creating.value = true
  try {
    const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; id: number }>)(`/api/admin/pages`, {
      method: 'POST',
      body: { title: createForm.title.trim(), slug: createForm.slug.trim() || undefined },
    })
    if (res.ok) {
      toast.success('Đã tạo trang mới.')
      showCreate.value = false
      await navigateTo(`/admin/content/pages/${res.id}`)
    }
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không tạo được trang.'))
  } finally {
    creating.value = false
  }
}

const removePage = async (p: AdminPageRow) => {
  const ok = await confirm({
    title: 'Xóa trang',
    message: `Xóa trang "${p.title}"? Toàn bộ block của trang sẽ bị xóa. Hành động này không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa',
  })
  if (!ok) return
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/admin/pages/${p.id}`, { method: 'DELETE' })
    toast.success('Đã xóa trang.')
    await fetchPages()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xóa được trang.'))
  }
}

onMounted(fetchPages)
</script>
