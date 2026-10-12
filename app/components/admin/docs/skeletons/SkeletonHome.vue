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
    <!-- Topbar: hotline + social -->
    <button
      v-if="findHotspot('top')"
      class="h-7 bg-[#0d1f11] border-2 border-dashed border-[#2c6e33] rounded text-[#8ed694] text-[0.6rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-[#8ed694] hover:bg-[#122815] focus:outline-none focus:ring-2 focus:ring-[#8ed694] transition-colors"
      :aria-label="findHotspot('top')!.label"
      :title="`${findHotspot('top')!.label} — ${findHotspot('top')!.hint}`"
      @click="hotspotClick(findHotspot('top')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-2">
        <i class="fa-solid fa-phone text-[#8ed694] text-[0.55rem]"></i>
        <span class="h-1.5 w-16 bg-[#8ed694]/30 rounded"></span>
      </span>
      <span aria-hidden="true" class="flex items-center gap-1.5">
        <i class="fa-brands fa-facebook text-[#8ed694]/60 text-[0.55rem]"></i>
        <i class="fa-brands fa-youtube text-[#8ed694]/60 text-[0.55rem]"></i>
        <span class="h-1.5 w-8 bg-[#8ed694]/30 rounded"></span>
      </span>
    </button>

    <!-- Header: logo + nav -->
    <button
      v-if="findHotspot('header')"
      class="h-14 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('header')!.label"
      :title="`${findHotspot('header')!.label} — ${findHotspot('header')!.hint}`"
      @click="hotspotClick(findHotspot('header')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-2">
        <i class="fa-solid fa-shield-halved text-[#2c6e33] text-base"></i>
        <span class="h-2.5 w-20 bg-[#2c6e33]/20 rounded"></span>
      </span>
      <span aria-hidden="true" class="hidden sm:flex items-center gap-3">
        <span class="h-2 w-10 bg-[#2c6e33]/20 rounded"></span>
        <span class="h-2 w-10 bg-[#2c6e33]/20 rounded"></span>
        <span class="h-2 w-10 bg-[#2c6e33]/20 rounded"></span>
        <span class="h-2 w-10 bg-[#2c6e33]/20 rounded"></span>
        <i class="fa-solid fa-magnifying-glass text-[#2c6e33]/40 text-[0.6rem]"></i>
      </span>
    </button>

    <!-- Hero banner -->
    <button
      v-if="findHotspot('hero')"
      class="h-28 bg-gradient-to-br from-[#e8f4e8] to-[#d0e8d0] border-2 border-dashed border-[#a8c8a8] rounded text-[#2c6e33] text-[0.72rem] font-bold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#e0f0e0] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('hero')!.label"
      :title="`${findHotspot('hero')!.label} — ${findHotspot('hero')!.hint}`"
      @click="hotspotClick(findHotspot('hero')!)"
    >
      <i class="fa-solid fa-image text-[#2c6e33]/30 text-2xl" aria-hidden="true"></i>
      <span aria-hidden="true" class="h-3 w-32 bg-[#2c6e33]/25 rounded"></span>
      <span aria-hidden="true" class="h-2 w-20 bg-[#2c6e33]/15 rounded"></span>
    </button>

    <!-- Content blocks: news + role-models + reintegration -->
    <div class="grid grid-cols-3 gap-2.5">
      <button
        v-if="findHotspot('news')"
        class="h-24 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors p-2 text-center"
        :aria-label="findHotspot('news')!.label"
        :title="`${findHotspot('news')!.label} — ${findHotspot('news')!.hint}`"
        @click="hotspotClick(findHotspot('news')!)"
      >
        <i class="fa-solid fa-newspaper text-[#2c6e33]/40 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-full bg-[#2c6e33]/15 rounded"></span>
        <span aria-hidden="true" class="h-1.5 w-3/4 bg-[#2c6e33]/10 rounded"></span>
      </button>
      <button
        v-if="findHotspot('role-models')"
        class="h-24 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors p-2 text-center"
        :aria-label="findHotspot('role-models')!.label"
        :title="`${findHotspot('role-models')!.label} — ${findHotspot('role-models')!.hint}`"
        @click="hotspotClick(findHotspot('role-models')!)"
      >
        <i class="fa-solid fa-user-group text-[#2c6e33]/40 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-full bg-[#2c6e33]/15 rounded"></span>
        <span aria-hidden="true" class="h-1.5 w-3/4 bg-[#2c6e33]/10 rounded"></span>
      </button>
      <button
        v-if="findHotspot('reintegration')"
        class="h-24 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors p-2 text-center"
        :aria-label="findHotspot('reintegration')!.label"
        :title="`${findHotspot('reintegration')!.label} — ${findHotspot('reintegration')!.hint}`"
        @click="hotspotClick(findHotspot('reintegration')!)"
      >
        <i class="fa-solid fa-handshake text-[#2c6e33]/40 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-full bg-[#2c6e33]/15 rounded"></span>
        <span aria-hidden="true" class="h-1.5 w-3/4 bg-[#2c6e33]/10 rounded"></span>
      </button>
    </div>

    <!-- Stats row -->
    <button
      v-if="findHotspot('stats')"
      class="h-20 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-around cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors px-4"
      :aria-label="findHotspot('stats')!.label"
      :title="`${findHotspot('stats')!.label} — ${findHotspot('stats')!.hint}`"
      @click="hotspotClick(findHotspot('stats')!)"
    >
      <span aria-hidden="true" class="flex flex-col items-center gap-1">
        <i class="fa-solid fa-chart-line text-[#2c6e33]/30 text-sm"></i>
        <span class="h-2.5 w-10 bg-[#2c6e33]/20 rounded"></span>
      </span>
      <span aria-hidden="true" class="h-8 w-px bg-[#c8d6c9]"></span>
      <span aria-hidden="true" class="flex flex-col items-center gap-1">
        <i class="fa-solid fa-eye text-[#2c6e33]/30 text-sm"></i>
        <span class="h-2.5 w-10 bg-[#2c6e33]/20 rounded"></span>
      </span>
      <span aria-hidden="true" class="h-8 w-px bg-[#c8d6c9]"></span>
      <span aria-hidden="true" class="flex flex-col items-center gap-1">
        <i class="fa-solid fa-users text-[#2c6e33]/30 text-sm"></i>
        <span class="h-2.5 w-10 bg-[#2c6e33]/20 rounded"></span>
      </span>
    </button>

    <!-- Footer -->
    <button
      v-if="findHotspot('footer')"
      class="h-14 bg-[#0d1f11] border-2 border-dashed border-[#2c6e33] rounded text-[#8ed694] text-[0.65rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-[#8ed694] hover:bg-[#122815] focus:outline-none focus:ring-2 focus:ring-[#8ed694] transition-colors"
      :aria-label="findHotspot('footer')!.label"
      :title="`${findHotspot('footer')!.label} — ${findHotspot('footer')!.hint}`"
      @click="hotspotClick(findHotspot('footer')!)"
    >
      <span aria-hidden="true" class="flex flex-col gap-1">
        <span class="h-2 w-16 bg-[#8ed694]/25 rounded"></span>
        <span class="h-1.5 w-12 bg-[#8ed694]/15 rounded"></span>
      </span>
      <span aria-hidden="true" class="flex flex-col gap-1">
        <span class="h-2 w-16 bg-[#8ed694]/25 rounded"></span>
        <span class="h-1.5 w-12 bg-[#8ed694]/15 rounded"></span>
      </span>
      <span aria-hidden="true" class="flex flex-col gap-1">
        <span class="h-2 w-16 bg-[#8ed694]/25 rounded"></span>
        <span class="h-1.5 w-12 bg-[#8ed694]/15 rounded"></span>
      </span>
    </button>
  </div>
</template>
