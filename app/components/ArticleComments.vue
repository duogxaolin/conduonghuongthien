<!--
  Public comment thread for one item — an article or a media item.

  Which item is the `mediaItemId` prop: absent means an article addressed by
  `slug`, present means a media item addressed by the same `slug`. That is the
  ONLY axis this component is parameterized on, because it is the only axis the
  engine itself is parameterized on (`resolveCommentTarget`). Duplicating the
  component for videos would have produced two threads that drift — one of them
  keeping notifications, or the draft-recovery path, and the other not, with
  nothing reporting the difference.

  Everything here is fetched AFTER MOUNT. The article routes are served with
  `swr: 60` (nuxt.config.ts), so a thread rendered on the server would be handed
  to the next visitor from cache — including the `canDelete` flags that say which
  comments are the *current* reader's to remove. That is why no route is added to
  routeRules for any of this, and why the whole section renders empty on the
  server.

  Bodies are rendered with `{{ }}` and `whitespace-pre-line break-words`, never
  `v-html` — the same rule /qa-documents follows. The server stores what a
  citizen typed verbatim precisely because this template cannot interpret it.
-->
<template>
  <section
    v-if="enabled || pending || errorMessage"
    class="mt-12 border-t border-[#E2E8DF] pt-8"
    aria-labelledby="comments-heading"
  >
    <h2 id="comments-heading" class="m-0 mb-5 text-[1.15rem] font-extrabold text-[#1E251C]">
      <i class="fa-solid fa-comments mr-2 text-[#7CB342]" aria-hidden="true"></i>{{ t('comments') }}
      <span v-if="total" class="ml-1 text-[0.95rem] font-semibold text-[#7A8675]">({{ total }})</span>
    </h2>

    <!-- 1. Đang tải -->
    <div v-if="pending" role="status" aria-busy="true" class="flex flex-col gap-4">
      <span class="sr-only">Đang tải bình luận</span>
      <div
        v-for="n in 3"
        :key="n"
        aria-hidden="true"
        class="flex gap-3 animate-pulse motion-reduce:animate-none"
      >
        <div class="w-9 h-9 rounded-full bg-[#EEF2EC] shrink-0"></div>
        <div class="flex-grow flex flex-col gap-2">
          <div class="h-3 w-32 bg-[#EEF2EC] rounded"></div>
          <div class="h-4 w-full bg-[#EEF2EC] rounded"></div>
          <div class="h-4 w-3/4 bg-[#EEF2EC] rounded"></div>
        </div>
      </div>
    </div>

    <!-- 2. Lỗi. Nút thử lại gọi lại chính lượt fetch đã hỏng, không tải lại
         trang: bài viết ở trên vẫn đọc được và không có lý do gì để mất nó. -->
    <div
      v-else-if="errorMessage"
      role="alert"
      class="bg-white border border-dashed border-[#E2A0A0] px-6 py-8 rounded-lg text-center text-[#B04A4A] text-[0.95rem]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ errorMessage }} Vui lòng
      <button type="button" class="text-[#4A6741] font-bold underline" @click="loadThread()">thử lại</button>.
    </div>

    <template v-else>
      <!-- Banner thông báo thu hồi bình luận sau kiểm duyệt AI mà không cần reload trang -->
      <div
        v-if="revokedNotice"
        role="alert"
        class="mb-5 rounded-lg border border-[#f0c0c0] bg-[#fff5f4] p-3.5 text-xs text-[#a32924] flex items-center justify-between gap-3 animate-fadeIn"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-base shrink-0 text-[#d12420]" aria-hidden="true"></i>
          <span><strong>{{ t('c_revoked_label') }}</strong> {{ revokedNotice }}</span>
        </div>
        <button
          type="button"
          class="text-[#a32924] hover:text-black font-bold text-sm p-1 border-none bg-transparent cursor-pointer shrink-0"
          :title="t('c_close_notice')"
          @click="revokedNotice = ''"
        >✕</button>
      </div>

      <!-- 3. Chưa có bình luận -->
      <p v-if="!comments.length" class="bg-[#F7FAF6] border border-[#E2E8DF] rounded-lg px-6 py-8 text-center text-[0.95rem] text-[#4A5545] m-0 mb-6">
        {{ t('no_comments_yet') || 'Chưa có bình luận nào. Hãy là người đầu tiên đặt câu hỏi hoặc chia sẻ ý kiến về nội dung này.' }}
      </p>

      <ul v-else class="list-none p-0 m-0 mb-6 flex flex-col gap-5">
        <li v-for="comment in comments" :key="comment.id">
          <article
            :id="`comment-${comment.id}`"
            class="bg-white border rounded-lg p-4 transition-colors duration-700"
            :class="highlightId === comment.id
              ? 'border-[#7CB342] bg-[#F4F9F0] ring-2 ring-[#7CB342]/40'
              : 'border-[#E2E8DF]'"
          >
            <div class="flex gap-3">
              <ReaderAvatar :initials="comment.initials" :is-admin="comment.isAdminReply" />
              <div class="flex-grow min-w-0">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
                  <span class="font-bold text-[0.92rem] text-[#1E251C]">{{ comment.authorName }}</span>
                  <span
                    v-if="comment.isAdminReply"
                    class="px-2 py-0.5 rounded-full bg-[#4A6741] text-white text-[0.7rem] font-bold uppercase tracking-wide"
                  >{{ t('admin_badge') || 'Ban quản trị' }}</span>
                  <span class="text-[0.78rem] text-[#7A8675]">{{ formatDateVN(comment.createdAt) }}</span>
                </div>
                <p class="m-0 text-[0.95rem] leading-[1.6] text-[#2C3529] whitespace-pre-line break-words">{{ comment.body }}</p>

                <div class="mt-2.5 flex flex-wrap items-center gap-3">
                  <button
                    v-if="isSignedIn && enabled"
                    type="button"
                    class="text-[0.82rem] font-semibold text-[#4A6741] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] rounded"
                    @click="toggleReply(comment.id)"
                  >
                    <i class="fa-solid fa-reply mr-1" aria-hidden="true"></i>{{ t('reply') || 'Trả lời' }}
                  </button>
                  <!-- Mỗi bình luận có địa chỉ riêng, chia sẻ được — cùng ý với
                       neo `#qa-<id>` của /qa-documents. -->
                  <button
                    type="button"
                    class="text-[0.82rem] font-semibold text-[#7A8675] hover:text-[#4A6741] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] rounded"
                    @click="copyLink(comment.id)"
                  >
                    <i class="fa-solid fa-link mr-1" aria-hidden="true"></i>
                    {{ copiedId === comment.id ? (t('link_copied') || 'Đã chép liên kết') : (t('copy_link') || 'Chép liên kết') }}
                  </button>
                  <button
                    v-if="comment.canDelete"
                    type="button"
                    class="text-[0.82rem] font-semibold text-[#B04A4A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2A0A0] rounded"
                    :disabled="deletingId === comment.id"
                    @click="removeComment(comment)"
                  >
                    <i class="fa-solid fa-trash-can mr-1" aria-hidden="true"></i>
                    {{ deletingId === comment.id ? (t('deleting') || 'Đang xoá…') : (t('delete') || 'Xoá') }}
                  </button>
                </div>

                <!-- Trả lời một cấp. Không lồng sâu hơn: sâu hơn thì một cuộc
                     trao đổi dài thành cái thang thụt lề không đọc được trên
                     điện thoại. -->
                <ul v-if="comment.replies && comment.replies.length" class="list-none p-0 mt-4 mb-0 flex flex-col gap-3 border-l-2 border-[#E2E8DF] pl-4">
                  <li v-for="reply in comment.replies" :key="reply.id">
                    <div
                      :id="`comment-${reply.id}`"
                      class="flex gap-2.5 rounded-lg transition-colors duration-700"
                      :class="highlightId === reply.id ? 'bg-[#F4F9F0] ring-2 ring-[#7CB342]/40 p-2 -m-2' : ''"
                    >
                      <ReaderAvatar :initials="reply.initials" :is-admin="reply.isAdminReply" size="sm" />
                      <div class="flex-grow min-w-0">
                        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                          <span class="font-bold text-[0.86rem] text-[#1E251C]">{{ reply.authorName }}</span>
                          <span
                            v-if="reply.isAdminReply"
                            class="px-2 py-0.5 rounded-full bg-[#4A6741] text-white text-[0.68rem] font-bold uppercase tracking-wide"
                          >{{ t('admin_badge') }}</span>
                          <span class="text-[0.75rem] text-[#7A8675]">{{ formatDateVN(reply.createdAt) }}</span>
                        </div>
                        <p class="m-0 text-[0.9rem] leading-[1.55] text-[#2C3529] whitespace-pre-line break-words">{{ reply.body }}</p>
                        <div class="mt-1.5 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            class="text-[0.8rem] font-semibold text-[#7A8675] hover:text-[#4A6741] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] rounded"
                            @click="copyLink(reply.id)"
                          >
                            <i class="fa-solid fa-link mr-1" aria-hidden="true"></i>
                            {{ copiedId === reply.id ? t('link_copied') : t('copy_link') }}
                          </button>
                          <button
                            v-if="reply.canDelete"
                            type="button"
                            class="text-[0.8rem] font-semibold text-[#B04A4A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2A0A0] rounded"
                            :disabled="deletingId === reply.id"
                            @click="removeComment(reply)"
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
                <form v-if="replyTo === comment.id" class="mt-3" @submit.prevent="submit(comment.id)">
                  <textarea
                    v-model="replyBody"
                    rows="3"
                    :maxlength="MAX_LENGTH"
                    :disabled="submitting"
                    :placeholder="t('c_reply_placeholder')"
                    class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.92rem] outline-none focus:border-[#4A6741] focus:ring-2 focus:ring-[#4A6741]/15 box-border resize-y"
                  ></textarea>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <button type="submit" class="btn btn-primary text-[0.85rem]" :disabled="submitting || !replyBody.trim()">
                      {{ submitting ? t('sending') : t('c_send_reply') }}
                    </button>
                    <button type="button" class="text-[0.85rem] font-semibold text-[#4A5545] hover:underline" @click="cancelReply">{{ t('c_cancel') }}</button>
                  </div>
                </form>
              </div>
            </div>
          </article>
        </li>
      </ul>

      <!-- Pending (optimistic) comments — only the sender sees these.
           Dimmed while sending, red on failure with retry/dismiss. -->
      <ul v-if="pendingComments.length" class="list-none p-0 m-0 mb-6 flex flex-col gap-3" :aria-label="t('c_section_title')">
        <li v-for="p in pendingComments" :key="p.tempId" class="transition-opacity">
          <div
            class="rounded-lg p-4 border"
            :class="p.status === 'error'
              ? 'border-[#f0c0c0] bg-[#fff5f4]'
              : 'border-[#E2E8DF] bg-[#F8FAF7] opacity-60'"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <span v-if="p.status === 'sending'" class="inline-flex items-center gap-1.5 text-[0.78rem] text-[#7A8675] font-medium">
                <i class="fa-solid fa-circle-notch fa-spin text-[0.7rem]" aria-hidden="true"></i>
                {{ t('sending') || 'Đang gửi…' }}
              </span>
              <span v-else class="inline-flex items-center gap-1.5 text-[0.78rem] text-[#B04A4A] font-medium" role="alert">
                <i class="fa-solid fa-circle-exclamation text-[0.75rem]" aria-hidden="true"></i>
                {{ p.error }}
              </span>
            </div>
            <p class="m-0 text-[0.95rem] leading-[1.6] text-[#2C3529] whitespace-pre-line break-words">{{ p.body }}</p>
            <div v-if="p.status === 'error'" class="mt-2 flex gap-3">
              <button type="button" class="text-[0.82rem] font-semibold text-[#4A6741] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] rounded" @click="retryPendingComment(p.tempId)">
                <i class="fa-solid fa-rotate-right mr-1" aria-hidden="true"></i>{{ t('retry') || 'Thử lại' }}
              </button>
              <button type="button" class="text-[0.82rem] font-semibold text-[#7A8675] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2A0A0] rounded" @click="dismissPendingComment(p.tempId)">
                <i class="fa-solid fa-xmark mr-1" aria-hidden="true"></i>{{ t('dismiss') || 'Bỏ qua' }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="totalPages > 1" class="mb-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-[#E2E8DF] bg-white text-[0.85rem] font-semibold text-[#4A5545] disabled:opacity-50"
          :disabled="page <= 1 || pending"
          @click="goToPage(page - 1)"
        >{{ t('page_prev') || 'Trang trước' }}</button>
        <span class="text-[0.85rem] text-[#4A5545]">{{ t('page_of') || 'Trang' }} {{ page }} / {{ totalPages }}</span>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-[#E2E8DF] bg-white text-[0.85rem] font-semibold text-[#4A5545] disabled:opacity-50"
          :disabled="page >= totalPages || pending"
          @click="goToPage(page + 1)"
        >{{ t('page_next') || 'Trang sau' }}</button>
      </div>

      <!-- 4. Chưa đăng nhập -->
      <div v-if="!isSignedIn" class="bg-[#F7FAF6] border border-[#E2E8DF] rounded-lg px-5 py-6 text-center">
        <!-- Lý do phải hiện Ở ĐÂY, không phải trong form.

             Khi phiên hết hạn giữa lúc trang đang mở, `forgetReader()` thay khung
             soạn bằng khối này — và `submitError` sống trong khung soạn, nên nó
             biến mất cùng lúc. Không có dòng dưới đây thì người đọc bấm "Gửi",
             thấy form đột nhiên đổi thành một nút đăng nhập, và **không có gì nói
             vì sao**: nội dung họ vừa gõ cũng đi theo form. Nói rõ nguyên nhân là
             thứ biến một thay đổi khó hiểu thành một việc họ hiểu và làm được. -->
        <p v-if="sessionLapsed" role="alert" class="m-0 mb-3 text-[0.92rem] font-semibold text-[#B04A4A]">
          <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>
          {{ t('c_session_lapsed') }}
          <span v-if="body.trim()" class="block mt-1 font-normal text-[#4A5545]">
            {{ t('c_session_lapsed_keep') }}
          </span>
        </p>
        <p class="m-0 mb-3 text-[0.95rem] text-[#4A5545]">
          {{ t('c_google_login_desc') }}
        </p>
        <button type="button" class="btn btn-primary" @click="signIn()">
          <i class="fa-solid fa-right-to-bracket mr-2" aria-hidden="true"></i>{{ t('c_google_login_btn') }}
        </button>
      </div>

      <!-- 5. Khung soạn bình luận -->
      <form v-else class="bg-white border border-[#E2E8DF] rounded-lg p-4" @submit.prevent="submit(null)">
        <label for="comment-body" class="block mb-2 text-[0.9rem] font-bold text-[#385130]">{{ t('c_your_comment') }}</label>
        <textarea
          id="comment-body"
          v-model="body"
          rows="4"
          :maxlength="MAX_LENGTH"
          :disabled="submitting"
          :placeholder="t('c_placeholder')"
          class="w-full px-3.5 py-2.5 border border-[#c8d6c9] rounded-lg text-[0.95rem] outline-none focus:border-[#4A6741] focus:ring-2 focus:ring-[#4A6741]/15 box-border resize-y"
        ></textarea>

        <p v-if="submitError" role="alert" class="mt-2 mb-0 text-[0.88rem] text-[#B04A4A]">
          <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ submitError }}
        </p>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span class="text-[0.8rem] text-[#7A8675]">{{ body.length }} / {{ MAX_LENGTH }} {{ t('c_chars') }}</span>
          <button type="submit" class="btn btn-primary" :disabled="submitting || !body.trim()">
            {{ submitting ? t('sending') : t('c_send') }}
          </button>
        </div>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { formatDateVN } from '~/utils/formatDate'
import { useReaderAuth } from '~/composables/useReaderAuth'
import { useI18n } from '~/composables/useI18n'

const { t } = useI18n()
// Đổi tên khi import: `errorMessage` đã là một `ref` cục bộ trong tệp này (thông
// báo lỗi của lượt tải luồng), nên nhập trùng tên là xung đột khai báo.
import { errorMessage as messageFrom, errorStatus } from '~/utils/errorMessage'
import type { CommentThreadPayload, PublicCommentItem } from '~/types/public-api'

const props = defineProps<{
  /** The article's or the media item's slug — whichever `mediaItemId` says. */
  slug: string
  /**
   * Set for a media item, absent for an article.
   *
   * This is the switch, not the slug: article slugs and media slugs are unique
   * within their own table and nothing stops the same string existing in both, so
   * a slug alone cannot say which item a thread belongs to. The two namespaces
   * are also served by different endpoints, so guessing here would read the wrong
   * thread rather than fail.
   */
  mediaItemId?: number | null
}>()

/** True when this thread belongs to a media item rather than an article. */
const isMedia = computed(() => typeof props.mediaItemId === 'number' && props.mediaItemId > 0)

/**
 * Where this thread lives, as one place.
 *
 * The SAME path for both kinds — `/api/public/comments/<slug>` — with `source`
 * naming which table the slug is looked up in. Not a separate media path: the
 * two endpoints already exist and are already tested, and the item kind is the
 * one thing that differs, so a second route file would be a second place for the
 * paging, the reader-identity check, and the "comments are off" branch to be
 * written slightly differently.
 *
 * `source` is omitted for an article rather than sent as `source=article`. An
 * absent parameter reads as the old behaviour, so the request an existing article
 * page sends is unchanged byte for byte — and the server side parses this with
 * the same `parseCommentSource` the moderation filter uses, which refuses an
 * unknown value instead of quietly falling back to articles.
 */
const threadPath = `/api/public/comments/${encodeURIComponent(props.slug)}`

const threadQuery = computed(() => isMedia.value
  ? { page: page.value, source: 'media' }
  : { page: page.value })

/**
 * The identifier the write endpoint reads, named as that endpoint already names
 * it.
 *
 * `articleSlug` is untouched; media adds `mediaSlug` beside it. Renaming the
 * existing field to a neutral `slug` would be a change to a contract that is
 * already serving production comments, and the engine's XOR guard means the
 * server can tell the two apart without a discriminator — exactly one of the two
 * fields may be present.
 */
const writeBody = computed(() => isMedia.value
  ? { mediaSlug: props.slug }
  : { articleSlug: props.slug })

/** Mirrors COMMENT_MAX_LENGTH on the server. The server is the authority; this
 *  only stops the reader typing past a limit the write would then refuse. */
const MAX_LENGTH = 2000

/** Bao lâu thì bỏ tô sáng. Đủ để mắt bắt được sau cú cuộn, đủ ngắn để không
 *  biến thành một trạng thái thường trực khiến bình luận trông như bị đánh dấu. */
const HIGHLIGHT_MS = 3000

const { isSignedIn, signIn, load: loadReader, forgetReader } = useReaderAuth()
const route = useRoute()

// `ref([])` trần suy ra `Ref<never[]>` trong một tệp typed, nên MỌI phép đọc
// trường trên phần tử thành lỗi — dấu hiệu hình dạng này chưa từng được khai ở
// đâu, không phải một bất tiện của trình kiểm kiểu. Kiểu suy từ chính handler
// (`app/types/public-api.ts`), nên đổi projection ở máy chủ là mọi phép đọc sai
// ở đây đỏ ngay lượt typecheck kế tiếp.
const comments = ref<PublicCommentItem[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const revokedNotice = ref('')

/** Checkpoint theo dõi kết quả kiểm duyệt AI ngầm: tự động thu hồi và gỡ bình luận nếu AI phát hiện vi phạm mà KHÔNG CẦN TẢI LẠI TRANG. */
function startModerationCheckpoint(commentId: number) {
  const intervals = [2500, 6000, 11000, 18000]
  for (const delay of intervals) {
    window.setTimeout(async () => {
      const existsTop = comments.value.some(c => c.id === commentId)
      const existsReply = comments.value.some(c => c.replies?.some(r => r.id === commentId))
      if (!existsTop && !existsReply) return

      try {
        const res = await ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<{ ok: boolean; items: Array<{ id: number; isHidden: boolean; flagReason: string | null }> }>)(
          '/api/public/comments/checkpoint',
          { query: { ids: String(commentId) } },
        )
        const match = res?.items?.find(i => i.id === commentId)
        if (match && match.isHidden) {
          const topIdx = comments.value.findIndex(c => c.id === commentId)
          if (topIdx !== -1) {
            comments.value.splice(topIdx, 1)
            total.value = Math.max(0, total.value - 1)
          } else {
            for (const c of comments.value) {
              if (c.replies) {
                const rIdx = c.replies.findIndex(r => r.id === commentId)
                if (rIdx !== -1) {
                  c.replies.splice(rIdx, 1)
                  break
                }
              }
            }
          }
          revokedNotice.value = t('c_revoked_template').replace('{reason}', match.flagReason || t('c_revoked_default'))
        }
      } catch {
        // Non-blocking checkpoint lookup
      }
    }, delay)
  }
}
const enabled = ref(false)
const pending = ref(true)
const errorMessage = ref('')
const pendingComments = ref<Array<{
  tempId: number
  parentId: number | null
  body: string
  status: 'sending' | 'error'
  error: string
}>>([])
const body = ref('')
const replyTo = ref<number | null>(null)
const replyBody = ref('')
const submitting = ref(false)
const submitError = ref('')
const deletingId = ref<number | null>(null)
const sessionLapsed = ref(false)
const highlightId = ref<number | null>(null)
const copiedId = ref<number | null>(null)

/**
 * Id bình luận nêu trong `#comment-<id>`.
 *
 * Cùng cách đọc mà /qa-documents dùng cho `#qa-<id>`: `Number.isSafeInteger`
 * chứ không chỉ `Number`, nếu không một hash rác sẽ thành `NaN` rồi đi tiếp vào
 * `getElementById` như chuỗi "NaN".
 */
function anchoredCommentId() {
  const raw = Number(String(route.hash || '').replace('#comment-', ''))
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null
}

/**
 * Cuộn tới bình luận được trỏ tới và tô sáng nó một lúc.
 *
 * Phải chạy SAU khi luồng đã vẽ (`nextTick`), không thì phần tử chưa tồn tại và
 * lượt cuộn im lặng không làm gì. Nếu không tìm thấy id — bình luận đã bị xoá, hay
 * liên kết trỏ sang trang khác — thì **không làm gì cả**: cuộn về đầu danh sách sẽ
 * trông như đã tới đúng chỗ trong khi không phải vậy.
 */
async function focusAnchoredComment() {
  const id = anchoredCommentId()
  if (!id || typeof window === 'undefined') return

  await nextTick()
  const element = document.getElementById(`comment-${id}`)
  if (!element) return

  // Người bật giảm chuyển động vẫn cần tới đúng chỗ — chỉ bỏ phần cuộn mượt.
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })

  highlightId.value = id
  window.setTimeout(() => {
    if (highlightId.value === id) highlightId.value = null
  }, HIGHLIGHT_MS)
}

/**
 * Chép địa chỉ của một bình luận.
 *
 * Dựng từ `window.location` chứ không ghép chuỗi từ slug: trang này tới được từ
 * nhiều nơi và địa chỉ thật là thứ duy nhất chắc chắn mở lại đúng nó. Giữ luôn
 * `?page=` của trang đang xem, nếu không thì liên kết tới một bình luận ở
 * trang 3 sẽ mở trang 1 và không tìm thấy gì.
 */
async function copyLink(id: number) {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  url.hash = `comment-${id}`
  if (page.value > 1) url.searchParams.set('comments', String(page.value))
  else url.searchParams.delete('comments')

  try {
    await navigator.clipboard.writeText(url.toString())
    copiedId.value = id
    window.setTimeout(() => { if (copiedId.value === id) copiedId.value = null }, 2000)
  } catch {
    // Clipboard bị từ chối (không phải HTTPS, hoặc người dùng chặn). Ghi địa chỉ
    // vào thanh URL để vẫn còn cách chép tay, thay vì báo một lỗi không làm gì.
    window.history.replaceState(null, '', url.toString())
  }
}

/**
 * Nháp sống qua lượt điều hướng đăng nhập lại.
 *
 * `sessionStorage`, không `localStorage`: nháp này chỉ có nghĩa trong đúng tab và
 * đúng lượt duyệt hiện tại. Giữ lâu hơn thì một câu hỏi bỏ dở nửa năm trước sẽ
 * hiện lại trên máy dùng chung — nội dung của người khác, trong khung soạn của
 * người đang ngồi đó.
 *
 * Khoá gắn theo slug nên hai bài viết không tráo nháp của nhau. Mọi lỗi bị nuốt:
 * Safari ở chế độ riêng tư ném khi ghi storage, và một nháp không lưu được không
 * có tư cách làm hỏng trang.
 */
const DRAFT_KEY = `cdkt:comment-draft:${props.slug}`

function saveDraft() {
  try {
    const text = body.value.trim()
    if (text) window.sessionStorage.setItem(DRAFT_KEY, body.value)
  } catch { /* storage không dùng được — nháp là tiện ích, không phải hợp đồng */ }
}

function clearDraft() {
  try { window.sessionStorage.removeItem(DRAFT_KEY) } catch { /* như trên */ }
}

function restoreDraft() {
  try {
    const saved = window.sessionStorage.getItem(DRAFT_KEY)
    if (saved && !body.value) body.value = saved
    // Dọn ngay sau khi phục hồi: để lại thì lượt tải trang sau sẽ điền lại một
    // nháp mà người đọc có thể đã cố ý bỏ.
    window.sessionStorage.removeItem(DRAFT_KEY)
  } catch { /* như trên */ }
}

async function loadThread() {
  pending.value = true
  errorMessage.value = ''
  try {
    // Kiểu tường minh: `$fetch` trên một URL dựng bằng template string không suy
    // được tuyến nào, nên nó trả `{}` và mọi phép đọc trường thành lỗi.
    const response = await ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<CommentThreadPayload>)(
      threadPath,
      { query: threadQuery.value },
    )
    comments.value = response?.comments || []
    total.value = response?.total || 0
    totalPages.value = response?.totalPages || 1
    enabled.value = Boolean(response?.enabled)
  } catch {
    // A failed fetch must not read as "this article has no comments" — that is
    // the same screen as an empty thread, and a reader would conclude nobody has
    // written anything.
    errorMessage.value = 'Không thể tải bình luận.'
  } finally {
    pending.value = false
  }
}

function goToPage(next: number) {
  if (next < 1 || next > totalPages.value) return
  page.value = next
  // Tô sáng thuộc về bình luận ở trang trước; giữ lại thì sau khi đổi trang nó
  // sẽ tô nhầm một bình luận khác trùng vị trí.
  highlightId.value = null
  loadThread()
}

function toggleReply(id: number) {
  replyTo.value = replyTo.value === id ? null : id
  replyBody.value = ''
  submitError.value = ''
}

function cancelReply() {
  replyTo.value = null
  replyBody.value = ''
}

/**
 * Turn a rejected request into a message, and re-sync the sign-in state when the
 * server says the ticket is gone.
 *
 * The 401 branch is the one that matters. A reader ticket lives 30 days, so it can
 * lapse while an article page sits open — and a ban bumps `tokenVersion`, which
 * has the same effect immediately. Without this the cached `isSignedIn` stays
 * true, so the compose box keeps rendering with "Chưa đăng nhập" printed under it
 * and no sign-in button anywhere: a dead end whose only exit is a manual reload.
 * Dropping the stale identity swaps the form for the sign-in prompt, which is a
 * screen the reader can act on.
 *
 * 403 is deliberately NOT treated the same way. That is a ban, and the reader IS
 * still signed in — offering them a sign-in button would invite a round trip that
 * succeeds and changes nothing, reading as a broken portal rather than a decision
 * somebody made.
 */
function reportFailure(error: unknown, fallback: string): string {
  // Qua `errorStatus()` thay vì tự dò bốn đường trên một giá trị `unknown`: đó là
  // helper dùng chung đã bao cả `statusCode`, `status` và `response.status`.
  const status = errorStatus(error)
  if (status === 401) {
    sessionLapsed.value = true
    // Lưu nháp TRƯỚC khi bỏ danh tính. `signIn()` là một lượt điều hướng cấp
    // trang thật (window.location.href — luồng OAuth là chuỗi redirect qua
    // accounts.google.com, không làm được trong XHR), nên mọi state trong bộ nhớ
    // của component này biến mất. Không lưu ra sessionStorage thì lời hứa "nội
    // dung vẫn được giữ" là một lời nói dối, và người đọc mất đúng ba đoạn văn họ
    // vừa gõ ở đúng lúc họ được bảo là không mất.
    saveDraft()
    forgetReader()
  }
  return messageFrom(error, fallback)
}

async function submit(parentId: number | null) {
  const text = parentId === null ? body.value : replyBody.value
  if (!text.trim() || submitting.value) return
  submitting.value = true
  submitError.value = ''
  const tempId = -Date.now()
  pendingComments.value.push({ tempId, parentId, body: text.trim(), status: 'sending', error: '' })
  try {
    const res = await ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<{ ok: boolean; id?: number }>)('/api/public/comments', {
      method: 'POST',
      body: { ...writeBody.value, parentId, body: text },
    })
    pendingComments.value = pendingComments.value.filter(p => p.tempId !== tempId)
    if (parentId === null) body.value = ''
    else { replyBody.value = ''; replyTo.value = null }
    clearDraft()
    sessionLapsed.value = false
    await loadThread()
    if (res?.id) startModerationCheckpoint(res.id)
  } catch (error) {
    const failed = pendingComments.value.find(p => p.tempId === tempId)
    if (failed) { failed.status = 'error'; failed.error = reportFailure(error, 'Không thể gửi bình luận.') }
    submitError.value = reportFailure(error, 'Không thể gửi bình luận. Vui lòng thử lại.')
  } finally {
    submitting.value = false
  }
}

/** Retry a failed optimistic comment by removing it and re-submitting. */
function retryPendingComment(tempId: number) {
  const pending = pendingComments.value.find(p => p.tempId === tempId)
  if (!pending) return
  const text = pending.body
  const parentId = pending.parentId
  pendingComments.value = pendingComments.value.filter(p => p.tempId !== tempId)
  // Re-submit using the same text
  if (parentId === null) {
    body.value = text
    submit(null)
  } else {
    replyTo.value = parentId
    replyBody.value = text
    submit(parentId)
  }
}

/** Dismiss a failed optimistic comment. */
function dismissPendingComment(tempId: number) {
  pendingComments.value = pendingComments.value.filter(p => p.tempId !== tempId)
}

async function removeComment(comment: PublicCommentItem) {
  // A deletion is irreversible, so it asks first. `window.confirm` rather than
  // the admin `useConfirm()` modal: that composable drives a ConfirmDialog which
  // is mounted only in layouts/admin.vue, so calling it from a public page would
  // set state nothing renders — the promise would never resolve and the delete
  // would silently never happen.
  if (!window.confirm(t('c_delete_confirm'))) return

  deletingId.value = comment.id
  try {
    await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/public/comments/${comment.id}`, { method: 'DELETE' })
    await loadThread()
  } catch (error) {
    submitError.value = reportFailure(error, t('c_delete_error'))
  } finally {
    deletingId.value = null
  }
}

// After mount only — see the template comment. Nothing reader-specific may enter
// server-rendered HTML on an SWR-cached route.
onMounted(async () => {
  /**
   * Trang phân trang phải đặt TRƯỚC lượt nạp đầu tiên.
   *
   * Thông báo trỏ tới `?page=3#comment-45`. Nạp trang 1 rồi mới nhảy sang
   * trang 3 là hai lượt fetch và một cú nháy; tệ hơn, `focusAnchoredComment` sẽ
   * chạy trên trang 1 và không tìm thấy gì. Cùng cách đọc số như máy chủ:
   * `Number.isSafeInteger` chứ không phải `Math.max(1, Number(...))`.
   */
  const requested = Number(route.query.comments)
  if (Number.isSafeInteger(requested) && requested > 0) page.value = requested

  await loadReader()
  // Chỉ phục hồi khi đã đăng nhập được: điền lại nháp vào một trang vẫn chưa đăng
  // nhập là đưa văn bản vào một khung soạn không hiện ra.
  if (isSignedIn.value) restoreDraft()
  await loadThread()
  await focusAnchoredComment()
})
</script>
