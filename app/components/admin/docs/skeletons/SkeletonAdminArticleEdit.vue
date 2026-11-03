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

    <!-- Main editor area -->
    <div class="flex-1 flex flex-col gap-2.5">
      <!-- Title input -->
      <button
        v-if="findHotspot('title')"
        class="h-10 bg-white border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex items-center gap-2 px-4 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
        :aria-label="findHotspot('title')!.label"
        :title="`${findHotspot('title')!.label} — ${findHotspot('title')!.hint}`"
        @click="hotspotClick(findHotspot('title')!)"
      >
        <i class="fa-solid fa-heading text-brand-700/40 text-[0.6rem]" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2.5 w-48 bg-brand-700/15 rounded"></span>
      </button>

      <!-- Cover image -->
      <button
        v-if="findHotspot('cover')"
        class="h-16 bg-gradient-to-br from-[#e8f4e8] to-surface-tint border-2 border-dashed border-[#a8c8a8] rounded text-brand-700 text-[0.65rem] font-bold flex items-center justify-center gap-2 cursor-pointer hover:border-brand-700 hover:bg-[#e0f0e0] focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors"
        :aria-label="findHotspot('cover')!.label"
        :title="`${findHotspot('cover')!.label} — ${findHotspot('cover')!.hint}`"
        @click="hotspotClick(findHotspot('cover')!)"
      >
        <i class="fa-solid fa-image text-brand-700/30 text-lg" aria-hidden="true"></i>
        <span aria-hidden="true" class="h-2 w-20 bg-brand-700/15 rounded"></span>
      </button>

      <!-- Editor: toolbar + content -->
      <button
        v-if="findHotspot('editor')"
        class="h-40 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors overflow-hidden"
        :aria-label="findHotspot('editor')!.label"
        :title="`${findHotspot('editor')!.label} — ${findHotspot('editor')!.hint}`"
        @click="hotspotClick(findHotspot('editor')!)"
      >
        <!-- Toolbar -->
        <span aria-hidden="true" class="flex items-center gap-3 h-7 bg-line border-b border-line px-3 shrink-0">
          <i class="fa-solid fa-bold text-brand-700/30 text-[0.55rem]"></i>
          <i class="fa-solid fa-italic text-brand-700/30 text-[0.55rem]"></i>
          <i class="fa-solid fa-underline text-brand-700/30 text-[0.55rem]"></i>
          <span class="w-px h-3 bg-line-strong"></span>
          <i class="fa-solid fa-list-ul text-brand-700/30 text-[0.55rem]"></i>
          <i class="fa-solid fa-link text-brand-700/30 text-[0.55rem]"></i>
          <i class="fa-solid fa-image text-brand-700/30 text-[0.55rem]"></i>
        </span>
        <!-- Content area -->
        <span aria-hidden="true" class="flex flex-col gap-2 p-3 flex-1">
          <span class="h-2 w-full bg-brand-700/12 rounded"></span>
          <span class="h-2 w-full bg-brand-700/12 rounded"></span>
          <span class="h-2 w-11/12 bg-brand-700/12 rounded"></span>
          <span class="h-2 w-full bg-brand-700/12 rounded"></span>
          <span class="h-2 w-10/12 bg-brand-700/12 rounded"></span>
          <span class="h-2 w-3/4 bg-brand-700/12 rounded"></span>
        </span>
      </button>
    </div>

    <!-- Right sidebar: category + publish + SEO -->
    <div class="w-36 flex flex-col gap-2.5">
      <!-- Category select -->
      <button
        v-if="findHotspot('category')"
        class="h-16 bg-surface-tint border-2 border-dashed border-line-strong rounded text-ink-muted text-[0.65rem] font-semibold flex flex-col gap-1.5 justify-center px-3 cursor-pointer hover:border-brand-700 hover:bg-line focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors text-left"
        :aria-label="findHotspot('category')!.label"
        :title="`${findHotspot('category')!.label} — ${findHotspot('category')!.hint}`"
        @click="hotspotClick(findHotspot('category')!)"
      >
        <span aria-hidden="true" class="flex items-center gap-1.5">
          <i class="fa-solid fa-folder text-brand-700/40 text-[0.6rem]"></i>
          <span class="h-2 w-12 bg-brand-700/20 rounded"></span>
        </span>
        <span aria-hidden="true" class="h-4 w-full bg-white border border-line-strong rounded flex items-center justify-between px-1.5">
          <span class="h-1.5 w-10 bg-brand-700/15 rounded"></span>
          <i class="fa-solid fa-chevron-down text-brand-700/20 text-[0.5rem]"></i>
        </span>
      </button>

      <!-- Publish box -->
      <button
        v-if="findHotspot('publish')"
        class="h-20 bg-brand-900 border-2 border-dashed border-brand-700 rounded text-white text-[0.65rem] font-semibold flex flex-col gap-2 justify-center px-3 cursor-pointer hover:bg-brand-700 hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-700 transition-colors text-left"
        :aria-label="findHotspot('publish')!.label"
        :title="`${findHotspot('publish')!.label} — ${findHotspot('publish')!.hint}`"
        @click="hotspotClick(findHotspot('publish')!)"
      >
        <span aria-hidden="true" class="flex items-center gap-1.5">
          <i class="fa-solid fa-paper-plane text-white/60 text-[0.6rem]"></i>
          <span class="h-2 w-14 bg-white/25 rounded"></span>
        </span>
        <span aria-hidden="true" class="h-4 w-full bg-white/15 rounded"></span>
        <span aria-hidden="true" class="h-3 w-16 bg-brand-300/40 rounded"></span>
      </button>

      <!-- SEO box (decorative only, no hotspot) -->
      <div class="h-14 bg-surface-tint rounded border border-line flex flex-col gap-1 justify-center px-3" aria-hidden="true">
        <div class="flex items-center gap-1.5">
          <i class="fa-solid fa-magnifying-glass text-brand-700/20 text-[0.55rem]"></i>
          <span class="h-1.5 w-10 bg-brand-700/15 rounded"></span>
        </div>
        <span class="h-1.5 w-full bg-brand-700/8 rounded"></span>
        <span class="h-1.5 w-3/4 bg-brand-700/8 rounded"></span>
      </div>
    </div>
  </div>
</template>
