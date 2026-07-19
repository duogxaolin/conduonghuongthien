<template>
  <div class="role-models-page section-bg">
    <!-- Hero Header -->
    <section class="role-hero">
      <div class="role-hero-overlay"></div>
      <div class="container">
        <h2 class="role-hero-title">Tấm Gương Tiêu Biểu</h2>
        <p class="role-hero-subtitle">Khát vọng hoàn lương, ý chí vượt khó và những hành trình làm lại cuộc đời đầy nghị lực</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="section">
      <div class="container">
        <div class="role-list-grid">
          <div class="role-card-item">
            <div class="avatar-wrap">
              <img src="/assets/guong_sang_1.jpg" alt="Nguyễn Văn A" />
            </div>
            <div class="info-wrap">
              <span class="location">📍 TP. Đà Nẵng</span>
              <h3>Anh Nguyễn Văn A — Nghị lực làm giàu từ xưởng mộc</h3>
              <p>Sau những năm tháng lầm lỡ và cải tạo tốt, anh A trở về địa phương được Công an phường hỗ trợ làm thủ tục xóa án tích sớm và kết nối ngân hàng vay vốn chính sách 100 triệu đồng. Hiện nay anh làm chủ xưởng mộc lớn, tạo sinh kế bền vững cho 15 nhân công cùng hoàn cảnh.</p>
              <nuxt-link to="#" class="btn btn-outline">Xem câu chuyện</nuxt-link>
            </div>
          </div>

          <div class="role-card-item">
            <div class="avatar-wrap">
              <img src="/assets/guong_sang_2.jpg" alt="Trần Thị B" />
            </div>
            <div class="info-wrap">
              <span class="location">📍 Tỉnh Quảng Ninh</span>
              <h3>Chị Trần Thị B — Hành trình vươn lên làm chủ cơ sở may</h3>
              <p>Được sự động viên của gia đình và cán bộ cơ sở phụ trách, chị B đã vượt qua mặc cảm tự ti ban đầu, theo học lớp trung cấp may mặc và hiện nay đã sở hữu một cơ sở may gia công xuất khẩu lớn, trực tiếp hỗ trợ phụ nữ hoàn lương tái hòa nhập.</p>
              <nuxt-link to="#" class="btn btn-outline">Xem câu chuyện</nuxt-link>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

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
}

.info-wrap p {
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
