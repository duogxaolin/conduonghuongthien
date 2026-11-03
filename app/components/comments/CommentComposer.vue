<!--
  Cuối luồng bình luận: lời mời đăng nhập (4) hoặc khung soạn (5).

  Chỉ hiển thị (tách từ ArticleComments.vue ở wave3 4.2): `v-model` cho nội dung, "Gửi"
  và "Đăng nhập" phát lên cho ArticleComments.vue. Hai ô `role="alert"` ở đây là lỗi GỬI
  (phiên hết hạn, máy chủ từ chối) — đi theo khung của nó; nhánh lỗi TẢI luồng + "thử lại"
  ở lại ArticleComments.vue.
-->
<template>
  <div v-if="!isSignedIn" class="bg-surface border border-line rounded-lg px-5 py-6 text-center">
    <!-- 4. Chưa đăng nhập -->
    <!-- Lý do phải hiện Ở ĐÂY, không phải trong form.

         Khi phiên hết hạn giữa lúc trang đang mở, `forgetReader()` thay khung
         soạn bằng khối này — và `submitError` sống trong khung soạn, nên nó
         biến mất cùng lúc. Không có dòng dưới đây thì người đọc bấm "Gửi",
         thấy form đột nhiên đổi thành một nút đăng nhập, và **không có gì nói
         vì sao**: nội dung họ vừa gõ cũng đi theo form. Nói rõ nguyên nhân là
         thứ biến một thay đổi khó hiểu thành một việc họ hiểu và làm được. -->
    <p v-if="sessionLapsed" role="alert" class="m-0 mb-3 text-[0.92rem] font-semibold text-danger-soft">
      <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>
      {{ t('c_session_lapsed') }}
      <span v-if="body.trim()" class="block mt-1 font-normal text-ink-secondary">
        {{ t('c_session_lapsed_keep') }}
      </span>
    </p>
    <p class="m-0 mb-3 text-[0.95rem] text-ink-secondary">
      {{ t('c_google_login_desc') }}
    </p>
    <button type="button" class="btn btn-primary" @click="emit('sign-in')">
      <i class="fa-solid fa-right-to-bracket mr-2" aria-hidden="true"></i>{{ t('c_google_login_btn') }}
    </button>
  </div>

  <form v-else class="bg-white border border-line rounded-lg p-4" @submit.prevent="emit('submit')">
    <!-- 5. Khung soạn bình luận -->
    <label for="comment-body" class="block mb-2 text-[0.9rem] font-bold text-brand-800">{{ t('c_your_comment') }}</label>
    <textarea
      id="comment-body"
      v-model="body"
      rows="4"
      :maxlength="MAX_LENGTH"
      :disabled="submitting"
      :placeholder="t('c_placeholder')"
      class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-[0.95rem] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 box-border resize-y"
    ></textarea>

    <p v-if="submitError" role="alert" class="mt-2 mb-0 text-[0.88rem] text-danger-soft">
      <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ submitError }}
    </p>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <span class="text-[0.8rem] text-ink-soft">{{ body.length }} / {{ MAX_LENGTH }} {{ t('c_chars') }}</span>
      <button type="submit" class="btn btn-primary" :disabled="submitting || !body.trim()">
        {{ submitting ? t('sending') : t('c_send') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { COMMENT_MAX_LENGTH } from '~/utils/comment-thread'

defineProps<{
  isSignedIn: boolean
  /** Phiên vừa hết hạn giữa lúc gửi (401) — lý do hiện trên khối đăng nhập. */
  sessionLapsed: boolean
  submitting: boolean
  submitError: string
}>()
const emit = defineEmits<{ 'sign-in': []; submit: [] }>()

const body = defineModel<string>('body', { required: true })

const { t } = useI18n()
const MAX_LENGTH = COMMENT_MAX_LENGTH
</script>
