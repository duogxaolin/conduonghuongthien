<template>
  <section class="section bg-white">
    <div class="container">
      <figure v-if="d.url" class="max-w-[900px] mx-auto text-center" role="group">
        <SafeImg :src="d.url" :alt="d.alt || 'Hình ảnh minh hoạ'" img-class="w-full rounded-lg shadow-sm"  loading="lazy" decoding="async" sizes="512px sm:768px lg:1024px" />
        <figcaption v-if="d.caption" class="mt-3 text-[0.85rem] text-ink-soft italic">{{ d.caption }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
</script>
