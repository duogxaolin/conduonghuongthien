<template>
  <div class="role-models-page section-bg">
    <!-- Hero Header -->
    <section class="role-hero">
      <div class="role-hero-overlay"></div>
      <div class="container">
        <h2 class="role-hero-title">Tấm Gương Tiêu Biểu</h2>
        <p class="role-hero-subtitle">Hành trình vươn lên từ lầm lỡ, khẳng định giá trị bản thân và đóng góp tích cực cho cộng đồng</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="section">
      <div class="container">
        <SectionBar icon="🌟" title="Những tấm gương hoàn lương" />
        <div class="role-list-grid">
          <div v-for="item in roleModels" :key="item.id" class="role-card-item">
            <div class="avatar-wrap">
              <img :src="item.image" :alt="item.name" />
            </div>
            <div class="info-wrap">
              <span class="location">📍 {{ item.location }}</span>
              <h3>{{ item.title }}</h3>
              <p class="excerpt">{{ item.excerpt }}</p>
              <nuxt-link :to="`/role-models/${item.slug}`" class="btn btn-outline">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
useSeoMeta({
  title: 'Tấm gương tiêu biểu | Con Đường Hướng Thiện',
  description: 'Những tấm gương hoàn lương lập nghiệp thành công sau khi chấp hành xong án phạt tù.'
})

const roleModels = [
  {
    id: 1,
    name: 'Nguyễn Văn A',
    slug: 'nguyen-van-a',
    location: 'TP. Đà Nẵng',
    title: 'Anh Nguyễn Văn A — Nghị lực làm giàu và gieo mầm hy vọng từ xưởng mộc',
    image: '/assets/guong_sang_1.jpg',
    excerpt: 'Trở về sau án phạt tù 5 năm, anh Nguyễn Văn A vượt qua mặc cảm tự ti ban đầu để lập nghiệp. Nhờ sự hỗ trợ vay vốn của Công an địa phương và Ngân hàng CSXH, anh đã xây dựng thành công xưởng sản xuất đồ gỗ mỹ nghệ lớn...'
  },
  {
    id: 2,
    name: 'Trần Thị B',
    slug: 'tran-thi-b',
    location: 'Tỉnh Quảng Ninh',
    title: 'Chị Trần Thị B — Tự tin vươn lên làm chủ cơ sở may gia công xuất khẩu',
    image: '/assets/guong_sang_2.jpg',
    excerpt: 'Từng lầm lỡ sa ngã, chị B trở về địa phương được sự động viên sát sao của Hội Phụ nữ và Công an phường. Chị kiên trì học nghề may và hiện nay sở hữu cơ sở may mặc uy tín tạo sinh kế cho nhiều phụ nữ hoàn cảnh khó khăn...'
  }
]
</script>

<style scoped>
.role-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.role-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.role-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.role-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.role-list-grid {
  display: flex;
  flex-direction: column;
  gap: 30px;
  max-width: 900px;
  margin: 0 auto;
}

.role-card-item {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 30px;
  display: flex;
  gap: 30px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.role-card-item:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.avatar-wrap {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  overflow: hidden;
  border: 4px solid var(--bg-light);
  flex-shrink: 0;
}

.avatar-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.location {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary);
  background-color: var(--bg-light);
  padding: 4px 10px;
  border-radius: 4px;
  display: inline-block;
  margin-bottom: 10px;
}

.info-wrap h3 {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--text-dark);
}

.excerpt {
  font-size: 0.95rem;
  color: var(--text-medium);
  line-height: 1.6;
  margin-bottom: 20px;
}

@media (max-width: 768px) {
  .role-card-item {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}
</style>
