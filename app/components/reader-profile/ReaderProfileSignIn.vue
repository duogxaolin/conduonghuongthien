<template>
  <div class="rounded-xl border border-line bg-white px-6 py-12 text-center">
    <i class="fa-solid fa-user-lock mb-4 text-[2rem] text-[#CFDDC8]" aria-hidden="true"></i>
    <h2 class="m-0 mb-2 text-[1.1rem] font-extrabold text-brand-950">Bạn chưa đăng nhập</h2>
    <p class="mx-auto mb-6 max-w-[460px] text-[0.9rem] leading-relaxed text-ink-secondary">
      Đăng nhập bằng tài khoản Google để đặt câu hỏi dưới các bài viết, xem lại bình luận đã gửi
      và các đoạn trò chuyện với trợ lý.
    </p>
    <button
      type="button"
      class="btn btn-primary inline-flex items-center gap-2 px-6 py-3 text-[0.9rem]"
      @click="emit('sign-in')"
    >
      <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Đăng nhập bằng Google
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * `/profile`, signed out — the sign-in block instead of a redirect (`useReaderAuth` only
 * knows who the reader is after mount). `sign-in` → the page's `signIn('/profile')`.
 * Display only.
 */
const emit = defineEmits<{ 'sign-in': [] }>()
</script>
