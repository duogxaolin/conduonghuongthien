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

    <!-- Statistics Section -->
    <section class="stats-section">
      <div class="container stats-grid">
        <div class="stat-card">
          <span class="stat-number">63</span>
          <span class="stat-label">Tỉnh / Thành phố đồng hành</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">10.000+</span>
          <span class="stat-label">Người hoàn lương được hỗ trợ</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">500+</span>
          <span class="stat-label">Mô hình kinh tế tiêu biểu</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">24/7</span>
          <span class="stat-label">Tư vấn pháp lý & Tâm lý miễn phí</span>
        </div>
      </div>
    </section>

    <!-- Latest & Trending Split News Section (Section Mới đan xen cực đẹp) -->
    <section class="section split-news-section">
    <!-- BCA Style News Section -->
    <section class="section bca-news-section">
      <div class="container bca-news-grid">
        <!-- Cột Trái: Tin nổi bật & Tin tiêu điểm (2/3 chiều rộng) -->
        <div class="bca-news-left-col">
          <div class="bca-title-wrap">
            <h2 class="bca-section-title">Tin nổi bật</h2>
            <nuxt-link to="/ban-tin" class="bca-view-all">TẤT CẢ TIN TỨC &rarr;</nuxt-link>
          </div>
          
          <!-- Tin tiêu điểm chính (Overlay text trên ảnh lớn) -->
          <div class="bca-main-featured">
            <nuxt-link to="/ban-tin/da-nang-hoi-nghi-doi-thoai-giam-thi-pham-nhan" class="bca-featured-link">
              <div class="bca-featured-img-wrap">
                <img src="/assets/news_danang.jpg" alt="Đại hội Đà Nẵng" />
                <div class="bca-featured-overlay"></div>
                <div class="bca-featured-info">
                  <span class="bca-badge-cat">TIN NỔI BẬT</span>
                  <span class="bca-date">📅 17/07/2026</span>
                  <h3 class="bca-featured-title">ĐÀ NẴNG: HỘI NGHỊ ĐỐI THOẠI GIỮA GIÁM THỊ VỚI PHẠM NHÂN</h3>
                  <p class="bca-featured-excerpt">Chiều ngày 16/7/2026, Trại Tạm giam số 1 Công an thành phố Đà Nẵng tổ chức Hội nghị đối thoại giữa Giám thị Trại với phạm nhân đang chấp hành án phạt tù lần thứ I năm 2026 nhằm nâng cao chất lượng giáo dục, cải tạo...</p>
                </div>
              </div>
            </nuxt-link>
          </div>

          <!-- 2 tin phụ nằm ngang bên dưới -->
          <div class="bca-sub-grid">
            <div class="bca-sub-card">
              <nuxt-link to="/ban-tin/quang-ninh-van-don-ho-tro-viec-lam" class="bca-card-img-link">
                <img src="/assets/news_quangninh.jpg" alt="Vân đồn việc làm" />
              </nuxt-link>
              <div class="bca-card-content">
                <span class="bca-sub-date">17/07/2026</span>
                <h4>
                  <nuxt-link to="/ban-tin/quang-ninh-van-don-ho-tro-viec-lam">
                    QUẢNG NINH: Hỗ trợ việc làm tại Vân Đồn cho người chấp hành xong án phạt
                  </nuxt-link>
                </h4>
              </div>
            </div>
            
            <div class="bca-sub-card">
              <nuxt-link to="/ban-tin/lam-dong-tham-hoi-tang-qua-dac-xa" class="bca-card-img-link">
                <img src="/assets/news_lamdong.jpg" alt="Lâm đồng đặc xá" />
              </nuxt-link>
              <div class="bca-card-content">
                <span class="bca-sub-date">17/07/2026</span>
                <h4>
                  <nuxt-link to="/ban-tin/lam-dong-tham-hoi-tang-qua-dac-xa">
                    LÂM ĐỒNG: Thăm hỏi, tặng quà, động viên người được đặc xá khó khăn
                  </nuxt-link>
                </h4>
              </div>
            </div>
          </div>
        </div>

        <!-- Cột Phải: Hoạt động & Chỉ đạo (1/3 chiều rộng) -->
        <div class="bca-news-right-col">
          <div class="bca-title-wrap">
            <h2 class="bca-section-title">Chỉ đạo & Hoạt động</h2>
          </div>
          
          <div class="bca-text-list">
            <div v-for="item in trendingNews" :key="item.id" class="bca-text-item">
              <div class="bca-text-bullet"></div>
              <div class="bca-text-body">
                <h4>
                  <nuxt-link :to="item.link">{{ item.title }}</nuxt-link>
                </h4>
                <span class="bca-text-date">📅 Cập nhật: {{ item.id === 1 ? '17/07' : '16/07' }}/2026</span>
              </div>
            </div>
          </div>

          <!-- Banner phụ chuyên mục Bộ Công an -->
          <div class="bca-side-banner">
            <div class="bca-side-banner-overlay"></div>
            <div class="bca-side-banner-content">
              <h3>Hotline Cảnh Sát QLHC</h3>
              <p>Hỗ trợ giải đáp thủ tục cấp CCCD & Lý lịch tư pháp cho người hoàn lương</p>
              <span class="bca-side-phone">📞 1900.0368</span>
            </div>
          </div>
        </div>
      </div>
    </section>
    </section>

    </section>

    <!-- Sub News Columns (Tuyên truyền cảnh báo & Tin địa phương) -->
    <section class="section section-bg bca-sub-news-columns">
      <div class="container bca-sub-news-grid">
        <!-- Cột Trái: Cảnh báo & Tuyên truyền -->
        <div class="bca-warning-col">
          <div class="bca-title-wrap">
            <h2 class="bca-section-title">Cảnh báo & Tuyên truyền</h2>
          </div>
          <div class="bca-warning-list">
            <div v-for="item in legalWarningNews" :key="item.id" class="bca-warning-card">
              <div class="bca-warning-card-body">
                <span class="bca-warning-date">📅 {{ item.date }}</span>
                <h4><nuxt-link :to="item.link">{{ item.title }}</nuxt-link></h4>
                <p>{{ item.excerpt }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Cột Phải: Tin Công an địa phương -->
        <div class="bca-local-col">
          <div class="bca-title-wrap">
            <h2 class="bca-section-title">Tin Công an địa phương</h2>
          </div>
          <div class="bca-local-list">
            <div v-for="item in localPoliceNews" :key="item.id" class="bca-local-item">
              <span class="bca-local-item-date">[{{ item.date.slice(0,5) }}]</span>
              <nuxt-link :to="item.link" class="bca-local-item-title">{{ item.title }}</nuxt-link>
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

          <div class="role-card">
            <div class="role-avatar-wrap">
              <img src="/assets/guong_sang_1.jpg" alt="Lê Văn C" />
            </div>
            <div class="role-info">
              <span class="role-location">📍 Tỉnh Đồng Nai</span>
              <h3>Anh Lê Văn C</h3>
              <p class="role-desc">
                Trở về địa phương với nhiều mặc cảm, anh C được Công an xã định hướng làm kinh tế trang trại. Nhờ áp dụng khoa học kỹ thuật và sự kiên trì, mô hình vườn-ao-chuồng của anh hiện đạt doanh thu hàng trăm triệu mỗi năm, giúp đỡ 5 người có hoàn cảnh tương tự làm việc.
              </p>
              <nuxt-link to="/tamguongtieubieu" class="role-link">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
            </div>
          </div>

          <div class="role-card">
            <div class="role-avatar-wrap">
              <img src="/assets/guong_sang_2.jpg" alt="Phạm Thị D" />
            </div>
            <div class="role-info">
              <span class="role-location">📍 TP. Hải Phòng</span>
              <h3>Chị Phạm Thị D</h3>
              <p class="role-desc">
                Chị D tập trung học nghề thêu dệt mỹ nghệ tại lớp đào tạo do Hội phụ nữ tổ chức. Với đôi tay khéo léo và óc kinh doanh nhạy bén, chị đã thành lập Hợp tác xã dệt may nghệ thuật, tạo sinh kế bền vững cho hàng chục phụ nữ lầm lỡ tái hòa nhập.
              </p>
              <nuxt-link to="/tamguongtieubieu" class="role-link">Đọc câu chuyện hoàn lương &rarr;</nuxt-link>
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

    <!-- Photo Gallery Section -->
    <section class="section section-bg" id="photo-library">
      <div class="container">
        <div class="section-header-center">
          <span class="sub-title">Hình ảnh thực tế</span>
          <h2 class="section-title-center">Thư Viện Ảnh Hoạt Động</h2>
          <p class="section-desc-center">Ghi nhận những khoảnh khắc hỗ trợ, kết nối doanh nghiệp và sinh hoạt cộng đồng tái hòa nhập</p>
        </div>
        
        <div class="gallery-grid">
          <div class="gallery-item">
            <img src="/assets/news_danang.jpg" alt="Đối thoại phạm nhân Đà Nẵng" />
            <div class="gallery-info">
              <h4>Hội nghị đối thoại cùng phạm nhân</h4>
              <span>Trại tạm giam Đà Nẵng</span>
            </div>
          </div>
          <div class="gallery-item">
            <img src="/assets/news_quangninh.jpg" alt="Hỗ trợ việc làm Vân Đồn" />
            <div class="gallery-info">
              <h4>Tư vấn học nghề và việc làm</h4>
              <span>Sàn GDVL Vân Đồn, Quảng Ninh</span>
            </div>
          </div>
          <div class="gallery-item">
            <img src="/assets/news_lamdong.jpg" alt="Động viên đặc xá Lâm Đồng" />
            <div class="gallery-info">
              <h4>Tặng quà động viên người hoàn lương</h4>
              <span>Ban chỉ đạo đặc xá Lâm Đồng</span>
            </div>
          </div>
          <div class="gallery-item">
            <img src="/assets/hero_banner.jpg" alt="Nẻo về hướng thiện" />
            <div class="gallery-info">
              <h4>Không gian sinh hoạt cộng đồng</h4>
              <span>CLB Hòa Nhập Xanh, Bắc Ninh</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Legal FAQ Section -->
    <section class="section">
      <div class="container faq-container-width">
        <div class="section-header-center">
          <span class="sub-title">Giải đáp nhanh</span>
          <h2 class="section-title-center">Hỏi Đáp Pháp Luật Thường Gặp</h2>
          <p class="section-desc-center">Các câu hỏi pháp lý cốt lõi về thủ tục xóa án tích, điều kiện hỗ trợ vay vốn đã được C11 kiểm duyệt</p>
        </div>
        
        <div class="faq-accordion-list">
          <div 
            v-for="(faq, index) in localFaqList" 
            :key="index" 
            class="faq-accordion-item"
            :class="{ 'is-active': activeFaqIndex === index }"
          >
            <button class="faq-accordion-question" @click="toggleFaqIndex(index)">
              <span>{{ faq.question }}</span>
              <span class="faq-icon-arrow">{{ activeFaqIndex === index ? '▲' : '▼' }}</span>
            </button>
            <div class="faq-accordion-answer" v-if="activeFaqIndex === index">
              <p>{{ faq.answer }}</p>
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

    <!-- Useful Links Section (Partner Banners) -->
    <section class="section useful-links-section">
      <div class="container">
        <div class="section-header-center">
          <span class="sub-title">Liên kết Cổng thông tin</span>
          <h2 class="section-title-center">Liên Kết Hữu Ích</h2>
        </div>
        
        <div class="links-carousel-grid">
          <a href="https://bocongan.gov.vn" target="_blank" class="link-partner-card">
            <div class="partner-logo-box">🏛</div>
            <span>Bộ Công an</span>
          </a>
          <a href="https://dichvucong.gov.vn" target="_blank" class="link-partner-card">
            <div class="partner-logo-box">💻</div>
            <span>Cổng Dịch vụ công Quốc gia</span>
          </a>
          <a href="https://vbsp.org.vn" target="_blank" class="link-partner-card">
            <div class="partner-logo-box">🏦</div>
            <span>NH Chính sách Xã hội</span>
          </a>
          <a href="https://molisa.gov.vn" target="_blank" class="link-partner-card">
            <div class="partner-logo-box">⚖</div>
            <span>Bộ Lao động - TB&XH</span>
          </a>
          <a href="https://cand.com.vn" target="_blank" class="link-partner-card">
            <div class="partner-logo-box">📰</div>
            <span>Báo Công an Nhân dân</span>
          </a>
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

const localPoliceNews = [
  { id: 1, date: '17/07/2026', title: 'BẮC NINH: Công an huyện Tiên Du giúp đỡ 12 người hoàn lương làm thủ tục cấp Căn cước công dân và đăng ký tạm trú', link: '/ban-tin' },
  { id: 2, date: '16/07/2026', title: 'HÀ NỘI: Công an quận Cầu Giấy phối hợp với các doanh nghiệp trên địa bàn tổ chức ngày hội định nghiệp quý II', link: '/ban-tin' },
  { id: 3, date: '15/07/2026', title: 'TP. HỒ CHÍ MINH: Công an thành phố Thủ Đức trao tặng 20 xe máy hỗ trợ sinh kế cho cá nhân chấp hành xong án phạt tù', link: '/ban-tin' },
  { id: 4, date: '14/07/2026', title: 'THANH HÓA: Phổ biến chính sách vay vốn Ngân hàng Chính sách Xã hội theo Quyết định 22 cho hơn 120 hộ gia đình', link: '/ban-tin' },
  { id: 5, date: '12/07/2026', title: 'ĐỒNG NAI: Khen thưởng các gương doanh nghiệp điển hình tiếp nhận và cảm hóa người lao động hoàn lương', link: '/ban-tin' }
]

const legalWarningNews = [
  { id: 1, date: '16/07/2026', title: 'CẢNH BÁO: Cảnh giác với các thủ đoạn lừa đảo qua mạng xã hội hứa hẹn xóa án tích nhanh lấy phí cao', link: '/ban-tin', excerpt: 'Công an C11 khuyến cáo người dân không tin vào các dịch vụ mập mờ trên mạng xã hội cam kết làm dịch vụ lý lịch tư pháp sạch lấy phí khẩn cấp...' },
  { id: 2, date: '15/07/2026', title: 'TUYÊN TRUYỀN: Quy định mới về mức hỗ trợ tiền ăn và tiền đi lại cho người hoàn lương học nghề từ ngày 01/08/2026', link: '/ban-tin', excerpt: 'Theo đề án sửa đổi mới nhất, mức chi phí hỗ trợ sinh hoạt hàng ngày cho người hoàn lương học nghề tại trung tâm tăng 25%...' },
  { id: 3, date: '14/07/2026', title: 'HƯỚNG DẪN: Các bước chuẩn bị hồ sơ xin cấp Phiếu lý lịch tư pháp số 2 trực tuyến trên cổng Dịch vụ công Quốc gia', link: '/ban-tin', excerpt: 'Hướng dẫn chi tiết quy trình nộp hồ sơ xin cấp phiếu số 2 qua Cổng dịch vụ công của Sở Tư pháp, giúp tiết kiệm thời gian và đi lại...' }
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

const localFaqList = [
  {
    question: "Điều kiện và thủ tục để người hoàn lương được xóa án tích đương nhiên?",
    answer: "Người chấp hành xong hình phạt chính (án tù) hoặc thời gian thử thách án treo, đã chấp hành xong các quyết định hình phạt bổ sung (án phí, bồi thường dân sự) và không thực hiện hành vi phạm tội mới trong thời hạn quy định của Bộ luật Hình sự (thông thường từ 1 đến 5 năm tùy mức độ tội danh). Khi đủ thời gian, đương sự làm hồ sơ xin cấp Phiếu lý lịch tư pháp số 2 tại Sở Tư pháp tỉnh/thành phố để xác nhận trạng thái xóa án tích."
  },
  {
    question: "Làm thế nào để tiếp cận nguồn vốn vay ưu đãi 100 triệu theo Quyết định 22/2023/QĐ-TTg?",
    answer: "Người chấp hành xong án phạt tù (trở về cư trú hợp pháp tại địa phương trong vòng 5 năm) cần làm đơn đề nghị có xác nhận của UBND cấp xã về việc chấp hành tốt pháp luật. Sau đó, hồ sơ được gửi qua tổ tiết kiệm và vay vốn (Hội Phụ nữ, Hội Nông dân, Đoàn Thanh niên...) để chuyển đến Ngân hàng Chính sách Xã hội quận/huyện thẩm định giải ngân tối đa 100 triệu đồng."
  },
  {
    question: "Các trường hợp người hoàn lương được miễn phí đào tạo nghề?",
    answer: "Theo Nghị định 49/2020/NĐ-CP, người chấp hành xong án phạt tù khi tham gia các lớp đào tạo nghề ngắn hạn (dưới 3 tháng) tại địa phương sẽ được hỗ trợ 100% chi phí học nghề và hỗ trợ tiền ăn, tiền đi lại theo chính sách hiện hành của từng địa phương."
  },
  {
    question: "Ai có trách nhiệm trực tiếp giúp đỡ người hoàn lương tại cơ sở?",
    answer: "Lực lượng Công an cấp xã/phường có trách nhiệm trực tiếp tham mưu cho UBND cấp xã lập hồ sơ quản lý, phối hợp cùng các tổ chức đoàn thể (Hội Cựu chiến binh, Hội phụ nữ, Đoàn thanh niên) phân công người trực tiếp cảm hóa, giáo dục và hướng dẫn làm các thủ tục giấy tờ công dân."
  }
]

const activeFaqIndex = ref(null)
const toggleFaqIndex = (index) => {
  activeFaqIndex.value = activeFaqIndex.value === index ? null : index
}
</script>

<style scoped>
/* Hero Section */
.hero-section {
  position: relative;
  background: url('/assets/hero_banner.jpg') center 65% / cover no-repeat;
  padding: 70px 0 110px 0;
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
  margin-top: -40px;
  z-index: 10;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.stat-card {
  background-color: var(--white);
  border-radius: var(--radius-sm);
  padding: 30px 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  border: 1px solid var(--border-color);
  text-align: center;
  transition: var(--transition);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.06);
}

.stat-number {
  font-size: 2.2rem;
  font-weight: 800;
  color: var(--primary);
  display: block;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 0.88rem;
  color: var(--text-medium);
  font-weight: 600;
  line-height: 1.4;
  display: block;
}

/* Split News Section - BCA Portal Style */
.bca-news-section {
  background-color: var(--white);
  padding: 60px 0;
}

.bca-news-grid {
  display: grid;
  grid-template-columns: 2.1fr 0.9fr;
  gap: 32px;
}

.bca-title-wrap {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  border-bottom: 2px solid #e0e6dd;
  padding-bottom: 8px;
  margin-bottom: 20px;
  position: relative;
}

.bca-section-title {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--primary-dark);
  text-transform: uppercase;
  margin: 0;
  position: relative;
  letter-spacing: 0.3px;
}

.bca-section-title::after {
  content: '';
  position: absolute;
  bottom: -10px;
  left: 0;
  width: 60px;
  height: 2px;
  background-color: var(--primary);
}

.bca-view-all {
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-medium);
  text-decoration: none;
  transition: var(--transition);
}

.bca-view-all:hover {
  color: var(--primary);
}

/* Main Featured Box (BCA style) */
.bca-main-featured {
  margin-bottom: 24px;
}

.bca-featured-link {
  display: block;
  text-decoration: none;
}

.bca-featured-img-wrap {
  position: relative;
  height: 420px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.bca-featured-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s cubic-bezier(0.165, 0.84, 0.44, 1);
}

.bca-featured-link:hover img {
  transform: scale(1.03);
}

.bca-featured-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60%;
  background: linear-gradient(to top, rgba(16, 28, 16, 0.95) 0%, rgba(16, 28, 16, 0.4) 60%, rgba(16, 28, 16, 0) 100%);
  z-index: 1;
}

.bca-featured-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 24px;
  color: white;
  z-index: 2;
}

.bca-badge-cat {
  background-color: var(--secondary);
  color: white;
  padding: 3px 8px;
  font-size: 0.65rem;
  font-weight: 800;
  border-radius: 2px;
  display: inline-block;
  margin-bottom: 8px;
}

.bca-date {
  font-size: 0.75rem;
  opacity: 0.85;
  margin-left: 12px;
}

.bca-featured-title {
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.3;
  margin: 6px 0 10px 0;
  color: white;
  transition: color 0.2s ease;
}

.bca-featured-link:hover .bca-featured-title {
  color: var(--secondary-light);
}

.bca-featured-excerpt {
  font-size: 0.88rem;
  line-height: 1.5;
  opacity: 0.88;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Secondary horizontally aligned cards */
.bca-sub-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.bca-sub-card {
  display: flex;
  gap: 16px;
  background-color: transparent;
  padding: 12px 0;
  border-top: 1px dashed var(--border-color);
}

.bca-card-img-link {
  width: 130px;
  height: 85px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.bca-card-img-link img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: var(--transition);
}

.bca-sub-card:hover .bca-card-img-link img {
  transform: scale(1.05);
}

.bca-card-content {
  display: flex;
  flex-direction: column;
}

.bca-sub-date {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 700;
  margin-bottom: 4px;
}

.bca-card-content h4 {
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.35;
  margin: 0;
}

.bca-card-content h4 a {
  color: var(--text-dark);
  text-decoration: none;
  transition: var(--transition);
}

.bca-card-content h4 a:hover {
  color: var(--primary);
}

/* Right side list (BCA signature style) */
.bca-text-list {
  display: flex;
  flex-direction: column;
}

.bca-text-item {
  display: flex;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-color);
}

.bca-text-item:last-child {
  border-bottom: none;
}

.bca-text-bullet {
  width: 6px;
  height: 6px;
  background-color: var(--primary);
  border-radius: 50%;
  margin-top: 8px;
  flex-shrink: 0;
}

.bca-text-body h4 {
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 6px 0;
}

.bca-text-body h4 a {
  color: var(--text-dark);
  text-decoration: none;
  transition: var(--transition);
}

.bca-text-body h4 a:hover {
  color: var(--primary);
}

.bca-text-date {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 600;
}

/* Side Banner */
.bca-side-banner {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  border-radius: var(--radius-sm);
  padding: 24px;
  color: white;
  margin-top: 24px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.bca-side-banner-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(74, 103, 65, 0.9);
  z-index: 1;
}

.bca-side-banner-content {
  position: relative;
  z-index: 2;
}

.bca-side-banner-content h3 {
  font-size: 1rem;
  font-weight: 800;
  margin-top: 0;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.bca-side-banner-content p {
  font-size: 0.78rem;
  line-height: 1.4;
  margin: 0 0 16px 0;
  opacity: 0.9;
}

.bca-side-phone {
  background-color: var(--secondary);
  color: white;
  padding: 6px 14px;
  font-size: 0.9rem;
  font-weight: 800;
  border-radius: 4px;
  display: inline-block;
}

/* Sub News Columns - Warning and Local News */
.bca-sub-news-columns {
  border-top: 1px solid var(--border-color);
  padding: 50px 0;
}

.bca-sub-news-grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 32px;
}

.bca-warning-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bca-warning-card {
  background-color: var(--white);
  border-left: 3px solid #d9534f; /* Cảnh báo màu đỏ */
  border-top: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  padding: 18px;
  border-radius: var(--radius-sm);
  transition: var(--transition);
}

.bca-warning-card:hover {
  box-shadow: var(--shadow-sm);
  border-left-color: var(--primary);
}

.bca-warning-date {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 700;
  display: block;
  margin-bottom: 6px;
}

.bca-warning-card h4 {
  font-size: 0.92rem;
  font-weight: 800;
  margin: 0 0 8px 0;
  line-height: 1.4;
}

.bca-warning-card h4 a {
  color: var(--text-dark);
  text-decoration: none;
  transition: var(--transition);
}

.bca-warning-card h4 a:hover {
  color: var(--primary);
}

.bca-warning-card p {
  font-size: 0.82rem;
  color: var(--text-medium);
  line-height: 1.5;
  margin: 0;
}

.bca-local-list {
  display: flex;
  flex-direction: column;
}

.bca-local-item {
  display: flex;
  padding: 12px 0;
  border-bottom: 1px dashed var(--border-color);
  font-size: 0.88rem;
  line-height: 1.4;
}

.bca-local-item:last-child {
  border-bottom: none;
}

.bca-local-item-date {
  color: var(--primary);
  font-weight: 750;
  margin-right: 8px;
  flex-shrink: 0;
}

.bca-local-item-title {
  color: var(--text-dark);
  text-decoration: none;
  font-weight: 700;
  transition: var(--transition);
}

.bca-local-item-title:hover {
  color: var(--primary);
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
    gap: 12px;
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
  .hero-badge {
    font-size: 0.72rem;
    padding: 6px 12px;
  }
  .hero-actions {
    flex-direction: column;
    gap: 12px;
  }
  .hero-actions .btn {
    text-align: center;
  }
  .quote-parallax-section {
    padding: 60px 0;
  }
  .quote-container blockquote {
    font-size: 1.1rem;
  }
  .role-card {
    flex-direction: column;
    text-align: center;
    padding: 24px;
  }
  .role-avatar-wrap {
    margin: 0 auto;
  }
  .section-title-center {
    font-size: 1.6rem;
  }
  .docs-info-col h2, .form-info-side h2 {
    font-size: 1.6rem;
  }
  .video-placeholder {
    height: 220px;
  }
  .main-news-img {
    height: 200px;
  }
}

@media (max-width: 480px) {
  .hero-section {
    padding: 40px 0 70px 0;
  }
  .hero-title {
    font-size: 1.7rem;
  }
  .hero-subtitle {
    font-size: 0.9rem;
    margin-bottom: 24px;
  }
  .hero-content {
    max-width: 100%;
  }
  .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .stat-card {
    padding: 20px 12px;
  }
  .stat-number {
    font-size: 1.6rem;
  }
  .stat-label {
    font-size: 0.75rem;
  }
  .section-title {
    font-size: 1.2rem;
  }
  .section-title-center {
    font-size: 1.3rem;
  }
  .trending-item {
    gap: 12px;
  }
  .trend-number {
    font-size: 1.6rem;
  }
  .trend-body h4 {
    font-size: 0.82rem;
  }
  .news-card-inline {
    padding: 12px;
    gap: 12px;
  }
  .news-card-inline img {
    width: 60px;
    height: 60px;
  }
  .model-card {
    padding: 24px 16px;
  }
  .model-icon-wrap {
    font-size: 2rem;
  }
  .support-form {
    padding: 24px 16px;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
  .quote-parallax-section {
    padding: 40px 0;
    background-attachment: scroll;
  }
  .quote-container blockquote {
    font-size: 0.95rem;
  }
  .video-placeholder {
    height: 180px;
  }
  .playlist-item {
    padding: 10px;
    gap: 12px;
  }
  .playlist-thumb {
    width: 60px;
    height: 40px;
  }
}

/* Photo Gallery */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.gallery-item {
  position: relative;
  border-radius: var(--radius-sm);
  overflow: hidden;
  height: 200px;
  box-shadow: var(--shadow-sm);
}

.gallery-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}

.gallery-item::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 70%;
  background: linear-gradient(to top, rgba(16, 28, 16, 0.9) 0%, rgba(16, 28, 16, 0) 100%);
  z-index: 1;
}

.gallery-info {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 16px;
  color: white;
  z-index: 2;
  transition: transform 0.3s ease;
}

.gallery-info h4 {
  font-size: 0.88rem;
  font-weight: 800;
  margin: 0 0 4px 0;
}

.gallery-info span {
  font-size: 0.7rem;
  opacity: 0.8;
  text-transform: uppercase;
  font-weight: 750;
  letter-spacing: 0.5px;
}

.gallery-item:hover img {
  transform: scale(1.05);
}

/* Legal FAQ */
.faq-container-width {
  max-width: 800px;
  margin: 0 auto;
}

.faq-accordion-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.faq-accordion-item {
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: var(--transition);
}

.faq-accordion-item.is-active {
  border-color: var(--primary);
  box-shadow: 0 4px 16px rgba(74, 103, 65, 0.06);
}

.faq-accordion-question {
  width: 100%;
  background: none;
  border: none;
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: left;
  font-size: 0.95rem;
  font-weight: 750;
  color: var(--text-dark);
  cursor: pointer;
  font-family: inherit;
  transition: var(--transition);
}

.faq-accordion-question:hover {
  color: var(--primary);
  background-color: #fcfdfe;
}

.faq-accordion-item.is-active .faq-accordion-question {
  color: var(--primary);
  border-bottom: 1px solid var(--border-color);
}

.faq-icon-arrow {
  font-size: 0.72rem;
  color: var(--text-muted);
  transition: var(--transition);
}

.faq-accordion-item.is-active .faq-icon-arrow {
  color: var(--primary);
}

.faq-accordion-answer {
  padding: 18px 24px;
  background-color: #fcfdfe;
}

.faq-accordion-answer p {
  font-size: 0.88rem;
  color: var(--text-medium);
  line-height: 1.6;
  margin: 0;
}

/* Useful Links Section */
.useful-links-section {
  border-top: 1px solid var(--border-color);
  background-color: #f7f9f6;
  padding: 50px 0;
}

.links-carousel-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 20px;
}

.link-partner-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--white);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 20px;
  text-align: center;
  text-decoration: none;
  color: var(--text-dark);
  box-shadow: var(--shadow-sm);
  transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
}

.link-partner-card:hover {
  transform: translateY(-4px);
  border-color: var(--primary);
  box-shadow: var(--shadow-md);
}

.partner-logo-box {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background-color: rgba(74, 103, 65, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.45rem;
  margin-bottom: 12px;
  transition: var(--transition);
}

.link-partner-card:hover .partner-logo-box {
  background-color: var(--primary);
  color: white;
}

.link-partner-card span {
  font-size: 0.82rem;
  font-weight: 750;
  line-height: 1.3;
}

/* Additional media query overrides */
@media (max-width: 900px) {
  .gallery-grid {
    grid-template-columns: 1fr 1fr;
  }
  .links-carousel-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 480px) {
  .gallery-grid {
    grid-template-columns: 1fr;
  }
  .links-carousel-grid {
    grid-template-columns: 1fr 1fr;
  }
  .faq-accordion-question {
    padding: 14px 18px;
    font-size: 0.85rem;
  }
  .faq-accordion-answer {
    padding: 14px 18px;
  }
}
}
</style>
