<script setup lang="ts">
const { user, logout } = useAdminAuth()
const route = useRoute()

const isSidebarCollapsed = ref(false)

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}

const menuGroups = [
  {
    title: 'Tổng quan',
    items: [
      { label: 'Dashboard', icon: '📊', path: '/admin', resource: 'dashboard' },
    ]
  },
  {
    title: 'Hệ thống & Nhân sự',
    items: [
      { label: 'Người dùng', icon: '👥', path: '/admin/users', resource: 'users' },
      { label: 'Vai trò & Phân quyền', icon: '🛡️', path: '/admin/users/roles', resource: 'roles' },
    ]
  },
  {
    title: 'Nội dung Website',
    items: [
      { label: 'Trang chủ (Kéo-thả)', icon: '🧩', path: '/admin/content/home', resource: 'home_sections' },
      { label: 'Bài viết & Bản tin', icon: '📰', path: '/admin/content/articles', resource: 'news' },
      { label: 'Thư viện Media', icon: '🖼️', path: '/admin/media', resource: 'media' },
    ]
  },
  {
    title: 'Yêu cầu & Cài đặt',
    items: [
      { label: 'Đơn đăng ký hỗ trợ', icon: '📬', path: '/admin/submissions', resource: 'submissions' },
      { label: 'Cài đặt chung', icon: '⚙️', path: '/admin/settings/general', resource: 'settings' },
      { label: 'Lưu trữ Media (R2)', icon: '☁️', path: '/admin/settings/media-storage', resource: 'settings' },
    ]
  }
]
</script>

<template>
  <div class="admin-wrapper" :class="{ 'sidebar-collapsed': isSidebarCollapsed }">
    <!-- Sidebar -->
    <aside class="admin-sidebar">
      <div class="sidebar-header">
        <div class="brand-logo">
          <span class="logo-icon">🌿</span>
          <span class="logo-text" v-if="!isSidebarCollapsed">ADMIN PANEL</span>
        </div>
        <button class="collapse-btn" @click="toggleSidebar" :title="isSidebarCollapsed ? 'Mở rộng' : 'Thu gọn'">
          {{ isSidebarCollapsed ? '➔' : '❮' }}
        </button>
      </div>

      <nav class="sidebar-nav">
        <div v-for="(group, gIdx) in menuGroups" :key="gIdx" class="nav-group">
          <div class="group-title" v-if="!isSidebarCollapsed">{{ group.title }}</div>
          <ul>
            <li v-for="item in group.items" :key="item.path">
              <nuxt-link :to="item.path" class="nav-link" active-class="active">
                <span class="nav-icon">{{ item.icon }}</span>
                <span class="nav-label" v-if="!isSidebarCollapsed">{{ item.label }}</span>
              </nuxt-link>
            </li>
          </ul>
        </div>
      </nav>

      <div class="sidebar-footer" v-if="user">
        <div class="user-info" v-if="!isSidebarCollapsed">
          <div class="user-avatar">{{ user.username.charAt(0).toUpperCase() }}</div>
          <div class="user-details">
            <span class="user-name">{{ user.username }}</span>
            <span class="user-role">{{ user.isSuperAdmin ? 'SuperAdmin' : user.roleName }}</span>
          </div>
        </div>
        <button class="logout-btn" @click="logout" title="Đăng xuất">
          <span>🚪</span>
          <span v-if="!isSidebarCollapsed">Thoát</span>
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="admin-main">
      <header class="admin-topbar">
        <div class="topbar-left">
          <span class="breadcrumb-item">Con Đường Hướng Thiện</span>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current">{{ route.name || 'Admin' }}</span>
        </div>
        <div class="topbar-right">
          <nuxt-link to="/" target="_blank" class="view-site-link">
            🌐 Xem Website ↗
          </nuxt-link>
        </div>
      </header>

      <main class="admin-content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-wrapper {
  display: flex;
  min-height: 100vh;
  background-color: #f4f7f4;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #2c3e2e;
}

/* Sidebar */
.admin-sidebar {
  width: 260px;
  background-color: #122815;
  color: #e2ede3;
  display: flex;
  flex-direction: column;
  transition: width 0.25s ease;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
}

.sidebar-collapsed .admin-sidebar {
  width: 70px;
}

.sidebar-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  font-size: 1.05rem;
  color: #8ed694;
}

.collapse-btn {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: #8ed694;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 16px 10px;
}

.nav-group {
  margin-bottom: 20px;
}

.group-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 10px 8px 10px;
  font-weight: 700;
}

.nav-group ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.75);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.nav-link:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.nav-link.active {
  background-color: #2c6e33;
  color: #ffffff;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(44, 110, 51, 0.4);
}

.nav-icon {
  font-size: 1.1rem;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background-color: #2c6e33;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

.user-details {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: #fff;
}

.user-role {
  font-size: 0.72rem;
  color: #8ed694;
}

.logout-btn {
  background: rgba(255, 77, 77, 0.15);
  border: 1px solid rgba(255, 77, 77, 0.3);
  color: #ff8080;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
}

.logout-btn:hover {
  background: #ff4d4d;
  color: white;
}

/* Main Area */
.admin-main {
  flex: 1;
  margin-left: 260px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: margin-left 0.25s ease;
}

.sidebar-collapsed .admin-main {
  margin-left: 70px;
}

.admin-topbar {
  height: 64px;
  background: #ffffff;
  border-bottom: 1px solid #e2ece3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  color: #667768;
}

.breadcrumb-current {
  color: #122815;
  font-weight: 700;
}

.view-site-link {
  color: #2c6e33;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 6px 12px;
  border-radius: 6px;
  background: #f0f7f1;
}

.view-site-link:hover {
  background: #e1f0e2;
}

.admin-content {
  padding: 24px;
  flex: 1;
}
</style>
