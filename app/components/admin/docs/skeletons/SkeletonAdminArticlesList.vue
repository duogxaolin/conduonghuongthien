<script setup lang="ts">
import type { PreviewHotspot } from '~/utils/docs/previews'

const props = defineProps<{
  hotspots: PreviewHotspot[]
}>()

const emit = defineEmits<{ 'hotspot-click': [docSlug: string, anchor?: string] }>()

const hotspotClick = (hotspot: PreviewHotspot) => {
  emit('hotspot-click', hotspot.docSlug, hotspot.anchor)
}

const findHotspot = (area: string) => props.hotspots.find(h => h.area === area)
</script>

<template>
  <div class="flex gap-2.5">
    <!-- Sidebar -->
    <button
      v-if="findHotspot('sidebar')"
      class="w-32 bg-[#0d1f11] border-2 border-dashed border-brand-700 rounded text-brand-300 text-[0.65rem] font-semibold flex flex-col items-center gap-3 py-4 px-2 cursor-pointer hover:border-brand-300 hover:bg-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-300 transition-colors"
      :aria-label="findHotspot('sidebar')!.label"
      :title="`${findHotspot('sidebar')!.label} — ${findHotspot('sidebar')!.hint}`"
      @click="hotspotClick(findHotspot('sidebar')!)"
    >
      <i class="fa-solid fa-shield-halved text-brand-300 text-base" aria-hidden="true"></i>
      <span aria-hidden="true" class="flex flex-col gap-2 w-full items-center">
        <span class="h-2 w-20 bg-brand-300/25 rounded"></span>
        <span class="h-2 w-16 bg-brand-300/15 rounded"></span>
        <span class="h-2 w-16 bg-brand-300/15 rounded"></span>
        <span class="h-2 w-16 bg-brand-300/15 rounded"></span>
      </span>
    </button>

    <div class="flex-1 flex flex-col gap-2.5">
      <!-- Toolbar: filter + create -->
      <div class="flex gap-2">
        <button
          v-if="findHotspot('filter')"
          class="flex-1 h-9 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex items-center gap-2 px-3 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
          :aria-label="findHotspot('filter')!.label"
          :title="`${findHotspot('filter')!.label} — ${findHotspot('filter')!.hint}`"
          @click="hotspotClick(findHotspot('filter')!)"
        >
          <i class="fa-solid fa-filter text-brand-700/40 text-[0.6rem]" aria-hidden="true"></i>
          <span aria-hidden="true" class="h-1.5 w-16 bg-brand-700/15 rounded"></span>
          <i class="fa-solid fa-chevron-down text-brand-700/30 text-[0.5rem]" aria-hidden="true"></i>
        </button>
        <button
          v-if="findHotspot('create')"
          class="w-28 h-9 bg-brand-900 border-2 border-dashed border-brand-700 rounded text-white text-[0.65rem] font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-brand-700 hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
          :aria-label="findHotspot('create')!.label"
          :title="`${findHotspot('create')!.label} — ${findHotspot('create')!.hint}`"
          @click="hotspotClick(findHotspot('create')!)"
        >
          <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
          <span aria-hidden="true" class="h-2 w-12 bg-white/25 rounded"></span>
        </button>
      </div>

      <!-- Table -->
      <button
        v-if="findHotspot('table')"
        class="h-56 bg-white border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors overflow-hidden"
        :aria-label="findHotspot('table')!.label"
        :title="`${findHotspot('table')!.label} — ${findHotspot('table')!.hint}`"
        @click="hotspotClick(findHotspot('table')!)"
      >
        <!-- Table header row -->
        <span aria-hidden="true" class="flex items-center h-7 bg-surface-tint border-b border-line px-3 gap-2 w-full shrink-0">
          <span class="w-4 h-4 border border-line-strong rounded"></span>
          <span class="flex-1 h-2 bg-brand-700/20 rounded"></span>
          <span class="w-16 h-2 bg-brand-700/15 rounded"></span>
          <span class="w-14 h-2 bg-brand-700/15 rounded"></span>
          <span class="w-16 h-2 bg-brand-700/15 rounded"></span>
        </span>
        <!-- Table body rows -->
        <span aria-hidden="true" v-for="n in 4" :key="n" class="flex items-center h-8 border-b border-surface-tint px-3 gap-2 w-full shrink-0">
          <span class="w-4 h-4 border border-line-strong rounded"></span>
          <span class="flex-1 h-2 bg-brand-700/12 rounded"></span>
          <span class="w-16 h-2 bg-brand-700/10 rounded"></span>
          <span class="w-14 h-4 bg-brand-700/15 rounded-full"></span>
          <span class="w-16 flex items-center gap-1 justify-center">
            <i class="fa-solid fa-pen text-brand-700/20 text-[0.5rem]"></i>
            <i class="fa-solid fa-trash text-brand-700/20 text-[0.5rem]"></i>
          </span>
        </span>
      </button>

      <!-- Bulk action bar -->
      <button
        v-if="findHotspot('bulk')"
        class="h-9 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex items-center justify-center gap-3 px-4 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
        :aria-label="findHotspot('bulk')!.label"
        :title="`${findHotspot('bulk')!.label} — ${findHotspot('bulk')!.hint}`"
        @click="hotspotClick(findHotspot('bulk')!)"
      >
        <i class="fa-solid fa-layer-group text-brand-700/40 text-[0.6rem]" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-16 bg-brand-700/15 rounded"></span>
        <span aria-hidden="true" class="h-5 px-2 bg-brand-700/15 rounded flex items-center text-[0.5rem]">
          <i class="fa-solid fa-file-export mr-1 text-[0.5rem]"></i>
          Xuất
        </span>
        <span aria-hidden="true" class="h-5 px-2 bg-brand-700/15 rounded flex items-center text-[0.5rem]">
          <i class="fa-solid fa-trash mr-1 text-[0.5rem]"></i>
          Xoá
        </span>
      </button>
    </div>
  </div>
</template>
