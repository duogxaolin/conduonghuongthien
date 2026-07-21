<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const submissions = ref<any[]>([])
const loading = ref(true)
const search = ref('')
const typeFilter = ref('')
const selectedSub = ref<any>(null)
const toast = useToast()

const fetchSubmissions = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/submissions')
    if (res.ok) submissions.value = res.submissions
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách đơn đăng ký')
  } finally {
    loading.value = false
  }
}

const filteredSubmissions = computed(() => {
  return submissions.value.filter(s => {
    const matchSearch = !search.value ||
      s.name?.toLowerCase().includes(search.value.toLowerCase()) ||
      s.phone?.includes(search.value) ||
      s.city?.toLowerCase().includes(search.value.toLowerCase())
    const matchType = !typeFilter.value || s.type === typeFilter.value
    return matchSearch && matchType
  })
})

onMounted(() => { fetchSubmissions() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.3rem] font-extrabold text-[#122815] m-0">Danh sách Đơn đăng ký Hỗ trợ</h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Tiếp nhận và xử lý thông tin từ người dân đăng ký tư vấn tái hòa nhập cộng đồng</p>
    </div>

    <!-- Filter Bar -->
    <div class="bg-white rounded-xl border border-[#e2ece3] p-4 flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        v-model="search"
        placeholder="Tìm theo họ tên, số điện thoại, tỉnh thành..."
        class="flex-1 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15"
      />
      <select
        v-model="typeFilter"
        class="px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-sm outline-none focus:border-[#2c6e33]"
      >
        <option value="">Tất cả loại yêu cầu</option>
        <option value="support">Tư vấn Hỗ trợ (Tái hòa nhập)</option>
        <option value="contact">Liên hệ thông thường</option>
      </select>
    </div>

    <!-- Table Card -->
    <div class="bg-white rounded-xl border border-[#e2ece3] overflow-hidden">
      <div v-if="loading" class="p-10 text-center text-[#667768]">Đang tải danh sách...</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full border-collapse text-[0.88rem] text-left">
          <thead>
            <tr>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">ID</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Họ và tên</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Số điện thoại</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Tỉnh / Thành</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Loại yêu cầu</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Ngày gửi</th>
              <th class="bg-[#f8faf8] px-4 py-3 text-[#667768] font-bold border-b border-[#e2ece3] whitespace-nowrap">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in filteredSubmissions" :key="s.id" class="hover:bg-[#fafcfa]">
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768]">#{{ s.id }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] font-bold text-[#122815]">{{ s.name }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]"><code class="bg-[#f4f7f4] px-1.5 py-0.5 rounded text-xs">{{ s.phone }}</code></td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#2c3e2e]">{{ s.city || '—' }}</td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <span
                  class="px-2 py-1 rounded-md text-[0.75rem] font-bold"
                  :class="s.type === 'support' ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#eef2f8] text-[#1a4f8b]'"
                >
                  {{ s.type === 'support' ? 'Hỗ trợ tái hòa nhập' : 'Liên hệ' }}
                </span>
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee] text-[#667768] text-[0.82rem] whitespace-nowrap">
                {{ new Date(s.submittedAt).toLocaleString('vi-VN') }}
              </td>
              <td class="px-4 py-3.5 border-b border-[#eef2ee]">
                <button
                  class="inline-flex items-center gap-1.5 bg-[#f0f7f1] text-[#2c6e33] border border-[#8ed694] px-2.5 py-1.5 rounded-md text-[0.78rem] font-bold cursor-pointer hover:bg-[#e4f2e5] transition-colors"
                  @click="selectedSub = s"
                >
                  <i class="fa-solid fa-eye"></i> Xem chi tiết
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Detail Modal -->
    <div v-if="selectedSub" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4" @click.self="selectedSub = null">
      <div class="bg-white rounded-2xl p-7 w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <h3 class="text-[1.15rem] font-extrabold text-[#122815] m-0 mb-1">📋 Chi tiết Đơn đăng ký #{{ selectedSub.id }}</h3>
        <p class="text-[0.82rem] text-[#667768] m-0 mb-5">Gửi lúc: {{ new Date(selectedSub.submittedAt).toLocaleString('vi-VN') }}</p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Họ và tên:</span>
            <strong class="text-[#122815]">{{ selectedSub.name }}</strong>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Số điện thoại:</span>
            <code class="bg-[#f4f7f4] px-2 py-1 rounded text-sm self-start">{{ selectedSub.phone }}</code>
          </div>
          <div v-if="selectedSub.email" class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Email:</span>
            <span>{{ selectedSub.email }}</span>
          </div>
          <div v-if="selectedSub.city" class="flex flex-col gap-1">
            <span class="text-[0.78rem] text-[#667768] font-bold">Tỉnh / Thành phố:</span>
            <span>{{ selectedSub.city }}</span>
          </div>
          <div v-if="selectedSub.address" class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] text-[#667768] font-bold">Địa chỉ chi tiết:</span>
            <span>{{ selectedSub.address }}</span>
          </div>
          <div class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-[0.78rem] text-[#667768] font-bold">Nội dung yêu cầu / Hoàn cảnh:</span>
            <div class="bg-[#f8faf8] border border-[#e2ece3] px-3 py-3 rounded-lg text-[0.9rem] leading-relaxed whitespace-pre-wrap">{{ selectedSub.message }}</div>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg cursor-pointer font-medium" @click="selectedSub = null">Đóng</button>
          <a
            :href="`tel:${selectedSub.phone}`"
            class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white font-bold px-4 py-2.5 rounded-lg no-underline transition-colors"
          >
            <i class="fa-solid fa-phone"></i> Gọi Điện Tư Vấn
          </a>
        </div>
      </div>
    </div>
  </div>
</template>
