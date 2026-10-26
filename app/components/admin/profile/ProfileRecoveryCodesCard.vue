<script setup lang="ts">
/**
 * Thẻ "Mã dự phòng" của /admin/profile, kể cả lô mã hiện đúng một lần ngay sau khi sinh —
 * chỉ trình bày. Lô mã, hộp thoại mật khẩu và copy/tải về nằm ở `useProfileRecoveryCodes`
 * (app/composables); trang nối các sự kiện vào đó.
 */
defineProps<{
  enabled: boolean
  remaining: number
  /** Số yếu tố thứ hai đang bật: không có yếu tố nào thì chưa tạo được mã. */
  activeFactorCount: number
  /** Lô mã vừa sinh (rỗng = không hiện gì). */
  codes: string[]
}>()
const emit = defineEmits<{ open: [mode: 'create' | 'delete'], copy: [], download: [], hide: [] }>()
</script>

<template>
  <div class="mt-5 rounded-xl border border-line bg-[#fafcfa] p-4">
    <div class="flex items-start gap-4 flex-wrap">
      <div class="w-10 h-10 rounded-xl bg-surface-tint border border-line flex items-center justify-center shrink-0">
        <i class="fa-solid fa-life-ring text-brand-700" aria-hidden="true"></i>
      </div>
      <div class="flex-1 min-w-[220px]">
        <div class="flex items-center gap-2 flex-wrap">
          <strong class="text-[0.9rem] text-brand-950">Mã dự phòng</strong>
          <span class="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full border"
                :class="enabled ? 'bg-[#eef7ee] border-[#cce5cd] text-brand-900' : 'bg-[#f4f7f4] border-[#dce8dd] text-ink-muted'">
            <i class="fa-solid" :class="enabled ? 'fa-circle-check' : 'fa-circle-minus'" aria-hidden="true"></i>
            {{ enabled ? `Còn ${remaining} mã` : 'Đang tắt' }}
          </span>
        </div>
        <p class="text-[0.8rem] text-ink-muted mt-1 mb-0">
          10 mã dùng một lần, để vào được hệ thống khi mất thiết bị xác thực. Tuỳ chọn — bật/tắt lúc nào cũng được.
        </p>
        <p v-if="activeFactorCount === 0" class="text-[0.78rem] text-[#8a6412] mt-1.5 mb-0">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
          Cần bật ít nhất một yếu tố thứ hai trước khi tạo mã dự phòng.
        </p>
      </div>
      <div class="flex items-center gap-2 shrink-0 flex-wrap">
        <button type="button" :disabled="activeFactorCount === 0"
                class="inline-flex items-center gap-2 rounded-lg bg-brand-900 hover:bg-brand-700 px-3.5 py-2 text-[0.84rem] font-bold text-white border-0 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-2"
                @click="emit('open', 'create')">
          <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          {{ enabled ? 'Tạo lại mã' : 'Tạo mã dự phòng' }}
        </button>
        <button v-if="enabled" type="button"
                class="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-[0.84rem] font-semibold text-danger hover:bg-red-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-400"
                @click="emit('open', 'delete')">
          <i class="fa-solid fa-trash" aria-hidden="true"></i>
          Tắt
        </button>
      </div>
    </div>

    <!-- Hiện mã đúng một lần -->
    <div v-if="codes.length" class="mt-4 rounded-lg border border-[#f0dcae] bg-[#fdf6e7] p-4">
      <div class="flex items-start gap-2 text-[0.84rem] font-bold text-[#8a6412] mb-3">
        <i class="fa-solid fa-triangle-exclamation shrink-0 mt-0.5" aria-hidden="true"></i>
        <span>Lưu lại ngay — các mã này chỉ hiện một lần duy nhất và sẽ không xem lại được.</span>
      </div>
      <ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 list-none p-0 m-0">
        <li v-for="c in codes" :key="c"
            class="rounded-lg border border-line bg-white px-2.5 py-2 text-center font-mono text-[0.85rem] font-bold text-brand-950 tracking-wide">
          {{ c }}
        </li>
      </ul>
      <div class="flex items-center gap-2 mt-3 flex-wrap">
        <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-brand-700 bg-white px-3.5 py-2 text-[0.84rem] font-bold text-brand-700 hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700" @click="emit('copy')">
          <i class="fa-solid fa-copy" aria-hidden="true"></i>
          Copy toàn bộ
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-brand-700 bg-white px-3.5 py-2 text-[0.84rem] font-bold text-brand-700 hover:bg-surface-tint cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700" @click="emit('download')">
          <i class="fa-solid fa-download" aria-hidden="true"></i>
          Tải về tệp .txt
        </button>
        <button type="button" class="inline-flex items-center gap-2 rounded-lg bg-transparent border-0 px-2 py-2 text-[0.84rem] font-semibold text-ink-muted hover:text-brand-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-700 rounded-lg" @click="emit('hide')">
          Tôi đã lưu, ẩn đi
        </button>
      </div>
    </div>
  </div>
</template>
