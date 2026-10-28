import { onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { PublicCommentItem } from '~/types/public-api'
// Đường dẫn tương đối (không `~/`): tệp này cũng chạy trong test Node, nơi bộ nạp không
// biết alias của Nuxt.
import { errorMessage as messageFrom, errorStatus } from '../utils/errorMessage'
import { commentDraftKey, removeCommentFromThread, threadHasComment } from '../utils/comment-thread'

/**
 * The three writes of the thread, as the component hands them in.
 *
 * The requests themselves stay in `components/ArticleComments.vue`: each is a `$fetch` cast,
 * and the public side has no typed fetch helper (`adminFetch` is the admin one) — so the
 * casts stay counted where they were (fetch-cast ratchet) and this file holds the flow.
 */
export type CommentWriteApi = {
  post: (body: Record<string, unknown>) => Promise<{ ok: boolean; id?: number }>
  remove: (id: number) => Promise<unknown>
  checkpoint: (id: number) => Promise<{ ok: boolean; items: Array<{ id: number; isHidden: boolean }> }>
}

/** An optimistic comment — only the sender sees it, dimmed while sending, red on failure. */
export type PendingComment = {
  tempId: number
  parentId: number | null
  body: string
  status: 'sending' | 'error'
  error: string
}

/** Lịch kiểm duyệt ngầm sau một lượt gửi (ms). */
const CHECKPOINT_DELAYS = [2500, 6000, 11000, 18000]

/**
 * Luồng GHI của bình luận công khai (`components/ArticleComments.vue`, tách ở wave3 4.2):
 * soạn/trả lời, gửi lạc quan, thử lại/bỏ qua, xoá, phiên hết hạn (401) + nháp, và điểm kiểm
 * duyệt ngầm sau khi gửi. Luồng ĐỌC (state của luồng, `loadThread`, nhánh lỗi + "thử lại",
 * phân trang) ở lại component — đó là hợp đồng tải/lỗi/rỗng mà test nguồn ghim ở đó.
 */
export function useCommentWrites(options: {
  slug: string
  isMedia: boolean
  /** `{ articleSlug }` or `{ mediaSlug }` — the item the write endpoint reads (ArticleComments.vue). */
  writeBody: ComputedRef<{ articleSlug?: string; mediaSlug?: string }>
  comments: Ref<PublicCommentItem[]>
  total: Ref<number>
  revokedNotice: Ref<string>
  loadThread: () => Promise<void>
  api: CommentWriteApi
  t: (key: string) => string
  forgetReader: () => void
}) {
  const { comments, total, revokedNotice, loadThread, api, t, forgetReader } = options

  const pendingComments = ref<PendingComment[]>([])
  const body = ref('')
  const replyTo = ref<number | null>(null)
  const replyBody = ref('')
  const submitting = ref(false)
  const submitError = ref('')
  const deletingId = ref<number | null>(null)
  const sessionLapsed = ref(false)

  /**
   * Nháp sống qua lượt điều hướng đăng nhập lại.
   *
   * `sessionStorage`, không `localStorage`: nháp này chỉ có nghĩa trong đúng tab và
   * đúng lượt duyệt hiện tại. Giữ lâu hơn thì một câu hỏi bỏ dở nửa năm trước sẽ
   * hiện lại trên máy dùng chung — nội dung của người khác, trong khung soạn của
   * người đang ngồi đó.
   *
   * Khoá gắn theo loại + slug (`commentDraftKey`) nên hai nội dung không tráo nháp của
   * nhau. Mọi lỗi bị nuốt: Safari ở chế độ riêng tư ném khi ghi storage, và một nháp
   * không lưu được không có tư cách làm hỏng trang.
   */
  const DRAFT_KEY = commentDraftKey(options.slug, options.isMedia)

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

  /**
   * Checkpoint theo dõi kết quả kiểm duyệt AI ngầm: tự động thu hồi và gỡ bình luận nếu AI
   * phát hiện vi phạm mà KHÔNG CẦN TẢI LẠI TRANG.
   *
   * Hẹn giờ được huỷ khi rời trang, và một câu trả lời về sau đó không ghi gì: trước wave3
   * 4.2 bốn lượt hẹn giờ mỗi lần gửi không bao giờ bị huỷ, nên tới bốn request vẫn đi sau
   * khi người đọc đã đóng trang (FINDING-C2).
   *
   * `left` (đặt ở `onBeforeUnmount`) chặn MỌI tác dụng phụ của một câu trả lời về sau khi rời
   * trang — gửi, xoá, đọc lại, hẹn kiểm duyệt, ghi state; chỉ còn dọn nháp của bình luận đã
   * được nhận. Một lượt gửi hỏng (kể cả 401) về sau khi rời trang không lưu nháp: người đọc đã
   * bỏ trang trong lúc nó đang gửi.
   */
  const checkpointTimers = new Set<number>()
  let left = false
  onBeforeUnmount(() => {
    left = true
    for (const timer of checkpointTimers) window.clearTimeout(timer)
    checkpointTimers.clear()
  })

  function startModerationCheckpoint(commentId: number) {
    if (left) return
    for (const delay of CHECKPOINT_DELAYS) {
      const timer = window.setTimeout(async () => {
        checkpointTimers.delete(timer)
        if (!threadHasComment(comments.value, commentId)) return

        try {
          const res = await api.checkpoint(commentId)
          if (left) return
          const match = res?.items?.find(i => i.id === commentId)
          if (match && match.isHidden) {
            if (removeCommentFromThread(comments.value, commentId) === 'top') total.value = Math.max(0, total.value - 1)
            // The server no longer sends the moderator's reason (it held internal notes and
            // blocklist patterns); the author gets the generic one.
            revokedNotice.value = t('c_revoked_template').replace('{reason}', t('c_revoked_default'))
          }
        } catch {
          // Non-blocking checkpoint lookup
        }
      }, delay)
      checkpointTimers.add(timer)
    }
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
      const res = await api.post({ ...options.writeBody.value, parentId, body: text })
      // Rời trang khi lượt gửi còn bay: bình luận ĐÃ được nhận, nên chỉ dọn nháp (để lần sau
      // không điền lại thứ đã gửi). Không đọc lại luồng, không hẹn kiểm duyệt, không ghi state
      // của một trang đã gỡ — trước đây lượt đọc lại vẫn đi cho một trang không ai xem.
      if (left) { clearDraft(); return }
      pendingComments.value = pendingComments.value.filter(p => p.tempId !== tempId)
      if (parentId === null) body.value = ''
      else { replyBody.value = ''; replyTo.value = null }
      clearDraft()
      sessionLapsed.value = false
      await loadThread()
      if (res?.id) startModerationCheckpoint(res.id)
    } catch (error) {
      if (left) return
      const failed = pendingComments.value.find(p => p.tempId === tempId)
      if (failed) { failed.status = 'error'; failed.error = reportFailure(error, 'Không thể gửi bình luận.') }
      submitError.value = reportFailure(error, 'Không thể gửi bình luận. Vui lòng thử lại.')
    } finally {
      if (!left) submitting.value = false
    }
  }

  /**
   * Retry a failed optimistic comment by removing it and re-submitting.
   *
   * Not while another write is in flight: `submit()` would return at once, after the entry
   * had left the list and its text had replaced the box — and the in-flight write clears
   * the box when it lands. The failed comment was then gone from everywhere (FINDING-C3).
   * It stays in the list instead, its "Thử lại" usable a moment later.
   */
  function retryPendingComment(tempId: number) {
    if (submitting.value) return
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
      await api.remove(comment.id)
      // Rời trang khi lượt xoá còn bay: không đọc lại luồng cho một trang đã gỡ.
      if (left) return
      await loadThread()
    } catch (error) {
      if (left) return
      submitError.value = reportFailure(error, t('c_delete_error'))
    } finally {
      if (!left) deletingId.value = null
    }
  }

  return {
    pendingComments, body, replyTo, replyBody, submitting, submitError, deletingId, sessionLapsed,
    restoreDraft, toggleReply, cancelReply, submit, retryPendingComment, dismissPendingComment, removeComment,
  }
}
