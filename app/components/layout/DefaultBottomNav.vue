<template>
  <!-- Mobile Bottom Nav: nền đặc thay cho backdrop-blur để bớt phí repaint mỗi frame cuộn. -->
  <nav
    class="fixed bottom-2.5 left-3 right-3 h-16 bg-white/95 border border-white/40 rounded-[24px] shadow-[0_8px_32px_rgba(30,70,32,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] z-[9900] flex justify-around items-center px-1.5 transition-all md:hidden"
    :class="{ 'opacity-0 pointer-events-none translate-y-4': isMobileMenuOpen || isChatOpen }"
    aria-label="Điều hướng nhanh"
    style="padding-bottom: env(safe-area-inset-bottom, 0px); box-shadow: 0 8px 32px rgba(30,70,32,0.12), inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.05)"
  >
    <template v-for="item in bottomNav" :key="item.id">
      <!-- Featured raised center button -->
      <button
        v-if="item.featured"
        class="flex-1 relative flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#385130] max-w-[52px] font-extrabold text-[0.65rem] -top-3.5 cursor-pointer transition-all font-[inherit]"
        :class="{ 'text-[#4A6741]': (item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
        :aria-pressed="(item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)"
        :aria-label="navItemLabel(item)"
        @click="item.type === 'link' ? navigateTo(item.url) : $emit('bottom-nav-click', item)"
      >
        <div
          class="w-[50px] h-[50px] rounded-full bg-gradient-to-br from-[#2e6b32] to-[#173b18] text-white flex items-center justify-center shadow-[0_12px_28px_rgba(23,59,24,0.45),inset_0_2px_4px_rgba(255,255,255,0.4)] border-[3.5px] border-white/95 transition-all active:scale-90"
          :class="{ 'shadow-[0_16px_36px_rgba(23,59,24,0.55),inset_0_2px_6px_rgba(255,255,255,0.5)] scale-105': (item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen) }"
        >
          <i :class="item.icon || 'fa-solid fa-circle'" class="text-[1.3rem]" aria-hidden="true"></i>
        </div>
        <span class="mt-0.5">{{ navItemLabel(item) }}</span>
      </button>

      <!-- Normal link item với liquid glass active state -->
      <nuxt-link
        v-else-if="item.type === 'link'"
        :to="item.url || '/'"
        class="flex-1 flex flex-col items-center justify-center gap-0.5 no-underline text-[#6b7669] max-w-[52px] font-semibold text-[0.65rem] py-1.5 cursor-pointer transition-all active:text-[#4A6741]"
        :aria-current="$route.path === item.url ? 'page' : undefined"
      >
        <div
          class="flex items-center justify-center px-3 py-1.5 rounded-2xl transition-all"
          :class="$route.path === item.url ? 'bg-gradient-to-br from-[#e8f5e3] to-[#d4ead0] shadow-[inset_0_2px_8px_rgba(74,103,65,0.15),0_2px_8px_rgba(74,103,65,0.08)] scale-105' : 'bg-transparent hover:bg-white/40'"
        >
          <i
            :class="item.icon || 'fa-solid fa-circle'"
            class="text-[1.25rem] transition-all"
            :style="$route.path === item.url ? 'color: #4A6741; filter: drop-shadow(0 1px 2px rgba(74,103,65,0.3))' : ''"
            aria-hidden="true"
          ></i>
        </div>
        <span
          class="transition-all"
          :class="$route.path === item.url ? 'text-[#2e5a28] font-extrabold' : ''"
        >{{ navItemLabel(item) }}</span>
      </nuxt-link>

      <!-- Action item (chatbot / drawer) với glass effect khi active -->
      <button
        v-else
        class="flex-1 flex flex-col items-center justify-center gap-0.5 bg-transparent border-none text-[#6b7669] max-w-[52px] font-semibold text-[0.65rem] py-1.5 cursor-pointer transition-all font-[inherit]"
        :aria-pressed="(item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)"
        :aria-label="navItemLabel(item)"
        @click="$emit('bottom-nav-click', item)"
      >
        <div
          class="flex items-center justify-center px-3 py-1.5 rounded-2xl transition-all"
          :class="((item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)) ? 'bg-gradient-to-br from-[#e8f5e3] to-[#d4ead0] shadow-[inset_0_2px_8px_rgba(74,103,65,0.15),0_2px_8px_rgba(74,103,65,0.08)] scale-105' : 'bg-transparent hover:bg-white/40'"
        >
          <i
            :class="item.icon || 'fa-solid fa-circle'"
            class="text-[1.25rem] transition-all"
            :style="((item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)) ? 'color: #4A6741; filter: drop-shadow(0 1px 2px rgba(74,103,65,0.3))' : ''"
            aria-hidden="true"
          ></i>
        </div>
        <span
          class="transition-all"
          :class="((item.type === 'chatbot' && isChatOpen) || (item.type === 'drawer' && isMobileMenuOpen)) ? 'text-[#2e5a28] font-extrabold' : ''"
        >{{ navItemLabel(item) }}</span>
      </button>
    </template>
  </nav>
</template>

<script setup lang="ts">
import type { BottomNavItem } from '~/utils/nav-config'

/** Bottom nav mobile — featured center button + link items + action items. */
defineProps<{
  bottomNav: BottomNavItem[]
  navItemLabel: (item: BottomNavItem) => string
  isMobileMenuOpen: boolean
  isChatOpen: boolean
}>()
defineEmits<{ 'bottom-nav-click': [item: BottomNavItem] }>()
</script>
