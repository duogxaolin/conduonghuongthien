<template>
  <div class="bg-[#F8FAF7]">
    <!-- Hero Header -->
    <section class="relative bg-[url('/assets/hero_banner.jpg')] bg-center bg-cover px-4 py-16 text-center text-white sm:py-[100px]">
      <div class="absolute inset-0 bg-[rgba(74,103,65,0.9)]"></div>
      <div class="container relative z-10">
        <h2 class="text-[1.9rem] font-extrabold mb-3 relative z-10 sm:text-[2.5rem]">{{ t('contact_hero_title') }}</h2>
        <p class="text-[1.1rem] opacity-90 relative z-10">{{ t('contact_hero_sub') }}</p>
      </div>
    </section>

    <!-- Content Grid -->
    <section class="section">
      <div class="container grid grid-cols-1 lg:grid-cols-2 gap-[60px]">
        <!-- Contact Details -->
        <div class="flex flex-col gap-10">
          <div>
            <h3 class="text-[1.4rem] font-bold text-[#4A6741] mb-5 border-b-2 border-[#E2E8DF] pb-2">{{ t('contact_editorial_info') }}</h3>
            <p class="text-[0.95rem] text-[#4A5545] mb-3 leading-relaxed">
              <strong class="text-[#1E251C]">{{ t('footer_agency') }}</strong> Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) - Bộ Công an
            </p>
            <p class="text-[0.95rem] text-[#4A5545] mb-3 leading-relaxed">
              <strong class="text-[#1E251C]">{{ t('footer_address') }}</strong> Thôn Phượng Mỹ, xã Tam Hưng, thành phố Hà Nội
            </p>
            <p class="text-[0.95rem] text-[#4A5545] mb-3 leading-relaxed">
              <strong class="text-[#1E251C]">{{ t('hotline_lbl') }}:</strong> 0903.480.985
            </p>
            <p class="text-[0.95rem] text-[#4A5545] mb-3 leading-relaxed">
              <strong class="text-[#1E251C]">{{ t('footer_email') }}</strong> contact@conduonghuongthien.com.vn
            </p>
          </div>

          <div>
            <h3 class="text-[1.4rem] font-bold text-[#4A6741] mb-5 border-b-2 border-[#E2E8DF] pb-2">{{ t('contact_support_mechanism') }}</h3>
            <p class="text-[0.95rem] text-[#4A5545] leading-relaxed text-justify">
              Hệ thống trợ giúp tiếp nhận yêu cầu 24/7 từ người chấp hành xong án phạt tù hoặc thân nhân của họ. Sau khi tiếp nhận thông tin, Ban Biên tập sẽ tiến hành bảo mật dữ liệu cá nhân, phân loại nghiệp vụ và chuyển giao nhanh chóng đến lực lượng Công an cấp cơ sở (xã, phường, thị trấn) hoặc ban ngành liên quan tại địa bàn bạn cư trú để hỗ trợ xử lý kịp thời.
            </p>
          </div>
        </div>

        <!-- Contact Form -->
        <div class="bg-white p-10 md:p-6 rounded-lg shadow-md border border-[#E2E8DF]">
          <h3 class="text-[1.3rem] font-bold text-[#4A6741] mb-6">{{ t('contact_form_heading') }}</h3>
          <form @submit.prevent="handleSubmit" class="flex flex-col gap-5">
            <div class="flex flex-col gap-2">
              <label class="text-[0.85rem] font-bold text-[#4A5545]">Họ và tên người đăng ký *</label>
              <input
                type="text"
                v-model="form.name"
                placeholder="Nhập đầy đủ họ và tên"
                required
                class="px-3 py-3 border border-[#E2E8DF] rounded bg-[#F8FAF7] font-[inherit] text-[0.9rem] outline-none transition-all duration-300 focus:border-[#7CB342] focus:bg-white focus:shadow-sm"
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="flex flex-col gap-2">
                <label class="text-[0.85rem] font-bold text-[#4A5545]">Số điện thoại *</label>
                <input
                  type="tel"
                  v-model="form.phone"
                  placeholder="Nhập số điện thoại liên hệ"
                  required
                  class="px-3 py-3 border border-[#E2E8DF] rounded bg-[#F8FAF7] font-[inherit] text-[0.9rem] outline-none transition-all duration-300 focus:border-[#7CB342] focus:bg-white focus:shadow-sm"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[0.85rem] font-bold text-[#4A5545]">Email liên hệ (nếu có)</label>
                <input
                  type="email"
                  v-model="form.email"
                  placeholder="Nhập địa chỉ email"
                  class="px-3 py-3 border border-[#E2E8DF] rounded bg-[#F8FAF7] font-[inherit] text-[0.9rem] outline-none transition-all duration-300 focus:border-[#7CB342] focus:bg-white focus:shadow-sm"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-[0.85rem] font-bold text-[#4A5545]">Địa chỉ thường trú / cư trú *</label>
              <input
                type="text"
                v-model="form.address"
                placeholder="Số nhà, đường phố, xã/phường, quận/huyện, tỉnh/thành phố"
                required
                class="px-3 py-3 border border-[#E2E8DF] rounded bg-[#F8FAF7] font-[inherit] text-[0.9rem] outline-none transition-all duration-300 focus:border-[#7CB342] focus:bg-white focus:shadow-sm"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-[0.85rem] font-bold text-[#4A5545]">Nội dung chi tiết cần trợ giúp *</label>
              <textarea
                v-model="form.message"
                rows="5"
                placeholder="Mô tả cụ thể nguyện vọng (Ví dụ: tư vấn vay vốn theo Quyết định 22, thủ tục đăng ký tạm trú, hỗ trợ học nghề mộc, xóa án tích...)"
                required
                class="px-3 py-3 border border-[#E2E8DF] rounded bg-[#F8FAF7] font-[inherit] text-[0.9rem] outline-none transition-all duration-300 focus:border-[#7CB342] focus:bg-white focus:shadow-sm resize-y"
              ></textarea>
            </div>

            <button type="submit" class="btn btn-primary" :disabled="submitStatus === 'loading'">
              {{ submitStatus === 'loading' ? 'Đang gửi...' : 'Gửi yêu cầu trợ giúp' }}
            </button>

            <div
              v-if="submitMessage"
              role="status"
              aria-live="polite"
              class="mt-4 px-[18px] py-[14px] rounded text-[0.9rem] font-semibold leading-relaxed"
              :class="submitStatus === 'success'
                ? 'bg-[#e8f5e9] text-[#2e6b32] border border-[#b6d7b8]'
                : 'bg-[#fdecea] text-[#b71c1c] border border-[#f5c6cb]'"
            >
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
