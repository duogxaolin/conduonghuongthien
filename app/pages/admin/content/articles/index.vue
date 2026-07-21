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
  news: 'Bản tin', role_model: 'Tấm gương', reintegration: 'Mô hình', document: 'Văn bản', faq: 'Giải đáp',
}

const toast = useToast()

const fetchArticles = async (page = 1) => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/articles', {
      params: { page, search: search.value, type: selectedType.value, status: selectedStatus.value, perPage: 15 }
    })
    if (res.ok) { articles.value = res.items; pagination.value = res.pagination }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách bài viết')
  } finally {
    loading.value = false
  }
}

const deleteArticle = async (art: any) => {
  if (!confirm(`Bạn có chắc muốn xóa bài viết "${art.title}"?`)) return
  try {
    await $fetch(`/api/admin/articles/${art.id}`, { method: 'DELETE' })
    toast.success('Đã xóa bài viết thành công!')
    await fetchArticles(pagination.value.page)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi xóa bài viết')
  }
}

onMounted(() => { fetchArticles() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Quản lý Bài viết & Nội dung</h1>
        <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Danh sách bài viết tin tức, tấm gương tiêu biểu, mô hình kinh tế và văn bản</p>
      </div>
      <nuxt-link
        to="/admin/content/articles/new"
        class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg no-underline transition-colors shrink-0"
      >
        <i class="fa-solid fa-pen-to-square"></i> Viết Bài Mới
      </nuxt-link>
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row flex-wrap gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo tiêu đề bài viết..."
        @keyup.enter="fetchArticles(1)"
        class="flex-1 min-w-[180px] px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      />
      <select v-model="selectedType" @change="fetchArticles(1)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]">
        <option value="">Tất cả Thể loại</option>
        <option value="news">Bản tin & Tin tức</option>
        <option value="role_model">Tấm gương tiêu biểu</option>
        <option value="reintegration">Mô hình tái hòa nhập</option>
        <option value="document">Văn bản pháp luật</option>
        <option value="faq">Giải đáp pháp luật</option>
      </select>
      <select v-model="selectedStatus" @change="fetchArticles(1)" class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]">
        <option value="">Tất cả Trạng thái</option>
        <option value="published">Đã Xuất Bản</option>
        <option value="draft">Bản Nháp (Draft)</option>
        <option value="archived">Lưu Trữ</option>
      </select>
      <button
        class="inline-flex items-center gap-2 bg-[#2c6e33] hover:bg-[#1e4620] text-white font-bold px-4 py-2.5 rounded-lg cursor-pointer border-0 transition-colors"
        @click="fetchArticles(1)"
      >
        <i class="fa-regular fa-magnifying-glass"></i> Tìm kiếm
      </button>
    </div>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <div v-if="loading" class="py-10 text-center text-[#667768]">Đang tải danh sách bài viết...</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">ID</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3]">Ảnh</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3]">Tiêu đề bài viết</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thể loại</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Trạng thái</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Tác giả</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Ngày tạo</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in articles" :key="a.id" class="hover:bg-[#fafcfa]">
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768]">#{{ a.id }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee] w-[50px]">
                <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" class="w-11 h-11 object-cover rounded-md" />
                <i v-else class="fa-regular fa-image text-2xl text-[#c8d6c9]"></i>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee] max-w-[260px]">
                <strong class="text-[#122815] line-clamp-2">{{ a.title }}</strong>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <span class="inline-block bg-[#f0f7f1] text-[#2c6e33] px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap">
                  {{ typeLabels[a.type] || a.type }}
                </span>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <span
                  class="inline-block px-2 py-1 rounded-md text-[0.75rem] font-bold whitespace-nowrap"
                  :class="a.status === 'published' ? 'bg-[#e4f2e5] text-[#2c6e33]' : a.status === 'draft' ? 'bg-[#fff8e1] text-[#b78103]' : 'bg-[#f5f5f5] text-[#888]'"
                >
                  {{ a.status === 'published' ? 'Đã đăng' : (a.status === 'draft' ? 'Bản nháp' : 'Lưu trữ') }}
                </span>
              </td>
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768] whitespace-nowrap">{{ a.authorName || 'Admin' }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee] text-[#667768] whitespace-nowrap">{{ new Date(a.createdAt).toLocaleDateString('vi-VN') }}</td>
              <td class="px-4 py-3 border-b border-[#eef2ee]">
                <div class="flex items-center gap-2">
                  <nuxt-link
                    :to="`/admin/content/articles/${a.id}`"
                    class="inline-flex items-center gap-1 text-[#2c6e33] no-underline font-bold text-[0.82rem] hover:underline"
                  ><i class="fa-solid fa-pen-to-square"></i> Sửa</nuxt-link>
                  <button
                    class="inline-flex items-center gap-1 bg-none border-0 text-[#d12420] cursor-pointer font-bold text-[0.82rem] hover:underline"
                    @click="deleteArticle(a)"
                  ><i class="fa-regular fa-trash"></i> Xóa</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="pagination.totalPages > 1" class="flex justify-center items-center gap-4">
      <button
        :disabled="pagination.page <= 1"
        @click="fetchArticles(pagination.page - 1)"
        class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] px-4 py-2 rounded-lg cursor-pointer text-sm font-medium hover:bg-[#f0f7f1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      ><i class="fa-regular fa-chevron-left"></i> Trang trước</button>
      <span class="text-sm text-[#667768] font-medium">Trang {{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button
        :disabled="pagination.page >= pagination.totalPages"
        @click="fetchArticles(pagination.page + 1)"
        class="inline-flex items-center gap-2 bg-white border border-[#c8d6c9] px-4 py-2 rounded-lg cursor-pointer text-sm font-medium hover:bg-[#f0f7f1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >Trang sau <i class="fa-regular fa-chevron-right"></i></button>
    </div>
  </div>
</template>
