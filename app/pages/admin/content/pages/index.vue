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
    <div v-if="loading" class="flex items-center justify-center py-20 text-gray-400">
      <i class="fa-solid fa-spinner fa-spin text-2xl"></i>
    </div>

    <!-- Error -->
    <div v-else-if="loadError" class="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600">
      <p>{{ loadError }}</p>
      <button class="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100" @click="fetchPages">Thử lại</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!pages.length" class="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
      <i class="fa-solid fa-file-lines text-4xl text-gray-300"></i>
      <p class="mt-3">Chưa có trang nào. Nhấn "Tạo trang mới" để bắt đầu.</p>
    </div>

    <!-- List -->
    <div v-else class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-5 py-3 font-semibold">Tiêu đề</th>
            <th class="px-5 py-3 font-semibold">Đường dẫn</th>
            <th class="px-5 py-3 font-semibold text-center">Số block</th>
            <th class="px-5 py-3 font-semibold text-center">Loại</th>
            <th class="px-5 py-3 font-semibold text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="p in pages" :key="p.id" class="transition hover:bg-gray-50">
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

    <!-- Create modal -->
    <div v-if="showCreate" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showCreate = false">
      <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-bold text-gray-800">Tạo trang mới</h2>
        <div class="mt-4 space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Tiêu đề trang *</label>
            <input v-model="createForm.title" type="text" placeholder="VD: Chương trình hỗ trợ" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Đường dẫn (slug)</label>
            <input v-model="createForm.slug" type="text" placeholder="tự động tạo từ tiêu đề nếu để trống" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="showCreate = false">Hủy</button>
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            :disabled="creating || !createForm.title.trim()"
            @click="createPage"
          >
            <i v-if="creating" class="fa-solid fa-spinner fa-spin"></i>
            Tạo trang
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const toast = useToast()
const { confirm } = useConfirm()

const pages = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')

const showCreate = ref(false)
const creating = ref(false)
const createForm = reactive({ title: '', slug: '' })

const fetchPages = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res: any = await $fetch('/api/admin/pages')
    if (res.ok) pages.value = res.items
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || 'Không tải được danh sách trang.'
  } finally {
    loading.value = false
  }
}

const openCreate = () => {
  createForm.title = ''
  createForm.slug = ''
  showCreate.value = true
}

const createPage = async () => {
  if (!createForm.title.trim()) return
  creating.value = true
  try {
    const res: any = await $fetch('/api/admin/pages', {
      method: 'POST',
      body: { title: createForm.title.trim(), slug: createForm.slug.trim() || undefined },
    })
    if (res.ok) {
      toast.success('Đã tạo trang mới.')
      showCreate.value = false
      await navigateTo(`/admin/content/pages/${res.id}`)
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không tạo được trang.')
  } finally {
    creating.value = false
  }
}

const removePage = async (p: any) => {
  const ok = await confirm({
    title: 'Xóa trang',
    message: `Xóa trang "${p.title}"? Toàn bộ block của trang sẽ bị xóa. Hành động này không thể hoàn tác.`,
    danger: true,
    confirmLabel: 'Xóa',
  })
  if (!ok) return
  try {
    await $fetch(`/api/admin/pages/${p.id}`, { method: 'DELETE' })
    toast.success('Đã xóa trang.')
    await fetchPages()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không xóa được trang.')
  }
}

onMounted(fetchPages)
</script>
