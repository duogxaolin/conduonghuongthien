<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Văn Bản Quy Phạm Pháp Luật</h2>
        <p class="text-[1.1rem] opacity-90">Tra cứu các nghị định, chính sách, chỉ thị về công tác quản lý thi hành án hình sự và tái hòa nhập cộng đồng</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <div class="container">
        <div>
          <SectionBar icon="fa-solid fa-file-contract" title="Văn bản pháp luật mới" />

          <!-- Search Bar -->
          <div class="flex flex-col gap-3 mb-[30px] bg-white p-4 rounded-lg border border-[#E2E8DF] shadow-sm sm:flex-row">
            <input
              type="text"
              placeholder="Nhập từ khóa tìm kiếm văn bản (Ví dụ: 49/2020, vay vốn, xóa án tích...)"
              v-model="searchQuery"
              class="flex-1 px-3 py-3 border border-[#E2E8DF] rounded text-[0.95rem] outline-none focus:border-[#7CB342] font-[inherit] transition-colors duration-200"
            />
            <button class="btn btn-primary w-full sm:w-auto">Tìm kiếm</button>
          </div>

          <!-- Table -->
          <div class="bg-white rounded-lg border border-[#E2E8DF] shadow-sm overflow-x-auto">
            <table class="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th class="w-[15%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Số ký hiệu / Ngày</th>
                  <th class="w-[55%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Trích yếu nội dung</th>
                  <th class="w-[20%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Cơ quan ban hành</th>
                  <th class="w-[10%] px-5 py-4 border-b border-[#E2E8DF] bg-[#F8FAF7] text-[#4A6741] font-bold text-[0.8rem] uppercase tracking-[0.5px]">Tải về</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="doc in filteredDocs" :key="doc.id">
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem]">
                    <div class="flex flex-col gap-1">
                      <strong class="text-[#4A6741] text-[0.88rem]">{{ doc.code }}</strong>
                      <span class="text-[0.78rem] text-[#7A8675]">{{ doc.date }}</span>
                    </div>
                  </td>
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem]">
                    <a href="#" class="no-underline text-[#1E251C] font-semibold leading-snug hover:text-[#4A6741] transition-colors duration-300">{{ doc.title }}</a>
                  </td>
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem] text-[#4A5545] font-medium">{{ doc.org }}</td>
                  <td class="px-5 py-4 border-b border-[#E2E8DF] text-[0.9rem]">
                    <a href="#" class="text-[#D32F2F] no-underline font-bold hover:underline">📄 PDF</a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

useSeoMeta({
  title: 'Văn bản pháp luật | Con Đường Hướng Thiện',
  description: 'Tra cứu văn bản quy phạm pháp luật về thi hành án hình sự, chính sách tín dụng và tái hòa nhập cộng đồng.'
})

const searchQuery = ref('')

const docs = [
  {
    id: 1,
    code: 'Nghị định 49/2020/NĐ-CP',
    date: '17/04/2020',
    title: 'Nghị định quy định chi tiết thi hành Luật Thi hành án hình sự về các biện pháp bảo đảm tái hòa nhập cộng đồng đối với người chấp hành xong án phạt tù.',
    org: 'Chính phủ',
  },
  {
    id: 2,
    code: 'Quyết định 22/2023/QĐ-TTg',
    date: '17/08/2023',
    title: 'Quyết định của Thủ tướng Chính phủ về chính sách tín dụng đối với người chấp hành xong án phạt tù vay vốn ưu đãi tại Ngân hàng Chính sách Xã hội.',
    org: 'Thủ tướng Chính phủ',
  },
  {
    id: 3,
    code: 'Thông tư 12/2022/TT-BTTTT',
    date: '12/08/2022',
    title: 'Thông tư quy định chi tiết và hướng dẫn về các yêu cầu, tiêu chuẩn kỹ thuật trong xây dựng hồ sơ thiết kế an toàn thông tin cấp độ mạng.',
    org: 'Bộ Thông tin & Truyền thông',
  },
  {
    id: 4,
    code: 'Luật số 41/2019/QH14',
    date: '14/06/2019',
    title: 'Luật Thi hành án hình sự năm 2019 của Quốc hội nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.',
    org: 'Quốc hội',
  }
]

const filteredDocs = computed(() => {
  if (searchQuery.value.trim() === '') {
    return docs
  }
  const cleanQ = searchQuery.value.toLowerCase()
  return docs.filter(doc =>
    doc.code.toLowerCase().includes(cleanQ) ||
    doc.title.toLowerCase().includes(cleanQ) ||
    doc.org.toLowerCase().includes(cleanQ)
  )
})
</script>
