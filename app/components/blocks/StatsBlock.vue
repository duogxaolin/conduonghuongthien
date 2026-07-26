<template>
  <section class="relative z-10 -mt-10 px-4 sm:-mt-7 sm:px-0" aria-label="Những con số nổi bật">
    <div class="container">
      <div class="relative overflow-hidden rounded-2xl border border-[#dce7d9] bg-white shadow-[0_18px_50px_rgba(35,67,31,0.12)]">
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#315c35] via-[#7CB342] to-[#315c35]"></div>
        <div class="grid grid-cols-1 divide-y divide-[#e5ede2] sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <div
            v-for="(stat, i) in stats"
            :key="i"
            class="group flex items-center gap-4 px-5 py-6 transition-colors duration-200 hover:bg-[#f7faf5] sm:px-6 lg:flex-col lg:items-start lg:gap-5 lg:px-7 lg:py-8"
          >
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#edf5e8] text-[#416b3b] ring-1 ring-[#d7e7d0] transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105" aria-hidden="true">
              <i :class="[stat.icon || fallbackIcons[i % fallbackIcons.length], 'text-xl']"></i>
            </div>
            <div class="min-w-0">
              <span class="block text-[2rem] font-black leading-none tracking-tight text-[#244829] lg:text-[2.25rem]" v-html="formatValue(stat.value)"></span>
              <span class="mt-2 block text-[0.84rem] font-semibold leading-[1.45] text-[#5d6d59]">{{ stat.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })

const fallbackIcons = [
  'fa-solid fa-map-location-dot',
  'fa-solid fa-hands-holding-circle',
  'fa-solid fa-seedling',
  'fa-solid fa-headset',
]

const defaultStats = [
  { icon: 'fa-solid fa-map-location-dot', value: '34', label: 'Tỉnh / Thành phố đồng hành' },
  { icon: 'fa-solid fa-hands-holding-circle', value: '10.000+', label: 'Người hoàn lương được hỗ trợ' },
  { icon: 'fa-solid fa-seedling', value: '500+', label: 'Mô hình kinh tế tiêu biểu' },
  { icon: 'fa-solid fa-headset', value: '24/7', label: 'Tư vấn pháp lý & Tâm lý miễn phí' },
]

const stats = computed(() => {
  const raw = props.block?.data?.stats
  const arr = Array.isArray(raw) && raw.length ? raw : defaultStats
  return arr
})

// Wrap +, / markers in the accent color, matching the original design.
// The value is admin-authored but rendered with v-html, so it MUST be HTML-escaped
// first — otherwise a stat value like `<img src=x onerror=...>` executes (XSS).
// Escaping happens before the marker pass; the escaped text contains no '+' or '/'
// artifacts of its own except inside entities (&#39;), which are left untouched
// because the replacement only wraps the bare characters.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatValue(v) {
  return escapeHtml(v).replace(/[+/]/g, (m) => `<span class="text-[#6da33e]">${m}</span>`)
}
</script>
