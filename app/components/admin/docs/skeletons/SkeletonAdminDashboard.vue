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
      <!-- Topbar -->
      <div class="h-8 bg-[#f0f7f1] rounded border border-[#e2ece3] flex items-center justify-between px-3" aria-hidden="true">
        <div class="h-2 w-20 bg-[#2c6e33]/15 rounded"></div>
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-bell text-[#2c6e33]/30 text-[0.6rem]"></i>
          <div class="w-6 h-6 rounded-full bg-[#2c6e33]/15"></div>
        </div>
      </div>

      <!-- Stat cards row -->
      <div class="relative">
        <button
          v-if="findHotspot('stats')"
          class="absolute inset-0 z-10 border-2 border-dashed border-[#2c6e33] rounded text-transparent cursor-pointer hover:border-[#2c6e33] hover:bg-[#2c6e33]/5 focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
          :aria-label="findHotspot('stats')!.label"
          :title="`${findHotspot('stats')!.label} — ${findHotspot('stats')!.hint}`"
          @click="hotspotClick(findHotspot('stats')!)"
        >
          <span class="sr-only">{{ findHotspot('stats')!.label }}</span>
        </button>
        <div class="grid grid-cols-3 gap-2" aria-hidden="true">
          <div class="h-18 bg-white rounded border border-[#e2ece3] p-2.5 flex flex-col gap-1.5">
            <i class="fa-solid fa-file-lines text-[#2c6e33]/30 text-sm"></i>
            <span class="h-3 w-12 bg-[#2c6e33]/20 rounded"></span>
            <span class="h-1.5 w-8 bg-[#2c6e33]/10 rounded"></span>
          </div>
          <div class="h-18 bg-white rounded border border-[#e2ece3] p-2.5 flex flex-col gap-1.5">
            <i class="fa-solid fa-users text-[#2c6e33]/30 text-sm"></i>
            <span class="h-3 w-12 bg-[#2c6e33]/20 rounded"></span>
            <span class="h-1.5 w-8 bg-[#2c6e33]/10 rounded"></span>
          </div>
          <div class="h-18 bg-white rounded border border-[#e2ece3] p-2.5 flex flex-col gap-1.5">
            <i class="fa-solid fa-comments text-[#2c6e33]/30 text-sm"></i>
            <span class="h-3 w-12 bg-[#2c6e33]/20 rounded"></span>
            <span class="h-1.5 w-8 bg-[#2c6e33]/10 rounded"></span>
          </div>
        </div>
      </div>

      <!-- Chart -->
      <button
        v-if="findHotspot('chart')"
        class="h-32 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
        :aria-label="findHotspot('chart')!.label"
        :title="`${findHotspot('chart')!.label} — ${findHotspot('chart')!.hint}`"
        @click="hotspotClick(findHotspot('chart')!)"
      >
        <i class="fa-solid fa-chart-line text-[#2c6e33]/25 text-2xl" aria-hidden="true"></i>
        <span aria-hidden="true" class="flex items-end gap-1 h-8">
          <span class="w-3 h-3 bg-[#2c6e33]/20 rounded-sm"></span>
          <span class="w-3 h-5 bg-[#2c6e33]/20 rounded-sm"></span>
          <span class="w-3 h-7 bg-[#2c6e33]/25 rounded-sm"></span>
          <span class="w-3 h-4 bg-[#2c6e33]/15 rounded-sm"></span>
          <span class="w-3 h-6 bg-[#2c6e33]/20 rounded-sm"></span>
          <span class="w-3 h-8 bg-[#2c6e33]/25 rounded-sm"></span>
        </span>
      </button>

      <!-- Recent + Quick actions -->
      <div class="grid grid-cols-2 gap-2">
        <button
          v-if="findHotspot('recent')"
          class="h-20 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col gap-1.5 justify-center px-3 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
          :aria-label="findHotspot('recent')!.label"
          :title="`${findHotspot('recent')!.label} — ${findHotspot('recent')!.hint}`"
          @click="hotspotClick(findHotspot('recent')!)"
        >
          <span aria-hidden="true" class="flex items-center gap-2">
            <span class="h-2 w-6 bg-[#2c6e33]/15 rounded"></span>
            <span class="h-2 w-full bg-[#2c6e33]/10 rounded"></span>
          </span>
          <span aria-hidden="true" class="flex items-center gap-2">
            <span class="h-2 w-6 bg-[#2c6e33]/15 rounded"></span>
            <span class="h-2 w-full bg-[#2c6e33]/10 rounded"></span>
          </span>
          <span aria-hidden="true" class="flex items-center gap-2">
            <span class="h-2 w-6 bg-[#2c6e33]/15 rounded"></span>
            <span class="h-2 w-3/4 bg-[#2c6e33]/10 rounded"></span>
          </span>
        </button>
        <button
          v-if="findHotspot('quick')"
          class="h-20 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
          :aria-label="findHotspot('quick')!.label"
          :title="`${findHotspot('quick')!.label} — ${findHotspot('quick')!.hint}`"
          @click="hotspotClick(findHotspot('quick')!)"
        >
          <i class="fa-solid fa-bolt text-[#2c6e33]/30 text-base" aria-hidden="true"></i>
          <span aria-hidden="true" class="flex gap-1.5">
            <span class="h-5 w-5 bg-[#2c6e33]/15 rounded flex items-center justify-center">
              <i class="fa-solid fa-plus text-[#2c6e33]/30 text-[0.5rem]"></i>
            </span>
            <span class="h-5 w-5 bg-[#2c6e33]/15 rounded flex items-center justify-center">
              <i class="fa-solid fa-file text-[#2c6e33]/30 text-[0.5rem]"></i>
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
