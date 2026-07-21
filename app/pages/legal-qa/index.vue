<template>
  <div class="faq-page section-bg">
    <!-- Hero Header -->
    <section class="faq-hero">
      <div class="faq-hero-overlay"></div>
      <div class="container">
        <h2 class="faq-hero-title">Giải Đáp Pháp Luật</h2>
        <p class="faq-hero-subtitle">Ngân hàng câu hỏi đáp pháp luật, quy trình thủ tục hành chính hỗ trợ xóa án tích, vay vốn</p>
      </div>
    </section>

    <!-- Content -->
    <section class="section">
      <div class="container faq-container">
        <SectionBar icon="fa-solid fa-circle-question" title="Câu hỏi thường gặp" />
        <div class="faq-accordion-wrap">
          <div v-for="(item, index) in faqs" :key="index" class="faq-card" :class="{ 'is-open': activeIndex === index }">
            <button class="faq-btn" @click="toggleFaq(index)">
              <span>{{ item.question }}</span>
              <span class="faq-sign">{{ activeIndex === index ? '−' : '+' }}</span>
            </button>
            <div class="faq-answer-block" v-show="activeIndex === index">
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

<style scoped>
.faq-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.faq-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.faq-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.faq-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.faq-accordion-wrap {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.faq-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  overflow: hidden;
  transition: var(--transition);
}

.faq-card.is-open {
  border-color: var(--primary);
  box-shadow: var(--shadow-sm);
}

.faq-btn {
  width: 100%;
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: none;
  border: none;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-dark);
  text-align: left;
  cursor: pointer;
}

.faq-card:hover .faq-btn {
  color: var(--primary);
}

.faq-sign {
  font-size: 1.4rem;
  color: var(--text-muted);
}

.faq-answer-block {
  padding: 0 24px 20px 24px;
  font-size: 0.95rem;
  color: var(--text-medium);
  line-height: 1.6;
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-light);
}
</style>
