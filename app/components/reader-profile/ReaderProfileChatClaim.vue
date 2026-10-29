<template>
  <div class="mt-4 border-t border-surface-tint pt-4">
    <p class="mb-2.5 mt-0 text-[0.8rem] leading-relaxed text-ink-soft">
      Nếu bạn đã trò chuyện với trợ lý trên thiết bị này trước khi đăng nhập, hãy gắn các đoạn đó vào tài khoản.
    </p>
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[0.85rem] font-bold text-brand-800 transition-colors hover:bg-surface-tint disabled:opacity-60"
      :disabled="claiming"
      @click="emit('claim')"
    >
      <i class="fa-solid fa-link" aria-hidden="true"></i>
      {{ claiming ? 'Đang gắn…' : 'Nhận các đoạn chat trên thiết bị này' }}
    </button>
    <p v-if="message" role="status" class="mt-2.5 mb-0 text-[0.83rem] font-semibold text-brand-600">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * `/profile`, the manual claim under "Đoạn chat của tôi".
 *
 * `load()` (useReaderAuth) đã tự gửi một lượt nhận mỗi phiên trình duyệt, nên nút này là
 * đường dự phòng cho lượt tự động đã trượt (mất mạng giữa lúc đăng nhập) — chứ không phải
 * cách chính. The claim (which clears the session flag first, or a second press would do
 * nothing) is the page's (`useReaderChatClaim`). Display only.
 */
defineProps<{ claiming: boolean; message: string }>()
const emit = defineEmits<{ claim: [] }>()
</script>
