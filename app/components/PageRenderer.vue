<template>
  <div>
    <BlockNode
      v-for="node in blocks"
      :key="node.id"
      :node="node"
      :interactive="interactive"
      :selected-id="selectedId"
    />
  </div>
</template>

<script setup>
// Renders a page's node tree. Each root node is delegated to the recursive
// BlockNode, which handles containers (section/row/column) and leaf blocks alike.
// A legacy flat array is simply a list of childless root nodes — rendered
// identically to before (each maps to its block component).
//
// `interactive` + `selectedId` are only set when embedded in the builder preview
// (see usePagePreview); on the live site both are inert.
import BlockNode from './blocks/BlockNode.vue'

defineProps({
  blocks: { type: Array, default: () => [] },
  interactive: { type: Boolean, default: false },
  selectedId: { type: [Number, String, null], default: null },
})
</script>
