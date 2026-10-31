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
      class="h-7 bg-[#0d1f11] border-2 border-dashed border-brand-700 rounded text-brand-300 text-[0.6rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-brand-300 hover:bg-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-300 transition-colors"
      :aria-label="findHotspot('top')!.label"
      :title="`${findHotspot('top')!.label} — ${findHotspot('top')!.hint}`"
      @click="hotspotClick(findHotspot('top')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-2">
        <i class="fa-solid fa-phone text-brand-300 text-[0.55rem]"></i>
        <span class="h-1.5 w-16 bg-brand-300/30 rounded"></span>
      </span>
      <span aria-hidden="true" class="flex items-center gap-1.5">
        <i class="fa-brands fa-facebook text-brand-300/60 text-[0.55rem]"></i>
        <i class="fa-brands fa-youtube text-brand-300/60 text-[0.55rem]"></i>
        <span class="h-1.5 w-8 bg-brand-300/30 rounded"></span>
      </span>
    </button>

    <!-- Header: logo + nav -->
    <button
      v-if="findHotspot('header')"
      class="h-14 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
      :aria-label="findHotspot('header')!.label"
      :title="`${findHotspot('header')!.label} — ${findHotspot('header')!.hint}`"
      @click="hotspotClick(findHotspot('header')!)"
    >
      <span aria-hidden="true" class="flex items-center gap-2">
        <i class="fa-solid fa-shield-halved text-brand-700 text-base"></i>
        <span class="h-2.5 w-20 bg-brand-700/20 rounded"></span>
      </span>
      <span aria-hidden="true" class="hidden sm:flex items-center gap-3">
        <span class="h-2 w-10 bg-brand-700/20 rounded"></span>
        <span class="h-2 w-10 bg-brand-700/20 rounded"></span>
        <span class="h-2 w-10 bg-brand-700/20 rounded"></span>
        <span class="h-2 w-10 bg-brand-700/20 rounded"></span>
        <i class="fa-solid fa-magnifying-glass text-brand-700/40 text-[0.6rem]"></i>
      </span>
    </button>

    <!-- Hero banner -->
    <button
      v-if="findHotspot('hero')"
      class="h-28 bg-gradient-to-br from-[#e8f4e8] to-[#d0e8d0] border-2 border-dashed border-[#a8c8a8] rounded text-brand-700 text-[0.72rem] font-bold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-brand-700 hover:bg-[#e0f0e0] focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
      :aria-label="findHotspot('hero')!.label"
      :title="`${findHotspot('hero')!.label} — ${findHotspot('hero')!.hint}`"
      @click="hotspotClick(findHotspot('hero')!)"
    >
      <i class="fa-solid fa-image text-brand-700/30 text-2xl" aria-hidden="true"></i>
      <span aria-hidden="true" class="h-3 w-32 bg-brand-700/25 rounded"></span>
      <span aria-hidden="true" class="h-2 w-20 bg-brand-700/15 rounded"></span>
    </button>

    <!-- Content blocks: news + role-models + reintegration -->
    <div class="grid grid-cols-3 gap-2.5">
      <button
        v-if="findHotspot('news')"
        class="h-24 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors p-2 text-center"
        :aria-label="findHotspot('news')!.label"
        :title="`${findHotspot('news')!.label} — ${findHotspot('news')!.hint}`"
        @click="hotspotClick(findHotspot('news')!)"
      >
        <i class="fa-solid fa-newspaper text-brand-700/40 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-full bg-brand-700/15 rounded"></span>
        <span aria-hidden="true" class="h-1.5 w-3/4 bg-brand-700/10 rounded"></span>
      </button>
      <button
        v-if="findHotspot('role-models')"
        class="h-24 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors p-2 text-center"
        :aria-label="findHotspot('role-models')!.label"
        :title="`${findHotspot('role-models')!.label} — ${findHotspot('role-models')!.hint}`"
        @click="hotspotClick(findHotspot('role-models')!)"
      >
        <i class="fa-solid fa-user-group text-brand-700/40 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-full bg-brand-700/15 rounded"></span>
        <span aria-hidden="true" class="h-1.5 w-3/4 bg-brand-700/10 rounded"></span>
      </button>
      <button
        v-if="findHotspot('reintegration')"
        class="h-24 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors p-2 text-center"
        :aria-label="findHotspot('reintegration')!.label"
        :title="`${findHotspot('reintegration')!.label} — ${findHotspot('reintegration')!.hint}`"
        @click="hotspotClick(findHotspot('reintegration')!)"
      >
        <i class="fa-solid fa-handshake text-brand-700/40 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-full bg-brand-700/15 rounded"></span>
        <span aria-hidden="true" class="h-1.5 w-3/4 bg-brand-700/10 rounded"></span>
      </button>
    </div>

    <!-- Stats row -->
    <button
      v-if="findHotspot('stats')"
      class="h-20 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex items-center justify-around cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors px-4"
      :aria-label="findHotspot('stats')!.label"
      :title="`${findHotspot('stats')!.label} — ${findHotspot('stats')!.hint}`"
      @click="hotspotClick(findHotspot('stats')!)"
    >
      <span aria-hidden="true" class="flex flex-col items-center gap-1">
        <i class="fa-solid fa-chart-line text-brand-700/30 text-sm"></i>
        <span class="h-2.5 w-10 bg-brand-700/20 rounded"></span>
      </span>
      <span aria-hidden="true" class="h-8 w-px bg-line-strong"></span>
      <span aria-hidden="true" class="flex flex-col items-center gap-1">
        <i class="fa-solid fa-eye text-brand-700/30 text-sm"></i>
        <span class="h-2.5 w-10 bg-brand-700/20 rounded"></span>
      </span>
      <span aria-hidden="true" class="h-8 w-px bg-line-strong"></span>
      <span aria-hidden="true" class="flex flex-col items-center gap-1">
        <i class="fa-solid fa-users text-brand-700/30 text-sm"></i>
        <span class="h-2.5 w-10 bg-brand-700/20 rounded"></span>
      </span>
    </button>

    <!-- Footer -->
    <button
      v-if="findHotspot('footer')"
      class="h-14 bg-[#0d1f11] border-2 border-dashed border-brand-700 rounded text-brand-300 text-[0.65rem] font-semibold flex items-center justify-between px-4 cursor-pointer hover:border-brand-300 hover:bg-brand-950 focus:outline-none focus:ring-2 focus:ring-brand-300 transition-colors"
      :aria-label="findHotspot('footer')!.label"
      :title="`${findHotspot('footer')!.label} — ${findHotspot('footer')!.hint}`"
      @click="hotspotClick(findHotspot('footer')!)"
    >
      <span aria-hidden="true" class="flex flex-col gap-1">
        <span class="h-2 w-16 bg-brand-300/25 rounded"></span>
        <span class="h-1.5 w-12 bg-brand-300/15 rounded"></span>
      </span>
      <span aria-hidden="true" class="flex flex-col gap-1">
        <span class="h-2 w-16 bg-brand-300/25 rounded"></span>
        <span class="h-1.5 w-12 bg-brand-300/15 rounded"></span>
      </span>
      <span aria-hidden="true" class="flex flex-col gap-1">
        <span class="h-2 w-16 bg-brand-300/25 rounded"></span>
        <span class="h-1.5 w-12 bg-brand-300/15 rounded"></span>
      </span>
    </button>
  </div>
</template>
