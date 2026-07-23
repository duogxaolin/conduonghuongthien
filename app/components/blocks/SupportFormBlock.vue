<template>
  <section class="section bg-[#F8FAF7]" id="tro-giup">
    <div class="container">
      <div class="grid grid-cols-1 items-center gap-[50px] md:grid-cols-2">
        <div>
          <h2 class="text-[2.2rem] md:text-[1.6rem] font-extrabold text-[#1E251C] mb-4">{{ d.title || 'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập' }}</h2>
          <p class="text-[#4A5545] leading-[1.6] mb-[30px]">{{ d.subtitle || 'Điền thông tin để cán bộ chuyên môn liên hệ tư vấn miễn phí trong vòng 24 giờ.' }}</p>
          <div class="flex flex-col gap-3">
            <div class="text-[0.95rem] text-[#4A5545]">📞 <span>Hotline hỗ trợ: <strong>{{ d.hotline || '0903.480.985' }}</strong></span></div>
            <div class="text-[0.95rem] text-[#4A5545]">✉ <span>Email: <strong>{{ d.email || 'contact@conduonghuongthien.com.vn' }}</strong></span></div>
          </div>
        </div>
        <div>
          <form @submit.prevent="submitForm" class="bg-white p-10 sm:p-6 rounded-lg shadow-md border border-[#E2E8DF]">
            <div class="mb-5">
              <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">Họ và tên</label>
              <input type="text" v-model="form.name" required placeholder="Nguyễn Văn A" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]" />
            </div>
            <div class="grid grid-cols-1 gap-5 mb-5 sm:grid-cols-2">
              <div>
                <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">Số điện thoại</label>
                <input type="tel" v-model="form.phone" required placeholder="09xx xxx xxx" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]" />
              </div>
              <div>
                <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">Tỉnh / Thành phố</label>
                <input type="text" v-model="form.city" required placeholder="Hà Nội" class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]" />
              </div>
            </div>
            <div class="mb-5">
              <label class="block text-[0.85rem] font-bold text-[#1E251C] mb-[6px]">Nội dung cần hỗ trợ</label>
              <textarea rows="4" v-model="form.message" required placeholder="Mô tả ngắn gọn vấn đề bạn cần được tư vấn..." class="w-full px-[14px] py-[10px] border border-[#E2E8DF] rounded-lg font-[inherit] text-[0.9rem] outline-none transition focus:border-[#4A6741]"></textarea>
            </div>
            <button type="submit" class="btn btn-primary w-full text-lg" :disabled="submitStatus === 'loading'">
              {{ submitStatus === 'loading' ? 'Đang gửi...' : 'Gửi đăng ký tư vấn' }}
            </button>
            <div
              v-if="submitMessage"
              class="mt-4 px-[18px] py-[14px] rounded-lg text-[0.9rem] font-semibold leading-[1.5]"
              :class="submitStatus === 'success' ? 'bg-[#e8f5e9] text-[#2e6b32] border border-[#b6d7b8]' : 'bg-[#fdecea] text-[#b71c1c] border border-[#f5c6cb]'"
              role="status"
              aria-live="polite"
            >
              {{ submitMessage }}
            </div>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { reactive, ref, computed } from 'vue'
const props = defineProps({ block: { type: Object, required: true } })
const d = computed(() => props.block?.data || {})

const form = reactive({ name: '', phone: '', city: '', message: '' })
const submitStatus = ref(null) // null | 'loading' | 'success' | 'error'
const submitMessage = ref('')

const submitForm = async () => {
  submitStatus.value = 'loading'
  submitMessage.value = ''
  try {
    await $fetch('/api/submissions', {
      method: 'POST',
      body: { type: 'support', name: form.name, phone: form.phone, city: form.city, message: form.message },
    })
    submitStatus.value = 'success'
    submitMessage.value = `Cám ơn ${form.name}. Thông tin đăng ký của bạn đã được ghi nhận. Cán bộ chuyên môn sẽ liên hệ tư vấn trong vòng 24 giờ qua số ${form.phone}.`
    form.name = ''; form.phone = ''; form.city = ''; form.message = ''
  } catch (err) {
    submitStatus.value = 'error'
    submitMessage.value = err?.data?.statusMessage || 'Có lỗi xảy ra, vui lòng thử lại hoặc gọi hotline 0903.480.985.'
  }
}
</script>
