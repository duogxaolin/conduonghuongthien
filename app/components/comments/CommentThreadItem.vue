<!--
  Một bình luận gốc của luồng công khai, cùng một cấp trả lời và khung trả lời của nó.

  Chỉ hiển thị (tách từ ArticleComments.vue ở wave3 4.2): props vào, emit ra, `v-model`
  cho khung trả lời. Không tự fetch, không giữ state của luồng — hành động nào cũng do
  ArticleComments.vue (qua `useCommentWrites`/`useCommentAnchor`) thực hiện.

  Thân bình luận vẽ bằng `{{ }}` + `whitespace-pre-line break-words`, KHÔNG BAO GIỜ
  `v-html` — cùng luật với cả luồng (xem đầu ArticleComments.vue).
-->
<template>
  <article
    :id="`comment-${comment.id}`"
    class="bg-white border rounded-lg p-4 transition-colors duration-700"
    :class="highlightId === comment.id
      ? 'border-accent bg-surface-tint ring-2 ring-[#7CB342]/40'
      : 'border-line'"
  >
    <div class="flex gap-3">
      <ReaderAvatar :initials="comment.initials" :is-admin="comment.isAdminReply" />
      <div class="flex-grow min-w-0">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
          <span class="font-bold text-[0.92rem] text-ink">{{ comment.authorName }}</span>
          <span
            v-if="comment.isAdminReply"
            class="px-2 py-0.5 rounded-full bg-brand-600 text-white text-[0.7rem] font-bold uppercase tracking-wide"
          >{{ t('admin_badge') || 'Ban quản trị' }}</span>
          <span class="text-[0.78rem] text-ink-soft">{{ formatDateVN(comment.createdAt) }}</span>
        </div>
        <p class="m-0 text-[0.95rem] leading-[1.6] text-[#2C3529] whitespace-pre-line break-words">{{ comment.body }}</p>

        <div class="mt-2.5 flex flex-wrap items-center gap-3">
          <button
            v-if="canReply"
            type="button"
            class="text-[0.82rem] font-semibold text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded"
            @click="emit('toggle-reply', comment.id)"
          >
            <i class="fa-solid fa-reply mr-1" aria-hidden="true"></i>{{ t('reply') || 'Trả lời' }}
          </button>
          <!-- Mỗi bình luận có địa chỉ riêng, chia sẻ được — cùng ý với
               neo `#qa-<id>` của /qa-documents. -->
          <button
            type="button"
            class="text-[0.82rem] font-semibold text-ink-soft hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded"
            @click="emit('copy-link', comment.id)"
          >
            <i class="fa-solid fa-link mr-1" aria-hidden="true"></i>
            {{ copiedId === comment.id ? (t('link_copied') || 'Đã chép liên kết') : (t('copy_link') || 'Chép liên kết') }}
          </button>
          <button
            v-if="comment.canDelete"
            type="button"
            class="text-[0.82rem] font-semibold text-danger-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2A0A0] rounded"
            :disabled="deletingId === comment.id"
            @click="emit('remove', comment)"
          >
            <i class="fa-solid fa-trash-can mr-1" aria-hidden="true"></i>
            {{ deletingId === comment.id ? (t('deleting') || 'Đang xoá…') : (t('delete') || 'Xoá') }}
          </button>
        </div>

        <!-- Trả lời một cấp. Không lồng sâu hơn: sâu hơn thì một cuộc
             trao đổi dài thành cái thang thụt lề không đọc được trên
             điện thoại. -->
        <ul v-if="comment.replies && comment.replies.length" class="list-none p-0 mt-4 mb-0 flex flex-col gap-3 border-l-2 border-line pl-4">
          <li v-for="reply in comment.replies" :key="reply.id">
            <div
              :id="`comment-${reply.id}`"
              class="flex gap-2.5 rounded-lg transition-colors duration-700"
              :class="highlightId === reply.id ? 'bg-surface-tint ring-2 ring-[#7CB342]/40 p-2 -m-2' : ''"
            >
              <ReaderAvatar :initials="reply.initials" :is-admin="reply.isAdminReply" size="sm" />
              <div class="flex-grow min-w-0">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                  <span class="font-bold text-[0.86rem] text-ink">{{ reply.authorName }}</span>
                  <span
                    v-if="reply.isAdminReply"
                    class="px-2 py-0.5 rounded-full bg-brand-600 text-white text-[0.68rem] font-bold uppercase tracking-wide"
                  >{{ t('admin_badge') }}</span>
                  <span class="text-[0.75rem] text-ink-soft">{{ formatDateVN(reply.createdAt) }}</span>
                </div>
                <p class="m-0 text-[0.9rem] leading-[1.55] text-[#2C3529] whitespace-pre-line break-words">{{ reply.body }}</p>
                <div class="mt-1.5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    class="text-[0.8rem] font-semibold text-ink-soft hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 rounded"
                    @click="emit('copy-link', reply.id)"
                  >
                    <i class="fa-solid fa-link mr-1" aria-hidden="true"></i>
                    {{ copiedId === reply.id ? t('link_copied') : t('copy_link') }}
                  </button>
                  <button
                    v-if="reply.canDelete"
                    type="button"
                    class="text-[0.8rem] font-semibold text-danger-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2A0A0] rounded"
                    :disabled="deletingId === reply.id"
                    @click="emit('remove', reply)"
                  >
                    <i class="fa-solid fa-trash-can mr-1" aria-hidden="true"></i>
                    {{ deletingId === reply.id ? t('deleting') : t('delete') }}
                  </button>
                </div>
              </div>
            </div>
          </li>
        </ul>

        <!-- Khung trả lời, ngay dưới bình luận nó trả lời -->
        <form v-if="replyTo === comment.id" class="mt-3" @submit.prevent="emit('submit-reply', comment.id)">
          <textarea
            v-model="replyBody"
            rows="3"
            :maxlength="MAX_LENGTH"
            :disabled="submitting"
            :placeholder="t('c_reply_placeholder')"
            class="w-full px-3.5 py-2.5 border border-line-strong rounded-lg text-[0.92rem] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15 box-border resize-y"
          ></textarea>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="submit" class="btn btn-primary text-[0.85rem]" :disabled="submitting || !replyBody.trim()">
              {{ submitting ? t('sending') : t('c_send_reply') }}
            </button>
            <button type="button" class="text-[0.85rem] font-semibold text-ink-secondary hover:underline" @click="emit('cancel-reply')">{{ t('c_cancel') }}</button>
          </div>
        </form>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { formatDateVN } from '~/utils/formatDate'
import { useI18n } from '~/composables/useI18n'
import { COMMENT_MAX_LENGTH } from '~/utils/comment-thread'
import type { PublicCommentItem } from '~/types/public-api'

defineProps<{
  comment: PublicCommentItem
  /** Bình luận đang được tô sáng sau cú cuộn tới neo `#comment-<id>`. */
  highlightId: number | null
  /** Bình luận vừa được chép liên kết (nhãn đổi trong 2 giây). */
  copiedId: number | null
  deletingId: number | null
  /** Bình luận gốc đang mở khung trả lời. */
  replyTo: number | null
  /** Đã đăng nhập VÀ luồng đang mở bình luận. */
  canReply: boolean
  submitting: boolean
}>()

const emit = defineEmits<{
  'toggle-reply': [id: number]
  'copy-link': [id: number]
  'remove': [comment: PublicCommentItem]
  'submit-reply': [parentId: number]
  'cancel-reply': []
}>()

const replyBody = defineModel<string>('replyBody', { required: true })

const { t } = useI18n()
const MAX_LENGTH = COMMENT_MAX_LENGTH
</script>
