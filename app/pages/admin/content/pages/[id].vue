<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <nuxt-link to="/admin/content/pages" class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
          <i class="fa-solid fa-arrow-left"></i>
        </nuxt-link>
        <div>
          <h1 class="text-xl font-bold text-gray-800">{{ page?.title || 'Trình dựng trang' }}</h1>
          <p class="text-xs text-gray-500 mt-0.5">
            <code class="rounded bg-gray-100 px-1.5 py-0.5">/{{ page?.slug === 'home' ? '' : page?.slug }}</code>
            <span v-if="page?.isSystem" class="ml-2 text-blue-600"><i class="fa-solid fa-lock"></i> Trang hệ thống</span>
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" @click="openMeta">
          <i class="fa-solid fa-gear mr-1"></i> Cấu hình
        </button>
        <button class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800" @click="showPalette = true">
          <i class="fa-solid fa-plus"></i> Thêm block
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20 text-gray-400">
      <i class="fa-solid fa-spinner fa-spin text-2xl"></i>
    </div>

    <div v-else-if="loadError" class="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600">
      <p>{{ loadError }}</p>
      <button class="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100" @click="fetchPage">Thử lại</button>
    </div>

    <template v-else>
      <!-- Empty -->
      <div v-if="!blocks.length" class="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-gray-500">
        <i class="fa-solid fa-cubes text-4xl text-gray-300"></i>
        <p class="mt-3">Trang chưa có block nào. Nhấn "Thêm block" để bắt đầu dựng trang.</p>
      </div>

      <!-- Block list -->
      <div v-else class="space-y-3">
        <div
          v-for="(block, index) in blocks"
          :key="block.id"
          class="group flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm transition"
          :class="[
            dragOverIndex === index ? 'border-green-500 ring-2 ring-green-100' : 'border-gray-200',
            block.isVisible ? '' : 'opacity-60',
          ]"
          draggable="true"
          @dragstart="onDragStart(index)"
          @dragover.prevent="dragOverIndex = index"
          @drop.prevent="onDrop(index)"
          @dragend="onDragEnd"
        >
          <span class="cursor-grab text-gray-300 transition group-hover:text-gray-400" title="Kéo để sắp xếp">
            <i class="fa-solid fa-grip-vertical"></i>
          </span>

          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-700">
            <i :class="registry[block.blockType]?.icon || 'fa-solid fa-cube'"></i>
          </div>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-gray-800">{{ registry[block.blockType]?.label || block.blockType }}</p>
            <p class="truncate text-xs text-gray-400">{{ blockPreviewText(block) }}</p>
          </div>

          <!-- Reorder arrows (fallback / accessibility, works alongside DnD) -->
          <div class="flex flex-col">
            <button class="px-1 text-gray-300 hover:text-green-600 disabled:opacity-30" :disabled="index === 0" @click="move(index, -1)"><i class="fa-solid fa-chevron-up text-xs"></i></button>
            <button class="px-1 text-gray-300 hover:text-green-600 disabled:opacity-30" :disabled="index === blocks.length - 1" @click="move(index, 1)"><i class="fa-solid fa-chevron-down text-xs"></i></button>
          </div>

          <button
            class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold transition"
            :class="block.isVisible ? 'text-gray-600 hover:bg-gray-50' : 'text-orange-500 hover:bg-orange-50'"
            @click="toggleVisible(block)"
          >
            <i :class="block.isVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
            {{ block.isVisible ? 'Hiển thị' : 'Đã ẩn' }}
          </button>

          <button class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:border-green-600 hover:text-green-700" @click="openEdit(block)">
            <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa
          </button>

          <button class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50" @click="removeBlock(block)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </template>

    <!-- Block palette drawer -->
    <div v-if="showPalette" class="fixed inset-0 z-50 flex justify-end bg-black/40" @click.self="showPalette = false">
      <div class="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-gray-800">Thêm block</h2>
          <button class="text-gray-400 hover:text-gray-600" @click="showPalette = false"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>

        <div v-for="(group, cat) in grouped" :key="cat" class="mb-6">
          <h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{{ cat === 'section' ? 'Khối trang chủ' : 'Khối nội dung' }}</h3>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="item in group"
              :key="item.type"
              class="flex flex-col items-start gap-2 rounded-lg border border-gray-200 p-3 text-left transition hover:border-green-500 hover:bg-green-50 disabled:opacity-50"
              :disabled="adding"
              @click="addBlock(item.type)"
            >
              <i :class="[item.icon, 'text-green-700']"></i>
              <span class="text-sm font-semibold text-gray-700">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit drawer -->
    <div v-if="editing" class="fixed inset-0 z-50 flex justify-end bg-black/40" @click.self="closeEdit">
      <div class="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-gray-800">
            <i :class="registry[editing.blockType]?.icon" class="mr-2 text-green-700"></i>
            {{ registry[editing.blockType]?.label || editing.blockType }}
          </h2>
          <button class="text-gray-400 hover:text-gray-600" @click="closeEdit"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>

        <div class="space-y-4">
          <div v-for="field in editFields" :key="field.key">
            <label class="block text-sm font-semibold text-gray-700 mb-1">{{ field.label }}</label>

            <input
              v-if="field.type === 'text' || field.type === 'url'"
              v-model="editData[field.key]"
              type="text"
              :placeholder="field.placeholder || ''"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
            />

            <input
              v-else-if="field.type === 'number'"
              v-model.number="editData[field.key]"
              type="number"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
            />

            <textarea
              v-else-if="field.type === 'textarea'"
              v-model="editData[field.key]"
              rows="3"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
            ></textarea>

            <textarea
              v-else-if="field.type === 'richtext'"
              v-model="editData[field.key]"
              rows="8"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:border-green-600"
            ></textarea>

            <select
              v-else-if="field.type === 'select'"
              v-model="editData[field.key]"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
            >
              <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>

            <div v-else-if="field.type === 'image'" class="flex items-center gap-3">
              <div v-if="editData[field.key]" class="h-16 w-24 overflow-hidden rounded-lg border border-gray-200">
                <img :src="editData[field.key]" class="h-full w-full object-cover" />
              </div>
              <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" @click="pickImage(field.key)">
                <i class="fa-solid fa-image mr-1"></i> Chọn ảnh
              </button>
              <button v-if="editData[field.key]" class="text-sm text-red-500 hover:underline" @click="editData[field.key] = ''">Xóa</button>
            </div>

            <p v-if="field.help" class="mt-1 text-xs text-gray-400">{{ field.help }}</p>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="closeEdit">Hủy</button>
          <button
            class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
            :disabled="savingBlock"
            @click="saveBlock"
          >
            <i v-if="savingBlock" class="fa-solid fa-spinner fa-spin"></i>
            Lưu thay đổi
          </button>
        </div>
      </div>
    </div>

    <!-- Meta drawer -->
    <div v-if="showMeta" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showMeta = false">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Cấu hình trang</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Tiêu đề trang</label>
            <input v-model="metaForm.title" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">Đường dẫn (slug)</label>
            <input v-model="metaForm.slug" type="text" :disabled="page?.isSystem" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600 disabled:bg-gray-100 disabled:text-gray-400" />
            <p v-if="page?.isSystem" class="mt-1 text-xs text-gray-400">Trang hệ thống không thể đổi đường dẫn.</p>
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">SEO Title</label>
            <input v-model="metaForm.seoTitle" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">SEO Description</label>
            <textarea v-model="metaForm.seoDescription" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="showMeta = false">Hủy</button>
          <button class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50" :disabled="savingMeta" @click="saveMeta">
            <i v-if="savingMeta" class="fa-solid fa-spinner fa-spin"></i>
            Lưu
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BLOCK_REGISTRY, blocksByCategory, getDefaultData } from '~/utils/blocks/registry'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const pageId = computed(() => Number(route.params.id))
const toast = useToast()
const { confirm } = useConfirm()
const { openPicker } = useImagePicker()

const registry = BLOCK_REGISTRY
const grouped = blocksByCategory()

const page = ref<any>(null)
const blocks = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')

const fetchPage = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}`)
    if (res.ok) {
      page.value = res.page
      blocks.value = res.blocks
    }
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || 'Không tải được trang.'
  } finally {
    loading.value = false
  }
}

// ── Block preview text for the list row ──
const blockPreviewText = (block: any) => {
  const d = block.data || {}
  return d.title || d.text || d.badge || d.html?.replace(/<[^>]+>/g, '').slice(0, 60) || '—'
}

// ── Palette / add ──
const showPalette = ref(false)
const adding = ref(false)
const addBlock = async (type: string) => {
  adding.value = true
  try {
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}/blocks`, {
      method: 'POST',
      body: { blockType: type, data: getDefaultData(type) },
    })
    if (res.ok) {
      blocks.value.push(res.block)
      showPalette.value = false
      toast.success('Đã thêm block.')
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không thêm được block.')
  } finally {
    adding.value = false
  }
}

// ── Edit drawer ──
const editing = ref<any>(null)
const editData = reactive<Record<string, any>>({})
const savingBlock = ref(false)
const editFields = computed(() => (editing.value ? registry[editing.value.blockType]?.fields || [] : []))

const openEdit = (block: any) => {
  editing.value = block
  // Deep copy current data into editData; serialize array/object fields to JSON text for textarea editing.
  const raw = { ...(block.data || {}) }
  Object.keys(editData).forEach(k => delete editData[k])
  const fields = registry[block.blockType]?.fields || []
  for (const f of fields) {
    let v = raw[f.key]
    if ((f.type === 'textarea' || f.type === 'richtext') && v !== null && typeof v === 'object') {
      v = JSON.stringify(v, null, 2)
    }
    editData[f.key] = v ?? (f.type === 'number' ? 0 : '')
  }
}

const closeEdit = () => {
  editing.value = null
}

const pickImage = (key: string) => {
  openPicker({ onSelect: (img: any) => { editData[key] = img.url } })
}

const saveBlock = async () => {
  if (!editing.value) return
  savingBlock.value = true
  try {
    // Reconstruct data, parsing JSON-textarea fields back into arrays/objects.
    const fields = registry[editing.value.blockType]?.fields || []
    const data: Record<string, any> = {}
    for (const f of fields) {
      let v = editData[f.key]
      if ((f.type === 'textarea' || f.type === 'richtext') && typeof v === 'string' && looksLikeJson(v)) {
        try { v = JSON.parse(v) } catch { /* keep string if invalid JSON */ }
      }
      data[f.key] = v
    }
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}/blocks/${editing.value.id}`, {
      method: 'PUT',
      body: { data },
    })
    if (res.ok) {
      const idx = blocks.value.findIndex(b => b.id === editing.value.id)
      if (idx !== -1) blocks.value[idx] = res.block
      toast.success('Đã lưu block.')
      closeEdit()
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không lưu được block.')
  } finally {
    savingBlock.value = false
  }
}

const looksLikeJson = (s: string) => {
  const t = s.trim()
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))
}

// ── Visibility toggle ──
const toggleVisible = async (block: any) => {
  const next = !block.isVisible
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/blocks/${block.id}`, {
      method: 'PUT',
      body: { isVisible: next },
    })
    block.isVisible = next
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không cập nhật được.')
  }
}

// ── Delete ──
const removeBlock = async (block: any) => {
  const ok = await confirm({
    title: 'Xóa block',
    message: `Xóa block "${registry[block.blockType]?.label || block.blockType}"?`,
    danger: true,
    confirmLabel: 'Xóa',
  })
  if (!ok) return
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/blocks/${block.id}`, { method: 'DELETE' })
    blocks.value = blocks.value.filter(b => b.id !== block.id)
    toast.success('Đã xóa block.')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không xóa được block.')
  }
}

// ── Reorder (drag-and-drop + arrows) ──
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const onDragStart = (index: number) => { dragIndex.value = index }
const onDragEnd = () => { dragIndex.value = null; dragOverIndex.value = null }
const onDrop = (index: number) => {
  if (dragIndex.value === null || dragIndex.value === index) { onDragEnd(); return }
  const moved = blocks.value.splice(dragIndex.value, 1)[0]
  blocks.value.splice(index, 0, moved)
  onDragEnd()
  persistOrder()
}

const move = (index: number, dir: number) => {
  const target = index + dir
  if (target < 0 || target >= blocks.value.length) return
  const arr = blocks.value
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
  persistOrder()
}

const persistOrder = async () => {
  const orders = blocks.value.map((b, i) => ({ id: b.id, displayOrder: i + 1 }))
  // Optimistic: local order already updated. Persist and toast on failure.
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/blocks/reorder`, {
      method: 'PUT',
      body: { orders },
    })
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không lưu được thứ tự. Đang tải lại.')
    await fetchPage()
  }
}

// ── Meta ──
const showMeta = ref(false)
const savingMeta = ref(false)
const metaForm = reactive({ title: '', slug: '', seoTitle: '', seoDescription: '' })

const openMeta = () => {
  metaForm.title = page.value?.title || ''
  metaForm.slug = page.value?.slug || ''
  metaForm.seoTitle = page.value?.seoTitle || ''
  metaForm.seoDescription = page.value?.seoDescription || ''
  showMeta.value = true
}

const saveMeta = async () => {
  savingMeta.value = true
  try {
    const body: any = {
      title: metaForm.title,
      seoTitle: metaForm.seoTitle,
      seoDescription: metaForm.seoDescription,
    }
    if (!page.value?.isSystem) body.slug = metaForm.slug
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}`, { method: 'PUT', body })
    if (res.ok) {
      page.value.title = metaForm.title
      page.value.slug = res.slug
      page.value.seoTitle = metaForm.seoTitle
      page.value.seoDescription = metaForm.seoDescription
      toast.success('Đã lưu cấu hình trang.')
      showMeta.value = false
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không lưu được cấu hình.')
  } finally {
    savingMeta.value = false
  }
}

onMounted(fetchPage)
</script>
