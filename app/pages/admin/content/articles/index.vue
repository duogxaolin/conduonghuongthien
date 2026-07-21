<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const articles = ref<any[]>([])
const loading = ref(true)
const search = ref('')
const selectedType = ref('')
const selectedStatus = ref('')
const pagination = ref({ page: 1, totalPages: 1, total: 0 })

const typeLabels: Record<string, string> = {
  news: 'Bản tin',
  role_model: 'Tấm gương',
  reintegration: 'Mô hình',
  document: 'Văn bản',
  faq: 'Giải đáp',
}

const fetchArticles = async (page = 1) => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/articles', {
      params: {
        page,
        search: search.value,
        type: selectedType.value,
        status: selectedStatus.value,
        perPage: 15
      }
    })
    if (res.ok) {
      articles.value = res.items
      pagination.value = res.pagination
    }
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi tải danh sách bài viết')
  } finally {
    loading.value = false
  }
}

const deleteArticle = async (art: any) => {
  if (!confirm(`Bạn có chắc muốn xóa bài viết "${art.title}"?`)) return
  try {
    await $fetch(`/api/admin/articles/${art.id}`, { method: 'DELETE' })
    await fetchArticles(pagination.value.page)
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Lỗi xóa bài viết')
  }
}

onMounted(() => {
  fetchArticles()
})
</script>

<template>
  <div class="articles-page">
    <div class="page-header">
      <div>
        <h1>Quản lý Bài viết & Nội dung</h1>
        <p>Danh sách bài viết tin tức, tấm gương tiêu biểu, mô hình kinh tế và văn bản</p>
      </div>
      <nuxt-link to="/admin/content/articles/new" class="primary-btn">
        ✍️ Viết Bài Mới
      </nuxt-link>
    </div>

    <!-- Filters -->
    <div class="filter-card">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo tiêu đề bài viết..."
        @keyup.enter="fetchArticles(1)"
      />

      <select v-model="selectedType" @change="fetchArticles(1)">
        <option value="">Tất cả Thể loại</option>
        <option value="news">Bản tin & Tin tức</option>
        <option value="role_model">Tấm gương tiêu biểu</option>
        <option value="reintegration">Mô hình tái hòa nhập</option>
        <option value="document">Văn bản pháp luật</option>
        <option value="faq">Giải đáp pháp luật</option>
      </select>

      <select v-model="selectedStatus" @change="fetchArticles(1)">
        <option value="">Tất cả Trạng thái</option>
        <option value="published">Đã Xuất Bản</option>
        <option value="draft">Bản Nháp (Draft)</option>
        <option value="archived">Lưu Trữ</option>
      </select>

      <button class="search-btn" @click="fetchArticles(1)">Tìm kiếm</button>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div v-if="loading" class="loading-state">Đang tải danh sách bài viết...</div>

      <table v-else class="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Ảnh</th>
            <th>Tiêu đề bài viết</th>
            <th>Thể loại</th>
            <th>Trạng thái</th>
            <th>Tác giả</th>
            <th>Ngày tạo</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in articles" :key="a.id">
            <td>#{{ a.id }}</td>
            <td class="thumb-cell">
              <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" class="thumb-img" />
              <span v-else class="no-thumb">🖼️</span>
            </td>
            <td>
              <strong class="article-title">{{ a.title }}</strong>
            </td>
            <td>
              <span class="type-badge">{{ typeLabels[a.type] || a.type }}</span>
            </td>
            <td>
              <span class="status-badge" :class="a.status">
                {{ a.status === 'published' ? 'Đã đăng' : (a.status === 'draft' ? 'Bản nháp' : 'Lưu trữ') }}
              </span>
            </td>
            <td>{{ a.authorName || 'Admin' }}</td>
            <td>{{ new Date(a.createdAt).toLocaleDateString('vi-VN') }}</td>
            <td>
              <div class="action-buttons">
                <nuxt-link :to="`/admin/content/articles/${a.id}`" class="edit-link">✏️ Sửa</nuxt-link>
                <button class="delete-btn" @click="deleteArticle(a)">🗑️ Xóa</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination" v-if="pagination.totalPages > 1">
      <button
        :disabled="pagination.page <= 1"
        @click="fetchArticles(pagination.page - 1)"
      >
        ❮ Trang trước
      </button>
      <span>Trang {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button
        :disabled="pagination.page >= pagination.totalPages"
        @click="fetchArticles(pagination.page + 1)"
      >
        Trang sau ❯
      </button>
    </div>
  </div>
</template>

<style scoped>
.articles-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-header h1 {
  font-size: 1.3rem;
  font-weight: 800;
  margin: 0;
  color: #122815;
}

.page-header p {
  font-size: 0.85rem;
  color: #667768;
  margin: 4px 0 0 0;
}

.primary-btn {
  background: #1e4620;
  color: white;
  text-decoration: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 700;
}

.filter-card {
  background: white;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  display: flex;
  gap: 12px;
}

.filter-card input, .filter-card select {
  padding: 10px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
}

.filter-card input {
  flex: 1;
}

.search-btn {
  background: #2c6e33;
  color: white;
  border: none;
  padding: 0 18px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
}

.table-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2ece3;
  overflow: hidden;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  text-align: left;
}

.admin-table th {
  background: #f8faf8;
  padding: 12px 16px;
  color: #667768;
  border-bottom: 1px solid #e2ece3;
}

.admin-table td {
  padding: 14px 16px;
  border-bottom: 1px solid #eef2ee;
}

.thumb-cell {
  width: 50px;
}

.thumb-img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
}

.no-thumb {
  font-size: 24px;
  opacity: 0.5;
}

.article-title {
  color: #122815;
}

.type-badge {
  background: #f0f7f1;
  color: #2c6e33;
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.75rem;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.75rem;
}

.status-badge.published {
  background: #e4f2e5;
  color: #2c6e33;
}

.status-badge.draft {
  background: #fff8e1;
  color: #b78103;
}

.status-badge.archived {
  background: #f5f5f5;
  color: #888;
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.edit-link {
  color: #2c6e33;
  text-decoration: none;
  font-weight: 700;
  font-size: 0.82rem;
}

.delete-btn {
  background: none;
  border: none;
  color: #d12420;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.82rem;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
}

.pagination button {
  background: white;
  border: 1px solid #c8d6c9;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}
</style>
