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
    <!-- Breadcrumb -->
    <button
      v-if="findHotspot('top')"
      class="h-6 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center gap-2 px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('top')!.label"
      :title="`${findHotspot('top')!.label} — ${findHotspot('top')!.hint}`"
      @click="hotspotClick(findHotspot('top')!)"
    >
      <i class="fa-solid fa-house text-[#2c6e33]/40 text-[0.55rem]" aria-hidden="true"></i>
      <span aria-hidden="true" class="h-1.5 w-32 bg-[#2c6e33]/15 rounded"></span>
      <i class="fa-solid fa-chevron-right text-[#2c6e33]/20 text-[0.5rem]" aria-hidden="true"></i>
      <span aria-hidden="true" class="h-1.5 w-16 bg-[#2c6e33]/15 rounded"></span>
    </button>

    <!-- Category tag + title + meta -->
    <button
      v-if="findHotspot('title')"
      class="h-20 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors px-4"
      :aria-label="findHotspot('title')!.label"
      :title="`${findHotspot('title')!.label} — ${findHotspot('title')!.hint}`"
      @click="hotspotClick(findHotspot('title')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-1.5">
        <span class="h-4 px-2 bg-[#2c6e33]/15 rounded text-[0.5rem] flex items-center">Chuyên mục</span>
      </span>
      <span aria-hidden="true" class="h-3.5 w-3/4 bg-[#2c6e33]/25 rounded"></span>
      <span aria-hidden="true" class="flex items-center gap-3">
        <span class="flex items-center gap-1">
          <i class="fa-solid fa-calendar text-[#2c6e33]/30 text-[0.55rem]"></i>
          <span class="h-1.5 w-12 bg-[#2c6e33]/15 rounded"></span>
        </span>
        <span class="flex items-center gap-1">
          <i class="fa-solid fa-user text-[#2c6e33]/30 text-[0.55rem]"></i>
          <span class="h-1.5 w-10 bg-[#2c6e33]/15 rounded"></span>
        </span>
      </span>
    </button>

    <!-- Cover image -->
    <button
      v-if="findHotspot('cover')"
      class="h-28 bg-gradient-to-br from-[#e8f4e8] to-[#d0e8d0] border-2 border-dashed border-[#a8c8a8] rounded text-[#2c6e33] text-[0.72rem] font-bold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#e0f0e0] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('cover')!.label"
      :title="`${findHotspot('cover')!.label} — ${findHotspot('cover')!.hint}`"
      @click="hotspotClick(findHotspot('cover')!)"
    >
      <i class="fa-solid fa-image text-[#2c6e33]/30 text-2xl" aria-hidden="true"></i>
      <span aria-hidden="true" class="h-2 w-24 bg-[#2c6e33]/15 rounded"></span>
    </button>

    <!-- Rich-text body -->
    <button
      v-if="findHotspot('content')"
      class="h-36 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors px-6"
      :aria-label="findHotspot('content')!.label"
      :title="`${findHotspot('content')!.label} — ${findHotspot('content')!.hint}`"
      @click="hotspotClick(findHotspot('content')!)"
    >
      <span aria-hidden="true" class="h-2 w-full bg-[#2c6e33]/12 rounded"></span>
      <span aria-hidden="true" class="h-2 w-full bg-[#2c6e33]/12 rounded"></span>
      <span aria-hidden="true" class="h-2 w-11/12 bg-[#2c6e33]/12 rounded"></span>
      <span aria-hidden="true" class="h-2 w-full bg-[#2c6e33]/12 rounded"></span>
      <span aria-hidden="true" class="h-2 w-10/12 bg-[#2c6e33]/12 rounded"></span>
    </button>

    <!-- Share + Related -->
    <div class="flex gap-2.5">
      <button
        v-if="findHotspot('share')"
        class="flex-1 h-10 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-center gap-3 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
        :aria-label="findHotspot('share')!.label"
        :title="`${findHotspot('share')!.label} — ${findHotspot('share')!.hint}`"
        @click="hotspotClick(findHotspot('share')!)"
      >
        <i class="fa-brands fa-facebook text-[#2c6e33]/40 text-sm" aria-hidden="true"></i>
        <i class="fa-solid fa-share-nodes text-[#2c6e33]/40 text-sm" aria-hidden="true"></i>
        <i class="fa-solid fa-link text-[#2c6e33]/40 text-sm" aria-hidden="true"></i>
      </button>
      <button
        v-if="findHotspot('related')"
        class="flex-1 h-10 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
        :aria-label="findHotspot('related')!.label"
        :title="`${findHotspot('related')!.label} — ${findHotspot('related')!.hint}`"
        @click="hotspotClick(findHotspot('related')!)"
      >
        <i class="fa-solid fa-layer-group text-[#2c6e33]/40 text-sm" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-20 bg-[#2c6e33]/15 rounded"></span>
      </button>
    </div>

    <!-- Comments -->
    <button
      v-if="findHotspot('comments')"
      class="h-20 bg-[#f0f7f1] border-2 border-dashed border-[#c8d6c9] rounded text-[#667768] text-[0.65rem] font-semibold flex flex-col gap-2 justify-center px-4 cursor-pointer hover:border-[#2c6e33] hover:bg-[#eaf4ea] focus:outline-none focus:ring-2 focus:ring-[#2c6e33] transition-colors"
      :aria-label="findHotspot('comments')!.label"
      :title="`${findHotspot('comments')!.label} — ${findHotspot('comments')!.hint}`"
      @click="hotspotClick(findHotspot('comments')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-2">
        <span class="w-6 h-6 rounded-full bg-[#2c6e33]/15 flex items-center justify-center">
          <i class="fa-solid fa-user text-[#2c6e33]/30 text-[0.5rem]"></i>
        </span>
        <span class="flex flex-col gap-1 flex-1">
          <span class="h-1.5 w-16 bg-[#2c6e33]/15 rounded"></span>
          <span class="h-1.5 w-full bg-[#2c6e33]/10 rounded"></span>
        </span>
      </span>
      <span aria-hidden="true" class="flex items-center gap-2">
        <span class="w-6 h-6 rounded-full bg-[#2c6e33]/15 flex items-center justify-center">
          <i class="fa-solid fa-user text-[#2c6e33]/30 text-[0.5rem]"></i>
        </span>
        <span class="flex flex-col gap-1 flex-1">
          <span class="h-1.5 w-16 bg-[#2c6e33]/15 rounded"></span>
          <span class="h-1.5 w-3/4 bg-[#2c6e33]/10 rounded"></span>
        </span>
      </span>
    </button>
  </div>
</template>
