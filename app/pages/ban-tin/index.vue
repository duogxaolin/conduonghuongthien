<template>
  <div class="news-page section-bg">
    <!-- Hero Header -->
    <section class="news-hero">
      <div class="news-hero-overlay"></div>
      <div class="container">
        <h2 class="news-hero-title">Bản Tin Hoạt Động</h2>
        <p class="news-hero-subtitle">Cập nhật tin tức, chỉ đạo điều hành và sự kiện hỗ trợ hoàn lương trên toàn quốc</p>
      </div>
    </section>

    <!-- Main Content Grid -->
    <section class="section">
      <div class="container news-container">
        <!-- Filter Sidebar -->
        <aside class="news-filter-sidebar">
          <div class="filter-card">
            <h4>DANH MỤC TIN TỨC</h4>
            <ul>
              <li><button :class="{ active: activeCategory === 'all' }" @click="setCategory('all')">Tất cả bản tin</button></li>
              <li><button :class="{ active: activeCategory === 'tin-noi-bat' }" @click="setCategory('tin-noi-bat')">Tin nổi bật</button></li>
              <li><button :class="{ active: activeCategory === 'tin-hoat-dong' }" @click="setCategory('tin-hoat-dong')">Tin hoạt động</button></li>
              <li><button :class="{ active: activeCategory === 'tin-dia-phuong' }" @click="setCategory('tin-dia-phuong')">Tin địa phương</button></li>
            </ul>
          </div>
        </aside>

        <!-- News List -->
        <div class="news-main-list">
          <div v-for="item in filteredNews" :key="item.id" class="news-horizontal-card">
            <div class="news-card-img">
              <img :src="item.image" :alt="item.title" />
            </div>
            <div class="news-card-info">
              <span class="news-card-date">{{ item.date }} • {{ item.categoryName }}</span>
              <h3><nuxt-link :to="`/ban-tin/${item.slug}`">{{ item.title }}</nuxt-link></h3>
              <p>{{ item.excerpt }}</p>
              <nuxt-link :to="`/ban-tin/${item.slug}`" class="read-more-btn">Xem chi tiết &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const activeCategory = ref('all')

const newsItems = [
  {
    id: 1,
    title: 'ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN',
    slug: 'da-nang-doi-thoai-giam-thi-pham-nhan',
    category: 'tin-noi-bat',
    categoryName: 'Tin nổi bật',
    date: '17/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 để kịp thời tháo gỡ vướng mắc, động viên cải tạo.'
  },
  {
    id: 2,
    title: 'QUẢNG NINH: Công an đặc khu Vân Đồn hỗ trợ người chấp hành xong án phạt tù tìm kiếm việc làm',
    slug: 'quang-ninh-van-don-ho-tro-viec-lam',
    category: 'tin-hoat-dong',
    categoryName: 'Tin hoạt động',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Nhằm tạo điều kiện tốt nhất cho người chấp hành xong án phạt tù xóa bỏ tự ti và có thu nhập ổn định, Công an đặc khu Vân Đồn phối hợp cơ quan chức năng tổ chức sàn giao dịch hướng nghiệp kết nối trực tiếp doanh nghiệp.'
  },
  {
    id: 3,
    title: 'CÔNG AN TỈNH LÂM ĐỒNG THĂM HỎI, TẶNG QUÀ, ĐỘNG VIÊN NGƯỜI ĐƯỢC ĐẶC XÁ CÓ HOÀN CẢNH KHÓ KHĂN',
    slug: 'lam-dong-tham-hoi-tang-qua-dac-xa',
    category: 'tin-hoat-dong',
    categoryName: 'Tin hoạt động',
    date: '17/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Phòng Cảnh sát thi hành án hình sự và hỗ trợ tư pháp Công an tỉnh Lâm Đồng phối hợp với Công an các địa bàn tổ chức thăm hỏi, trao tặng các phần quà hỗ trợ thiết thực động viên tinh thần người chấp hành đặc xá vươn lên.'
  },
  {
    id: 4,
    title: 'QUẢNG NINH: Công an phường Móng Cái 3 tăng cường công tác cảm hóa, giáo dục thi hành án hình sự tại cộng đồng',
    slug: 'mong-cai-tang-cuong-cam-hoa-giao-duc',
    category: 'tin-dia-phuong',
    categoryName: 'Tin địa phương',
    date: '17/07/2026',
    image: '/assets/news_quangninh.jpg',
    excerpt: 'Tăng cường điểm danh, kiểm diện và lập hồ sơ theo dõi sát sao, kết hợp rà soát hoàn cảnh gia đình để có phương hướng cảm hóa giáo dục phù hợp, phòng ngừa tái phạm tội trên địa bàn phường Móng Cái 3.'
  },
  {
    id: 5,
    title: 'CẦN THƠ: Điểm tựa tín dụng cho người hoàn lương tái hòa nhập',
    slug: 'can-tho-diem-tua-tin-dung',
    category: 'tin-noi-bat',
    categoryName: 'Tin nổi bật',
    date: '16/07/2026',
    image: '/assets/news_lamdong.jpg',
    excerpt: 'Triển khai chính sách tín dụng ưu đãi từ Ngân hàng Chính sách Xã hội theo Quyết định 22/2023/QĐ-TTg, giúp hàng chục hộ gia đình người hoàn lương tại Cần Thơ tiếp cận nguồn vốn ưu đãi 100 triệu đồng để mở rộng làm ăn.'
  },
  {
    id: 6,
    title: 'LÂM ĐỒNG: Sơ kết công tác quản lý giam giữ, thi hành án hình sự và hỗ trợ tư pháp 6 tháng đầu năm 2026',
    slug: 'lam-dong-so-ket-cong-tac',
    category: 'tin-hoat-dong',
    categoryName: 'Tin hoạt động',
    date: '16/07/2026',
    image: '/assets/news_danang.jpg',
    excerpt: 'Công an tỉnh Lâm Đồng sơ kết đánh giá kết quả triển khai công tác quản lý giam giữ và hỗ trợ tái hòa nhập cộng đồng 6 tháng đầu năm, đề ra phương hướng chỉ đạo sát sao cho 6 tháng cuối năm.'
  }
]

const filteredNews = computed(() => {
  if (activeCategory.value === 'all') {
    return newsItems
  }
  return newsItems.filter(item => item.category === activeCategory.value)
})

const setCategory = (cat) => {
  activeCategory.value = cat
}

onMounted(() => {
  if (route.query.cat) {
    activeCategory.value = route.query.cat
  }
})
</script>

<style scoped>
.news-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.news-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.news-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.news-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.news-container {
  display: grid;
  grid-template-columns: 1fr 3fr;
  gap: 30px;
}

.filter-card {
  background-color: var(--white);
  padding: 24px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
  position: sticky;
  top: 100px;
}

.filter-card h4 {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 16px;
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 8px;
}

.filter-card ul {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-card button {
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 10px 14px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-medium);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition);
}

.filter-card button:hover, .filter-card button.active {
  background-color: var(--bg-light);
  color: var(--primary);
  padding-left: 18px;
}

.news-main-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.news-horizontal-card {
  display: flex;
  background-color: var(--white);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.news-horizontal-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.news-card-img {
  width: 260px;
  height: 180px;
  flex-shrink: 0;
}

.news-card-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.news-card-info {
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.news-card-date {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: 6px;
}

.news-card-info h3 {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.4;
  margin-bottom: 8px;
}

.news-card-info h3 a {
  text-decoration: none;
  color: var(--text-dark);
  transition: var(--transition);
}

.news-card-info h3 a:hover {
  color: var(--primary);
}

.news-card-info p {
  font-size: 0.88rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin-bottom: 12px;
}

.read-more-btn {
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
  font-size: 0.88rem;
  align-self: flex-start;
}

@media (max-width: 900px) {
  .news-container {
    grid-template-columns: 1fr;
  }
  .news-horizontal-card {
    flex-direction: column;
  }
  .news-card-img {
    width: 100%;
    height: 200px;
  }
}
</style>
