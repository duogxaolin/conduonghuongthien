<template>
  <section class="section bg-white">
    <div class="container">
      <figure v-if="d.url" class="max-w-[900px] mx-auto text-center">
        <img :src="d.url" :alt="d.alt || ''" class="w-full rounded-lg shadow-sm"  loading="lazy" decoding="async" />
        <figcaption v-if="d.caption" class="mt-3 text-[0.85rem] text-[#7A8675] italic">{{ d.caption }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
</script>
