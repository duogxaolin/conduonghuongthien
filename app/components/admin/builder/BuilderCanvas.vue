<template>
  <div class="flex h-full flex-col bg-[#eef1ee]">
    <!-- Canvas toolbar: viewport switch -->
    <div class="flex shrink-0 items-center justify-center gap-1 border-b border-gray-200 bg-white px-3 py-2">
      <button
        v-for="vp in viewports"
        :key="vp.key"
        class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition"
        :class="modelViewport === vp.key ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-100'"
        :title="vp.label"
        @click="$emit('update:viewport', vp.key)"
      >
        <i :class="vp.icon"></i>
        <span class="hidden sm:inline">{{ vp.label }}</span>
      </button>
      <span class="ml-3 text-[0.7rem] text-gray-400">{{ widthLabel }}</span>
    </div>

    <!-- Scrollable stage -->
    <div class="flex-1 overflow-auto p-4">
      <!-- Empty -->
      <div v-if="!blocks.length" class="mx-auto flex h-full min-h-[300px] max-w-md flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white/60 p-10 text-center text-gray-500">
        <i class="fa-solid fa-cubes text-4xl text-gray-300"></i>
        <p class="mt-3 text-sm">Trang chưa có block. Chọn block từ bảng bên trái để bắt đầu.</p>
      </div>

      <!-- Live preview: real block components, same as the public page -->
      <div
        v-else
        class="mx-auto bg-white shadow-lg transition-all duration-300"
        :style="{ width: canvasWidth, maxWidth: '100%' }"
      >
        <div
          v-for="(block, index) in blocks"
          :key="block.id"
          class="group/blk relative"
          :class="[
            block.isVisible ? '' : 'opacity-40',
            selectedId === block.id ? 'outline outline-2 outline-green-600' : 'hover:outline hover:outline-2 hover:outline-green-300',
          ]"
          @click="$emit('select', block.id)"
        >
          <!-- Label tag -->
          <span
            class="pointer-events-none absolute left-0 top-0 z-20 rounded-br-md px-2 py-0.5 text-[0.65rem] font-bold text-white transition-opacity"
            :class="selectedId === block.id ? 'bg-green-600 opacity-100' : 'bg-green-400 opacity-0 group-hover/blk:opacity-100'"
          >
            <i :class="registry[block.blockType]?.icon"></i>
            {{ registry[block.blockType]?.label || block.blockType }}
          </span>

          <!-- Quick toolbar -->
          <div
            class="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg bg-gray-900/90 p-1 shadow-lg transition-opacity"
            :class="selectedId === block.id ? 'opacity-100' : 'opacity-0 group-hover/blk:opacity-100'"
            @click.stop
          >
            <button class="rounded p-1.5 text-xs text-gray-200 hover:bg-white/15 disabled:opacity-30" :disabled="index === 0" title="Lên" @click="$emit('move', index, -1)"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="rounded p-1.5 text-xs text-gray-200 hover:bg-white/15 disabled:opacity-30" :disabled="index === blocks.length - 1" title="Xuống" @click="$emit('move', index, 1)"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="rounded p-1.5 text-xs text-gray-200 hover:bg-white/15" title="Nhân đôi" @click="$emit('duplicate', block)"><i class="fa-solid fa-copy"></i></button>
            <button class="rounded p-1.5 text-xs text-gray-200 hover:bg-white/15" :title="block.isVisible ? 'Ẩn' : 'Hiện'" @click="$emit('toggle-visible', block)"><i :class="block.isVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i></button>
            <button class="rounded p-1.5 text-xs text-red-300 hover:bg-red-500/25" title="Xóa" @click="$emit('delete', block)"><i class="fa-solid fa-trash"></i></button>
          </div>

          <!-- Rendered block (interactions disabled so clicks select instead of navigate) -->
          <div class="pointer-events-none select-none">
            <ClientOnly>
              <Suspense>
                <component :is="resolveBlockComponent(block.blockType)" v-if="resolveBlockComponent(block.blockType)" :block="block" />
                <template #fallback>
                  <div class="flex items-center justify-center py-16 text-gray-300"><i class="fa-solid fa-spinner fa-spin"></i></div>
                </template>
              </Suspense>
              <template #fallback>
                <div class="flex items-center justify-center py-16 text-gray-300"><i class="fa-solid fa-spinner fa-spin"></i></div>
              </template>
            </ClientOnly>
            <div v-if="!resolveBlockComponent(block.blockType)" class="border border-dashed border-orange-300 bg-orange-50 p-4 text-center text-xs text-orange-600">
              Block "{{ block.blockType }}" chưa có bộ hiển thị.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BLOCK_REGISTRY } from '~/utils/blocks/registry'
import { resolveBlockComponent } from '~/components/blocks/blockComponents'

const props = defineProps<{
  blocks: any[]
  selectedId: number | null
  viewport: 'desktop' | 'tablet' | 'mobile'
}>()

defineEmits<{
  (e: 'select', id: number): void
  (e: 'move', index: number, dir: number): void
  (e: 'duplicate', block: any): void
  (e: 'delete', block: any): void
  (e: 'toggle-visible', block: any): void
  (e: 'update:viewport', vp: 'desktop' | 'tablet' | 'mobile'): void
}>()

const registry = BLOCK_REGISTRY
const modelViewport = computed(() => props.viewport)

const viewports = [
  { key: 'desktop', label: 'Máy tính', icon: 'fa-solid fa-desktop', width: '100%' },
  { key: 'tablet', label: 'Máy tính bảng', icon: 'fa-solid fa-tablet-screen-button', width: '768px' },
  { key: 'mobile', label: 'Điện thoại', icon: 'fa-solid fa-mobile-screen-button', width: '390px' },
] as const

const canvasWidth = computed(() => viewports.find(v => v.key === props.viewport)?.width || '100%')
const widthLabel = computed(() => (props.viewport === 'desktop' ? 'Toàn màn hình' : canvasWidth.value))
</script>
