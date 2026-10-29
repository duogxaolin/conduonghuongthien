<template>
  <div class="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-surface-tint px-3.5 py-3">
    <div class="min-w-0 flex-1">
      <p class="m-0 text-[0.85rem] font-bold text-brand-800">
        <i class="fa-solid fa-envelope mr-1.5 text-accent" aria-hidden="true"></i>
        Gửi email khi có người trả lời
      </p>
      <p v-if="email" class="m-0 mt-1 text-[0.78rem] leading-relaxed text-ink-secondary">
        Gửi tới <strong class="break-all">{{ email }}</strong>. Bạn có thể tắt bất cứ lúc nào.
      </p>
      <!-- Tài khoản Google không có email thì không có gì để gửi tới;
           hiện một công tắc bật được ở đây là hứa một việc sẽ không
           bao giờ xảy ra. -->
      <p v-else class="m-0 mt-1 text-[0.78rem] italic leading-relaxed text-ink-soft">
        Tài khoản của bạn không có địa chỉ email nên cổng thông tin không gửi được.
      </p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="on"
      :disabled="saving || !email"
      class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      :class="on ? 'bg-[#4A6741]' : 'bg-[#CFDDC8]'"
      @click="emit('toggle')"
    >
      <span class="sr-only">Gửi email khi có người trả lời</span>
      <span
        class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
        :class="on ? 'translate-x-6' : 'translate-x-1'"
        aria-hidden="true"
      ></span>
    </button>
    <p v-if="error" role="alert" class="m-0 w-full text-[0.8rem] text-danger-soft">
      <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * `/profile`, the email switch inside "Thông báo".
 *
 * Đặt trong khối thông báo chứ không ở khối thông tin: nó nói về chính những thông báo
 * bên dưới, và một thiết lập nằm cách xa thứ nó điều khiển là thiết lập người đọc không
 * tìm thấy khi cần tắt. The write and its state are the page's
 * (`useReaderEmailPreference`). Display only.
 */
defineProps<{
  email: string | null
  on: boolean
  saving: boolean
  /** The write's error sentence (`''` when none). */
  error: string
}>()
const emit = defineEmits<{ toggle: [] }>()
</script>
