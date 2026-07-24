<template>
  <div>
    <template v-for="block in blocks" :key="block.id">
      <component :is="resolveBlockComponent(block.blockType)" v-if="resolveBlockComponent(block.blockType)" :block="block" />
      <!-- Unknown block types are silently skipped (defensive against stale/removed types). -->
    </template>
  </div>
</template>

<script setup>
// Maps each blockType (registry key) to its renderer component via the shared
// blockComponents map — the admin live canvas uses the same map, so the editor
// preview matches the published page exactly.
import { resolveBlockComponent } from './blocks/blockComponents'

defineProps({ blocks: { type: Array, default: () => [] } })
</script>
