<template>
  <!-- Footer Area -->
  <footer class="bg-[#385130] text-white/80 pt-16 lg:pt-20 border-t-4 border-[#7CB342] pb-[calc(110px+env(safe-area-inset-bottom,0px))] md:pb-12 lg:pb-10">
    <div class="container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_2fr] gap-8 lg:gap-10 mb-12 lg:mb-16">
      <div>
        <div class="flex items-center gap-3.5 mb-5 flex-wrap">
          <div v-if="siteMainLogo || siteLogo" class="flex items-center gap-3 shrink-0">
            <NuxtImg               v-if="siteMainLogo"               :src="siteMainLogo"               alt="Logo cơ quan chủ quản"               class="w-auto object-contain"               :class="siteLogo ? 'h-16 md:h-[72px]' : 'h-14 md:h-16'"               sizes="96px sm:128px"              format="webp" />
            <span v-if="siteMainLogo && siteLogo" class="h-12 md:h-14 w-px bg-white/25" aria-hidden="true"></span>
            <NuxtImg               v-if="siteLogo"               :src="siteLogo"               alt="Logo Con Đường Hướng Thiện"               class="w-auto object-contain"               :class="siteMainLogo ? 'h-12 md:h-[52px]' : 'h-14 md:h-16'"               sizes="96px sm:128px"              format="webp" />
          </div>
          <span class="text-white font-extrabold text-[1.2rem] md:text-[1.35rem] tracking-[0.5px]">{{ t('portal_title') }}</span>
        </div>
        <p class="text-[0.9rem] leading-relaxed">
          {{ t('footer_desc') }}
        </p>
      </div>

      <div>
        <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">{{ t('footer_links_main') }}</h3>
        <ul class="list-none space-y-3">
          <li><nuxt-link to="/" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('home') }}</nuxt-link></li>
          <li><nuxt-link to="/about" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('about') }}</nuxt-link></li>
          <li><nuxt-link to="/news" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('news') }}</nuxt-link></li>
          <li><nuxt-link to="/documents" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('documents') }}</nuxt-link></li>
        </ul>
      </div>

      <div>
        <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">{{ t('reintegration') }}</h3>
        <ul class="list-none space-y-3">
          <li><nuxt-link to="/role-models" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('role_models') }}</nuxt-link></li>
          <li><nuxt-link to="/reintegration-models" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('reintegration') }}</nuxt-link></li>
          <li><nuxt-link to="/legal-qa" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('legal_qa') }}</nuxt-link></li>
          <li><nuxt-link to="/qa-documents" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('qa_documents') }}</nuxt-link></li>
          <li><nuxt-link to="/contact" class="text-white/70 no-underline text-[0.9rem] transition-all hover:text-[#7CB342] hover:pl-1.5">{{ t('contact') }}</nuxt-link></li>
        </ul>
      </div>

      <div>
        <h3 class="text-white text-[1.1rem] font-bold mb-6 relative pb-2 after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-[30px] after:h-[3px] after:bg-[#7CB342]">{{ t('contact_info') }}</h3>
        <p class="mb-3 text-[0.9rem]"><strong class="text-white">{{ t('footer_agency') }}</strong> C11 - Bộ Công an</p>
        <p class="mb-3 text-[0.9rem]"><strong class="text-white">{{ t('address') }}</strong> {{ siteAddress }}</p>
        <p class="mb-3 text-[0.9rem]"><strong class="text-white">{{ t('phone') }}</strong> {{ siteHotline }}</p>
        <p class="mb-3 text-[0.9rem]"><strong class="text-white">{{ t('email') || 'Email:' }}</strong> {{ siteEmail }}</p>
      </div>
    </div>

    <div class="border-t border-white/[0.08] py-6 text-[0.85rem]">
      <div class="container flex flex-col items-center md:items-start gap-2 text-center md:text-left md:pr-24">
        <p class="m-0 text-white/80 leading-relaxed">&copy; 2026 {{ t('footer_copyright') }}</p>
        <p class="m-0">
          <a
            href="https://delify.vn?ref=conduonghuongthien"
            target="_blank"
            rel="noopener noreferrer"
            class="text-white/70 no-underline font-semibold transition-all hover:text-[#7CB342] hover:underline"
          >{{ t('design_by').replace('{brand}', 'Delify.vn') }}</a>
        </p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'

/**
 * Footer — logo kép (giữ `v-if="siteMainLogo || siteLogo"` / `v-if="siteMainLogo && siteLogo"`
 * / `v-if="siteLogo"` + lớp tỷ lệ `h-16 md:h-[72px]` v.v. — `tests/main-logo-settings.test.ts`
 * grep), 4 cột link (có `to="/qa-documents"` — `tests/public-qa-documents-page.test.ts`).
 */
defineProps<{
  siteMainLogo: string
  siteLogo: string
  siteEmail: string
  siteHotline: string
  siteAddress: string
}>()

const { t } = useI18n()
</script>
