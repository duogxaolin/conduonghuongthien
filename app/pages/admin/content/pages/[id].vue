<template>
  <div class="flex h-[calc(100vh-6.5rem)] flex-col">
    <!-- Top bar -->
    <div class="flex shrink-0 items-center justify-between border-b border-gray-200 pb-3">
      <div class="flex items-center gap-3">
        <nuxt-link to="/admin/content/pages" class="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50">
          <i class="fa-solid fa-arrow-left"></i>
        </nuxt-link>
        <div>
          <h1 class="text-lg font-bold text-gray-800">{{ page?.title || 'Trình dựng trang' }}</h1>
          <p class="mt-0.5 text-xs text-gray-500">
            <code class="rounded bg-gray-100 px-1.5 py-0.5">/{{ page?.slug === 'home' ? '' : page?.slug }}</code>
            <span v-if="page?.isSystem" class="ml-2 text-blue-600"><i class="fa-solid fa-lock"></i> Trang hệ thống</span>
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1.5 text-xs font-semibold" :class="saveState.color">
          <i :class="saveState.icon"></i> {{ saveState.text }}
        </span>
        <nuxt-link v-if="page" :to="page.slug === 'home' ? '/' : `/${page.slug}`" target="_blank" class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <i class="fa-solid fa-up-right-from-square mr-1"></i> Xem trang
        </nuxt-link>
        <button class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50" @click="openMeta">
          <i class="fa-solid fa-gear mr-1"></i> Cấu hình
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-gray-400"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>
    <div v-else-if="loadError" class="flex flex-1 flex-col items-center justify-center gap-3 text-red-600">
      <p>{{ loadError }}</p>
      <button class="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold hover:bg-red-100" @click="fetchPage">Thử lại</button>
    </div>

    <!-- 3-pane workspace -->
    <div v-else class="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <!-- Left: navigator -->
      <aside class="flex w-64 shrink-0 flex-col border-r border-gray-200">
        <div class="shrink-0 border-b border-gray-200 p-3">
          <button class="flex w-full items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800" @click="showPalette = true">
            <i class="fa-solid fa-plus"></i> Thêm block
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <p v-if="!blocks.length" class="px-2 py-4 text-center text-xs text-gray-400">Chưa có block nào.</p>
          <div
            v-for="(block, index) in blocks"
            :key="block.id"
            class="group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition"
            :class="[
              selectedId === block.id ? 'bg-green-50 ring-1 ring-green-300' : 'hover:bg-gray-50',
              dragOverIndex === index ? 'ring-2 ring-green-400' : '',
              block.isVisible ? '' : 'opacity-50',
            ]"
            draggable="true"
            @dragstart="onDragStart(index)"
            @dragover.prevent="dragOverIndex = index"
            @drop.prevent="onDrop(index)"
            @dragend="onDragEnd"
            @click="selectedId = block.id"
          >
            <i class="fa-solid fa-grip-vertical cursor-grab text-gray-300 group-hover:text-gray-400"></i>
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-50 text-xs text-green-700"><i :class="registry[block.blockType]?.icon || 'fa-solid fa-cube'"></i></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-gray-700">{{ registry[block.blockType]?.label || block.blockType }}</p>
              <p class="truncate text-[0.68rem] text-gray-400">{{ blockPreviewText(block) }}</p>
            </div>
            <i v-if="!block.isVisible" class="fa-solid fa-eye-slash text-[0.7rem] text-orange-400" title="Đang ẩn"></i>
          </div>
        </div>
      </aside>

      <!-- Center: live canvas -->
      <BuilderCanvas
        class="min-w-0 flex-1"
        :blocks="blocks"
        :selected-id="selectedId"
        :viewport="viewport"
        @select="selectedId = $event"
        @move="move"
        @duplicate="duplicateBlock"
        @delete="removeBlock"
        @toggle-visible="toggleVisible"
        @update:viewport="viewport = $event"
      />

      <!-- Right: property panel -->
      <aside class="w-80 shrink-0 border-l border-gray-200">
        <PropertyPanel :block="selectedBlock" />
      </aside>
    </div>

    <!-- Block palette drawer -->
    <div v-if="showPalette" class="fixed inset-0 z-50 flex justify-end bg-black/40" @click.self="showPalette = false">
      <div class="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl">
        <div class="mb-4 flex items-center justify-between">
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

    <!-- Meta modal -->
    <div v-if="showMeta" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="showMeta = false">
      <div class="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 class="mb-4 text-lg font-bold text-gray-800">Cấu hình trang</h2>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">Tiêu đề trang</label>
            <input v-model="metaForm.title" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">Đường dẫn (slug)</label>
            <input v-model="metaForm.slug" type="text" :disabled="page?.isSystem" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600 disabled:bg-gray-100 disabled:text-gray-400" />
            <p v-if="page?.isSystem" class="mt-1 text-xs text-gray-400">Trang hệ thống không thể đổi đường dẫn.</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">SEO Title</label>
            <input v-model="metaForm.seoTitle" type="text" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-gray-700">SEO Description</label>
            <textarea v-model="metaForm.seoDescription" rows="3" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100" @click="showMeta = false">Hủy</button>
          <button class="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50" :disabled="savingMeta" @click="saveMeta">
            <i v-if="savingMeta" class="fa-solid fa-spinner fa-spin"></i> Lưu
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BLOCK_REGISTRY, blocksByCategory, getDefaultData } from '~/utils/blocks/registry'
import BuilderCanvas from '~/components/admin/builder/BuilderCanvas.vue'
import PropertyPanel from '~/components/admin/builder/PropertyPanel.vue'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const route = useRoute()
const pageId = computed(() => Number(route.params.id))
const toast = useToast()
const { confirm } = useConfirm()

const registry = BLOCK_REGISTRY
const grouped = blocksByCategory()

const page = ref<any>(null)
const blocks = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')

const selectedId = ref<number | null>(null)
const viewport = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const selectedBlock = computed(() => blocks.value.find(b => b.id === selectedId.value) || null)

const fetchPage = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}`)
    if (res.ok) {
      page.value = res.page
      // Ensure every block has a data object so panel/canvas can bind reactively.
      blocks.value = (res.blocks || []).map((b: any) => ({ ...b, data: b.data || {} }))
      if (blocks.value.length) selectedId.value = blocks.value[0].id
    }
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || 'Không tải được trang.'
  } finally {
    loading.value = false
  }
}

const blockPreviewText = (block: any) => {
  const d = block.data || {}
  return d.title || d.text || d.badge || d.titleLine1 || d.html?.replace(/<[^>]+>/g, '').slice(0, 40) || '—'
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
      blocks.value.push({ ...res.block, data: res.block.data || {} })
      selectedId.value = res.block.id
      showPalette.value = false
      toast.success('Đã thêm block.')
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không thêm được block.')
  } finally {
    adding.value = false
  }
}

// ── Duplicate ──
const duplicateBlock = async (block: any) => {
  try {
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}/blocks`, {
      method: 'POST',
      body: { blockType: block.blockType, data: JSON.parse(JSON.stringify(block.data || {})) },
    })
    if (res.ok) {
      blocks.value.push({ ...res.block, data: res.block.data || {} })
      selectedId.value = res.block.id
      toast.success('Đã nhân đôi block.')
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không nhân đôi được block.')
  }
}
// ── Auto-save (debounced) of the selected block's data ──
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
const status = ref<SaveStatus>('idle')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let lastSnapshot = ''

const saveState = computed(() => {
  switch (status.value) {
    case 'saving': return { text: 'Đang lưu…', icon: 'fa-solid fa-spinner fa-spin', color: 'text-gray-500' }
    case 'saved': return { text: 'Đã lưu', icon: 'fa-solid fa-circle-check', color: 'text-green-600' }
    case 'dirty': return { text: 'Chưa lưu', icon: 'fa-solid fa-pen', color: 'text-orange-500' }
    case 'error': return { text: 'Lỗi lưu', icon: 'fa-solid fa-triangle-exclamation', color: 'text-red-600' }
    default: return { text: 'Tự động lưu', icon: 'fa-solid fa-cloud', color: 'text-gray-400' }
  }
})

// When selection changes, snapshot its data so we don't fire a spurious save.
watch(selectedId, () => {
  lastSnapshot = selectedBlock.value ? JSON.stringify(selectedBlock.value.data) : ''
  status.value = 'idle'
})

// Deep-watch the selected block's data → debounce a PUT.
watch(
  () => selectedBlock.value?.data,
  (data) => {
    if (!selectedBlock.value || !data) return
    const snap = JSON.stringify(data)
    if (snap === lastSnapshot) return
    status.value = 'dirty'
    if (saveTimer) clearTimeout(saveTimer)
    const target = selectedBlock.value
    saveTimer = setTimeout(() => persistBlockData(target, snap), 800)
  },
  { deep: true }
)

const persistBlockData = async (block: any, snap: string) => {
  status.value = 'saving'
  try {
    const res: any = await $fetch(`/api/admin/pages/${pageId.value}/blocks/${block.id}`, {
      method: 'PUT',
      body: { data: block.data },
    })
    if (res.ok) {
      if (block.id === selectedId.value) lastSnapshot = snap
      status.value = 'saved'
    }
  } catch (err: any) {
    status.value = 'error'
    toast.error(err?.data?.statusMessage || 'Không lưu được block.')
  }
}

// ── Visibility ──
const toggleVisible = async (block: any) => {
  const next = !block.isVisible
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/blocks/${block.id}`, { method: 'PUT', body: { isVisible: next } })
    block.isVisible = next
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không cập nhật được.')
  }
}

// ── Delete ──
const removeBlock = async (block: any) => {
  const ok = await confirm({ title: 'Xóa block', message: `Xóa block "${registry[block.blockType]?.label || block.blockType}"?`, danger: true, confirmLabel: 'Xóa' })
  if (!ok) return
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/blocks/${block.id}`, { method: 'DELETE' })
    blocks.value = blocks.value.filter(b => b.id !== block.id)
    if (selectedId.value === block.id) selectedId.value = blocks.value[0]?.id ?? null
    toast.success('Đã xóa block.')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Không xóa được block.')
  }
}

// ── Reorder (drag in navigator + arrows in canvas) ──
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
  try {
    await $fetch(`/api/admin/pages/${pageId.value}/blocks/reorder`, { method: 'PUT', body: { orders } })
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
    const body: any = { title: metaForm.title, seoTitle: metaForm.seoTitle, seoDescription: metaForm.seoDescription }
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
