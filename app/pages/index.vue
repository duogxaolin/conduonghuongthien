<template>
  <div class="homepage">
    <!-- Hero Banner Section -->
    <section class="hero-section">
      <div class="hero-bg-overlay"></div>
      <div class="container hero-container">
        <div class="hero-content">
          <span class="hero-badge">CỔNG THÔNG TIN C11 - BỘ CÔNG AN</span>
          <h2 class="hero-title animate-fade-in">Đồng hành cùng hành trình hướng thiện</h2>
          <p class="hero-subtitle">
            Nền tảng hỗ trợ toàn diện về nghề nghiệp, pháp lý và tư vấn tâm lý giúp người chấp hành xong án phạt tù vững vàng tái hòa nhập cộng đồng, xây dựng cuộc sống mới bền vững.
          </p>
          <div class="hero-actions">
            <nuxt-link to="/gioi-thieu" class="btn btn-secondary btn-lg pulse-effect">Về chúng tôi</nuxt-link>
            <a href="#tro-giup" class="btn btn-outline-white btn-lg">Gửi yêu cầu trợ giúp</a>
          </div>
        </div>
      </div>
    </section>

    <!-- Statistics Section (Thiết kế lại cao cấp, hiện đại) -->
    <section class="stats-section">
      <div class="container stats-grid">
        <div class="stat-card">
          <div class="stat-icon-wrapper">
            <span class="stat-icon-svg">🏢</span>
          </div>
          <div class="stat-info">
            <span class="stat-number">63</span>
            <span class="stat-label">Tỉnh / Thành phố đồng hành</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon-wrapper">
            <span class="stat-icon-svg">🤝</span>
          </div>
          <div class="stat-info">
            <span class="stat-number">10.000+</span>
            <span class="stat-label">Người hoàn lương được hỗ trợ</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon-wrapper">
            <span class="stat-icon-svg">🌟</span>
          </div>
          <div class="stat-info">
            <span class="stat-number">500+</span>
            <span class="stat-label">Mô hình kinh tế tiêu biểu</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon-wrapper">
            <span class="stat-icon-svg">📞</span>
          </div>
          <div class="stat-info">
            <span class="stat-number">24/7</span>
            <span class="stat-label">Tư vấn pháp lý & Tâm lý miễn phí</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Latest & Trending Split News Section (Section Mới đan xen cực đẹp) -->
    <section class="section split-news-section">
      <div class="container split-news-grid">
        <!-- Cột Trái: Tin tức mới nhất (Latest News) -->
        <div class="latest-news-wrap">
          <div class="section-title-wrap">
            <h2 class="section-title">Tin Tức Mới Nhất</h2>
            <nuxt-link to="/ban-tin" class="view-all-link">Xem tất cả &rarr;</nuxt-link>
          </div>
          
          <div class="latest-news-list">
            <div class="featured-news-main">
              <div class="main-news-img">
                <img src="/assets/news_danang.jpg" alt="Đại hội Đà Nẵng" />
                <span class="news-badge-cat">Tin nổi bật</span>
              </div>
              <div class="main-news-body">
                <span class="news-date">📅 17/07/2026</span>
                <h3>
                  <nuxt-link to="/ban-tin/da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan">
                    ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN
                  </nuxt-link>
                </h3>
                <p>
                  Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026...
                </p>
                <nuxt-link to="/ban-tin/da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan" class="read-more-link">
                  Đọc tiếp bài viết &rarr;
                </nuxt-link>
              </div>
            </div>

            <div class="news-row-grid">
              <div class="news-card-inline">
                <img src="/assets/news_quangninh.jpg" alt="Vân đồn việc làm" />
                <div class="card-inline-body">
                  <span class="news-date">📅 17/07/2026</span>
                  <h4>
                    <nuxt-link to="/ban-tin/quang-ninh-van-don-ho-tro-viec-lam">
                      QUẢNG NINH: Hỗ trợ việc làm tại Vân Đồn cho người chấp hành xong án phạt
                    </nuxt-link>
                  </h4>
                </div>
              </div>
              <div class="news-card-inline">
                <img src="/assets/news_lamdong.jpg" alt="Lâm đồng đặc xá" />
                <div class="card-inline-body">
                  <span class="news-date">📅 17/07/2026</span>
                  <h4>
                    <nuxt-link to="/ban-tin/lam-dong-tham-hoi-tang-qua-dac-xa">
                      LÂM ĐỒNG: Thăm hỏi, tặng quà, động viên người được đặc xá khó khăn
                    </nuxt-link>
                  </h4>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Cột Phải: Tin Thịnh Hành / Xem Nhiều Nhất (Trending/Most Read) -->
        <div class="trending-news-wrap">
          <div class="section-title-wrap">
            <h2 class="section-title">Tin Thịnh Hành</h2>
          </div>
          
          <div class="trending-list">
            <div v-for="(item, index) in trendingNews" :key="item.id" class="trending-item">
              <span class="trend-number">{{ '0' + (index + 1) }}</span>
              <div class="trend-body">
                <span class="trend-cat">{{ item.category }}</span>
                <h4><nuxt-link :to="item.link">{{ item.title }}</nuxt-link></h4>
                <span class="trend-views">🔥 {{ item.views }} lượt xem</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Parallax quote Block (Thiết kế đan xen) -->
    <section class="quote-parallax-section">
      <div class="parallax-overlay"></div>
      <div class="container quote-container">
        <blockquote>
          "Mỗi con người lầm lỡ đều xứng đáng có một cơ hội thứ hai để hướng thiện. Sự chung tay, đồng hành của gia đình và toàn xã hội chính là ánh dương thắp sáng nẻo về lương thiện."
        </blockquote>
        <cite>— Đề án Tái hòa nhập cộng đồng, C11 Bộ Công an</cite>
      </div>
    </section>

    <!-- Role Models Section (Tấm gương tiêu biểu) -->
    <section class="section section-bg">
      <div class="container">
        <div class="section-header-center">
          <span class="sub-title">Hành trình hướng thiện</span>
          <h2 class="section-title-center">Tấm Gương Sáng Điển Hình</h2>
          <p class="section-desc-center">Những câu chuyện nghị lực phi thường vượt qua lầm lỡ, xây dựng cuộc sống ấm no và giúp đỡ đồng đội</p>
        </div>

        <div class="role-models-list">
          <div class="role-card">
            <div class="role-avatar-wrap">
              <img src="/assets/guong_sang_1.jpg" alt="Nguyễn Văn A" />
            </div>
            <div class="role-info">
              <span class="role-location">📍 TP. Đà Nẵng</span>
              <h3>Anh Nguyễn Văn A</h3>
              <p class="role-desc">
                Từng chấp hành án phạt tù 5 năm, anh A trở về lập nghiệp từ hai bàn tay trắng. Được chính quyền hỗ trợ vay vốn 100 triệu, anh mở xưởng sản xuất đồ gỗ mỹ nghệ lớn, tạo việc làm ổn định cho 15 lao động cùng hoàn cảnh tại địa bàn.
              </p>
              <nuxt-link to="/tamguongtieubieu/nguyen-van-a" class="role-link">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>

          <div class="role-card">
            <div class="role-avatar-wrap">
              <img src="/assets/guong_sang_2.jpg" alt="Trần Thị B" />
            </div>
            <div class="role-info">
              <span class="role-location">📍 Tỉnh Quảng Ninh</span>
              <h3>Chị Trần Thị B</h3>
              <p class="role-desc">
                Vượt qua định kiến và mặc cảm ban đầu, chị B kiên trì tham gia các lớp đào tạo may mặc miễn phí do Hội Phụ nữ tổ chức. Đến nay chị đã làm chủ xưởng may gia công xuất khẩu lớn, trực tiếp nâng bước các chị em hoàn lương khác.
              </p>
              <nuxt-link to="/tamguongtieubieu/tran-thi-b" class="role-link">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Reintegration Models Section (Mô hình kinh tế) -->
    <section class="section">
      <div class="container">
        <div class="section-header-center">
          <span class="sub-title">Mô hình hỗ trợ</span>
          <h2 class="section-title-center">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
          <p class="section-desc-center">Hệ thống giải pháp và cơ sở hỗ trợ sinh kế bền vững do Nhà nước và các địa phương tổ chức</p>
        </div>

        <div class="models-grid">
          <div class="model-card">
            <div class="model-icon-wrap">💰</div>
            <h3>Quỹ Tín dụng vay vốn</h3>
            <p>Hỗ trợ vay vốn sản xuất kinh doanh ưu đãi lên tới 100 triệu đồng theo Quyết định 22/2023/QĐ-TTg của Thủ tướng Chính phủ.</p>
            <nuxt-link to="/mohinhtaihoanhap/quy-tin-dung-hoan-luong" class="model-link">Tìm hiểu &rarr;</nuxt-link>
          </div>

          <div class="model-card">
            <div class="model-icon-wrap">🌳</div>
            <h3>CLB Hòa Nhập Xanh</h3>
            <p>Nơi sinh hoạt cộng đồng sẻ chia kinh nghiệm, trang bị kỹ năng sống và phổ biến kiến thức pháp luật bổ ích cho người hoàn lương.</p>
            <nuxt-link to="/mohinhtaihoanhap/cau-lac-bo-hoa-nhap-xanh" class="model-link">Tìm hiểu &rarr;</nuxt-link>
          </div>

          <div class="model-card">
            <div class="model-icon-wrap">🛠</div>
            <h3>Đào tạo nghề nhân văn</h3>
            <p>Tổ chức liên kết dạy nghề mộc, may mặc, cơ khí cắt gọt hoàn toàn miễn phí và giới thiệu bao tiêu đầu ra việc làm ổn định.</p>
            <nuxt-link to="/mohinhtaihoanhap/lien-ket-dao-tao-nghe-nhan-van" class="model-link">Tìm hiểu &rarr;</nuxt-link>
          </div>
        </div>
      </div>
    </section>

    <!-- Official Documents Section (Mục văn bản mới) -->
    <section class="section section-bg">
      <div class="container documents-split-grid">
        <div class="docs-info-col">
          <h2 class="section-title">Văn Bản Pháp Quy Mới</h2>
          <p>Cập nhật liên tục các quyết định chỉ đạo của Thủ tướng Chính phủ, các thông tư chỉ thị của Bộ Công an về công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng.</p>
          <nuxt-link to="/van-ban" class="btn btn-primary">Tra cứu thư viện văn bản</nuxt-link>
        </div>
        <div class="docs-list-col">
          <div v-for="doc in latestDocs" :key="doc.id" class="doc-card-mini">
            <span class="doc-number">📄</span>
            <div class="doc-body">
              <span class="doc-meta">{{ doc.number }} • {{ doc.date }}</span>
              <h4>{{ doc.title }}</h4>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Video Section -->
    <section class="section">
      <div class="container video-grid">
        <div class="video-main-col">
          <div class="section-title-wrap">
            <h2 class="section-title">Thư Viện Video</h2>
          </div>
          <div class="video-wrapper">
            <div class="video-placeholder">
              <img src="/assets/hero_banner.jpg" alt="Video thumbnail" />
              <div class="play-overlay">
                <span class="play-icon">▶</span>
              </div>
            </div>
            <h3 class="video-title">Phim tài liệu: Đường về hướng thiện - Nâng bước cuộc sống mới</h3>
          </div>
        </div>
        
        <div class="video-playlist-col">
          <div class="section-title-wrap">
            <h2 class="section-title">Playlist nổi bật</h2>
          </div>
          <div class="playlist-list">
            <div v-for="v in videos" :key="v.id" class="playlist-item">
              <div class="playlist-thumb">
                <span class="play-small">▶</span>
              </div>
              <div class="playlist-info">
                <h4>{{ v.title }}</h4>
                <span>{{ v.duration }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Support Form Section -->
    <section class="section section-bg" id="tro-giup">
      <div class="container form-container">
        <div class="form-grid">
          <div class="form-info-side">
            <h2>Đăng Ký Nhận Hỗ Trợ Tái Hòa Nhập</h2>
            <p>Nếu bạn hoặc người thân chấp hành xong án phạt tù có nhu cầu vay vốn chính sách, tư vấn hỗ trợ tâm lý, hướng nghiệp học nghề hoặc xóa án tích, hãy gửi thông tin cho chúng tôi. Các cán bộ chuyên môn sẽ liên hệ tư vấn trong vòng 24 giờ.</p>
            <div class="contact-methods">
              <div class="method-item">📞 <span>Hotline hỗ trợ: <strong>0903.480.985</strong></span></div>
              <div class="method-item">✉ <span>Email: <strong>contact@conduonghuongthien.com.vn</strong></span></div>
            </div>
          </div>
          <div class="form-inputs-side">
            <form @submit.prevent="submitForm" class="support-form">
              <div class="form-group">
                <label>Họ và tên người cần hỗ trợ *</label>
                <input type="text" v-model="form.name" required placeholder="Nhập họ và tên..." />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Số điện thoại liên hệ *</label>
                  <input type="tel" v-model="form.phone" required placeholder="Nhập số điện thoại..." />
                </div>
                <div class="form-group">
                  <label>Tỉnh / Thành phố *</label>
                  <input type="text" v-model="form.city" required placeholder="Ví dụ: Đà Nẵng, Quảng Ninh..." />
                </div>
              </div>
              <div class="form-group">
                <label>Nội dung cần hỗ trợ (Vay vốn, Việc làm, Pháp lý...) *</label>
                <textarea rows="4" v-model="form.message" required placeholder="Mô tả cụ thể nguyện vọng của bạn..."></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-block btn-lg">Gửi thông tin đăng ký</button>
            </form>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'

const trendingNews = [
  { id: 1, category: 'Tin nổi bật', title: 'CẦN THƠ: Hỗ trợ vay vốn 100 triệu đồng theo Quyết định 22 cho người hoàn lương', link: '/ban-tin/can-tho-diem-tua-tin-dung-cho-nguoi-hoan-luong-tai-hoa-nhap', views: '2.540' },
  { id: 2, category: 'Tin hoạt động', title: 'QUẢNG NINH: Sàn giao dịch việc làm Vân Đồn tiếp nhận hàng trăm lao động hoàn lương', link: '/ban-tin/quang-ninh-van-don-ho-tro-viec-lam', views: '1.985' },
  { id: 3, category: 'Tin nổi bật', title: 'ĐÀ NẴNG: Cuộc đối thoại nhân văn giữa Giám thị trại giam và các phạm nhân cải tạo', link: '/ban-tin/da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan', views: '1.742' },
  { id: 4, category: 'Tin địa phương', title: 'Công an phường Hồng Quang triển khai lập danh sách các hộ có nhu cầu vay vốn chính sách', link: '/ban-tin', views: '1.204' }
]

const latestDocs = [
  { id: 1, number: 'Quyết định số 22/2023/QĐ-TTg', date: '17/08/2026', title: 'Quyết định của Thủ tướng Chính phủ về chính sách tín dụng đối với người chấp hành xong án phạt tù.' },
  { id: 2, number: 'Nghị định số 49/2020/NĐ-CP', date: '16/08/2026', title: 'Quy định chi tiết Luật Thi hành án hình sự về các biện pháp bảo đảm tái hòa nhập cộng đồng.' },
  { id: 3, number: 'Chỉ thị số 05/CT-BCA', date: '15/08/2026', title: 'Chỉ thị của Bộ trưởng Bộ Công an về việc nâng cao hiệu quả công tác cảm hóa, giáo dục thi hành án hình sự tại cộng đồng.' }
]

const videos = [
  { id: 1, title: 'Hành trình hoàn lương - Kết nối yêu thương tại Đà Nẵng', duration: '08:24' },
  { id: 2, title: 'Ngày hội việc làm nhân đạo kết nối doanh nghiệp', duration: '12:45' },
  { id: 3, title: 'Phóng sự: Nguồn lực vay vốn thắp sáng nẻo thiện', duration: '06:18' }
]

const form = reactive({
  name: '',
  phone: '',
  city: '',
  message: ''
})

const submitForm = () => {
  alert(`Cảm ơn anh/chị ${form.name}. Đơn đăng ký hỗ trợ tại ${form.city} đã được gửi thành công đến cơ quan chuyên môn!`)
  form.name = ''
  form.phone = ''
  form.city = ''
  form.message = ''
}
</script>

<style scoped>
/* Hero Section */
.hero-section {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 240px 0 260px 0;
  color: white;
}

.hero-bg-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(135deg, rgba(45, 74, 45, 0.92) 0%, rgba(124, 179, 66, 0.4) 100%);
}

.hero-container {
  position: relative;
  z-index: 2;
}

.hero-content {
  max-width: 850px;
}

.hero-badge {
  background-color: var(--secondary);
  color: white;
  padding: 8px 18px;
  font-size: 0.85rem;
  font-weight: 800;
  border-radius: 4px;
  text-transform: uppercase;
  display: inline-block;
  margin-bottom: 24px;
  letter-spacing: 0.5px;
}

.hero-title {
  font-size: 4.2rem;
  font-weight: 800;
  line-height: 1.25;
  margin-bottom: 20px;
  letter-spacing: -0.5px;
}

.hero-subtitle {
  font-size: 1.45rem;
  line-height: 1.6;
  opacity: 0.95;
  margin-bottom: 36px;
}

.hero-actions {
  display: flex;
  gap: 16px;
}

/* Pulse Animation Effect */
.pulse-effect {
  animation: buttonPulse 2s infinite;
}

@keyframes buttonPulse {
  0% { box-shadow: 0 0 0 0 rgba(124, 179, 66, 0.7); }
  70% { box-shadow: 0 0 0 10px rgba(124, 179, 66, 0); }
  100% { box-shadow: 0 0 0 0 rgba(124, 179, 66, 0); }
}

/* Statistics Bar */
.stats-section {
  position: relative;
  margin-top: -80px;
  z-index: 10;
  padding: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(10px);
  border-radius: var(--radius-md);
  padding: 30px 20px;
  box-shadow: 0 15px 35px rgba(74, 103, 65, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
  position: relative;
  overflow: hidden;
}

.stat-card::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 4px;
  background-color: var(--secondary);
  border-radius: 2px;
  transition: var(--transition);
}

.stat-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 20px 45px rgba(74, 103, 65, 0.15);
  border-color: rgba(124, 179, 66, 0.3);
}

.stat-card:hover::after {
  width: 50%;
}

.stat-icon-wrapper {
  width: 56px;
  height: 56px;
  background-color: rgba(74, 103, 65, 0.06);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--transition);
}

.stat-card:hover .stat-icon-wrapper {
  background-color: var(--secondary);
}

.stat-icon-svg {
  font-size: 1.6rem;
  transition: var(--transition);
}

.stat-card:hover .stat-icon-svg {
  transform: scale(1.1);
}

.stat-number {
  font-size: 2rem;
  font-weight: 850;
  color: var(--primary-dark);
  line-height: 1.2;
  margin-bottom: 6px;
}

.stat-label {
  font-size: 0.85rem;
  color: var(--text-medium);
  font-weight: 600;
  line-height: 1.4;
}

/* Split News Section (Latest vs Trending) */
.split-news-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 40px;
}

.section-title-wrap {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 12px;
}

.view-all-link {
  font-size: 0.88rem;
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
}

.view-all-link:hover {
  color: var(--primary);
}

.featured-news-main {
  background-color: var(--white);
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  margin-bottom: 24px;
  transition: var(--transition);
}

.featured-news-main:hover {
  box-shadow: var(--shadow-md);
}

.main-news-img {
  height: 320px;
  position: relative;
  overflow: hidden;
}

.main-news-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.news-badge-cat {
  position: absolute;
  top: 16px;
  left: 16px;
  background-color: var(--primary);
  color: white;
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 4px;
}

.main-news-body {
  padding: 24px;
}

.news-date {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 600;
  display: block;
  margin-bottom: 8px;
}

.main-news-body h3 {
  font-size: 1.3rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.main-news-body h3 a {
  color: var(--text-dark);
  text-decoration: none;
  transition: var(--transition);
}

.main-news-body h3 a:hover {
  color: var(--primary);
}

.main-news-body p {
  font-size: 0.95rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin-bottom: 16px;
}

.news-row-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.news-card-inline {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  gap: 16px;
  align-items: center;
  transition: var(--transition);
}

.news-card-inline:hover {
  border-color: var(--secondary);
}

.news-card-inline img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.card-inline-body h4 {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.3;
}

.card-inline-body h4 a {
  color: var(--text-dark);
  text-decoration: none;
}

/* Trending Column */
.trending-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.trending-item {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.trend-number {
  font-size: 2.2rem;
  font-weight: 900;
  color: var(--secondary);
  opacity: 0.4;
  line-height: 1;
}

.trend-cat {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  display: block;
  margin-bottom: 4px;
}

.trend-body h4 {
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 6px;
}

.trend-body h4 a {
  color: var(--text-dark);
  text-decoration: none;
}

.trend-body h4 a:hover {
  color: var(--primary);
}

.trend-views {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Parallax Quote Section */
.quote-parallax-section {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat fixed;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.parallax-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(45, 74, 45, 0.85);
}

.quote-container {
  position: relative;
  z-index: 2;
  max-width: 800px;
  margin: 0 auto;
}

.quote-container blockquote {
  font-size: 1.6rem;
  font-weight: 600;
  line-height: 1.5;
  font-style: italic;
  margin-bottom: 24px;
}

.quote-container cite {
  font-size: 0.95rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* Center Section Headers */
.section-header-center {
  text-align: center;
  max-width: 600px;
  margin: 0 auto 50px auto;
}

.sub-title {
  font-size: 0.8rem;
  font-weight: 800;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  display: block;
  margin-bottom: 8px;
}

.section-title-center {
  font-size: 2.2rem;
  font-weight: 800;
  color: var(--text-dark);
  margin-bottom: 12px;
}

.section-desc-center {
  font-size: 0.95rem;
  color: var(--text-medium);
  line-height: 1.5;
}

/* Role Models List */
.role-models-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 30px;
}

.role-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 30px;
  box-shadow: var(--shadow-sm);
  display: flex;
  gap: 24px;
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.role-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.role-avatar-wrap {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid var(--bg-light);
  flex-shrink: 0;
}

.role-avatar-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.role-location {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary);
  background-color: var(--bg-light);
  padding: 3px 8px;
  border-radius: 4px;
  display: inline-block;
  margin-bottom: 8px;
}

.role-info h3 {
  font-size: 1.15rem;
  font-weight: 800;
  margin-bottom: 10px;
}

.role-desc {
  font-size: 0.88rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin-bottom: 14px;
}

.role-link {
  font-size: 0.85rem;
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
}

/* Models Grid */
.models-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px;
}

.model-card {
  background-color: var(--white);
  border-radius: var(--radius-md);
  padding: 40px 30px;
  text-align: center;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: var(--transition);
}

.model-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.model-icon-wrap {
  font-size: 3rem;
  margin-bottom: 20px;
}

.model-card h3 {
  font-size: 1.2rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.model-card p {
  font-size: 0.9rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin-bottom: 20px;
}

.model-link {
  font-size: 0.88rem;
  color: var(--secondary);
  font-weight: 700;
  text-decoration: none;
}

/* Documents Split Grid */
.documents-split-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: center;
}

.docs-info-col h2 {
  font-size: 2.2rem;
  font-weight: 800;
  margin-bottom: 16px;
}

.docs-info-col p {
  color: var(--text-medium);
  margin-bottom: 24px;
  line-height: 1.6;
}

.docs-list-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.doc-card-mini {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  transition: var(--transition);
}

.doc-card-mini:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-sm);
}

.doc-number {
  font-size: 1.5rem;
}

.doc-meta {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--primary);
  display: block;
  margin-bottom: 4px;
}

.doc-body h4 {
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.4;
}

/* Video Grid */
.video-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 40px;
}

.video-wrapper {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 16px;
}

.video-placeholder {
  position: relative;
  height: 340px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
}

.video-placeholder img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.play-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-icon {
  font-size: 3rem;
  color: white;
  background-color: var(--primary);
  width: 70px;
  height: 70px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 5px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  transition: var(--transition);
}

.video-placeholder:hover .play-icon {
  transform: scale(1.1);
  background-color: var(--secondary);
}

.video-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin-top: 14px;
}

.video-playlist-col {
  display: flex;
  flex-direction: column;
}

.playlist-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.playlist-item {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 12px;
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition);
}

.playlist-item:hover {
  border-color: var(--secondary);
  background-color: var(--bg-light);
}

.playlist-thumb {
  width: 80px;
  height: 50px;
  background-color: var(--primary-dark);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.play-small {
  color: white;
  font-size: 0.8rem;
}

.playlist-info h4 {
  font-size: 0.85rem;
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 4px;
}

.playlist-info span {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Support Form Section */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 50px;
  align-items: center;
}

.form-info-side h2 {
  font-size: 2.2rem;
  font-weight: 800;
  margin-bottom: 16px;
}

.form-info-side p {
  color: var(--text-medium);
  line-height: 1.6;
  margin-bottom: 30px;
}

.contact-methods {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.method-item {
  font-size: 0.95rem;
  color: var(--text-medium);
}

.support-form {
  background-color: var(--white);
  padding: 40px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
}

.form-group {
  margin-bottom: 20px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-dark);
  display: block;
  margin-bottom: 6px;
}

.form-group input, .form-group textarea {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  transition: var(--transition);
}

.form-group input:focus, .form-group textarea:focus {
  border-color: var(--primary);
}

/* Tablet & Mobile responsive */
@media (max-width: 1024px) {
  .split-news-grid, .documents-split-grid, .video-grid, .form-grid {
    grid-template-columns: 1fr;
  }
  .role-models-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .models-grid {
    grid-template-columns: 1fr;
  }
  .news-row-grid {
    grid-template-columns: 1fr;
  }
  .hero-title {
    font-size: 2.2rem;
  }
  .hero-subtitle {
    font-size: 1rem;
  }
}
</style>
