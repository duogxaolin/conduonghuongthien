<template>
  <div class="flex h-full flex-col bg-[#e9ece8]">
    <!-- Canvas toolbar: viewport switch + zoom readout + reload -->
    <div class="flex shrink-0 items-center justify-center gap-1 border-b border-gray-200 bg-white px-3 py-2">
      <button
        v-for="vp in viewports"
        :key="vp.key"
        class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition"
        :class="viewport === vp.key ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-100'"
        :title="vp.label"
        @click="$emit('update:viewport', vp.key)"
      >
        <i :class="vp.icon"></i>
        <span class="hidden sm:inline">{{ vp.label }}</span>
      </button>
      <span class="ml-3 text-[0.7rem] text-gray-400">{{ logicalWidth }}px · {{ Math.round(scale * 100) }}%</span>
      <button class="ml-2 rounded-md px-2 py-1.5 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-600" title="Tải lại preview" @click="reload">
        <i class="fa-solid fa-rotate-right"></i>
      </button>
    </div>

    <!-- Scrollable stage: the real public page in an iframe, scaled to fit -->
    <div ref="stageRef" class="flex-1 overflow-auto p-4">
      <div class="relative mx-auto" :style="{ width: Math.round(logicalWidth * scale) + 'px', height: Math.round(frameHeight * scale) + 'px' }">
        <div v-if="!ready" class="absolute inset-0 z-10 flex items-center justify-center text-gray-300">
          <i class="fa-solid fa-spinner fa-spin text-2xl"></i>
        </div>
        <iframe
          ref="frameRef"
          :src="previewSrc"
          class="origin-top-left border-0 bg-white shadow-lg transition-opacity"
          :class="ready ? 'opacity-100' : 'opacity-0'"
          :style="{ width: logicalWidth + 'px', height: frameHeight + 'px', transform: `scale(${scale})` }"
          @load="onFrameLoad"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  blocks: any[]
  selectedId: number | string | null
  viewport: 'desktop' | 'tablet' | 'mobile'
  previewPath: string
}>()

const emit = defineEmits<{
  (e: 'select', id: number | string | null): void
  (e: 'update:viewport', vp: 'desktop' | 'tablet' | 'mobile'): void
}>()

// True viewport widths — the iframe renders at these, then scales to fit.
const VIEWPORT_WIDTH = { desktop: 1440, tablet: 768, mobile: 390 } as const
const viewports = [
  { key: 'desktop', label: 'Máy tính', icon: 'fa-solid fa-desktop' },
  { key: 'tablet', label: 'Máy tính bảng', icon: 'fa-solid fa-tablet-screen-button' },
  { key: 'mobile', label: 'Điện thoại', icon: 'fa-solid fa-mobile-screen-button' },
] as const

const logicalWidth = computed(() => VIEWPORT_WIDTH[props.viewport])

// `?__preview=1` flips the public page into preview-bridge mode.
const previewSrc = computed(() => {
  const p = props.previewPath || '/'
  return `${p}${p.includes('?') ? '&' : '?'}__preview=1`
})

const frameRef = ref<HTMLIFrameElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const stageWidth = ref(0)
const frameHeight = ref(900)
const ready = ref(false)
let ro: ResizeObserver | null = null

// Shrink to fit the stage; never upscale past 1:1.
const scale = computed(() => {
  if (!stageWidth.value) return 1
  return Math.min(1, stageWidth.value / logicalWidth.value)
})

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '*')

const postToFrame = (msg: any) => {
  frameRef.value?.contentWindow?.postMessage(msg, origin())
}

// Reactive proxies can't be structured-cloned across postMessage → send plain JSON.
const plainVisibleBlocks = () =>
  JSON.parse(JSON.stringify(props.blocks.filter((b: any) => b.isVisible)))

const pushBlocks = () => { if (ready.value) postToFrame({ type: 'cdkt:blocks', blocks: plainVisibleBlocks() }) }
const pushSelection = () => { if (ready.value) postToFrame({ type: 'cdkt:select', id: props.selectedId }) }

const onMessage = (e: MessageEvent) => {
  if (e.origin !== origin()) return
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.type === 'cdkt:ready') {
    ready.value = true
    pushBlocks()
    pushSelection()
  } else if (m.type === 'cdkt:height') {
    // Ignore sub-threshold jitter so the frame doesn't visibly resize on hover.
    const next = Math.max(200, Number(m.height) || 0)
    if (Math.abs(next - frameHeight.value) >= 4) frameHeight.value = next
  } else if (m.type === 'cdkt:select') {
    // Preserve tmp string ids (tree pages); numeric-only ids stay numbers.
    const raw = m.id
    const s = raw == null ? null : String(raw)
    emit('select', s == null ? null : /^\d+$/.test(s) ? Number(s) : s)
  }
}

const onFrameLoad = () => { ready.value = false } // page will re-announce via cdkt:ready
const reload = () => { ready.value = false; frameRef.value?.contentWindow?.location.reload() }

onMounted(() => {
  window.addEventListener('message', onMessage)
  if (stageRef.value) {
    const measure = () => { stageWidth.value = (stageRef.value?.clientWidth || 0) - 32 /* p-4 */ }
    measure()
    ro = new ResizeObserver(measure)
    ro.observe(stageRef.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  ro?.disconnect(); ro = null
})

// Live-sync edits and selection into the running preview.
watch(() => props.blocks, pushBlocks, { deep: true })
watch(() => props.selectedId, pushSelection)
</script>
