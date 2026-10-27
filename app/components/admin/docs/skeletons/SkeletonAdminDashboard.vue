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
      <!-- Topbar -->
      <div class="h-8 bg-surface-tint rounded border border-line flex items-center justify-between px-3" aria-hidden="true">
        <div class="h-2 w-20 bg-brand-700/15 rounded"></div>
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-bell text-brand-700/30 text-[0.6rem]"></i>
          <div class="w-6 h-6 rounded-full bg-brand-700/15"></div>
        </div>
      </div>

      <!-- Stat cards row -->
      <div class="relative">
        <button
          v-if="findHotspot('stats')"
          class="absolute inset-0 z-10 border-2 border-dashed border-brand-700 rounded text-transparent cursor-pointer hover:border-brand-700 hover:bg-brand-700/5 focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
          :aria-label="findHotspot('stats')!.label"
          :title="`${findHotspot('stats')!.label} — ${findHotspot('stats')!.hint}`"
          @click="hotspotClick(findHotspot('stats')!)"
        >
          <span class="sr-only">{{ findHotspot('stats')!.label }}</span>
        </button>
        <div class="grid grid-cols-3 gap-2" aria-hidden="true">
          <div class="h-18 bg-white rounded border border-line p-2.5 flex flex-col gap-1.5">
            <i class="fa-solid fa-file-lines text-brand-700/30 text-sm"></i>
            <span class="h-3 w-12 bg-brand-700/20 rounded"></span>
            <span class="h-1.5 w-8 bg-brand-700/10 rounded"></span>
          </div>
          <div class="h-18 bg-white rounded border border-line p-2.5 flex flex-col gap-1.5">
            <i class="fa-solid fa-users text-brand-700/30 text-sm"></i>
            <span class="h-3 w-12 bg-brand-700/20 rounded"></span>
            <span class="h-1.5 w-8 bg-brand-700/10 rounded"></span>
          </div>
          <div class="h-18 bg-white rounded border border-line p-2.5 flex flex-col gap-1.5">
            <i class="fa-solid fa-comments text-brand-700/30 text-sm"></i>
            <span class="h-3 w-12 bg-brand-700/20 rounded"></span>
            <span class="h-1.5 w-8 bg-brand-700/10 rounded"></span>
          </div>
        </div>
      </div>

      <!-- Chart -->
      <button
        v-if="findHotspot('chart')"
        class="h-32 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
        :aria-label="findHotspot('chart')!.label"
        :title="`${findHotspot('chart')!.label} — ${findHotspot('chart')!.hint}`"
        @click="hotspotClick(findHotspot('chart')!)"
      >
        <i class="fa-solid fa-chart-line text-brand-700/25 text-2xl" aria-hidden="true"></i>
        <span aria-hidden="true" class="flex items-end gap-1 h-8">
          <span class="w-3 h-3 bg-brand-700/20 rounded-sm"></span>
          <span class="w-3 h-5 bg-brand-700/20 rounded-sm"></span>
          <span class="w-3 h-7 bg-brand-700/25 rounded-sm"></span>
          <span class="w-3 h-4 bg-brand-700/15 rounded-sm"></span>
          <span class="w-3 h-6 bg-brand-700/20 rounded-sm"></span>
          <span class="w-3 h-8 bg-brand-700/25 rounded-sm"></span>
        </span>
      </button>

      <!-- Recent + Quick actions -->
      <div class="grid grid-cols-2 gap-2">
        <button
          v-if="findHotspot('recent')"
          class="h-20 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col gap-1.5 justify-center px-3 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
          :aria-label="findHotspot('recent')!.label"
          :title="`${findHotspot('recent')!.label} — ${findHotspot('recent')!.hint}`"
          @click="hotspotClick(findHotspot('recent')!)"
        >
          <span aria-hidden="true" class="flex items-center gap-2">
            <span class="h-2 w-6 bg-brand-700/15 rounded"></span>
            <span class="h-2 w-full bg-brand-700/10 rounded"></span>
          </span>
          <span aria-hidden="true" class="flex items-center gap-2">
            <span class="h-2 w-6 bg-brand-700/15 rounded"></span>
            <span class="h-2 w-full bg-brand-700/10 rounded"></span>
          </span>
          <span aria-hidden="true" class="flex items-center gap-2">
            <span class="h-2 w-6 bg-brand-700/15 rounded"></span>
            <span class="h-2 w-3/4 bg-brand-700/10 rounded"></span>
          </span>
        </button>
        <button
          v-if="findHotspot('quick')"
          class="h-20 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
          :aria-label="findHotspot('quick')!.label"
          :title="`${findHotspot('quick')!.label} — ${findHotspot('quick')!.hint}`"
          @click="hotspotClick(findHotspot('quick')!)"
        >
          <i class="fa-solid fa-bolt text-brand-700/30 text-base" aria-hidden="true"></i>
          <span aria-hidden="true" class="flex gap-1.5">
            <span class="h-5 w-5 bg-brand-700/15 rounded flex items-center justify-center">
              <i class="fa-solid fa-plus text-brand-700/30 text-[0.5rem]"></i>
            </span>
            <span class="h-5 w-5 bg-brand-700/15 rounded flex items-center justify-center">
              <i class="fa-solid fa-file text-brand-700/30 text-[0.5rem]"></i>
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
