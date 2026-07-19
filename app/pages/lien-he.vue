<template>
  <div class="contact-page section-bg">
    <!-- Hero Header -->
    <section class="contact-hero">
      <div class="contact-hero-overlay"></div>
      <div class="container">
        <h2 class="contact-hero-title">Liên Hệ & Trợ Giúp</h2>
        <p class="contact-hero-subtitle">Kết nối với ban biên tập và gửi thông tin yêu cầu trợ giúp trực tiếp</p>
      </div>
    </section>

    <!-- Content Grid -->
    <section class="section">
      <div class="container contact-grid">
        <!-- Contact Details -->
        <div class="contact-details">
          <div class="contact-block">
            <h3>Thông tin liên hệ Ban Biên tập</h3>
            <p><strong>Cơ quan chủ quản:</strong> Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an</p>
            <p><strong>Địa chỉ:</strong> Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội</p>
            <p><strong>Điện thoại đường dây nóng:</strong> 0903.480.985</p>
            <p><strong>Email tiếp nhận phản ánh:</strong> contact@conduonghuongthien.com.vn</p>
          </div>

          <div class="contact-block">
            <h3>Cơ chế hỗ trợ</h3>
            <p class="desc-text">
              Hệ thống trợ giúp tiếp nhận yêu cầu 24/7 từ người chấp hành xong án phạt tù hoặc thân nhân của họ. Sau khi tiếp nhận thông tin, Ban Biên tập sẽ tiến hành bảo mật dữ liệu cá nhân, phân loại nghiệp vụ và chuyển giao nhanh chóng đến lực lượng Công an cấp cơ sở (xã, phường, thị trấn) hoặc ban ngành liên quan tại địa bàn bạn cư trú để hỗ trợ xử lý kịp thời.
            </p>
          </div>
        </div>

        <!-- Contact Form -->
        <div class="contact-form-card">
          <h3>Gửi Yêu Cầu Trợ Giúp Hoặc Ý Kiến Đóng Góp</h3>
          <form @submit.prevent="handleSubmit" class="main-contact-form">
            <div class="form-group">
              <label>Họ và tên người đăng ký *</label>
              <input type="text" v-model="form.name" placeholder="Nhập đầy đủ họ và tên" required />
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Số điện thoại *</label>
                <input type="tel" v-model="form.phone" placeholder="Nhập số điện thoại liên hệ" required />
              </div>
              <div class="form-group">
                <label>Email liên hệ (nếu có)</label>
                <input type="email" v-model="form.email" placeholder="Nhập địa chỉ email" />
              </div>
            </div>

            <div class="form-group">
              <label>Địa chỉ thường trú / cư trú *</label>
              <input type="text" v-model="form.address" placeholder="Số nhà, đường phố, xã/phường, quận/huyện, tỉnh/thành phố" required />
            </div>

            <div class="form-group">
              <label>Nội dung chi tiết cần trợ giúp *</label>
              <textarea v-model="form.message" rows="5" placeholder="Mô tả cụ thể nguyện vọng (Ví dụ: tư vấn vay vốn theo Quyết định 22, thủ tục đăng ký tạm trú, hỗ trợ học nghề mộc, xóa án tích...)" required></textarea>
            </div>

            <button type="submit" class="btn btn-primary">Gửi yêu cầu trợ giúp</button>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { reactive } from 'vue'

const form = reactive({
  name: '',
  phone: '',
  email: '',
  address: '',
  message: ''
})

const handleSubmit = () => {
  alert(`Cám ơn bạn ${form.name}. Yêu cầu hỗ trợ của bạn đã được gửi thành công đến hệ thống của C11. Chúng tôi sẽ phân loại và chuyển tiếp cơ quan chức năng hỗ trợ bạn sớm nhất qua số điện thoại ${form.phone}.`)
  form.name = ''
  form.phone = ''
  form.email = ''
  form.address = ''
  form.message = ''
}
</script>

<style scoped>
.contact-hero {
  position: relative;
  background: url('/assets/hero_banner.jpg') center/cover no-repeat;
  padding: 100px 0;
  text-align: center;
  color: white;
}

.contact-hero-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(74, 103, 65, 0.9);
}

.contact-hero-title {
  position: relative;
  z-index: 2;
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 12px;
}

.contact-hero-subtitle {
  position: relative;
  z-index: 2;
  font-size: 1.1rem;
  opacity: 0.9;
}

.contact-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 60px;
}

.contact-details {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.contact-block h3 {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 20px;
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 8px;
}

.contact-block p {
  font-size: 0.95rem;
  color: var(--text-medium);
  margin-bottom: 12px;
  line-height: 1.6;
}

.contact-block strong {
  color: var(--text-dark);
}

.desc-text {
  text-align: justify;
}

.contact-form-card {
  background-color: var(--white);
  padding: 40px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
}

.contact-form-card h3 {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 24px;
}

.main-contact-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-medium);
}

.form-group input, .form-group textarea {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  background-color: var(--bg-light);
  transition: var(--transition);
}

.form-group input:focus, .form-group textarea:focus {
  border-color: var(--secondary);
  background-color: var(--white);
  box-shadow: var(--shadow-sm);
}

@media (max-width: 900px) {
  .contact-grid {
    grid-template-columns: 1fr;
  }
  .contact-form-card {
    padding: 24px;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
