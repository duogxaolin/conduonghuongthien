<template>
  <div class="models-page section-bg">
    <!-- Hero Header -->
    <section class="models-hero">
      <div class="models-hero-overlay"></div>
      <div class="container">
        <h2 class="models-hero-title">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
        <p class="models-hero-subtitle">Các mô hình kinh tế tập thể, quỹ hỗ trợ nhân văn giúp người hoàn lương ổn định cuộc sống</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="section">
      <div class="container">
        <SectionBar icon="🏆" title="Các mô hình tiêu biểu" />
        <div class="models-list-grid">
          <div v-for="item in models" :key="item.id" class="model-detail-card">
            <span class="model-category">💡 Mô hình tiêu biểu</span>
            <h3>{{ item.title }}</h3>
            <p class="model-desc">{{ item.excerpt }}</p>
            <nuxt-link :to="`/reintegration-models/${item.slug}`" class="read-more-btn">Xem chi tiết mô hình &rarr;</nuxt-link>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
useSeoMeta({
  title: 'Mô hình tái hòa nhập | Con Đường Hướng Thiện',
  description: 'Các mô hình tiêu biểu hỗ trợ người hoàn lương tái hòa nhập cộng đồng: quỹ tín dụng, câu lạc bộ, liên kết đào tạo nghề.'
})

const models = [
  {
    id: 1,
    slug: 'quy-tin-dung-hoan-luong',
    title: 'Quỹ Tín dụng hỗ trợ hoàn lương theo Quyết định 22/2023/QĐ-TTg',
    excerpt: 'Triển khai chính sách tín dụng ưu đãi đột phá từ Chính phủ, hỗ trợ người chấp hành xong án phạt tù tiếp cận nguồn vốn vay 100 triệu đồng giải quyết việc làm, mua sắm công cụ sản xuất.'
  },
  {
    id: 2,
    slug: 'cau-lac-bo-hoa-nhap-xanh',
    title: 'Mô hình Câu lạc bộ "Hòa nhập xanh" nâng bước hoàn lương',
    excerpt: 'Nơi sinh hoạt cộng đồng gắn kết tình cảm, chia sẻ kinh nghiệm phát triển kinh tế gia đình và phổ biến kiến thức pháp luật bổ ích dưới sự hỗ trợ điều hành của lực lượng Công an cơ sở.'
  },
  {
    id: 3,
    slug: 'lien-ket-dao-tao-nghe-nhan-van',
    title: 'Mô hình liên kết Đào tạo nghề và giới thiệu việc làm nhân văn',
    excerpt: 'Chương trình liên kết chặt chẽ giữa các doanh nghiệp địa phương và trung tâm giáo dục nghề nghiệp nhằm tổ chức đào tạo các lớp nghề mộc, may mặc, cơ khí và bao tiêu đầu ra việc làm ngay sau khi tốt nghiệp.'
  }
]
</script>

<style scoped>
.models-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.models-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.models-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.models-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.models-list-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px;
}

.model-detail-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 40px 30px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: var(--transition);
}

.model-detail-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.model-category {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  margin-bottom: 10px;
  display: block;
}

.model-detail-card h3 {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-dark);
  margin-bottom: 16px;
  line-height: 1.4;
}

.model-desc {
  font-size: 0.92rem;
  color: var(--text-medium);
  line-height: 1.6;
  margin-bottom: 24px;
  flex-grow: 1;
}

.read-more-btn {
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.9rem;
  transition: var(--transition);
}

.read-more-btn:hover {
  color: var(--primary);
}

@media (max-width: 900px) {
  .models-list-grid {
    grid-template-columns: 1fr;
  }
}
</style>
