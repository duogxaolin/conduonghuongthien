<template>
  <div class="py-10 bg-[#F8FAF7]">
    <div class="max-w-[800px] mx-auto px-4">
      <!-- Breadcrumb -->
      <div class="text-[0.85rem] text-[#7A8675] mb-6">
        <nuxt-link to="/" class="text-[#4A6741] no-underline hover:underline">Trang chủ</nuxt-link> &raquo;
        <nuxt-link to="/reintegration-models" class="text-[#4A6741] no-underline hover:underline">Mô hình tái hòa nhập</nuxt-link> &raquo;
        <span>Chi tiết mô hình</span>
      </div>

      <!-- Main Content -->
      <article v-if="article">
        <span class="text-[0.85rem] font-bold text-[#4A6741] bg-[#F8FAF7] px-3 py-1.5 rounded inline-block mb-4">💡 Mô hình tiêu biểu • Ngày đăng: {{ article.date }}</span>
        <h1 class="text-[2.2rem] font-extrabold leading-[1.3] text-[#1E251C] mb-5">{{ article.title }}</h1>

        <div class="text-[1.15rem] font-semibold text-[#4A5545] leading-relaxed border-l-4 border-[#7CB342] pl-5 mb-8">
          <p>{{ article.lead }}</p>
        </div>

        <div class="article-body">
          <div class="my-8 text-center">
            <img :src="article.image" :alt="article.title" class="w-full max-h-[450px] object-cover rounded-md shadow-sm" />
            <span class="text-[0.85rem] text-[#7A8675] italic mt-2 block">Hình ảnh minh họa hoạt động triển khai mô hình trên thực tế.</span>
          </div>

          <div v-html="article.content"></div>
        </div>

        <!-- Back Link -->
        <div class="mt-10 border-t border-[#E2E8DF] pt-8">
          <nuxt-link to="/reintegration-models" class="btn btn-primary">&larr; Quay lại danh sách mô hình</nuxt-link>
        </div>
      </article>

      <div v-else class="py-10 text-center">
        <p class="text-[#4A5545] mb-4">Không tìm thấy mô hình yêu cầu hoặc nội dung đang được cập nhật.</p>
        <nuxt-link to="/reintegration-models" class="btn btn-primary">Quay lại danh sách</nuxt-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const slug = route.params.id

const articlesData = {
  'quy-tin-dung-hoan-luong': {
    date: '17/07/2026',
    title: 'Quỹ Tín dụng hỗ trợ hoàn lương theo Quyết định 22/2023/QĐ-TTg',
    image: '/assets/news_lamdong.jpg',
    lead: 'Quyết định số 22/2023/QĐ-TTg của Thủ tướng Chính phủ về tín dụng đối với người chấp hành xong án phạt tù là một bước đi mang tính đột phá, nhân văn sâu sắc. Chính sách này tháo gỡ điểm nghẽn lớn nhất của người hoàn lương — đó là vốn đầu tư sản xuất kinh doanh.',
    content: `
      <p>Theo Quyết định số 22/2023/QĐ-TTg, người chấp hành xong án phạt tù (trong khoảng thời gian không quá 5 năm kể từ ngày chấp hành xong án phạt tù) được vay vốn tín dụng ưu đãi từ Ngân hàng Chính sách Xã hội để phục vụ các mục đích đào tạo nghề hoặc sản xuất kinh doanh, tạo sinh kế bền vững.</p>

      <blockquote>
        "Mức vốn cho vay tối đa đối với mục đích sản xuất kinh doanh lên tới 100 triệu đồng/người chấp hành xong án phạt tù. Đây thực sự là điểm tựa tài chính vững vàng giúp họ tự tin làm lại cuộc đời."
      </blockquote>

      <p>Thủ tục vay vốn được thiết kế tối giản, công khai thông qua tổ tiết kiệm và vay vốn tại thôn, xóm dưới sự bảo lãnh và xác nhận chấp hành tốt pháp luật của UBND cấp xã cư trú. Lãi suất cho vay cực kỳ ưu đãi, bằng lãi suất cho vay đối với hộ nghèo quy định theo từng thời kỳ.</p>
    `
  },
  'cau-lac-bo-hoa-nhap-xanh': {
    date: '17/07/2026',
    title: 'Mô hình Câu lạc bộ "Hòa nhập xanh" nâng bước hoàn lương tại địa bàn cơ sở',
    image: '/assets/news_quangninh.jpg',
    lead: 'Câu lạc bộ "Hòa nhập xanh" là sáng kiến phối hợp hiệu quả giữa Công an xã/phường, Đoàn thanh niên và Hội phụ nữ địa phương nhằm tạo không gian sinh hoạt cộng đồng bổ ích cho người chấp hành xong án phạt tù.',
    content: `
      <p>Tại câu lạc bộ, các thành viên được chia sẻ kinh nghiệm vượt khó lập nghiệp, trao đổi các mô hình chăn nuôi, trồng trọt và sản xuất công nghiệp hiệu quả. Đồng thời, lực lượng Công an cơ sở trực tiếp lồng ghép các nội dung giáo dục pháp luật, tuyên truyền phòng chống tệ nạn xã hội.</p>

      <p>Mô hình đã chứng minh tính hiệu quả vượt trội trong việc gắn kết tình cảm, xóa bỏ mặc cảm xa lánh của xã hội, trực tiếp hạ thấp tỷ lệ tái phạm tội ở những địa bàn nhân rộng mô hình.</p>
    `
  },
  'lien-ket-dao-tao-nghe-nhan-van': {
    date: '17/07/2026',
    title: 'Mô hình liên kết Đào tạo nghề và bao tiêu giới thiệu việc làm nhân văn',
    image: '/assets/news_danang.jpg',
    lead: 'Liên kết chặt chẽ ba bên giữa "Nhà nước (Cơ quan Công an) — Nhà trường (Cơ sở đào tạo nghề) — Nhà doanh nghiệp" là chìa khóa mở cánh cửa tương lai cho người hoàn lương.',
    content: `
      <p>Chương trình hỗ trợ 100% học phí học nghề ngắn hạn cho học viên chấp hành xong án phạt tù. Các nghề đào tạo trọng điểm bao gồm: kỹ thuật hàn, cơ khí cắt gọt CNC, điện công nghiệp, may thời trang, kỹ thuật mộc dân dụng và trang trí nội thất.</p>

      <p>Sau khi hoàn thành khóa đào tạo, các học viên được doanh nghiệp ký kết liên kết tuyển dụng trực tiếp vào làm việc, đảm bảo thu nhập ngay để ổn định cuộc sống lâu dài.</p>
    `
  }
}

const article = computed(() => {
  return articlesData[slug] || null
})
</script>

<style scoped>
/* Retained for v-html deep content — not expressible with Tailwind utility classes */
.article-body :deep(p) {
  font-size: 1.05rem;
  line-height: 1.7;
  color: #4A5545;
  margin-bottom: 20px;
}

.article-body :deep(blockquote) {
  background-color: #F8FAF7;
  border-left: 4px solid #4A6741;
  padding: 20px 24px;
  margin: 30px 0;
  font-style: italic;
  font-size: 1.1rem;
  color: #385130;
}
</style>
