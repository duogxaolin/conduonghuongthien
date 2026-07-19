<template>
  <div class="news-category-page section-bg">
    <section class="cat-hero">
      <div class="cat-hero-overlay"></div>
      <div class="container">
        <h2 class="cat-hero-title">Tin Địa Phương</h2>
        <p class="cat-hero-subtitle">Hoạt động thi hành án hình sự và công tác cộng đồng tại địa bàn xã, phường</p>
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
              <span class="news-item-date">{{ item.date }} • Tin địa phương</span>
              <h3><nuxt-link :to="'/ban-tin/' + item.slug">{{ item.title }}</nuxt-link></h3>
              <p>{{ item.excerpt }}</p>
              <nuxt-link :to="'/ban-tin/' + item.slug" class="read-more-link">Chi tiết &rarr;</nuxt-link>
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
    slug: 'mong-cai-tang-cuong-cam-hoa-giao-duc',
    title: 'QUẢNG NINH: Công an phường Móng Cái 3 tăng cường công tác cảm hóa, giáo dục thi hành án hình sự tại cộng đồng',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Tăng cường điểm danh, kiểm diện và lập hồ sơ theo dõi sát sao, kết hợp rà soát hoàn cảnh gia đình để có phương hướng cảm hóa giáo dục phù hợp, phòng ngừa tái phạm tội trên địa bàn phường Móng Cái 3.'
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
