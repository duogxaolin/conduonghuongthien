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
      class="w-32 bg-[#0d1f11] border-2 border-dashed border-[#2c6e33] rounded text-[#8ed694] text-[0.65rem] font-semibold flex flex-col items-center gap-3 py-4 px-2 cursor-pointer hover:border-[#8ed694] hover:bg-[#122815] focus:outline-none focus:ring-2 focus:ring-[#8ed694] transition-colors"
      :aria-label="findHotspot('sidebar')!.label"
      :title="`${findHotspot('sidebar')!.label} — ${findHotspot('sidebar')!.hint}`"
      @click="hotspotClick(findHotspot('sidebar')!)"
    >
      <i class="fa-solid fa-shield-halved text-[#8ed694] text-base" aria-hidden="true"></i>
      <span aria-hidden="true" class="flex flex-col gap-2 w-full items-center">
        <span class="h-2 w-20 bg-[#8ed694]/25 rounded"></span>
        <span class="h-2 w-16 bg-[#8ed694]/15 rounded"></span>
        <span class="h-2 w-16 bg-[#8ed694]/15 rounded"></span>
        <span class="h-2 w-16 bg-[#8ed694]/15 rounded"></span>
      </span>
    </button>

    <div class="flex-1 flex flex-col gap-2.5">
      <!-- Toolbar: filter + create -->
      <div class="flex gap-2">
        <button
          v-if="findHotspot('filter')"
          class="flex-1 h-9 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center gap-2 px-3 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
          :aria-label="findHotspot('filter')!.label"
          :title="`${findHotspot('filter')!.label} — ${findHotspot('filter')!.hint}`"
          @click="hotspotClick(findHotspot('filter')!)"
        >
          <i class="fa-solid fa-filter text-[#2c6e33]/40 text-[0.6rem]" aria-hidden="true"></i>
          <span aria-hidden="true" class="h-1.5 w-16 bg-[#2c6e33]/15 rounded"></span>
          <i class="fa-solid fa-chevron-down text-[#2c6e33]/30 text-[0.5rem]" aria-hidden="true"></i>
        </button>
        <button
          v-if="findHotspot('create')"
          class="w-28 h-9 bg-[#1e4620] border-2 border-dashed border-[#2c6e33] rounded text-white text-[0.65rem] font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-[#2c6e33] hover:border-[#8ed694] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
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
        class="h-56 bg-white border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors overflow-hidden"
        :aria-label="findHotspot('table')!.label"
        :title="`${findHotspot('table')!.label} — ${findHotspot('table')!.hint}`"
        @click="hotspotClick(findHotspot('table')!)"
      >
        <!-- Table header row -->
        <span aria-hidden="true" class="flex items-center h-7 bg-[#f0f7f1] border-b border-[#e2ece3] px-3 gap-2 w-full shrink-0">
          <span class="w-4 h-4 border border-[#c8d6c9] rounded"></span>
          <span class="flex-1 h-2 bg-[#2c6e33]/20 rounded"></span>
          <span class="w-16 h-2 bg-[#2c6e33]/15 rounded"></span>
          <span class="w-14 h-2 bg-[#2c6e33]/15 rounded"></span>
          <span class="w-16 h-2 bg-[#2c6e33]/15 rounded"></span>
        </span>
        <!-- Table body rows -->
        <span aria-hidden="true" v-for="n in 4" :key="n" class="flex items-center h-8 border-b border-[#eef4ee] px-3 gap-2 w-full shrink-0">
          <span class="w-4 h-4 border border-[#c8d6c9] rounded"></span>
          <span class="flex-1 h-2 bg-[#2c6e33]/12 rounded"></span>
          <span class="w-16 h-2 bg-[#2c6e33]/10 rounded"></span>
          <span class="w-14 h-4 bg-[#2c6e33]/15 rounded-full"></span>
          <span class="w-16 flex items-center gap-1 justify-center">
            <i class="fa-solid fa-pen text-[#2c6e33]/20 text-[0.5rem]"></i>
            <i class="fa-solid fa-trash text-[#2c6e33]/20 text-[0.5rem]"></i>
          </span>
        </span>
      </button>

      <!-- Bulk action bar -->
      <button
        v-if="findHotspot('bulk')"
        class="h-9 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-center gap-3 px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
        :aria-label="findHotspot('bulk')!.label"
        :title="`${findHotspot('bulk')!.label} — ${findHotspot('bulk')!.hint}`"
        @click="hotspotClick(findHotspot('bulk')!)"
      >
        <i class="fa-solid fa-layer-group text-[#2c6e33]/40 text-[0.6rem]" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-16 bg-[#2c6e33]/15 rounded"></span>
        <span aria-hidden="true" class="h-5 px-2 bg-[#2c6e33]/15 rounded flex items-center text-[0.5rem]">
          <i class="fa-solid fa-file-export mr-1 text-[0.5rem]"></i>
          Xuất
        </span>
        <span aria-hidden="true" class="h-5 px-2 bg-[#2c6e33]/15 rounded flex items-center text-[0.5rem]">
          <i class="fa-solid fa-trash mr-1 text-[0.5rem]"></i>
          Xoá
        </span>
      </button>
    </div>
  </div>
</template>
