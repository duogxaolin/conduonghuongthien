<script setup lang="ts">
definePageMeta({ layout: false })

const { login } = useAdminAuth()

const username = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

const handleLogin = async () => {
  if (!username.value || !password.value) {
    errorMsg.value = 'Vui lòng nhập tài khoản và mật khẩu.'
    return
  }
  errorMsg.value = ''
  loading.value = true
  try {
    const res = await login(username.value, password.value)
    if (res.ok) navigateTo('/admin')
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || err?.message || 'Đăng nhập thất bại'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0d1e10] to-[#1e4620] p-5 font-[Inter,system-ui,sans-serif]">
    <div class="w-full max-w-[420px] bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden">
      <div class="px-8 pt-8 pb-6 text-center bg-[#f8faf8] border-b border-[#eef2ee]">
        <div class="w-14 h-14 bg-[#e4f2e5] text-[#2c6e33] text-3xl rounded-full flex items-center justify-center mx-auto mb-4">
          <i class="fa-solid fa-leaf"></i>
        </div>
        <h2 class="text-[1.15rem] font-extrabold text-[#122815] m-0 mb-1.5 tracking-[0.5px]">CON ĐƯỜNG HƯỚNG THIỆN</h2>
        <p class="text-[0.82rem] text-[#667768] m-0">Hệ thống Quản trị Nội dung (Admin Panel)</p>
      </div>

      <form @submit.prevent="handleLogin" class="px-8 py-8">
        <div v-if="errorMsg" class="flex items-center gap-2 bg-[#ffebe9] border border-[#ffc1ba] text-[#d12420] px-3.5 py-2.5 rounded-lg text-[0.84rem] mb-5">
          <i class="fa-solid fa-triangle-exclamation shrink-0"></i>
          {{ errorMsg }}
        </div>

        <div class="mb-5">
          <label class="block text-[0.82rem] font-bold text-[#2c3e2e] mb-2">Tài khoản</label>
          <input
            type="text"
            v-model="username"
            placeholder="Nhập tên đăng nhập"
            required
            autocomplete="username"
            class="w-full px-3.5 py-3 border border-[#c8d6c9] rounded-lg text-[0.92rem] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border"
          />
        </div>

        <div class="mb-5">
          <label class="block text-[0.82rem] font-bold text-[#2c3e2e] mb-2">Mật khẩu</label>
          <input
            type="password"
            v-model="password"
            placeholder="Nhập mật khẩu"
            required
            autocomplete="current-password"
            class="w-full px-3.5 py-3 border border-[#c8d6c9] rounded-lg text-[0.92rem] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/15 box-border"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3.5 bg-[#1e4620] hover:bg-[#2c6e33] text-white border-0 rounded-lg text-[0.95rem] font-bold cursor-pointer transition-colors mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {{ loading ? 'Đang xác thực...' : 'Đăng nhập hệ thống' }}
        </button>
      </form>

      <div class="px-8 py-4 bg-[#f8faf8] border-t border-[#eef2ee] text-center text-[0.75rem] text-[#88998a]">
        Cổng thông tin Hỗ trợ Tái hòa nhập Cộng đồng — Bộ Công an
      </div>
    </div>
  </div>
</template>
