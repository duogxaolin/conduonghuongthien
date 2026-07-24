<template>
  <div>
    <div
      class="group mb-1 flex cursor-pointer items-center gap-1.5 rounded-lg py-2 pr-2 transition"
      :class="[
        tree.selectedId.value === node.id ? 'bg-green-50 ring-1 ring-green-300' : 'hover:bg-gray-50',
        node.isVisible === false ? 'opacity-50' : '',
      ]"
      :style="{ paddingLeft: 8 + depth * 14 + 'px' }"
      @click.stop="tree.select(node.id)"
    >
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs" :class="isContainer ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-700'">
        <i :class="def?.icon || 'fa-solid fa-cube'"></i>
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-semibold text-gray-700">{{ def?.label || node.blockType }}</p>
        <p class="truncate text-[0.68rem] text-gray-400">{{ previewText }}</p>
      </div>
      <span v-if="node.blockType === 'column'" class="shrink-0 rounded bg-blue-50 px-1 text-[0.6rem] font-bold text-blue-500" title="Số cột chiếm (1–12)">{{ node.colSpan || 12 }}</span>
      <i v-if="node.isVisible === false" class="fa-solid fa-eye-slash shrink-0 text-[0.7rem] text-orange-400" title="Đang ẩn"></i>
      <button
        v-if="isContainer"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-300 opacity-0 transition hover:bg-green-100 hover:text-green-700 group-hover:opacity-100"
        :title="addTitle"
        @click.stop="tree.openPalette(node.id)"
      >
        <i class="fa-solid fa-plus text-[0.7rem]"></i>
      </button>
    </div>

    <!-- Children (recursive) -->
    <template v-if="isContainer && node.children && node.children.length">
      <BlockTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
      />
    </template>
    <p
      v-else-if="isContainer"
      class="mb-1 italic text-[0.66rem] text-gray-300"
      :style="{ paddingLeft: 8 + (depth + 1) * 14 + 'px' }"
    >
      (trống)
    </p>
  </div>
</template>

<script setup lang="ts">
// Recursive left-navigator node for the page builder tree. Renders one node with
// its registry icon/label, indents by depth, and — for layout containers — offers
// a contextual "+ add child" button. Selection + palette are driven through an
// injected `tree` bridge so this component recurses cleanly at any depth.
import { computed, inject } from 'vue'
import { BLOCK_REGISTRY, isContainerType } from '~/utils/blocks/registry'

defineOptions({ name: 'BlockTreeNode' })

const props = defineProps<{ node: any; depth: number }>()

const tree = inject<any>('builderTree')

const def = computed(() => BLOCK_REGISTRY[props.node?.blockType])
const isContainer = computed(() => isContainerType(props.node?.blockType))

const addTitle = computed(() => {
  const t = props.node?.blockType
  if (t === 'section') return 'Thêm Row vào Section'
  if (t === 'row') return 'Thêm Cột vào Row'
  if (t === 'column') return 'Thêm nội dung vào Cột'
  return 'Thêm vào'
})

const previewText = computed(() => {
  const d = props.node?.data || {}
  return d.title || d.text || d.badge || d.titleLine1 || (typeof d.html === 'string' ? d.html.replace(/<[^>]+>/g, '').slice(0, 40) : '') || '—'
})
</script>
