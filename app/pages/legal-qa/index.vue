<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-[2]">
        <h2 class="text-[1.9rem] font-extrabold mb-3 sm:text-[2.5rem]">Giải Đáp Pháp Luật</h2>
        <p class="text-[1.1rem] opacity-90">Ngân hàng câu hỏi đáp pháp luật, quy trình thủ tục hành chính hỗ trợ xóa án tích, vay vốn</p>
      </div>
    </section>

    <!-- Content -->
    <section class="section">
      <div class="container">
        <SectionBar icon="fa-solid fa-circle-question" title="Câu hỏi thường gặp" />
        <div class="max-w-[800px] mx-auto flex flex-col gap-4">
          <div
            v-for="(item, index) in faqs"
            :key="index"
            class="bg-white rounded-lg overflow-hidden transition-all duration-300"
            :class="activeIndex === index
              ? 'border border-[#4A6741] shadow-sm'
              : 'border border-[#E2E8DF]'"
          >
            <button
              class="w-full px-6 py-5 flex justify-between items-center bg-transparent border-none font-[inherit] text-base font-bold text-left cursor-pointer transition-colors duration-200 hover:text-[#4A6741]"
              :class="activeIndex === index ? 'text-[#4A6741]' : 'text-[#1E251C]'"
              @click="toggleFaq(index)"
            >
              <span>{{ item.question }}</span>
              <span class="text-[1.4rem] text-[#7A8675]">{{ activeIndex === index ? '−' : '+' }}</span>
            </button>
            <div
              v-show="activeIndex === index"
              class="px-6 pb-5 pt-0 text-[0.95rem] text-[#4A5545] leading-[1.6] border-t border-[#E2E8DF] bg-[#F8FAF7]"
            >
              <p>{{ item.answer }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue'

useSeoMeta({
  title: 'Giải đáp pháp luật | Con Đường Hướng Thiện',
  description: 'Giải đáp các câu hỏi pháp lý thường gặp về xóa án tích, vay vốn ưu đãi, học nghề cho người hoàn lương.'
})

const activeIndex = ref(null)

const faqs = [
  {
    question: '1. Thời gian thử thách án treo tính từ thời điểm nào?',
    answer: 'Thời gian thử thách án treo tính từ ngày tuyên án sơ thẩm có hiệu lực pháp luật hoặc ngày quyết định kháng nghị hoặc bản án phúc thẩm được tuyên.'
  },
  {
    question: '2. Thủ tục đề nghị hỗ trợ vay vốn ưu đãi 100 triệu đồng theo Quyết định 22 như thế nào?',
    answer: 'Đương sự hoặc người đại diện nộp đơn đề nghị có xác nhận của UBND cấp xã cư trú về việc chấp hành tốt pháp luật gửi đến Ngân hàng Chính sách Xã hội cấp quận/huyện để làm hồ sơ giải ngân.'
  },
  {
    question: '3. Có được miễn giảm học phí học nghề ngắn hạn không?',
    answer: 'Người chấp hành xong án phạt tù thuộc đối tượng chính sách ưu tiên theo Nghị định 49/2020/NĐ-CP được hỗ trợ 100% học phí học nghề ngắn hạn tại các cơ sở đào tạo công lập liên kết.'
  }
]

const toggleFaq = (index) => {
  activeIndex.value = activeIndex.value === index ? null : index
}
</script>
