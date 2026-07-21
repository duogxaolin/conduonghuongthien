<template>
  <div class="about-page section-bg">
    <!-- Banner Header -->
    <section class="about-hero">
      <div class="about-hero-overlay"></div>
      <div class="container">
        <h2 class="about-hero-title">{{ t('about_hero_title') }}</h2>
        <p class="about-hero-subtitle">{{ t('about_hero_sub') }}</p>
      </div>
    </section>

    <!-- Main Content -->
    <section class="section">
      <div class="container">
        <SectionBar icon="🏛" :title="t('about_editorial')" />
        <div class="about-container">
          <div class="about-main-content">
            <div class="about-block">
              <h3>{{ t('about_purpose_title') }}</h3>
              <p>
                Trang thông tin điện tử <strong>Con Đường Hướng Thiện</strong> hoạt động dưới sự chỉ đạo của Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an.
              </p>
              <p>
                Mục tiêu tối thượng của nền tảng là cung cấp thông tin chính thống về các chính sách, nghị định của Đảng và Nhà nước liên quan đến công tác thi hành án hình sự và hỗ trợ hòa nhập cộng đồng; tuyên truyền, nhân rộng các mô hình sản xuất kinh tế hiệu quả, các tấm gương điển hình tiên tiến hoàn lương lập nghiệp thành công; định hướng tư tưởng, pháp lý và kết nối hỗ trợ trực tuyến 24/7 giúp người lầm lỡ xóa bỏ tự ti, sớm ổn định cuộc sống.
              </p>
            </div>

            <div class="about-block">
              <h3>Nhiệm vụ trọng tâm</h3>
              <ul class="task-list">
                <li>
                  <strong>Tuyên truyền & Giáo dục pháp luật:</strong> Phổ biến các quy định về xóa án tích, chính sách vay vốn ưu đãi, quyền và nghĩa vụ công dân giúp người hoàn lương nâng cao hiểu biết pháp lý.
                </li>
                <li>
                  <strong>Đào tạo & Hướng nghiệp:</strong> Kết nối các cơ sở đào tạo nghề và các doanh nghiệp nhân văn nhằm tổ chức các lớp học nghề, tạo cơ hội việc làm công bằng cho người lầm lỡ.
                </li>
                <li>
                  <strong>Tư vấn & Trợ giúp trực tuyến:</strong> Xây dựng hệ thống giải đáp tự động và đường dây nóng tiếp nhận thông tin đăng ký hỗ trợ trực tiếp 24/7 trên phạm vi cả nước.
                </li>
              </ul>
            </div>
          </div>

          <!-- Sidebar thông tin tổ chức -->
          <div class="about-sidebar">
            <div class="org-card">
              <h4>ĐƠN VỊ CHỦ QUẢN</h4>
              <p class="org-name">Cục Cảnh sát QLTHG, TG và THAHS tại cộng đồng (C11)</p>
              <p><strong>Bộ Công an</strong></p>
              <div class="org-divider"></div>
              <p><strong>Ban Biên Tập:</strong> Đại diện Cảnh sát Thi hành án hình sự & Hỗ trợ tư pháp công an các địa phương.</p>
              <p><strong>Hotline liên hệ trực tiếp:</strong></p>
              <p class="hotline-text">0903.480.985</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
const { t } = useI18n()

useSeoMeta({
  title: 'Giới thiệu | Con Đường Hướng Thiện',
  description: 'Giới thiệu Ban Biên tập Cổng thông tin Con Đường Hướng Thiện - Cục C11 Bộ Công an.'
})
</script>

<style scoped>
.about-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.about-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.about-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.about-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.about-container {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 40px;
}

.about-main-content {
  background-color: var(--white);
  padding: 40px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.about-block {
  margin-bottom: 36px;
}

.about-block h3 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 18px;
  border-left: 4px solid var(--secondary);
  padding-left: 12px;
}

.about-block p {
  font-size: 1rem;
  color: var(--text-medium);
  margin-bottom: 16px;
  text-align: justify;
}

.task-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-list li {
  background-color: var(--bg-light);
  padding: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.task-list strong {
  color: var(--primary);
  display: block;
  margin-bottom: 6px;
}

.about-sidebar {
  display: flex;
  flex-direction: column;
}

.org-card {
  background-color: var(--primary);
  color: white;
  padding: 30px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.org-card h4 {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 1px;
  opacity: 0.8;
  margin-bottom: 8px;
}

.org-name {
  font-size: 1.2rem;
  font-weight: 800;
  line-height: 1.4;
  margin-bottom: 4px;
}

.org-divider {
  height: 1px;
  background-color: rgba(255, 255, 255, 0.15);
  margin: 20px 0;
}

.hotline-text {
  font-size: 1.8rem;
  font-weight: 800;
  color: var(--secondary-light);
  margin-top: 8px;
}

@media (max-width: 768px) {
  .about-container {
    grid-template-columns: 1fr;
  }
  .about-main-content {
    padding: 24px;
  }
}
</style>
