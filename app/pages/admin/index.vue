<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const { user } = useAdminAuth()

const stats = ref([
  { title: 'Bài viết & Tin tức', value: '...', icon: 'fa-solid fa-newspaper', change: 'Hệ thống DB' },
  { title: 'Tấm gương tiêu biểu', value: '...', icon: 'fa-solid fa-trophy', change: 'Hệ thống DB' },
  { title: 'Đơn đăng ký hỗ trợ', value: '...', icon: 'fa-solid fa-envelope-open-text', change: 'Chưa xử lý' },
  { title: 'Thư viện Media', value: '...', icon: 'fa-solid fa-images', change: 'Tải lên' },
])

const quickActions = [
  { title: 'Tùy chỉnh Trang chủ (Kéo-thả)', desc: 'Sắp xếp lại thứ tự section & đổi nội dung', path: '/admin/content/home', icon: 'fa-solid fa-cubes' },
  { title: 'Viết bài mới', desc: 'Soạn thảo tin tức, bài viết với TinyMCE Editor', path: '/admin/content/articles/new', icon: 'fa-solid fa-pen-to-square' },
  { title: 'Quản lý Người dùng & Phân quyền', desc: 'Thêm tài khoản admin mới, thiết lập rules', path: '/admin/users', icon: 'fa-solid fa-users' },
  { title: 'Cấu hình Media & Cloudflare R2', desc: 'Chuyển đổi lưu trữ Local / Cloudflare R2', path: '/admin/settings/media-storage', icon: 'fa-solid fa-cloud-arrow-up' },
]

onMounted(async () => {
  try {
    const [artRes, subRes, mediaRes] = await Promise.all([
      $fetch('/api/admin/articles').catch(() => null),
      $fetch('/api/admin/submissions').catch(() => null),
      $fetch('/api/admin/media').catch(() => null),
    ])
    if (artRes?.ok) stats.value[0].value = String(artRes.pagination?.total || 0)
    if (subRes?.ok) stats.value[2].value = String(subRes.submissions?.length || 0)
    if (mediaRes?.ok) stats.value[3].value = String(mediaRes.pagination?.total || 0)
  } catch { /* ignore */ }
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Welcome Banner -->
    <div class="bg-gradient-to-br from-[#1e4620] to-[#2c6e33] text-white px-6 py-6 md:px-8 md:py-7 rounded-2xl shadow-[0_8px_24px_rgba(30,70,32,0.15)]">
      <h1 class="text-[1.4rem] font-extrabold m-0 mb-1.5">Xin chào, {{ user?.username || 'Admin' }}! 👋</h1>
      <p class="text-[0.92rem] opacity-90 m-0">
        Hệ thống Quản trị Con Đường Hướng Thiện — Bạn đang có quyền:
        <strong>{{ user?.isSuperAdmin ? 'SuperAdmin (Full)' : user?.roleName }}</strong>
      </p>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div v-for="(s, idx) in stats" :key="idx" class="bg-white rounded-xl border border-[#e2ece3] p-5 flex items-center gap-4">
        <div class="w-12 h-12 rounded-xl bg-[#f0f7f1] flex items-center justify-center shrink-0">
          <i :class="s.icon" class="text-[1.4rem] text-[#2c6e33]"></i>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-[0.78rem] text-[#667768] font-semibold truncate">{{ s.title }}</span>
          <span class="text-[1.4rem] font-extrabold text-[#122815] leading-tight">{{ s.value }}</span>
          <span class="text-[0.7rem] text-[#2c6e33] font-semibold">{{ s.change }}</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div>
      <h2 class="text-[1.1rem] font-extrabold text-[#122815] mb-4">Tác vụ nhanh</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <nuxt-link
          v-for="(act, idx) in quickActions"
          :key="idx"
          :to="act.path"
          class="bg-white border border-[#e2ece3] p-5 rounded-xl no-underline flex items-center gap-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(0,0,0,0.05)] hover:border-[#8ed694]"
        >
          <div class="w-11 h-11 rounded-xl bg-[#f0f7f1] flex items-center justify-center shrink-0">
            <i :class="act.icon" class="text-[1.3rem] text-[#2c6e33]"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-[0.95rem] font-bold text-[#122815] m-0 mb-1 truncate">{{ act.title }}</h3>
            <p class="text-[0.82rem] text-[#667768] m-0 line-clamp-2">{{ act.desc }}</p>
          </div>
          <i class="fa-solid fa-arrow-right text-[#8ed694] shrink-0"></i>
        </nuxt-link>
      </div>
    </div>
  </div>
</template>
