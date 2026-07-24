<template>
  <div class="flex h-full flex-col">
    <!-- No selection -->
    <div v-if="!block" class="flex flex-1 flex-col items-center justify-center p-8 text-center text-gray-400">
      <i class="fa-solid fa-hand-pointer text-3xl"></i>
      <p class="mt-3 text-sm">Chọn một block trên khung xem trước để chỉnh sửa nội dung.</p>
    </div>

    <template v-else>
      <!-- Backdrop when expanded (click to close) -->
      <div v-if="expanded" class="fixed inset-0 z-40 bg-black/50" @click="expanded = false"></div>

      <!-- Panel body: inline sidebar by default, floating wide modal when expanded -->
      <div
        :class="expanded
          ? 'fixed inset-x-4 top-16 bottom-6 z-50 mx-auto flex max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl'
          : 'flex h-full flex-col'"
      >
      <!-- Header -->
      <div class="shrink-0 border-b border-gray-200 px-4 py-3">
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-700">
            <i :class="def?.icon || 'fa-solid fa-cube'"></i>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold text-gray-800">{{ def?.label || block.blockType }}</p>
            <p class="text-[0.7rem] text-gray-400">Chỉnh sửa nội dung block</p>
          </div>
          <span v-if="def?.dataDriven" class="rounded bg-blue-50 px-1.5 py-0.5 text-[0.62rem] font-semibold text-blue-600" title="Nội dung lấy tự động từ bài viết">Động</span>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500"
            :title="expanded ? 'Thu nhỏ (Esc)' : 'Mở rộng để dễ sửa'"
            :aria-pressed="expanded"
            @click="expanded = !expanded"
          >
            <i :class="expanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
          </button>
        </div>
        <!-- Block action toolbar -->
        <div class="mt-3 flex items-center gap-1">
          <button class="flex-1 rounded-md border border-gray-200 py-1.5 text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-30" :disabled="index <= 0" title="Di chuyển lên" @click="$emit('move', index, -1)"><i class="fa-solid fa-arrow-up"></i></button>
          <button class="flex-1 rounded-md border border-gray-200 py-1.5 text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-30" :disabled="index >= total - 1" title="Di chuyển xuống" @click="$emit('move', index, 1)"><i class="fa-solid fa-arrow-down"></i></button>
          <button class="flex-1 rounded-md border border-gray-200 py-1.5 text-xs text-gray-500 transition hover:bg-gray-50" title="Nhân đôi" @click="$emit('duplicate', block)"><i class="fa-solid fa-copy"></i></button>
          <button class="flex-1 rounded-md border border-gray-200 py-1.5 text-xs transition hover:bg-gray-50" :class="block.isVisible ? 'text-gray-500' : 'text-orange-500'" :title="block.isVisible ? 'Ẩn block' : 'Hiện block'" @click="$emit('toggle-visible', block)"><i :class="block.isVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i></button>
          <button class="flex-1 rounded-md border border-red-200 py-1.5 text-xs text-red-500 transition hover:bg-red-50" title="Xóa block" @click="$emit('delete', block)"><i class="fa-solid fa-trash"></i></button>
        </div>

        <!-- Column width (grid span 1–12) — only for column containers -->
        <div v-if="isColumn" class="mt-3">
          <div class="mb-1 flex items-center justify-between">
            <label class="text-xs font-semibold text-gray-700">Chiều rộng cột</label>
            <span class="rounded bg-blue-50 px-1.5 py-0.5 text-[0.68rem] font-bold text-blue-600">{{ colSpan }} / {{ GRID_COLUMNS }}</span>
          </div>
          <input
            v-model.number="colSpan"
            type="range"
            :min="MIN_COL_SPAN"
            :max="MAX_COL_SPAN"
            step="1"
            class="w-full accent-green-700"
          />
          <p class="mt-1 text-[0.7rem] text-gray-400">Số cột chiếm trên lưới 12 cột. Ví dụ 6 = nửa hàng, 4 = một phần ba.</p>
        </div>
      </div>

      <!-- Fields -->
      <div class="flex-1 overflow-y-auto p-4" :class="expanded ? 'grid grid-cols-2 gap-x-5 gap-y-4 content-start' : 'space-y-4'">
        <div v-for="field in fields" :key="field.key" :class="expanded && (field.type === 'richtext' || field.type === 'textarea') ? 'col-span-2' : ''">
          <label class="mb-1 block text-xs font-semibold text-gray-700">{{ field.label }}</label>

          <!-- text / url -->
          <input
            v-if="field.type === 'text' || field.type === 'url'"
            v-model="block.data[field.key]"
            type="text"
            :placeholder="field.placeholder || ''"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
          />

          <!-- number -->
          <input
            v-else-if="field.type === 'number'"
            v-model.number="block.data[field.key]"
            type="number"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
          />

          <!-- select -->
          <select
            v-else-if="field.type === 'select'"
            v-model="block.data[field.key]"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
          >
            <option v-for="opt in field.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>

          <!-- toggle -->
          <label
            v-else-if="field.type === 'toggle'"
            class="flex cursor-pointer items-center gap-2"
          >
            <input v-model="block.data[field.key]" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500" />
            <span class="text-sm text-gray-600">{{ field.help || 'Bật' }}</span>
          </label>

          <!-- image -->
          <div v-else-if="field.type === 'image'" class="flex items-center gap-3">
            <div v-if="block.data[field.key]" class="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-gray-200">
              <img :src="block.data[field.key]" class="h-full w-full object-cover" />
            </div>
            <div class="flex flex-col gap-1">
              <button class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50" @click="pickImage(field.key)">
                <i class="fa-solid fa-image mr-1"></i> Chọn ảnh
              </button>
              <button v-if="block.data[field.key]" class="text-left text-xs text-red-500 hover:underline" @click="block.data[field.key] = ''">Xóa ảnh</button>
            </div>
          </div>

          <!-- richtext -->
          <TinyMceEditor
            v-else-if="field.type === 'richtext'"
            :key="`${block.id}-${field.key}-${expanded ? 'wide' : 'narrow'}`"
            v-model="block.data[field.key]"
            :height="expanded ? 560 : 320"
            :placeholder="field.placeholder || ''"
          />

          <!-- array repeater (stats / links / gallery items / info rows) -->
          <BuilderArrayEditor
            v-else-if="field.type === 'array'"
            :items="ensureArray(field.key)"
            :schema="field.itemSchema || []"
            @pick-image="(cb) => openPicker({ onSelect: (img) => cb(img.url) })"
          />

          <!-- category dropdown (loaded from /api/public/categories?type=…) -->
          <select
            v-else-if="field.type === 'category'"
            v-model="block.data[field.key]"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
          >
            <option value="">Tất cả</option>
            <option v-if="isCategoryLoading(field.categoryType)" disabled>Đang tải…</option>
            <option v-for="cat in categoriesFor(field.categoryType)" :key="cat.slug" :value="cat.slug">{{ cat.name }}</option>
          </select>

          <!-- plain textarea -->
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="block.data[field.key]"
            rows="3"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-green-600"
          ></textarea>

          <p v-if="field.help" class="mt-1 text-[0.7rem] text-gray-400">{{ field.help }}</p>
        </div>
      </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { BLOCK_REGISTRY, clampColSpan, GRID_COLUMNS, MIN_COL_SPAN, MAX_COL_SPAN, type EditorField } from '~/utils/blocks/registry'
import TinyMceEditor from '~/components/admin/TinyMceEditor.vue'
import BuilderArrayEditor from '~/components/admin/builder/BuilderArrayEditor.vue'

const props = defineProps<{ block: any | null; index: number; total: number }>()
defineEmits<{
  (e: 'move', index: number, dir: number): void
  (e: 'duplicate', block: any): void
  (e: 'delete', block: any): void
  (e: 'toggle-visible', block: any): void
}>()
const { openPicker } = useImagePicker()

// Expand the editor into a wide floating modal so richtext fields have room.
const expanded = ref(false)
// Collapse when switching to another block, or when nothing is selected.
watch(() => props.block?.id, () => { expanded.value = false })
const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape' && expanded.value) expanded.value = false }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const def = computed(() => (props.block ? BLOCK_REGISTRY[props.block.blockType] : null))
const fields = computed<EditorField[]>(() => def.value?.fields || [])

// ── Column width (colSpan) ────────────────────────────────────────────────
// Only columns carry a colSpan (1–12 of the parent row's 12-track grid). The
// slider writes the clamped value straight back onto the node so the deep watch
// on `blocks` schedules a draft save and the preview re-renders.
const isColumn = computed(() => props.block?.blockType === 'column')
const colSpan = computed({
  get: () => clampColSpan(props.block?.colSpan),
  set: (v: number) => { if (props.block) props.block.colSpan = clampColSpan(v) },
})

// ── Category dropdowns ────────────────────────────────────────────────────
// Categories are fetched lazily per content type and cached so switching
// between blocks of the same type doesn't refetch. Fetch errors degrade
// gracefully to just the "Tất cả" option (editing is never blocked).
type Category = { slug: string; name: string; [k: string]: any }
const categoryCache = ref<Record<string, Category[]>>({})
const categoryLoading = ref<Record<string, boolean>>({})

const categoriesFor = (type?: string): Category[] => (type ? categoryCache.value[type] || [] : [])
const isCategoryLoading = (type?: string): boolean => (type ? !!categoryLoading.value[type] : false)

const loadCategories = async (type: string) => {
  if (!type || categoryCache.value[type] || categoryLoading.value[type]) return
  categoryLoading.value[type] = true
  try {
    const res: any = await $fetch('/api/public/categories', { params: { type } })
    categoryCache.value[type] = Array.isArray(res?.items) ? res.items : []
  } catch {
    categoryCache.value[type] = [] // fall back to just "Tất cả"
  } finally {
    categoryLoading.value[type] = false
  }
}

// Load categories for any category field on the currently selected block.
watch(fields, (list) => {
  for (const f of list) {
    if (f.type === 'category' && f.categoryType) loadCategories(f.categoryType)
  }
}, { immediate: true })

// Guarantee block.data[key] is an array so the repeater can bind to it.
const ensureArray = (key: string): any[] => {
  if (!props.block) return []
  const cur = props.block.data[key]
  if (!Array.isArray(cur)) props.block.data[key] = []
  return props.block.data[key]
}

const pickImage = (key: string) => {
  openPicker({ onSelect: (img: any) => { props.block.data[key] = img.url } })
}
</script>
