<template>
  <section class="section bg-surface" role="region" :aria-label="d.title || 'Thư viện hình ảnh'">
    <div class="container">
      <div v-if="d.title" class="text-center max-w-[600px] mx-auto mb-[50px]">
        <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-ink">{{ d.title }}</h2>
      </div>

      <div v-if="items.length" class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" role="list">
        <div v-for="(item, i) in items" :key="i" role="listitem">
        <figure class="relative rounded-lg overflow-hidden h-[200px] shadow-sm group" role="group">
          <SafeImg :src="item.url" :alt="item.caption || 'Hình ảnh minh hoạ'" img-class="w-full h-full object-cover transition-transform duration-[0.4s] group-hover:scale-[1.05]"  loading="lazy" decoding="async" sizes="256px sm:384px" />
          <div v-if="item.caption" class="absolute inset-0 z-[1]" style="background: linear-gradient(to top, rgba(16,28,16,0.9) 0%, rgba(16,28,16,0) 100%);"></div>
          <figcaption v-if="item.caption" class="absolute bottom-0 left-0 right-0 p-4 text-white z-[2]">
            <h3 class="text-[0.88rem] font-extrabold m-0">{{ item.caption }}</h3>
          </figcaption>
        </figure>
        </div>
      </div>

      <p v-else class="text-center text-[0.9rem] text-[#5A6C58] italic">Chưa có hình ảnh nào.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})
const items = computed(() => Array.isArray(d.value.items) ? d.value.items : [])
</script>
