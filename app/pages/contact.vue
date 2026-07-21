<template>
  <div class="contact-page section-bg">
    <!-- Hero Header -->
    <section class="contact-hero">
      <div class="contact-hero-overlay"></div>
      <div class="container">
        <h2 class="contact-hero-title">{{ t('contact_hero_title') }}</h2>
        <p class="contact-hero-subtitle">{{ t('contact_hero_sub') }}</p>
      </div>
    </section>

    <!-- Content Grid -->
    <section class="section">
      <div class="container contact-grid">
        <!-- Contact Details -->
        <div class="contact-details">
          <div class="contact-block">
            <h3>{{ t('contact_editorial_info') }}</h3>
            <p><strong>{{ t('footer_agency') }}</strong> Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an</p>
            <p><strong>{{ t('footer_address') }}</strong> Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội</p>
            <p><strong>{{ t('hotline_lbl') }}:</strong> 0903.480.985</p>
            <p><strong>{{ t('footer_email') }}</strong> contact@conduonghuongthien.com.vn</p>
          </div>

          <div class="contact-block">
            <h3>{{ t('contact_support_mechanism') }}</h3>
            <p class="desc-text">
              Hệ thống trợ giúp tiếp nhận yêu cầu 24/7 từ người chấp hành xong án phạt tù hoặc thân nhân của họ. Sau khi tiếp nhận thông tin, Ban Biên tập sẽ tiến hành bảo mật dữ liệu cá nhân, phân loại nghiệp vụ và chuyển giao nhanh chóng đến lực lượng Công an cấp cơ sở (xã, phường, thị trấn) hoặc ban ngành liên quan tại địa bàn bạn cư trú để hỗ trợ xử lý kịp thời.
            </p>
          </div>
        </div>

        <!-- Contact Form -->
        <div class="contact-form-card">
          <h3>{{ t('contact_form_heading') }}</h3>
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

            <button type="submit" class="btn btn-primary" :disabled="submitStatus === 'loading'">
              {{ submitStatus === 'loading' ? 'Đang gửi...' : 'Gửi yêu cầu trợ giúp' }}
            </button>
            <div v-if="submitMessage" class="form-feedback" :class="submitStatus" role="status" aria-live="polite">
              {{ submitMessage }}
            </div>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'

const { t } = useI18n()

useSeoMeta({
  title: 'Liên hệ & Trợ giúp | Con Đường Hướng Thiện',
  description: 'Liên hệ Ban Biên tập và gửi yêu cầu trợ giúp tái hòa nhập cộng đồng. Hotline 0903.480.985.'
})

const form = reactive({
  name: '',
  phone: '',
  email: '',
  address: '',
  message: ''
})

const submitStatus = ref(null)
const submitMessage = ref('')

const handleSubmit = async () => {
  submitStatus.value = 'loading'
  submitMessage.value = ''
  try {
    await $fetch('/api/submissions', {
      method: 'POST',
      body: {
        type: 'contact',
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        message: form.message
      }
    })
    submitStatus.value = 'success'
    submitMessage.value = `Cám ơn ${form.name}. Yêu cầu của bạn đã được gửi đến Ban Biên tập. Chúng tôi sẽ phân loại và chuyển cơ quan chức năng hỗ trợ bạn sớm nhất qua số ${form.phone}.`
    form.name = ''
    form.phone = ''
    form.email = ''
    form.address = ''
    form.message = ''
  } catch (err) {
    submitStatus.value = 'error'
    submitMessage.value = err?.data?.statusMessage || 'Có lỗi xảy ra, vui lòng thử lại hoặc gọi hotline 0903.480.985.'
  }
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

.form-feedback {
  margin-top: 16px;
  padding: 14px 18px;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.5;
}
.form-feedback.success {
  background: #e8f5e9;
  color: #2e6b32;
  border: 1px solid #b6d7b8;
}
.form-feedback.error {
  background: #fdecea;
  color: #b71c1c;
  border: 1px solid #f5c6cb;
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
