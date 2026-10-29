<script setup lang="ts">
/**
 * Danh sách mục menu của sidebar quản trị — tách khỏi `app/layouts/admin.vue` (wave3
 * D-SPLIT): các nhóm phẳng, nhóm accordion "Hệ thống & Cài đặt" và trạng thái "không tìm
 * thấy" của ô tìm nhanh. Chỉ hiển thị — mục nào hiện (theo quyền), lọc và mở/đóng accordion
 * là của `useAdminLayoutMenu`; phần này nhận nhóm đã lọc, phát `toggleAccordion` và xoá ô
 * tìm (`v-model:search-query`).
 */
import { countSubGroupItems, type AdminMenuGroup } from '~/utils/admin-layout-menu'

defineProps<{
  filteredMenuGroups: AdminMenuGroup[]
  isSidebarCollapsed: boolean
  isSearching: boolean
  openAccordions: Set<string>
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })
const emit = defineEmits<{ toggleAccordion: [title: string] }>()
</script>

<template>
  <nav class="flex-1 overflow-y-auto overscroll-contain px-2.5 py-2 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
    <!-- Search Empty State -->
    <div v-if="isSearching && filteredMenuGroups.length === 0" class="py-8 px-3 text-center flex flex-col items-center gap-2 text-white/50">
      <i class="fa-solid fa-magnifying-glass text-xl text-white/20"></i>
      <p class="text-xs m-0">Không tìm thấy chức năng</p>
      <p class="text-[0.7rem] text-white/40 m-0 font-medium">"{{ searchQuery }}"</p>
      <button
        type="button"
        @click="searchQuery = ''"
        class="mt-2 px-3 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-brand-300 text-xs border-0 cursor-pointer transition-colors"
      >
        Xoá bộ lọc
      </button>
    </div>

    <div v-for="group in filteredMenuGroups" :key="group.title" class="mb-4">
      <!-- Collapsible Accordion Group (Hệ thống & Cài đặt) -->
      <template v-if="group.collapsible && group.subGroups">
        <button
          v-if="!isSidebarCollapsed"
          type="button"
          class="w-full flex items-center justify-between gap-2 text-[0.68rem] uppercase tracking-[0.9px] text-brand-300/75 font-bold px-3 py-2 rounded-lg hover:bg-white/[0.06] hover:text-brand-300 transition-colors bg-transparent border-0 cursor-pointer select-none"
          :aria-expanded="openAccordions.has(group.title) || isSearching"
          @click="emit('toggleAccordion', group.title)"
        >
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-sliders text-xs text-brand-300"></i>
            <span>{{ group.title }}</span>
          </span>
          <div class="flex items-center gap-1.5">
            <span class="text-[0.62rem] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60 font-semibold">
              {{ countSubGroupItems(group) }}
            </span>
            <i
              class="fa-solid fa-chevron-right text-[0.6rem] transition-transform duration-200 text-white/40"
              :class="{ 'rotate-90 !text-brand-300': openAccordions.has(group.title) || isSearching }"
            ></i>
          </div>
        </button>
        <div v-show="isSidebarCollapsed || openAccordions.has(group.title) || isSearching">
          <div class="mt-1 space-y-2.5" :class="{ 'pl-2 border-l border-white/10 ml-3.5': !isSidebarCollapsed }">
            <div v-for="(sub, sIdx) in group.subGroups" :key="sIdx">
              <div
                v-if="!isSidebarCollapsed"
                class="text-[0.64rem] uppercase tracking-[0.6px] text-white/40 font-semibold px-2.5 pt-1 pb-1"
              >
                {{ sub.title }}
              </div>
              <ul class="list-none p-0 m-0 flex flex-col gap-0.5">
                <li v-for="item in sub.items" :key="item.path">
                  <nuxt-link
                    :to="item.path"
                    class="relative flex items-center gap-2.5 rounded-lg font-medium transition-all duration-150 no-underline group"
                    :class="[
                      isSidebarCollapsed
                        ? 'w-10 h-10 mx-auto justify-center text-white/70 hover:text-white hover:bg-white/[0.08]'
                        : 'px-2.5 py-1.5 text-white/70 hover:text-white hover:bg-white/[0.07] text-[0.82rem]'
                    ]"
                    active-class="!bg-gradient-to-r !from-brand-700 !to-[#1f5225] !text-white !font-semibold shadow-[0_2px_8px_rgba(44,110,51,0.35)] border border-brand-300/30 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-brand-300 before:rounded-r-full"
                    :title="item.label"
                  >
                    <i :class="item.icon" class="text-[0.92rem] shrink-0 w-4 text-center text-brand-300/70 group-hover:text-brand-300 group-[.router-link-active]:text-white transition-colors"></i>
                    <span v-if="!isSidebarCollapsed" class="truncate flex-1">{{ item.label }}</span>
                  </nuxt-link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </template>

      <!-- Regular Flat Group -->
      <template v-else>
        <div
          v-if="!isSidebarCollapsed"
          class="text-[0.66rem] uppercase tracking-[0.9px] text-brand-300/70 font-bold px-3 pt-2 pb-1 select-none"
        >
          {{ group.title }}
        </div>
        <div v-else class="border-t border-white/[0.08] my-2 mx-3"></div>
        <ul class="list-none p-0 m-0 flex flex-col gap-0.5">
          <li v-for="item in group.items" :key="item.path">
            <nuxt-link
              :to="item.path"
              :exact="item.path === '/admin'"
              class="relative flex items-center rounded-lg font-medium transition-all duration-150 no-underline group"
              :class="[
                isSidebarCollapsed
                  ? 'w-10 h-10 mx-auto justify-center text-white/70 hover:text-white hover:bg-white/[0.08]'
                  : 'gap-3 px-3 py-2 text-white/70 hover:text-white hover:bg-white/[0.07] text-[0.84rem]'
              ]"
              :active-class="item.path === '/admin' ? '' : '!bg-gradient-to-r !from-brand-700 !to-[#1f5225] !text-white !font-semibold shadow-[0_3px_12px_rgba(44,110,51,0.35)] border border-brand-300/30 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:bg-brand-300 before:rounded-r-full'"
              :exact-active-class="'!bg-gradient-to-r !from-brand-700 !to-[#1f5225] !text-white !font-semibold shadow-[0_3px_12px_rgba(44,110,51,0.35)] border border-brand-300/30 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:bg-brand-300 before:rounded-r-full'"
              :title="item.label"
            >
              <i :class="item.icon" class="text-[0.98rem] shrink-0 w-5 text-center text-brand-300/75 group-hover:text-brand-300 group-[.router-link-active]:text-white transition-colors"></i>
              <span v-if="!isSidebarCollapsed" class="truncate flex-1">{{ item.label }}</span>
            </nuxt-link>
          </li>
        </ul>
      </template>
    </div>
  </nav>
</template>
