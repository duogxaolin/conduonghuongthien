<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth'
})

const sections = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const selectedSection = ref<any>(null)
const editConfig = ref<any>({})
const activeTab = ref<'content' | 'style' | 'preview'>('content')

const sectionTypes: Record<string, { name: string; icon: string; desc: string }> = {
  hero:          { name: 'Hero Banner Đầu trang', icon: 'fa-solid fa-image', desc: 'Khối hình ảnh banner lớn kèm nút kêu gọi hành động (CTA)' },
  stats:         { name: 'Khối Thống kê Con số', icon: 'fa-solid fa-chart-line', desc: 'Hiển thị các chỉ số ấn tượng về công tác hỗ trợ tái hòa nhập' },
  news:          { name: 'Bản tin & Tin tức Nổi bật', icon: 'fa-solid fa-newspaper', desc: 'Danh sách bài viết tin tức hoạt động mới nhất' },
  role_models:   { name: 'Tấm Gương Tiêu Biểu', icon: 'fa-solid fa-star', desc: 'Các câu chuyện hoàn lương và mô hình lập nghiệp thành công' },
  reintegration: { name: 'Mô Hình Tái Hòa Nhập', icon: 'fa-solid fa-cubes', desc: 'Các mô hình kinh tế, đào tạo nghề nghiệp tiêu biểu' },
  documents:     { name: 'Văn bản Quy phạm Pháp luật', icon: 'fa-solid fa-file-contract', desc: 'Bảng tra cứu các văn bản, chỉ thị, chính sách hỗ trợ' },
  support_form:  { name: 'Form Đăng Ký Tư Vấn', icon: 'fa-solid fa-paper-plane', desc: 'Khối gửi yêu cầu hỗ trợ 24/7 của công dân' },
  links:         { name: 'Liên Kết Hữu Ích', icon: 'fa-solid fa-link', desc: 'Danh sách các cổng thông tin và trang web liên kết' },
}

const toast = useToast()

const fetchSections = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/admin/home-sections')
    if (res.ok) sections.value = res.sections
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi tải danh sách sections')
  } finally {
    loading.value = false
  }
}

const toggleVisibility = async (sec: any) => {
  try {
    const res = await $fetch(`/api/admin/home-sections/${sec.id}/toggle`, { method: 'PATCH' })
    if (res.ok) {
      sec.isVisible = res.isVisible
      toast.success(`Đã ${res.isVisible ? 'hiển thị' : 'ẩn'} Block "${sec.title}"!`)
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi đổi trạng thái hiển thị')
  }
}

const openEditModal = (sec: any) => {
  selectedSection.value = sec
  editConfig.value = JSON.parse(JSON.stringify(sec.config || {}))
  if (editConfig.value.title === undefined) editConfig.value.title = sec.title || ''
  if (editConfig.value.subtitle === undefined) editConfig.value.subtitle = ''
  if (editConfig.value.description === undefined) editConfig.value.description = ''
  if (editConfig.value.maxItems === undefined) editConfig.value.maxItems = 6
  if (editConfig.value.bgVariant === undefined) editConfig.value.bgVariant = 'default'
  if (editConfig.value.layoutStyle === undefined) editConfig.value.layoutStyle = 'grid-3'
  if (editConfig.value.bgImage === undefined) editConfig.value.bgImage = ''
  if (editConfig.value.btnText === undefined) editConfig.value.btnText = 'Xem tất cả'
  if (editConfig.value.btnLink === undefined) editConfig.value.btnLink = ''
  activeTab.value = 'content'
}

const saveSectionConfig = async () => {
  if (!selectedSection.value) return
  saving.value = true
  try {
    const res = await $fetch(`/api/admin/home-sections/${selectedSection.value.id}`, {
      method: 'PUT',
      body: { title: editConfig.value.title, config: editConfig.value }
    })
    if (res.ok) {
      selectedSection.value.title = editConfig.value.title
      selectedSection.value.config = JSON.parse(JSON.stringify(editConfig.value))
      selectedSection.value = null
      toast.success('Đã lưu cấu hình Block Gutenberg thành công!')
    }
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu cấu hình')
  } finally {
    saving.value = false
  }
}

const moveSection = async (index: number, direction: 'up' | 'down') => {
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= sections.value.length) return
  const temp = sections.value[index]
  sections.value[index] = sections.value[targetIndex]
  sections.value[targetIndex] = temp
  const ordersPayload = sections.value.map((sec, idx) => ({ id: sec.id, displayOrder: idx + 1 }))
  try {
    await $fetch('/api/admin/home-sections/reorder', { method: 'PUT', body: { orders: ordersPayload } })
    toast.success('Đã sắp xếp lại thứ tự Block!')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Lỗi lưu thứ tự mới')
  }
}

const { openPicker } = useImagePicker()
const { uploading: uploadingBg, uploadFile } = useUpload()

const openBgImagePicker = () => {
  openPicker({
    onSelect: (media) => {
      editConfig.value.bgImage = media.url
      toast.success('Đã chọn hình ảnh từ Thư viện Media!')
    }
  })
}

const uploadBgImage = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const media = await uploadFile(file)
  if (media) {
    editConfig.value.bgImage = media.url
    toast.success('Đã tải và chọn ảnh nền!')
  }
  ;(event.target as HTMLInputElement).value = ''
}

onMounted(() => { fetchSections() })
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Page Header -->
    <div>
      <h1 class="text-[1.35rem] font-extrabold text-[#122815] m-0 flex items-center gap-2.5">
        <i class="fa-solid fa-cubes"></i> Quản lý Block Trang chủ (WordPress Gutenberg Style)
      </h1>
      <p class="text-[0.85rem] text-[#667768] mt-1 mb-0">Sắp xếp thứ tự kéo-thả, tùy chỉnh nội dung văn bản &amp; phong cách hiển thị từng khối</p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="py-10 text-center text-[#667768] text-[1.05rem]">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i> Đang tải dữ liệu cấu hình Trang chủ...
    </div>

    <!-- Gutenberg Block List -->
    <div v-else class="bg-white rounded-2xl border border-[#e2ece3] p-5">
      <div class="flex flex-col gap-3.5">
        <div
          v-for="(sec, idx) in sections"
          :key="sec.id"
          class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-4 rounded-xl bg-[#fbfdfb] border border-[#e0eae1] transition-all duration-200 hover:border-[#a8d5ab] hover:shadow-[0_4px_14px_rgba(30,70,32,0.06)] hover:-translate-y-px"
          :class="{ 'opacity-55 bg-[#f4f6f4]': !sec.isVisible }"
        >
          <!-- Left: Block Meta -->
          <div class="flex items-center gap-4">
            <span class="text-[1.2rem] text-[#a0b2a2] cursor-grab select-none">⠿</span>
            <div class="w-11 h-11 rounded-[10px] bg-[#e4f2e5] text-[#1e4620] flex items-center justify-center text-[1.2rem] shrink-0">
              <i :class="sectionTypes[sec.type]?.icon || 'fa-solid fa-box'"></i>
            </div>
            <div class="flex flex-col gap-0.5">
              <div class="flex items-center gap-2.5">
                <span class="text-[0.98rem] font-bold text-[#122815]">{{ sectionTypes[sec.type]?.name || sec.type }}</span>
                <span class="text-[0.72rem] font-bold bg-[#eef3ee] text-[#556655] px-2 py-0.5 rounded-md">{{ sec.type }}</span>
              </div>
              <p class="text-[0.83rem] text-[#667768] m-0">{{ sec.config?.title || sectionTypes[sec.type]?.desc }}</p>
            </div>
          </div>

          <!-- Right: Action Buttons -->
          <div class="flex items-center gap-3 shrink-0 ml-auto">
            <div class="flex gap-1">
              <button
                class="w-8 h-8 rounded-md border border-[#dce4dd] bg-white text-[#445544] inline-flex items-center justify-center transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:not-disabled:bg-[#e4f2e5] hover:not-disabled:text-[#1e4620] hover:not-disabled:border-[#a8d5ab]"
                :disabled="idx === 0"
                @click="moveSection(idx, 'up')"
                title="Di chuyển lên"
              ><i class="fa-solid fa-arrow-up text-xs"></i></button>
              <button
                class="w-8 h-8 rounded-md border border-[#dce4dd] bg-white text-[#445544] inline-flex items-center justify-center transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:not-disabled:bg-[#e4f2e5] hover:not-disabled:text-[#1e4620] hover:not-disabled:border-[#a8d5ab]"
                :disabled="idx === sections.length - 1"
                @click="moveSection(idx, 'down')"
                title="Di chuyển xuống"
              ><i class="fa-solid fa-arrow-down text-xs"></i></button>
            </div>

            <button
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[0.8rem] font-bold border-0 cursor-pointer transition-all duration-200"
              :class="sec.isVisible ? 'bg-[#e4f2e5] text-[#2c6e33]' : 'bg-[#ffebe9] text-[#d12420]'"
              @click="toggleVisibility(sec)"
              :title="sec.isVisible ? 'Bấm để ẩn khỏi trang chủ' : 'Bấm để hiển thị lên trang chủ'"
            >
              <i :class="sec.isVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
              <span>{{ sec.isVisible ? 'Hiển thị' : 'Đã ẩn' }}</span>
            </button>

            <button
              class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white border-0 px-4 py-2 rounded-lg font-bold text-[0.85rem] cursor-pointer transition-colors"
              @click="openEditModal(sec)"
            >
              <i class="fa-solid fa-sliders"></i> Tùy biến Block
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Customizer Drawer -->
    <Teleport to="body">
      <div
        v-if="selectedSection"
        class="fixed inset-0 bg-black/55 backdrop-blur-[4px] z-[2000] flex justify-end"
        @click.self="selectedSection = null"
      >
        <div class="w-full max-w-[580px] h-full bg-white flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.2)] animate-[slideInRight_0.3s_cubic-bezier(0.16,1,0.3,1)]">
          <!-- Panel Header -->
          <div class="flex items-center justify-between px-6 py-5 border-b border-[#e2ece3] bg-[#f8faf8] shrink-0">
            <div class="flex items-center gap-3.5">
              <div class="w-[42px] h-[42px] rounded-[10px] bg-[#1e4620] text-white flex items-center justify-center text-[1.2rem] shrink-0">
                <i :class="sectionTypes[selectedSection.type]?.icon || 'fa-solid fa-box'"></i>
              </div>
              <div>
                <h3 class="m-0 text-[1.1rem] font-extrabold text-[#122815]">Tùy biến Block: {{ sectionTypes[selectedSection.type]?.name }}</h3>
                <p class="m-0 mt-0.5 text-[0.8rem] text-[#667768]">Chỉnh sửa giao diện &amp; nội dung theo phong cách WordPress Gutenberg</p>
              </div>
            </div>
            <button class="bg-transparent border-0 text-[1.3rem] text-[#889988] cursor-pointer p-1 leading-none" @click="selectedSection = null">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <!-- Panel Tabs -->
          <div class="flex bg-[#eef3ee] px-3 py-1.5 gap-1.5 border-b border-[#e2ece3] shrink-0">
            <button
              v-for="tab in (['content', 'style', 'preview'] as const)"
              :key="tab"
              class="flex-1 py-2.5 border-0 rounded-lg text-[0.83rem] font-bold cursor-pointer flex items-center justify-center gap-1.5 transition-all duration-200"
              :class="activeTab === tab ? 'bg-white text-[#1e4620] shadow-[0_2px_6px_rgba(0,0,0,0.06)]' : 'bg-transparent text-[#556655]'"
              @click="activeTab = tab"
            >
              <i v-if="tab === 'content'" class="fa-solid fa-pen-to-square"></i>
              <i v-else-if="tab === 'style'" class="fa-solid fa-palette"></i>
              <i v-else class="fa-solid fa-desktop"></i>
              <span class="hidden sm:inline">{{ tab === 'content' ? '1. Nội dung & Văn bản' : tab === 'style' ? '2. Giao diện & Layout' : '3. Xem trước' }}</span>
              <span class="sm:hidden">{{ tab === 'content' ? 'Nội dung' : tab === 'style' ? 'Giao diện' : 'Preview' }}</span>
            </button>
          </div>

          <!-- Panel Body -->
          <div class="flex-1 overflow-y-auto p-6">
            <!-- TAB 1: CONTENT -->
            <div v-if="activeTab === 'content'" class="flex flex-col gap-5">
              <div class="flex flex-col gap-1.5">
                <label class="text-[0.85rem] font-bold text-[#122815]">Tiêu đề chính của Block (*)</label>
                <input type="text" v-model="editConfig.title" placeholder="Nhập tiêu đề hiển thị" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
                <span class="text-[0.78rem] text-[#889988]">Tiêu đề nổi bật nằm ở đầu Block</span>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-[0.85rem] font-bold text-[#122815]">Tiêu đề phụ / Khẩu hiệu (Subtitle)</label>
                <input type="text" v-model="editConfig.subtitle" placeholder="Nhập mô tả ngắn gọn" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border" />
                <span class="text-[0.78rem] text-[#889988]">Hiển thị chữ nhỏ bên dưới tiêu đề chính</span>
              </div>

              <div v-if="selectedSection.type === 'hero'" class="flex flex-col gap-1.5">
                <label class="text-[0.85rem] font-bold text-[#122815]">Văn bản đoạn giới thiệu</label>
                <textarea v-model="editConfig.description" rows="3" placeholder="Nhập mô tả cho banner hero..." class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border resize-none font-[inherit]"></textarea>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="flex flex-col gap-1.5">
                  <label class="text-[0.85rem] font-bold text-[#122815]">Nhãn nút bấm (Button CTA)</label>
                  <input type="text" v-model="editConfig.btnText" placeholder="eg: Xem tất cả →" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] box-border" />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-[0.85rem] font-bold text-[#122815]">Đường dẫn liên kết (Button URL)</label>
                  <input type="text" v-model="editConfig.btnLink" placeholder="eg: /news" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] box-border" />
                </div>
              </div>

              <div v-if="['news', 'role_models', 'reintegration', 'documents'].includes(selectedSection.type)" class="flex flex-col gap-1.5">
                <label class="text-[0.85rem] font-bold text-[#122815]">Số lượng mục hiển thị trên trang chủ</label>
                <select v-model="editConfig.maxItems" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] box-border">
                  <option :value="3">3 bài (Đề xuất)</option>
                  <option :value="4">4 bài</option>
                  <option :value="6">6 bài</option>
                  <option :value="8">8 bài</option>
                </select>
              </div>
            </div>

            <!-- TAB 2: STYLE & LAYOUT -->
            <div v-if="activeTab === 'style'" class="flex flex-col gap-5">
              <div class="flex flex-col gap-2">
                <label class="text-[0.85rem] font-bold text-[#122815]">Màu nền Section (Background Variant)</label>
                <div class="flex flex-col gap-2">
                  <label
                    v-for="opt in [
                      { value: 'default', label: 'Nền Trắng (Mặc định)', swatch: '#ffffff' },
                      { value: 'light', label: 'Nền Xám Nhạt', swatch: '#f8faf8' },
                      { value: 'primary', label: 'Nền Xanh Đậm', swatch: '#1e4620' },
                    ]"
                    :key="opt.value"
                    class="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border cursor-pointer text-[0.85rem] transition-all"
                    :class="editConfig.bgVariant === opt.value ? 'border-[#1e4620] bg-[#f4f8f4] font-bold' : 'border-[#dce4dd]'"
                  >
                    <input type="radio" :value="opt.value" v-model="editConfig.bgVariant" class="accent-[#2c6e33]" />
                    <span class="w-[18px] h-[18px] rounded border border-[#ccc] shrink-0 inline-block" :style="{ background: opt.swatch }"></span>
                    <span>{{ opt.label }}</span>
                  </label>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-[0.85rem] font-bold text-[#122815]">Bố cục hiển thị (Layout Grid Style)</label>
                <select v-model="editConfig.layoutStyle" class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] box-border">
                  <option value="grid-3">Bố cục Grid 3 Cột (Tiêu chuẩn)</option>
                  <option value="grid-4">Bố cục Grid 4 Cột (Mở rộng)</option>
                  <option value="list">Bố cục Danh sách Hàng dọc</option>
                  <option value="card-hero">Bố cục Card Nổi bật</option>
                </select>
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-[0.85rem] font-bold text-[#122815]">Hình ảnh Banner / Nền Block</label>
                <div class="flex gap-2">
                  <input type="text" v-model="editConfig.bgImage" placeholder="Đường dẫn ảnh (/uploads/...)" class="flex-1 min-w-0 px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.9rem] outline-none focus:border-[#2c6e33] box-border" />
                  <button type="button" class="inline-flex items-center gap-1.5 bg-[#f0f7f1] text-[#2c6e33] border border-[#8ed694] px-3 py-2 rounded-lg font-bold text-[0.82rem] cursor-pointer hover:bg-[#e4f2e5] transition-colors whitespace-nowrap" @click="openBgImagePicker">
                    <i class="fa-regular fa-images"></i> Thư viện
                  </button>
                  <label
                    class="inline-flex items-center gap-1.5 bg-[#1e4620] hover:bg-[#2c6e33] text-white px-3 py-2 rounded-lg font-bold text-[0.82rem] cursor-pointer transition-colors whitespace-nowrap"
                    :class="{ 'opacity-60 cursor-not-allowed pointer-events-none': uploadingBg }"
                  >
                    <i class="fa-regular" :class="uploadingBg ? 'fa-spinner animate-spin' : 'fa-cloud-arrow-up'"></i>
                    {{ uploadingBg ? '...' : 'Upload' }}
                    <input type="file" accept="image/*" class="sr-only" :disabled="uploadingBg" @change="uploadBgImage" />
                  </label>
                </div>
                <div v-if="editConfig.bgImage" class="mt-1 relative inline-block">
                  <img :src="editConfig.bgImage" alt="Preview Background" class="max-w-full max-h-[140px] rounded-lg border border-[#ddd]" />
                  <button type="button" class="absolute top-1.5 right-1.5 bg-[rgba(209,36,32,0.9)] text-white border-0 px-2 py-1 rounded text-[0.75rem] cursor-pointer" @click="editConfig.bgImage = ''">✕ Xóa ảnh</button>
                </div>
              </div>
            </div>

            <!-- TAB 3: LIVE PREVIEW -->
            <div v-if="activeTab === 'preview'">
              <div
                class="p-5 rounded-xl border border-[#e0eae1]"
                :class="{
                  'bg-white': editConfig.bgVariant === 'default' || !editConfig.bgVariant,
                  'bg-[#f8faf8]': editConfig.bgVariant === 'light',
                  'bg-[#1e4620] text-white': editConfig.bgVariant === 'primary',
                }"
              >
                <div class="flex items-center gap-3 mb-4">
                  <span class="text-[1.4rem]"><i :class="sectionTypes[selectedSection.type]?.icon"></i></span>
                  <div>
                    <h4 class="m-0 text-[1.1rem] font-extrabold">{{ editConfig.title || 'Tiêu đề chưa nhập' }}</h4>
                    <p v-if="editConfig.subtitle" class="m-0 mt-0.5 text-[0.8rem] opacity-80">{{ editConfig.subtitle }}</p>
                  </div>
                </div>

                <div class="grid grid-cols-3 gap-2.5 mb-4">
                  <div v-for="i in 3" :key="i" class="bg-black/[0.04] rounded-md p-2">
                    <div class="h-[50px] bg-black/[0.08] rounded mb-1.5"></div>
                    <div class="h-1.5 w-[70%] bg-black/10 rounded mb-1"></div>
                    <div class="h-1.5 w-[40%] bg-black/10 rounded"></div>
                  </div>
                </div>

                <div v-if="editConfig.btnText" class="text-center">
                  <span class="inline-block px-3.5 py-1.5 bg-[#1e4620] text-white text-[0.78rem] rounded-md font-bold" :class="editConfig.bgVariant === 'primary' ? 'bg-white text-[#1e4620]' : ''">
                    {{ editConfig.btnText }} →
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Panel Footer -->
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-[#e2ece3] bg-[#f8faf8] shrink-0">
            <button class="bg-[#f0f0f0] border-0 px-4 py-2.5 rounded-lg text-[0.88rem] font-bold cursor-pointer hover:bg-[#e5e5e5] transition-colors" @click="selectedSection = null">Hủy bỏ</button>
            <button
              class="inline-flex items-center gap-2 bg-[#1e4620] hover:bg-[#2c6e33] text-white border-0 px-5 py-2.5 rounded-lg text-[0.88rem] font-bold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="saving"
              @click="saveSectionConfig"
            >
              <i v-if="saving" class="fa-solid fa-spinner fa-spin"></i>
              <i v-else class="fa-solid fa-check"></i>
              {{ saving ? 'Đang lưu...' : 'Lưu thay đổi Block' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
</style>

