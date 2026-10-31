<script setup lang="ts">
/**
 * Thẻ tài khoản ở chân sidebar quản trị — tách khỏi `app/layouts/admin.vue` (wave3 D-SPLIT):
 * chữ cái đầu, tên, vai trò (hoặc "SuperAdmin"), lối vào trang tài khoản và nút "Thoát"; khi
 * sidebar thu gọn chỉ còn chữ cái đầu và nút đăng xuất. Chỉ hiển thị — đăng xuất là của
 * layout (`logout` của `useAdminAuth`), phần này phát `logout`. Sidebar chỉ vẽ phần khi có
 * tài khoản (`v-if="user"` ở chỗ dùng).
 */
import type { AdminUser } from '~/composables/useAdminAuth'

defineProps<{
  user: AdminUser
  isSidebarCollapsed: boolean
}>()

const emit = defineEmits<{ logout: [] }>()
</script>

<template>
  <div class="p-2.5 border-t border-white/10 shrink-0 bg-black/20">
    <!-- Expanded User Card -->
    <div v-if="!isSidebarCollapsed" class="flex items-center justify-between gap-2 p-2 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-white/15 transition-all">
      <nuxt-link
        to="/admin/profile"
        class="flex items-center gap-2.5 min-w-0 flex-1 no-underline text-inherit group/user"
        title="Trang tài khoản của tôi"
      >
        <div class="relative shrink-0">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-700 to-[#3a8b43] text-white flex items-center justify-center font-bold text-sm shadow-sm border border-brand-300/30">
            {{ user.username.charAt(0).toUpperCase() }}
          </div>
          <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#4caf50] rounded-full border-2 border-[#0d1f11]" title="Đang trực tuyến"></span>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-[0.82rem] font-bold text-white truncate group-hover/user:text-brand-300 transition-colors leading-tight">
            {{ user.username }}
          </span>
          <span class="text-[0.66rem] text-brand-300 font-medium truncate mt-0.5">
            {{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}
          </span>
        </div>
      </nuxt-link>

      <button
        type="button"
        class="flex items-center gap-1.5 bg-red-500/15 border border-red-400/30 text-red-300 hover:text-white hover:bg-red-500 hover:border-transparent px-2.5 py-1.5 rounded-lg cursor-pointer text-[0.78rem] font-semibold transition-all shrink-0"
        @click="emit('logout')"
        title="Đăng xuất khỏi hệ thống"
      >
        <i class="fa-solid fa-right-from-bracket text-xs"></i>
        <span>Thoát</span>
      </button>
    </div>

    <!-- Collapsed User Card -->
    <div v-else class="flex flex-col items-center gap-2">
      <nuxt-link
        to="/admin/profile"
        class="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-700 to-[#3a8b43] text-white flex items-center justify-center font-bold text-sm shadow-sm border border-brand-300/30 no-underline"
        :title="`${user.username} (${user.isSuperAdmin ? 'SuperAdmin' : user.roleName}) - Tài khoản`"
      >
        {{ user.username.charAt(0).toUpperCase() }}
      </nuxt-link>
      <button
        type="button"
        class="w-8 h-8 rounded-lg flex items-center justify-center text-red-300 hover:text-white bg-red-500/15 hover:bg-red-500 border border-red-500/20 hover:border-transparent transition-all cursor-pointer"
        @click="emit('logout')"
        title="Đăng xuất"
      >
        <i class="fa-solid fa-right-from-bracket text-xs"></i>
      </button>
    </div>
  </div>
</template>
