<template>
  <section class="rounded-xl border border-line bg-white p-6">
    <div class="flex flex-wrap items-center gap-4 border-b border-surface-tint pb-5">
      <ReaderAvatar :initials="reader.initials" size="lg" />
      <div class="min-w-0 flex-1">
        <p class="m-0 truncate text-[1.15rem] font-extrabold text-brand-950">{{ reader.displayName }}</p>
        <p v-if="reader.email" class="m-0 mt-0.5 truncate text-[0.85rem] text-ink-soft">{{ reader.email }}</p>
      </div>
    </div>

    <form class="mt-5" @submit.prevent="emit('save')">
      <label for="reader-display-name" class="mb-2 block text-[0.85rem] font-bold text-brand-800">
        Tên hiển thị
      </label>
      <p class="mb-2.5 mt-0 text-[0.8rem] leading-relaxed text-ink-soft">
        Tên này hiện cùng mọi bình luận của bạn trên cổng thông tin. Từ
        {{ DISPLAY_NAME_MIN_LENGTH }} đến {{ DISPLAY_NAME_MAX_LENGTH }} ký tự.
        Địa chỉ email của bạn không bao giờ hiện công khai.
      </p>
      <div class="flex flex-wrap gap-2.5">
        <input
          id="reader-display-name"
          v-model="draft"
          type="text"
          :maxlength="DISPLAY_NAME_MAX_LENGTH"
          autocomplete="nickname"
          class="min-w-0 flex-1 rounded-lg border border-line bg-white px-3.5 py-2.5 text-[0.9rem] text-ink outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30"
          :placeholder="t('profile_display_name_ph')"
        />
        <button
          type="submit"
          class="btn btn-primary px-5 py-2.5 text-[0.88rem] disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="saving || !draft.trim() || draft.trim() === reader.displayName"
        >
          {{ saving ? 'Đang lưu…' : 'Lưu tên' }}
        </button>
      </div>

      <!-- Nhánh lỗi thường trực mang `role="alert"`: không có nó, người
           dùng sáng mắt thấy một khối đỏ còn người dùng trình đọc màn
           hình không được thông báo gì. -->
      <p v-if="error" role="alert" class="mt-2.5 mb-0 flex items-start gap-2 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-3 py-2.5 text-[0.85rem] text-danger-soft">
        <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
        <span>{{ error }}</span>
      </p>
      <p v-else-if="saved" role="status" class="mt-2.5 mb-0 flex items-center gap-2 text-[0.85rem] font-semibold text-brand-600">
        <i class="fa-solid fa-circle-check" aria-hidden="true"></i> Đã lưu tên hiển thị mới.
      </p>
    </form>
  </section>
</template>

<script setup lang="ts">
/**
 * `/profile`, Khối 1 — who the reader is, and the rename form. The draft is `v-model`; the
 * write (`save`) and its state are the page's (`useReaderNameEdit`). Display only.
 */
import { useI18n } from '~/composables/useI18n'

/**
 * Giữ đồng bộ với `DISPLAY_NAME_*` trong server/utils/display-name.ts.
 *
 * Cố ý là hằng số ở client chứ không nạp từ máy chủ: hai con số này chỉ để soạn
 * câu hướng dẫn và đặt `maxlength`, còn quyết định thật vẫn do máy chủ đưa ra và
 * trả về nguyên văn thông báo của nó. Lệch nhau thì hậu quả là một dòng hướng dẫn
 * lỗi thời, không phải một cái tên sai được lưu.
 */
const DISPLAY_NAME_MIN_LENGTH = 2
const DISPLAY_NAME_MAX_LENGTH = 60

defineProps<{
  reader: { displayName: string; email: string | null; initials: string }
  saving: boolean
  /** The write's error sentence (`''` when none). */
  error: string
  saved: boolean
}>()
const draft = defineModel<string>({ required: true })
const emit = defineEmits<{ save: [] }>()

const { t } = useI18n()
</script>
