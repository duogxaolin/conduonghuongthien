<template>
  <!-- Hero Banner Section (lifted from index.vue, editable fields from block.data) -->
  <section class="relative min-h-[520px] overflow-hidden sm:min-h-[580px]" :style="`background: url('${bgImage}') center 65% / cover no-repeat;`">
    <div class="absolute inset-0" style="background: linear-gradient(120deg, rgba(28,54,28,0.95) 0%, rgba(45,74,45,0.82) 45%, rgba(90,140,60,0.45) 100%);"></div>
    <div class="absolute inset-0 opacity-[0.04]" style="background: repeating-linear-gradient(135deg, #fff 0px, #fff 1px, transparent 1px, transparent 40px);"></div>

    <div class="container relative z-10 flex items-center px-4 pb-24 pt-16 sm:px-6 sm:pb-32 sm:pt-[90px] lg:px-8">
      <div class="max-w-[780px]">
        <div v-if="d.badge" class="flex items-center gap-3 mb-7">
          <span class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[0.75rem] font-extrabold uppercase tracking-[1px] text-[#1a3a1a]" style="background: linear-gradient(135deg, #ffd700 0%, #f59e0b 100%); box-shadow: 0 3px 12px rgba(245,158,11,0.5);">
            <i class="fa-solid fa-shield-halved text-[0.7rem]"></i>
            {{ d.badge }}
          </span>
        </div>

        <h1 class="text-[2.35rem] font-extrabold leading-[1.16] text-white mb-5 tracking-[-0.5px] sm:text-[3.6rem]" style="text-shadow: 0 2px 16px rgba(0,0,0,0.55);">
          <span class="block">{{ d.titleLine1 }}</span>
          <span class="block" style="color: #a8d878;">{{ d.titleLine2 }}</span>
        </h1>

        <div class="flex items-center gap-3 mb-6">
          <div class="h-[3px] w-12 rounded-full bg-[#7CB342]"></div>
          <div class="h-[3px] w-4 rounded-full bg-white/30"></div>
        </div>

        <p class="text-[1rem] leading-[1.65] text-white/85 mb-8 max-w-[620px] sm:text-[1.15rem] sm:mb-9" style="text-shadow: 0 1px 6px rgba(0,0,0,0.4);">
          {{ d.subtitle }}
        </p>

        <div class="flex flex-wrap gap-3 items-center">
          <nuxt-link
            v-if="d.btnAboutText"
            :to="d.btnAboutLink || '/about'"
            class="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] text-white transition-all duration-200 hover:-translate-y-0.5"
            style="background: linear-gradient(135deg, #7CB342 0%, #5a9e2a 100%); box-shadow: 0 6px 20px rgba(124,179,66,0.45);"
          >
            <i class="fa-solid fa-circle-info text-[0.85rem]"></i>
            {{ d.btnAboutText }}
          </nuxt-link>

          <a
            v-if="d.btnHelpText"
            :href="d.btnHelpLink || '#tro-giup'"
            class="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[0.95rem] text-white border border-white/40 backdrop-blur-sm transition-all duration-200 hover:bg-white/15 hover:-translate-y-0.5"
            style="background: rgba(255,255,255,0.1);"
          >
            <i class="fa-solid fa-headset text-[0.85rem]"></i>
            {{ d.btnHelpText }}
          </a>
        </div>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mt-9 text-[0.8rem] font-semibold text-white/60">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> Hỗ trợ 24/7 miễn phí</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> Bảo mật thông tin</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> Kết nối trực tiếp cán bộ</span>
        </div>
      </div>
    </div>

    <div class="absolute bottom-0 left-0 right-0">
      <svg viewBox="0 0 1440 56" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="display:block; width:100%; height:56px;">
        <path d="M0,56 C360,0 1080,0 1440,56 L1440,56 L0,56 Z" fill="#ffffff"/>
      </svg>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
// Merge with defaults so migrated blocks (which may lack the newer keys) still render.
const d = computed(() => ({
  badge: 'Cổng thông tin chính thống',
  titleLine1: 'Đồng hành cùng',
  titleLine2: 'hành trình hướng thiện',
  subtitle: 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý',
  btnAboutText: 'Về chúng tôi',
  btnAboutLink: '/about',
  btnHelpText: 'Nhận hỗ trợ 24/7',
  btnHelpLink: '#tro-giup',
  ...(props.block?.data || {}),
}))
const bgImage = computed(() => d.value.bgImage || '/assets/hero_banner.jpg')
</script>
