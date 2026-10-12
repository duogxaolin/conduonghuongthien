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
  <div class="flex flex-col gap-2.5">
    <!-- Category tab bar -->
    <button
      v-if="findHotspot('top')"
      class="h-9 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-center gap-3 px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('top')!.label"
      :title="`${findHotspot('top')!.label} — ${findHotspot('top')!.hint}`"
      @click="hotspotClick(findHotspot('top')!)"
    >
      <span aria-hidden="true" class="h-2 w-12 bg-[#2c6e33]/25 rounded"></span>
      <span aria-hidden="true" class="h-2 w-12 bg-[#2c6e33]/15 rounded"></span>
      <span aria-hidden="true" class="h-2 w-12 bg-[#2c6e33]/15 rounded"></span>
      <span aria-hidden="true" class="h-2 w-12 bg-[#2c6e33]/15 rounded"></span>
    </button>

    <!-- Search input -->
    <button
      v-if="findHotspot('search')"
      class="h-10 bg-white border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('search')!.label"
      :title="`${findHotspot('search')!.label} — ${findHotspot('search')!.hint}`"
      @click="hotspotClick(findHotspot('search')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-2">
        <i class="fa-solid fa-magnifying-glass text-[#2c6e33]/40 text-xs"></i>
        <span class="h-2 w-32 bg-[#2c6e33]/15 rounded"></span>
      </span>
      <span aria-hidden="true" class="h-5 px-3 bg-[#2c6e33]/15 rounded flex items-center text-[0.55rem]">Tìm</span>
    </button>

    <!-- 2x2 article card grid -->
    <div class="relative">
      <button
        v-if="findHotspot('grid')"
        class="absolute inset-0 z-10 border-2 border-dashed border-[#2c6e33] rounded text-transparent cursor-pointer hover:border-[#2c6e33] hover:bg-[#2c6e33]/5 focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
        :aria-label="findHotspot('grid')!.label"
        :title="`${findHotspot('grid')!.label} — ${findHotspot('grid')!.hint}`"
        @click="hotspotClick(findHotspot('grid')!)"
      >
        <span class="sr-only">{{ findHotspot('grid')!.label }}</span>
      </button>
      <div class="grid grid-cols-2 gap-2.5" aria-hidden="true">
        <div v-for="n in 4" :key="n" class="flex flex-col gap-1.5">
          <div class="h-20 bg-gradient-to-br from-[#e8f4e8] to-[#f0f7f1] rounded border border-[#e2ece3] flex items-center justify-center">
            <i class="fa-solid fa-image text-[#2c6e33]/20 text-lg"></i>
          </div>
          <div class="h-2.5 bg-[#2c6e33]/15 rounded w-3/4"></div>
          <div class="h-2 bg-[#2c6e33]/10 rounded"></div>
          <div class="flex items-center gap-1.5">
            <i class="fa-solid fa-calendar text-[#2c6e33]/20 text-[0.5rem]"></i>
            <div class="h-1.5 w-10 bg-[#2c6e33]/10 rounded"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <button
      v-if="findHotspot('pagination')"
      class="h-9 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-center gap-2 px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('pagination')!.label"
      :title="`${findHotspot('pagination')!.label} — ${findHotspot('pagination')!.hint}`"
      @click="hotspotClick(findHotspot('pagination')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-1.5">
        <i class="fa-solid fa-chevron-left text-[#2c6e33]/30 text-[0.55rem]"></i>
        <span class="h-5 w-5 bg-[#2c6e33]/20 rounded flex items-center justify-center text-[0.5rem]">1</span>
        <span class="h-5 w-5 bg-[#2c6e33]/10 rounded"></span>
        <span class="h-5 w-5 bg-[#2c6e33]/10 rounded"></span>
        <span class="h-5 w-5 bg-[#2c6e33]/10 rounded"></span>
        <i class="fa-solid fa-chevron-right text-[#2c6e33]/30 text-[0.55rem]"></i>
      </span>
    </button>
  </div>
</template>
