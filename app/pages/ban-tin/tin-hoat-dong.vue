<template>
  <div class="news-category-page section-bg">
    <section class="cat-hero">
      <div class="cat-hero-overlay"></div>
      <div class="container">
        <h2 class="cat-hero-title">Tin Hoạt Động</h2>
        <p class="cat-hero-subtitle">Các hoạt động, chỉ đạo nghiệp vụ thi hành án hình sự và tái hòa nhập</p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="news-list-container">
          <div v-for="item in newsItems" :key="item.id" class="news-item-card-vertical">
            <div class="news-item-img">
              <img :src="item.image" :alt="item.title" />
            </div>
            <div class="news-item-info">
              <span class="news-item-date">{{ item.date }} • Tin hoạt động</span>
              <h3><a href="#">{{ item.title }}</a></h3>
              <p>{{ item.excerpt }}</p>
              <a href="#" class="read-more-link">Chi tiết &rarr;</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
const newsItems = [
  {
    id: 1,
    title: 'QUẢNG NINH: Công an đặc khu Vân Đồn hỗ trợ người chấp hành xong án phạt tù tìm kiếm việc làm',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Nhằm tạo điều kiện tốt nhất cho người chấp hành xong án phạt tù xóa bỏ tự ti và có thu nhập ổn định, Công an đặc khu Vân Đồn phối hợp cơ quan chức năng tổ chức sàn giao dịch hướng nghiệp kết nối trực tiếp doanh nghiệp.'
  },
  {
    id: 2,
    title: 'CÔNG AN TỈNH LÂM ĐỒNG THĂM HỎI, TẶNG QUÀ, ĐỘNG VIÊN NGƯỜI ĐƯỢC ĐẶC XÁ CÓ HOÀN CẢNH KHÓ KHĂN',
    date: '17/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Phòng Cảnh sát thi hành án hình sự và hỗ trợ tư pháp Công an tỉnh Lâm Đồng phối hợp với Công an các địa bàn tổ chức thăm hỏi, trao tặng các phần quà hỗ trợ thiết thực động viên tinh thần người chấp hành đặc xá vươn lên.'
  },
  {
    id: 3,
    title: 'LÂM ĐỒNG: Sơ kết công tác quản lý giam giữ, thi hành án hình sự và hỗ trợ tư pháp 6 tháng đầu năm 2026',
    date: '16/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Công an tỉnh Lâm Đồng sơ kết đánh giá kết quả triển khai công tác quản lý giam giữ và hỗ trợ tái hòa nhập cộng đồng 6 tháng đầu năm, đề ra phương hướng chỉ đạo sát sao cho 6 tháng cuối năm.'
  }
]
</script>

<style scoped>
.cat-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 80px 0;
  text-align: center;
  color: white;
}

.cat-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.cat-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.2rem;
  font-weight: 800;
  margin-bottom: 8px;
}

.cat-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1rem;
  opacity: 0.9;
}

.news-list-container {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 30px;
  max-width: 1000px;
  margin: 0 auto;
}

.news-item-card-vertical {
  background-color: var(--white);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.news-item-card-vertical:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.news-item-img {
  height: 220px;
  overflow: hidden;
}

.news-item-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.news-item-info {
  padding: 24px;
}

.news-item-date {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
  display: block;
  margin-bottom: 8px;
}

.news-item-info h3 {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.4;
  margin-bottom: 10px;
}

.news-item-info h3 a {
  text-decoration: none;
  color: var(--text-dark);
  transition: var(--transition);
}

.news-item-info h3 a:hover {
  color: var(--primary);
}

.news-item-info p {
  font-size: 0.9rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin-bottom: 16px;
}

.read-more-link {
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.88rem;
}

@media (max-width: 768px) {
  .news-list-container {
    grid-template-columns: 1fr;
  }
}
</style>
