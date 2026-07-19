<template>
  <div class="models-page section-bg">
    <!-- Hero Header -->
    <section class="models-hero">
      <div class="models-hero-overlay"></div>
      <div class="container">
        <h2 class="models-hero-title">Mô Hình Tái Hòa Nhập Cộng Đồng</h2>
        <p class="models-hero-subtitle">Các quỹ hỗ trợ, câu lạc bộ xã hội và mô hình liên kết đào tạo tạo sinh kế bền vững</p>
      </div>
    </section>

    <!-- Main List -->
    <section class="section">
      <div class="container">
        <div class="models-list-grid">
          <div class="model-detail-card">
            <h3>1. Quỹ Tín dụng hỗ trợ hoàn lương</h3>
            <p>Triển khai chính sách vay vốn ưu đãi từ Ngân hàng Chính sách Xã hội theo Quyết định 22/2023/QĐ-TTg, giúp người chấp hành xong án phạt tù tiếp cận nguồn vốn ưu đãi 100 triệu đồng để làm kinh tế, mua sắm công cụ sản xuất nông lâm nghiệp.</p>
          </div>

          <div class="model-detail-card">
            <h3>2. Câu lạc bộ Hòa nhập xanh</h3>
            <p>Nơi tập hợp, chia sẻ kinh nghiệm, giúp đỡ lẫn nhau giữa những người cùng hoàn cảnh. Câu lạc bộ phối hợp lực lượng Công an cơ sở tổ chức các lớp giáo dục tuyên truyền pháp luật và sinh hoạt văn hóa thể thao nâng cao đời sống tinh thần.</p>
          </div>

          <div class="model-detail-card">
            <h3>3. Liên kết đào tạo nghề & Việc làm nhân văn</h3>
            <p>Hợp tác với các doanh nghiệp, cơ sở sản xuất kinh doanh tại địa phương để hướng nghiệp, đào tạo các nghề mộc, may mặc, cơ khí cắt gọt, điện dân dụng... đồng thời đảm bảo bố trí công việc ngay sau khi tốt nghiệp.</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

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
  transition: var(--transition);
}

.model-detail-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
  border-color: var(--secondary);
}

.model-detail-card h3 {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 16px;
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 8px;
}

.model-detail-card p {
  font-size: 0.92rem;
  color: var(--text-medium);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .models-list-grid {
    grid-template-columns: 1fr;
  }
}
</style>
