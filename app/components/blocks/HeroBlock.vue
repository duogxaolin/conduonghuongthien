<template>
  <!-- Hero Banner Section (lifted from index.vue, editable fields from block.data) -->
  <section class="relative min-h-[520px] overflow-hidden sm:min-h-[580px]">
    <!-- Background image với will-change để tối ưu composite layer -->
    <div class="absolute inset-0 will-change-transform" :style="`background: url('${bgImage}') center 65% / cover no-repeat;`"></div>
    <div class="absolute inset-0 will-change-transform" style="background: linear-gradient(120deg, rgba(28,54,28,0.95) 0%, rgba(45,74,45,0.82) 45%, rgba(90,140,60,0.45) 100%);"></div>
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
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> {{ t('hero_support_free') || 'Hỗ trợ 24/7 miễn phí' }}</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> {{ t('hero_security') || 'Bảo mật thông tin' }}</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-check-circle text-[#7CB342]"></i> {{ t('hero_connect_officer') || 'Kết nối trực tiếp cán bộ' }}</span>
        </div>
      </div>
    </div>

    <div class="absolute bottom-0 left-0 right-0 will-change-transform">
      <svg viewBox="0 0 1440 56" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" class="block w-full h-14">
        <path d="M0,56 C360,0 1080,0 1440,56 L1440,56 L0,56 Z" fill="#ffffff"/>
      </svg>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

const { t, currentLang } = useI18n()
const props = defineProps({ block: { type: Object, required: true } })

// Block data (từ Page Builder / DB) là nguồn gốc tiếng Việt. Khi chuyển ngữ,
// ưu tiên theo thứ tự: (1) bản dịch trong `block.data.translations[lang]` (cán bộ
// tự dịch trong Page Builder), (2) i18n dictionary (`lang_translations` / hardcode),
// (3) fallback tiếng Việt gốc. Trước đây `...(props.block?.data || {})` ở cuối
// **đè** mọi giá trị i18n bằng tiếng Việt cứng → hero không bao giờ dịch.
const d = computed(() => {
  const lang = currentLang.value
  const isVi = lang === 'vi'
  const data = (props.block?.data || {}) as Record<string, unknown>
  type Dict = Record<string, string>
  const translations = (data.translations || {}) as Record<string, Dict>
  const tr = !isVi ? (translations[lang] || {}) : ({} as Dict)
  const pick = (field: string, i18nKey: string, fbEn: string, fbVi: string): string => {
    if (isVi) return String(data[field] ?? fbVi)
    if (tr[field]) return tr[field]
    const dict = t(i18nKey)
    if (dict && dict !== i18nKey) return dict
    return fbEn
  }
  return {
    badge: data.badge
      ? (isVi ? String(data.badge) : (tr.badge || t('hero_badge') || 'C11 PORTAL - MINISTRY OF PUBLIC SAFETY'))
      : (isVi ? 'CỔNG THÔNG TIN C11 - BỘ CÔNG AN' : (t('hero_badge') || 'C11 PORTAL - MINISTRY OF PUBLIC SAFETY')),
    titleLine1: pick('titleLine1', 'hero_title_line1', 'Accompanying the', 'Đồng hành cùng'),
    titleLine2: pick('titleLine2', 'hero_title_line2', 'Journey of Rehabilitation', 'hành trình hướng thiện'),
    subtitle: pick('subtitle', 'hero_subtitle', 'A comprehensive platform offering vocational, legal, and psychological support to help former inmates reintegrate into society and build sustainable lives.', 'Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tù vững vàng tái hòa nhập cộng đồng, xây dựng cuộc sống mới bền vững.'),
    btnAboutText: isVi ? 'Về chúng tôi' : (t('hero_btn_about') || 'About Us'),
    btnAboutLink: '/about',
    btnHelpText: isVi ? 'Gửi yêu cầu trợ giúp' : (t('hero_btn_help') || 'Request Support'),
    btnHelpLink: '#tro-giup',
    bgImage: data.bgImage,
    btnAbout: data.btnAbout,
    btnHelp: data.btnHelp,
  }
})
const bgImage = computed(() => d.value.bgImage || '/assets/hero_banner.jpg')
</script>
