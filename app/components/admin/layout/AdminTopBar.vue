<script setup lang="ts">
/**
 * Thanh trên của khung quản trị — tách khỏi `app/layouts/admin.vue` (wave3 D-SPLIT): nút mở
 * ngăn kéo (màn hẹp), tên trang hiện tại, nút "Xoá cache", lối tắt tài khoản (màn hẹp) và
 * menu tài khoản khi rê chuột (từ `sm:`). Chỉ hiển thị — layout giữ trạng thái và mọi lượt
 * gọi (xoá cache, đăng xuất), phần này chỉ phát sự kiện.
 */
import type { AdminUser } from '~/composables/useAdminAuth'

defineProps<{
  currentAdminPageTitle: string
  user: AdminUser | null
  isClearingCache: boolean
}>()

const emit = defineEmits<{ toggleMobileMenu: [], clearPublicCache: [], logout: [] }>()
</script>

<template>
  <header class="h-16 bg-white border-b border-line flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
    <div class="flex items-center gap-3">
      <button
        class="flex lg:hidden w-9 h-9 items-center justify-center rounded-lg bg-surface-tint text-brand-700 cursor-pointer border-0 hover:bg-[#e1f0e2]"
        @click="emit('toggleMobileMenu')"
      >
        <i class="fa-solid fa-bars"></i>
      </button>
      <div class="flex items-center gap-2 text-[0.88rem] text-ink-muted">
        <span class="hidden sm:inline">Con Đường Hướng Thiện</span>
        <span class="hidden sm:inline">/</span>
        <span class="text-brand-950 font-bold">{{ currentAdminPageTitle }}</span>
      </div>
    </div>
    <!-- Topbar right: clear-cache button + user chip with dropdown (desktop) -->
    <div class="flex items-center gap-2">
      <!-- Nút xoá cache SWR: sửa nội dung xong là khách thấy ngay, không chờ 60s -->
      <button
        class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-surface-tint hover:bg-[#e1f0e2] transition-colors cursor-pointer border-0 text-brand-700"
        :disabled="isClearingCache"
        :class="{ 'opacity-60 cursor-wait': isClearingCache }"
        :title="isClearingCache ? 'Đang xoá cache…' : 'Xoá cache trang công khai — nội dung vừa sửa hiện ngay, không chờ 60 giây'"
        @click="emit('clearPublicCache')"
      >
        <i class="fa-solid text-xs sm:text-sm" :class="isClearingCache ? 'fa-spinner fa-spin' : 'fa-broom'"></i>
        <span class="hidden md:inline text-[0.82rem] font-semibold">{{ isClearingCache ? 'Đang xoá…' : 'Xoá cache' }}</span>
      </button>

      <!-- Mobile user shortcut: avatar profile + logout button -->
      <div v-if="user" class="flex sm:hidden items-center gap-1.5">
        <nuxt-link
          to="/admin/profile"
          class="w-8 h-8 rounded-full bg-brand-700 text-white text-xs font-bold flex items-center justify-center no-underline"
          :title="`${user.username} - Tài khoản`"
        >
          {{ user.username.charAt(0).toUpperCase() }}
        </nuxt-link>
        <button
          type="button"
          class="w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 transition-all cursor-pointer p-0"
          @click="emit('logout')"
          title="Đăng xuất"
        >
          <i class="fa-solid fa-right-from-bracket text-xs"></i>
        </button>
      </div>
      <div v-if="user" class="relative group hidden sm:flex">
        <button class="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-tint hover:bg-[#e1f0e2] transition-colors cursor-pointer border-0">
          <div class="w-8 h-8 rounded-full bg-brand-700 text-white text-sm font-bold flex items-center justify-center shrink-0">
            {{ user.username.charAt(0).toUpperCase() }}
          </div>
          <span class="text-[0.85rem] font-semibold text-brand-950 truncate max-w-[100px]">{{ user.username }}</span>
          <i class="fa-solid fa-caret-down text-brand-700 text-xs"></i>
        </button>
        <!-- Dropdown panel -->
        <div class="absolute top-full right-0 mt-1 w-52 bg-white border border-line rounded-lg shadow-lg z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150">
          <div class="px-4 py-3">
            <div class="text-[0.85rem] font-bold text-brand-950">{{ user.username }}</div>
            <div class="text-[0.75rem] text-ink-muted">{{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}</div>
          </div>
          <div class="border-t border-line"></div>
          <div class="px-2 py-2 flex flex-col gap-1">
            <nuxt-link
              to="/admin/profile"
              class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-brand-950 font-semibold no-underline hover:bg-surface-tint transition-colors"
            >
              <i class="fa-solid fa-user-gear w-4 text-center" aria-hidden="true"></i>
              <span>Tài khoản của tôi</span>
            </nuxt-link>
            <nuxt-link
              to="/"
              target="_blank"
              class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-brand-700 font-semibold no-underline hover:bg-surface-tint transition-colors"
            >
              <i class="fa-solid fa-globe w-4 text-center"></i>
              <span>Xem Website ↗</span>
            </nuxt-link>
            <button
              class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-brand-700 font-semibold hover:bg-surface-tint transition-colors cursor-pointer border-0 w-full text-left"
              :disabled="isClearingCache"
              @click="emit('clearPublicCache')"
            >
              <i class="fa-solid fa-broom w-4 text-center" :class="{ 'fa-spinner fa-spin': isClearingCache }"></i>
              <span>{{ isClearingCache ? 'Đang xoá cache…' : 'Xoá cache Website' }}</span>
            </button>
            <button
              class="flex items-center gap-2 px-3 py-2 rounded-md text-[0.85rem] text-red-500 font-semibold hover:bg-red-50 transition-colors cursor-pointer border-0 w-full text-left"
              @click="emit('logout')"
            >
              <i class="fa-solid fa-right-from-bracket w-4 text-center"></i>
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
