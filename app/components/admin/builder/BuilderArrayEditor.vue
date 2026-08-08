<template>
  <div class="space-y-2">
    <div
      v-for="(item, i) in items"
      :key="i"
      class="rounded-lg border border-gray-200 bg-gray-50 p-3"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[0.7rem] font-bold uppercase tracking-wide text-gray-400">#{{ i + 1 }}</span>
        <div class="flex items-center gap-1">
          <button class="rounded p-1 text-xs text-gray-400 hover:bg-gray-200 disabled:opacity-30" :disabled="i === 0" title="Lên" @click="moveItem(i, -1)"><i class="fa-solid fa-arrow-up"></i></button>
          <button class="rounded p-1 text-xs text-gray-400 hover:bg-gray-200 disabled:opacity-30" :disabled="i === items.length - 1" title="Xuống" @click="moveItem(i, 1)"><i class="fa-solid fa-arrow-down"></i></button>
          <button class="rounded p-1 text-xs text-red-400 hover:bg-red-50" title="Xóa" @click="removeItem(i)"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>

      <div class="space-y-2">
        <div v-for="col in schema" :key="col.key">
          <label class="mb-0.5 block text-[0.68rem] font-semibold text-gray-500">{{ col.label }}</label>

          <div v-if="col.type === 'image'" class="flex items-center gap-2">
            <div v-if="item[col.key]" class="h-12 w-16 shrink-0 overflow-hidden rounded border border-gray-200">
              <img :src="blockText(item, col.key)" class="h-full w-full object-cover" />
            </div>
            <button class="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50" @click="$emit('pick-image', (url: string) => item[col.key] = url)">
              <i class="fa-solid fa-image mr-1"></i> Chọn
            </button>
            <button v-if="item[col.key]" class="text-xs text-red-500 hover:underline" @click="item[col.key] = ''">Xóa</button>
          </div>

          <select
            v-else-if="col.type === 'select'"
            v-model="item[col.key]"
            class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-green-600"
          >
            <option v-for="opt in (col.options || [])" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>

          <label v-else-if="col.type === 'toggle'" class="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" v-model="item[col.key]" class="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-600" />
            <span class="text-sm text-gray-600">{{ item[col.key] ? 'Bật' : 'Tắt' }}</span>
          </label>

          <textarea
            v-else-if="col.type === 'textarea'"
            :value="blockText(item, col.key)"
            @input="item[col.key] = ($event.target as HTMLTextAreaElement).value"
            rows="3"
            class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-green-600"
          ></textarea>

          <input
            v-else
            v-model="item[col.key]"
            type="text"
            class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-green-600"
          />
        </div>
      </div>
    </div>

    <button
      class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2 text-sm font-semibold text-gray-500 transition hover:border-green-500 hover:text-green-600"
      @click="addItem"
    >
      <i class="fa-solid fa-plus"></i> Thêm mục
    </button>
  </div>
</template>

<script setup lang="ts">
import { blockText } from '~/utils/blocks/types'
import type { BlockData } from '~/utils/blocks/types'
type Col = {
  key: string
  label: string
  type: 'text' | 'url' | 'image' | 'textarea' | 'select' | 'toggle'
  options?: Array<{ value: string; label: string }>
}

const props = defineProps<{ items: BlockData[]; schema: Col[] }>()
defineEmits<{ (e: 'pick-image', cb: (url: string) => void): void }>()

const addItem = () => {
  const blank: BlockData = {}
  for (const col of props.schema) {
    if (col.type === 'toggle') blank[col.key] = false
    else if (col.type === 'select') blank[col.key] = col.options?.[0]?.value ?? ''
    else blank[col.key] = ''
  }
  props.items.push(blank)
}

const removeItem = (i: number) => { props.items.splice(i, 1) }

const moveItem = (i: number, dir: number) => {
  const t = i + dir
  if (t < 0 || t >= props.items.length) return
  const a = props.items[i]
  const b = props.items[t]
  if (!a || !b) return
  props.items[i] = b
  props.items[t] = a
}
</script>
