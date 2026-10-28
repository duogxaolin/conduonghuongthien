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

  Split in wave3 4.2 (732 lines → this file + parts). This file keeps the READ side and
  the thread's state contract: the thread state, `loadThread`, the skeleton, the load
  error with its "thử lại", the empty state, the pager and the mount sequence. The write
  flow is `composables/useCommentWrites.ts`, the anchors `composables/useCommentAnchor.ts`,
  the markup of one comment / the optimistic list / the compose box
  `components/comments/*.vue` (display only), the pure helpers `utils/comment-thread.ts`.
  The four `$fetch` calls stay here (no public typed fetch helper exists).
-->
<template>
  <section
    v-if="enabled || pending || errorMessage"
    class="mt-12 border-t border-line pt-8"
    aria-labelledby="comments-heading"
  >
    <h2 id="comments-heading" class="m-0 mb-5 text-[1.15rem] font-extrabold text-ink">
      <i class="fa-solid fa-comments mr-2 text-accent" aria-hidden="true"></i>{{ t('comments') }}
      <span v-if="total" class="ml-1 text-[0.95rem] font-semibold text-ink-soft">({{ total }})</span>
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
        <div class="w-9 h-9 rounded-full bg-surface-tint shrink-0"></div>
        <div class="flex-grow flex flex-col gap-2">
          <div class="h-3 w-32 bg-surface-tint rounded"></div>
          <div class="h-4 w-full bg-surface-tint rounded"></div>
          <div class="h-4 w-3/4 bg-surface-tint rounded"></div>
        </div>
      </div>
    </div>

    <!-- 2. Lỗi. Nút thử lại gọi lại chính lượt fetch đã hỏng, không tải lại
         trang: bài viết ở trên vẫn đọc được và không có lý do gì để mất nó. -->
    <div
      v-else-if="errorMessage"
      role="alert"
      class="bg-white border border-dashed border-[#E2A0A0] px-6 py-8 rounded-lg text-center text-danger-soft text-[0.95rem]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ errorMessage }} Vui lòng
      <button type="button" class="text-brand-600 font-bold underline" @click="loadThread()">thử lại</button>.
    </div>

    <template v-else>
      <!-- Banner thông báo thu hồi bình luận sau kiểm duyệt AI mà không cần reload trang -->
      <div
        v-if="revokedNotice"
        role="alert"
        class="mb-5 rounded-lg border border-[#f0c0c0] bg-[#fff5f4] p-3.5 text-xs text-[#a32924] flex items-center justify-between gap-3 animate-fade-slide-up"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-triangle-exclamation text-base shrink-0 text-danger" aria-hidden="true"></i>
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
      <p v-if="!comments.length" class="bg-surface border border-line rounded-lg px-6 py-8 text-center text-[0.95rem] text-ink-secondary m-0 mb-6">
        {{ t('no_comments_yet') || 'Chưa có bình luận nào. Hãy là người đầu tiên đặt câu hỏi hoặc chia sẻ ý kiến về nội dung này.' }}
      </p>

      <ul v-else class="list-none p-0 m-0 mb-6 flex flex-col gap-5">
        <li v-for="comment in comments" :key="comment.id">
          <CommentThreadItem
            v-model:reply-body="replyBody"
            :comment="comment"
            :highlight-id="highlightId"
            :copied-id="copiedId"
            :deleting-id="deletingId"
            :reply-to="replyTo"
            :can-reply="isSignedIn && enabled"
            :submitting="submitting"
            @toggle-reply="toggleReply"
            @copy-link="copyLink"
            @remove="removeComment"
            @submit-reply="submit"
            @cancel-reply="cancelReply"
          />
        </li>
      </ul>

      <CommentPendingList
        v-if="pendingComments.length"
        :pending-comments="pendingComments"
        @retry="retryPendingComment"
        @dismiss="dismissPendingComment"
      />

      <div v-if="totalPages > 1" class="mb-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-line bg-white text-[0.85rem] font-semibold text-ink-secondary disabled:opacity-50"
          :disabled="page <= 1 || pending"
          @click="goToPage(page - 1)"
        >{{ t('page_prev') || 'Trang trước' }}</button>
        <!-- `page_of` là một khuôn "Trang {current} / {total}" — thay chỗ trống như mọi
             trang danh sách khác; in thẳng khuôn rồi nối số là "Trang {current} / {total} 1 / 2"
             (FINDING-C1). -->
        <span class="text-[0.85rem] text-ink-secondary">{{ t('page_of').replace('{current}', String(page)).replace('{total}', String(totalPages)) }}</span>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border border-line bg-white text-[0.85rem] font-semibold text-ink-secondary disabled:opacity-50"
          :disabled="page >= totalPages || pending"
          @click="goToPage(page + 1)"
        >{{ t('page_next') || 'Trang sau' }}</button>
      </div>

      <!-- 4. Chưa đăng nhập / 5. Khung soạn bình luận -->
      <CommentComposer
        v-model:body="body"
        :is-signed-in="isSignedIn"
        :session-lapsed="sessionLapsed"
        :submitting="submitting"
        :submit-error="submitError"
        @sign-in="signIn()"
        @submit="submit(null)"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useReaderAuth } from '~/composables/useReaderAuth'
import { useI18n } from '~/composables/useI18n'
import { useCommentAnchor } from '~/composables/useCommentAnchor'
import { useCommentWrites } from '~/composables/useCommentWrites'
import { requestedCommentsPage } from '~/utils/comment-thread'
import CommentThreadItem from '~/components/comments/CommentThreadItem.vue'
import CommentPendingList from '~/components/comments/CommentPendingList.vue'
import CommentComposer from '~/components/comments/CommentComposer.vue'
import type { CommentThreadPayload, PublicCommentItem } from '~/types/public-api'

const { t } = useI18n()

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
const enabled = ref(false)
const pending = ref(true)
const errorMessage = ref('')

const { highlightId, copiedId, focusAnchoredComment, copyLink } = useCommentAnchor(route, page)

const {
  pendingComments, body, replyTo, replyBody, submitting, submitError, deletingId, sessionLapsed,
  restoreDraft, toggleReply, cancelReply, submit, retryPendingComment, dismissPendingComment, removeComment,
} = useCommentWrites({
  slug: props.slug,
  isMedia: isMedia.value,
  writeBody,
  comments,
  total,
  revokedNotice,
  loadThread,
  t,
  forgetReader,
  // Ba lượt ghi — request ở đây, luồng ở composable (xem đầu tệp).
  api: {
    post: payload => ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<{ ok: boolean; id?: number }>)('/api/public/comments', {
      method: 'POST',
      body: payload,
    }),
    remove: id => ($fetch as (u: string, o?: Record<string, unknown>) => Promise<unknown>)(`/api/public/comments/${id}`, { method: 'DELETE' }),
    checkpoint: id => ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<{ ok: boolean; items: Array<{ id: number; isHidden: boolean }> }>)(
      '/api/public/comments/checkpoint',
      { query: { ids: String(id) } },
    ),
  },
})

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

// After mount only — see the template comment. Nothing reader-specific may enter
// server-rendered HTML on an SWR-cached route.
onMounted(async () => {
  /**
   * Trang phân trang phải đặt TRƯỚC lượt nạp đầu tiên.
   *
   * Thông báo trỏ tới `?page=3#comment-45`. Nạp trang 1 rồi mới nhảy sang
   * trang 3 là hai lượt fetch và một cú nháy; tệ hơn, `focusAnchoredComment` sẽ
   * chạy trên trang 1 và không tìm thấy gì (cách đọc số: `requestedCommentsPage`).
   */
  const requested = requestedCommentsPage(route.query.comments)
  if (requested) page.value = requested

  await loadReader()
  // Chỉ phục hồi khi đã đăng nhập được: điền lại nháp vào một trang vẫn chưa đăng
  // nhập là đưa văn bản vào một khung soạn không hiện ra.
  if (isSignedIn.value) restoreDraft()
  await loadThread()
  await focusAnchoredComment()
})
</script>
