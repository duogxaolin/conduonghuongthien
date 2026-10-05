<script setup lang="ts">
/**
 * Trang lỗi toàn hệ thống (4xx/5xx).
 *
 * Nuxt render component này khi route throw `createError`/`showError`. Mặc định
 * Nuxt không gắn layout cho error page — trang trắng trơn. Bọc `<NuxtLayout>`
 * bên trong giữ header, menu, chat, sidebar, footer, bottom nav; chỉ vùng nội
 * dung giữa là thông báo lỗi. `clearError` xóa error state + (tuỳ chọn) redirect.
 *
 * Không index trang lỗi (Google không nên đánh chỉ mục URL lỗi).
 */
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'

const props = defineProps<{
  error: {
    statusCode?: number
    statusMessage?: string
    message?: string
  }
}>()

const { t } = useI18n()

const code = computed(() => props.error?.statusCode || 500)
const is4xx = computed(() => code.value >= 400 && code.value < 500)
const is5xx = computed(() => code.value >= 500)

// 404 → "Không tìm thấy trang"; 403 → "Không có quyền"; 500 → "Lỗi máy chủ".
// Ưu tiên statusMessage (do handler set tiếng Việt), fallback message, fallback generic.
const headline = computed(() => {
  if (props.error?.statusMessage) return String(props.error.statusMessage)
  if (props.error?.message) return String(props.error.message)
  if (code.value === 404) return 'Không tìm thấy trang.'
  if (code.value === 403) return 'Bạn không có quyền truy cập trang này.'
  if (code.value === 401) return 'Vui lòng đăng nhập để tiếp tục.'
  return 'Đã xảy ra lỗi.'
})

const description = computed(() => {
  if (code.value === 404) return 'Trang bạn tìm có thể đã bị di chuyển, đổi tên, hoặc tạm thời không khả dụng.'
  if (code.value === 403) return 'Tài khoản của bạn không đủ quyền xem nội dung này. Liên hệ quản trị viên nếu cần hỗ trợ.'
  if (code.value === 401) return 'Phiên đăng nhập hết hạn hoặc chưa đăng nhập. Quay lại trang đăng nhập để tiếp tục.'
  return 'Hệ thống gặp sự cố khi xử lý yêu cầu. Vui lòng thử lại sau ít phút — đội ngũ vận hành đã nhận thông báo.'
})

const handleHome = () => clearError({ redirect: '/' })
const handleRetry = () => clearError()

useSeoMeta({
  robots: 'noindex, nofollow',
  title: () => `${code.value} | Con Đường Hướng Thiện`,
})
</script>

<template>
  <NuxtLayout name="default">
    <section
      :role="is5xx ? 'alert' : undefined"
      class="container py-16 sm:py-24 min-h-[50vh] flex items-center justify-center"
    >
      <div class="max-w-xl w-full text-center">
        <!-- Icon lớn theo nhóm lỗi -->
        <div
          class="w-20 h-20 sm:w-24 sm:h-24 rounded-full mx-auto mb-6 flex items-center justify-center text-3xl sm:text-4xl"
          :class="is5xx
            ? 'bg-[#FDECEC] text-[#D14040]'
            : 'bg-[#EBF3E8] text-[#4A6741]'"
        >
          <i
            :class="is5xx ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-triangle-exclamation'"
            aria-hidden="true"
          ></i>
        </div>

        <!-- Mã lỗi + tiêu đề -->
        <p class="text-[0.78rem] font-extrabold uppercase tracking-[1.5px] text-[#7A8A76] m-0 mb-2">
          <span v-if="is4xx">Lỗi {{ code.value }}</span>
          <span v-else>Lỗi máy chủ {{ code.value }}</span>
        </p>
        <h1 class="text-[1.6rem] sm:text-[2rem] font-extrabold text-[#1E251C] leading-[1.25] m-0 mb-4">
          {{ headline }}
        </h1>
        <p class="text-[0.95rem] text-[#5A6655] leading-relaxed m-0 mb-8 px-2">
          {{ description }}
        </p>

        <!-- Hành động -->
        <div class="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#4A6741] text-white text-sm font-bold hover:bg-[#385132] transition-all cursor-pointer border-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]"
            @click="handleHome"
          >
            <i class="fa-solid fa-house text-xs" aria-hidden="true"></i>
            <span>{{ t('home') }}</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white border border-[#D5E1D3] text-[#385932] text-sm font-bold hover:bg-[#F2F7F0] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6741]"
            @click="handleRetry"
          >
            <i class="fa-solid fa-rotate-right text-xs" aria-hidden="true"></i>
            <span>{{ t('retry') }}</span>
          </button>
        </div>
      </div>
    </section>
  </NuxtLayout>
</template>
