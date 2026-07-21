<script setup lang="ts">
definePageMeta({
  layout: false
})

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
    if (res.ok) {
      navigateTo('/admin')
    }
  } catch (err: any) {
    errorMsg.value = err?.data?.statusMessage || err?.message || 'Đăng nhập thất bại'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="card-header">
        <div class="logo-circle">🌿</div>
        <h2>CON ĐƯỜNG HƯỚNG THIỆN</h2>
        <p>Hệ thống Quản trị Nội dung (Admin Panel)</p>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div v-if="errorMsg" class="error-alert">
          <span>⚠️</span> {{ errorMsg }}
        </div>

        <div class="form-group">
          <label>Tài khoản</label>
          <input
            type="text"
            v-model="username"
            placeholder="Nhập tên đăng nhập"
            required
            autocomplete="username"
          />
        </div>

        <div class="form-group">
          <label>Mật khẩu</label>
          <input
            type="password"
            v-model="password"
            placeholder="Nhập mật khẩu"
            required
            autocomplete="current-password"
          />
        </div>

        <button type="submit" class="login-btn" :disabled="loading">
          <span v-if="loading">Đang xác thực...</span>
          <span v-else>Đăng nhập hệ thống</span>
        </button>
      </form>

      <div class="card-footer">
        Cổng thông tin Hỗ trợ Tái hòa nhập Cộng đồng — Bộ Công an
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0d1e10 0%, #1e4620 100%);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.card-header {
  padding: 32px 32px 24px 32px;
  text-align: center;
  background: #f8faf8;
  border-bottom: 1px solid #eef2ee;
}

.logo-circle {
  width: 56px;
  height: 56px;
  background: #e4f2e5;
  color: #2c6e33;
  font-size: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px auto;
}

.card-header h2 {
  font-size: 1.15rem;
  font-weight: 800;
  color: #122815;
  margin: 0 0 6px 0;
  letter-spacing: 0.5px;
}

.card-header p {
  font-size: 0.82rem;
  color: #667768;
  margin: 0;
}

.login-form {
  padding: 32px;
}

.error-alert {
  background: #ffebe9;
  border: 1px solid #ffc1ba;
  color: #d12420;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.84rem;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 0.82rem;
  font-weight: 700;
  color: #2c3e2e;
  margin-bottom: 8px;
}

.form-group input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #c8d6c9;
  border-radius: 8px;
  font-size: 0.92rem;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-group input:focus {
  border-color: #2c6e33;
  box-shadow: 0 0 0 3px rgba(44, 110, 51, 0.15);
}

.login-btn {
  width: 100%;
  padding: 14px;
  background: #1e4620;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 8px;
}

.login-btn:hover {
  background: #2c6e33;
}

.login-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.card-footer {
  padding: 16px 32px;
  background: #f8faf8;
  border-top: 1px solid #eef2ee;
  text-align: center;
  font-size: 0.75rem;
  color: #88998a;
}
</style>
