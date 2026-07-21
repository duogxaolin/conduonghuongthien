<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const { user } = useAdminAuth()

const stats = ref([
  { title: 'Bài viết & Tin tức', value: '...', icon: '📰', change: 'Hệ thống DB' },
  { title: 'Tấm gương tiêu biểu', value: '...', icon: '🏆', change: 'Hệ thống DB' },
  { title: 'Đơn đăng ký hỗ trợ', value: '...', icon: '📬', change: 'Chưa xử lý' },
  { title: 'Thư viện Media', value: '...', icon: '🖼️', change: 'Tải lên' },
])

const quickActions = [
  { title: 'Tùy chỉnh Trang chủ (Kéo-thả)', desc: 'Sắp xếp lại thứ tự section & đổi nội dung', path: '/admin/content/home', icon: '🧩' },
  { title: 'Viết bài mới', desc: 'Soạn thảo tin tức, bài viết với TipTap Editor', path: '/admin/content/articles/new', icon: '✍️' },
  { title: 'Quản lý Người dùng & Phân quyền', desc: 'Thêm tài khoản admin mới, thiết lập rules', path: '/admin/users', icon: '👥' },
  { title: 'Cấu hình Media & Cloudflare R2', desc: 'Chuyển đổi lưu trữ Local / Cloudflare R2', path: '/admin/settings/media-storage', icon: '☁️' },
]

onMounted(async () => {
  try {
    const [artRes, subRes, mediaRes] = await Promise.all([
      $fetch('/api/admin/articles').catch(() => null),
      $fetch('/api/admin/submissions').catch(() => null),
      $fetch('/api/admin/media').catch(() => null),
    ])

    if (artRes?.ok) {
      stats.value[0].value = String(artRes.pagination?.total || 0)
    }
    if (subRes?.ok) {
      stats.value[2].value = String(subRes.submissions?.length || 0)
    }
    if (mediaRes?.ok) {
      stats.value[3].value = String(mediaRes.pagination?.total || 0)
    }
  } catch {
    // Ignore fetch errors
  }
})
</script>

<template>
  <div class="dashboard-page">
    <div class="welcome-banner">
      <div class="welcome-text">
        <h1>Xin chào, {{ user?.username || 'Admin' }}! 👋</h1>
        <p>Hệ thống Quản trị Con Đường Hướng Thiện — Bạn đang có quyền: <strong>{{ user?.isSuperAdmin ? 'SuperAdmin (Full)' : user?.roleName }}</strong></p>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="stats-grid">
      <div v-for="(s, idx) in stats" :key="idx" class="stat-card">
        <div class="stat-icon">{{ s.icon }}</div>
        <div class="stat-info">
          <span class="stat-title">{{ s.title }}</span>
          <span class="stat-value">{{ s.value }}</span>
          <span class="stat-change">{{ s.change }}</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <h2 class="section-heading">Tác vụ nhanh</h2>
    <div class="quick-grid">
      <nuxt-link v-for="(act, idx) in quickActions" :key="idx" :to="act.path" class="quick-card">
        <div class="quick-icon">{{ act.icon }}</div>
        <div class="quick-details">
          <h3>{{ act.title }}</h3>
          <p>{{ act.desc }}</p>
        </div>
        <span class="quick-arrow">➔</span>
      </nuxt-link>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.welcome-banner {
  background: linear-gradient(135deg, #1e4620 0%, #2c6e33 100%);
  color: white;
  padding: 24px 32px;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(30, 70, 32, 0.15);
}

.welcome-text h1 {
  font-size: 1.5rem;
  font-weight: 800;
  margin: 0 0 6px 0;
}

.welcome-text p {
  font-size: 0.92rem;
  opacity: 0.9;
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.stat-card {
  background: white;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: #f0f7f1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-title {
  font-size: 0.8rem;
  color: #667768;
  font-weight: 600;
}

.stat-value {
  font-size: 1.4rem;
  font-weight: 800;
  color: #122815;
}

.stat-change {
  font-size: 0.72rem;
  color: #2c6e33;
  font-weight: 600;
}

.section-heading {
  font-size: 1.1rem;
  font-weight: 800;
  color: #122815;
  margin: 10px 0 0 0;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}

.quick-card {
  background: white;
  border: 1px solid #e2ece3;
  padding: 20px;
  border-radius: 12px;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.2s ease;
}

.quick-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.05);
  border-color: #8ed694;
}

.quick-icon {
  font-size: 32px;
}

.quick-details {
  flex: 1;
}

.quick-details h3 {
  font-size: 0.95rem;
  font-weight: 700;
  color: #122815;
  margin: 0 0 4px 0;
}

.quick-details p {
  font-size: 0.82rem;
  color: #667768;
  margin: 0;
}

.quick-arrow {
  color: #8ed694;
  font-weight: bold;
}
</style>
