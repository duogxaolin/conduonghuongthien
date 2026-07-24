<template>
  <div class="flex h-full flex-col">
    <!-- No selection -->
    <div v-if="!block" class="flex flex-1 flex-col items-center justify-center p-8 text-center text-gray-400">
      <i class="fa-solid fa-hand-pointer text-3xl"></i>
      <p class="mt-3 text-sm">Chọn một block trên khung xem trước để chỉnh sửa nội dung.</p>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-700">
          <i :class="def?.icon || 'fa-solid fa-cube'"></i>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold text-gray-800">{{ def?.label || block.blockType }}</p>
          <p class="text-[0.7rem] text-gray-400">Chỉnh sửa nội dung block</p>
        </div>
        <span v-if="def?.dataDriven" class="rounded bg-blue-50 px-1.5 py-0.5 text-[0.62rem] font-semibold text-blue-600" title="Nội dung lấy tự động từ bài viết">Động</span>
      </div>

      <!-- Fields -->
      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <div v-for="field in fields" :key="field.key">
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
          <textarea
            v-else-if="field.type === 'richtext'"
            v-model="block.data[field.key]"
            rows="8"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:border-green-600"
          ></textarea>

          <!-- array repeater (stats / links / gallery items) -->
          <BuilderArrayEditor
            v-else-if="field.type === 'textarea' && arraySchema(field.key)"
            :items="ensureArray(field.key)"
            :schema="arraySchema(field.key)!"
            @pick-image="(cb) => openPicker({ onSelect: (img) => cb(img.url) })"
          />

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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BLOCK_REGISTRY, type EditorField } from '~/utils/blocks/registry'

const props = defineProps<{ block: any | null }>()
const { openPicker } = useImagePicker()

const def = computed(() => (props.block ? BLOCK_REGISTRY[props.block.blockType] : null))
const fields = computed<EditorField[]>(() => def.value?.fields || [])

// Structured schemas for the array fields that used to be raw-JSON textareas.
type Col = { key: string; label: string; type: 'text' | 'url' | 'image' }
const ARRAY_SCHEMAS: Record<string, Col[]> = {
  stats: [
    { key: 'icon', label: 'Icon (FontAwesome)', type: 'text' },
    { key: 'value', label: 'Giá trị', type: 'text' },
    { key: 'label', label: 'Nhãn', type: 'text' },
  ],
  links: [
    { key: 'icon', label: 'Icon / Emoji', type: 'text' },
    { key: 'label', label: 'Tên liên kết', type: 'text' },
    { key: 'url', label: 'Đường dẫn', type: 'url' },
  ],
  items: [
    { key: 'url', label: 'Ảnh', type: 'image' },
    { key: 'caption', label: 'Chú thích', type: 'text' },
  ],
}

const arraySchema = (key: string): Col[] | null => ARRAY_SCHEMAS[key] || null

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
