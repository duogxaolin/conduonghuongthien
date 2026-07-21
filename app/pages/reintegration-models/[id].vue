<template>
  <div class="article-detail-page section-bg">
    <div class="container article-container">
      <!-- Breadcrumb -->
      <div class="breadcrumb">
        <nuxt-link to="/">Trang chủ</nuxt-link> &raquo; 
        <nuxt-link to="/reintegration-models">Mô hình tái hòa nhập</nuxt-link> &raquo; 
        <span>Chi tiết mô hình</span>
      </div>

      <!-- Main Content -->
      <article class="article-content" v-if="article">
        <span class="meta-tag">💡 Mô hình tiêu biểu • Ngày đăng: {{ article.date }}</span>
        <h1 class="article-title">{{ article.title }}</h1>
        
        <div class="article-lead">
          <p>{{ article.lead }}</p>
        </div>

        <div class="article-body">
          <div class="article-img-wrap">
            <img :src="article.image" :alt="article.title" />
            <span class="img-caption">Hình ảnh minh họa hoạt động triển khai mô hình trên thực tế.</span>
          </div>

          <div v-html="article.content"></div>
        </div>

        <!-- Back Link -->
        <div class="back-wrap">
          <nuxt-link to="/reintegration-models" class="btn btn-primary">&larr; Quay lại danh sách mô hình</nuxt-link>
        </div>
      </article>

      <div class="not-found" v-else>
        <p>Không tìm thấy mô hình yêu cầu hoặc nội dung đang được cập nhật.</p>
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
.article-detail-page {
  padding: 40px 0;
}

.article-container {
  max-width: 800px;
  margin: 0 auto;
}

.breadcrumb {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.breadcrumb a {
  color: var(--primary);
  text-decoration: none;
}

.breadcrumb a:hover {
  text-decoration: underline;
}

.meta-tag {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--primary);
  background-color: var(--bg-light);
  padding: 6px 12px;
  border-radius: 4px;
  display: inline-block;
  margin-bottom: 16px;
}

.article-title {
  font-size: 2.2rem;
  font-weight: 800;
  line-height: 1.3;
  color: var(--text-dark);
  margin-bottom: 20px;
}

.article-lead {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--text-medium);
  line-height: 1.6;
  border-left: 4px solid var(--secondary);
  padding-left: 20px;
  margin-bottom: 30px;
}

.article-img-wrap {
  margin: 30px 0;
  text-align: center;
}

.article-img-wrap img {
  width: 100%;
  max-height: 450px;
  object-fit: cover;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.img-caption {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
  margin-top: 8px;
  display: block;
}

.article-body :deep(p) {
  font-size: 1.05rem;
  line-height: 1.7;
  color: var(--text-medium);
  margin-bottom: 20px;
}

.article-body :deep(blockquote) {
  background-color: var(--bg-light);
  border-left: 4px solid var(--primary);
  padding: 20px 24px;
  margin: 30px 0;
  font-style: italic;
  font-size: 1.1rem;
  color: var(--primary-dark);
}

.back-wrap {
  margin-top: 40px;
  border-top: 1px solid var(--border-color);
  padding-top: 30px;
}
</style>
