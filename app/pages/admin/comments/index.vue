<script setup lang="ts">
import type { AdminListPage } from '~/composables/useAdminList'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Comment moderation: newest first, optionally filtered to article or video, with
 * delete and an inline reply.
 *
 * A reply posted here appears publicly under the fixed "Ban quản trị" label, not
 * the officer's own name — the reply is the portal speaking, and naming the
 * individual would expose staff identities on a public page. Replies are allowed
 * even on a closed thread: closing comments stops the public from posting, not
 * the portal from answering.
 */

type Comment = {
  id: number
  body: string
  createdAt: string | null
  parentId: number | null
  /** Null when the comment was made on a media item rather than an article. */
  articleId: number | null
  articleTitle: string | null
  articleSlug: string | null
  mediaItemId: number | null
  mediaItemTitle: string | null
  mediaItemSlug: string | null
  readerId: number | null
  readerName: string | null
  readerEmail: string | null
  adminUserId: number | null
  adminName: string | null
  ip: string | null
  isHidden: boolean | null
  flagReason: string | null
}

type CommentFilters = {
  /** From the URL a string; once typed into the `type="number"` input Vue casts it to a number. */
  articleId: string | number
  source: '' | 'article' | 'media'
  /** Tab hiển thị: 'visible' = comment bình thường (mặc định), 'hidden' = bị ẩn. */
  visibility: 'visible' | 'hidden'
}

type CommentListResponse = { ok: boolean; comments: Comment[]; total: number; totalPages: number; page: number }
/** The list plus the "Đã ẩn" tab badge, fetched in the same load. */
type CommentListPage = AdminListPage<Comment> & { hiddenCount: number }

type AiVerdict = { verdict: 'safe' | 'spam' | 'violation'; riskLevel: string; flags: string[]; reason: string }
type AiModerateResponse = { ok: boolean; results: Array<{ id: number } & AiVerdict> }

const route = useRoute()
const toast = useToast()
const { confirm } = useConfirm()

// List state, stale-request guard and paging: useAdminList (tests/admin-list.test.ts).
const list = useAdminList<Comment, CommentFilters, CommentListPage>({
  filters: {
    articleId: route.query.articleId ? String(route.query.articleId) : '',
    source: route.query.source === 'article' || route.query.source === 'media' ? route.query.source : '',
    visibility: route.query.visibility === 'hidden' ? 'hidden' : 'visible',
  },
  errorFallback: 'Không tải được danh sách bình luận.',
  load: async ({ page, filters, signal }) => {
    // The badge count travels with the list on the same signal: a superseded load
    // cannot update the badge any more than it can update the rows.
    const [res, hiddenRes] = await Promise.all([
      adminFetch<CommentListResponse>('/api/admin/comments', {
        query: {
          articleId: filters.articleId || undefined,
          source: filters.source || undefined,
          visibility: filters.visibility,
          page,
        },
        signal,
      }),
      adminFetch<{ ok: boolean; total: number }>('/api/admin/comments', {
        query: { visibility: 'hidden', perPage: 1 },
        signal,
      }),
    ])
    if (!res?.ok) return null
    return {
      items: res.comments || [],
      total: res.total || 0,
      totalPages: res.totalPages || 1,
      page: res.page || 1,
      hiddenCount: hiddenRes?.total ?? 0,
    }
  },
})
const { items: comments, page, total, totalPages, loading, filters, applyFilters, goToPage } = list
// The error branch and its retry are declared here, in the page, on purpose:
// tests/admin-error-retry-ui.test.ts reads this file's own source.
const error = computed(() => list.error.value)
const reload = list.reload
const hiddenCount = computed(() => list.result.value?.hiddenCount ?? 0)

const busy = ref(false)
const moderating = ref(false)
const moderationMap = ref<Record<number, AiVerdict>>({})

const replyTo = ref<number | null>(null)
const replyBody = ref('')
const replying = ref(false)

async function runAiModerationScan() {
  if (!comments.value.length) return
  moderating.value = true
  try {
    const ids = comments.value.map(c => c.id).slice(0, 10)
    const res = await adminFetch<AiModerateResponse>('/api/admin/comments/ai-moderate', {
      method: 'POST',
      body: { commentIds: ids },
    })
    for (const r of res.results) {
      if (r.id) moderationMap.value[r.id] = r
    }
    toast.success(`Đã quét AI kiểm duyệt ${res.results.length} bình luận!`)
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không thể kiểm duyệt bằng AI.'))
  } finally {
    moderating.value = false
  }
}

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { hour12: false })
}

async function toggleVisibility(comment: Comment) {
  if (busy.value) return
  const next = !comment.isHidden
  busy.value = true
  try {
    await adminFetch<unknown>(`/api/admin/comments/${comment.id}/visibility`, {
      method: 'PATCH',
      body: { hidden: next },
    })
    toast.success(next ? 'Đã ẩn bình luận.' : 'Đã hiện lại bình luận.')
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không đổi được trạng thái bình luận.'))
  } finally {
    busy.value = false
  }
}

function switchVisibility(tab: 'visible' | 'hidden') {
  if (filters.visibility === tab) return
  filters.visibility = tab
  applyFilters()
}

function toggleReply(comment: Comment) {
  // Chỉ trả lời bình luận gốc: quy tắc một cấp nằm ở máy chủ, nhưng mở khung trả
  // lời dưới một phản hồi rồi để endpoint từ chối là bắt cán bộ gõ xong mới biết.
  if (comment.parentId !== null) return
  replyTo.value = replyTo.value === comment.id ? null : comment.id
  replyBody.value = ''
}

async function submitReply(comment: Comment) {
  if (!replyBody.value.trim() || replying.value) return
  replying.value = true
  try {
    await adminFetch<unknown>('/api/admin/comments/reply', {
      method: 'POST',
      body: { parentId: comment.id, body: replyBody.value },
    })
    // Chỉ dọn form sau khi biết chắc đã gửi được: một lượt gửi hỏng mà mất luôn
    // nội dung đã gõ là bắt cán bộ viết lại từ đầu.
    replyBody.value = ''
    replyTo.value = null
    toast.success('Đã gửi phản hồi của Ban quản trị.')
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không gửi được phản hồi.'))
  } finally {
    replying.value = false
  }
}

async function deleteOne(comment: Comment) {
  if (!await confirm({
    message: comment.parentId === null
      ? 'Xoá bình luận này? Mọi phản hồi bên dưới, kể cả phản hồi của Ban quản trị, sẽ bị xoá theo. Không thể hoàn tác.'
      : 'Xoá phản hồi này? Không thể hoàn tác.',
    confirmLabel: 'Xoá',
    danger: true,
  })) return

  busy.value = true
  try {
    await adminFetch<unknown>(`/api/admin/comments/${comment.id}`, { method: 'DELETE' })
    toast.success('Đã xoá bình luận.')
    await reload()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xoá được bình luận.'))
  } finally {
    busy.value = false
  }
}

onMounted(reload)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.35rem] font-extrabold text-brand-950">Kiểm duyệt bình luận</h1>
      <p class="m-0 mt-1 text-sm text-ink-muted">
        Bình luận công khai trên bài viết và video, mới nhất trước. Mỗi lượt xem được ghi vào lịch sử hoạt động.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2" role="tablist" aria-label="Lọc theo trạng thái bình luận">
      <button
        type="button"
        role="tab"
        :aria-selected="filters.visibility === 'visible'"
        class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors cursor-pointer"
        :class="filters.visibility === 'visible' ? 'bg-brand-900 text-white' : 'bg-white border border-line-strong text-[#2c3e2e] hover:bg-surface-tint'"
        @click="switchVisibility('visible')"
      >
        Bình luận hiện
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="filters.visibility === 'hidden'"
        class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors cursor-pointer"
        :class="filters.visibility === 'hidden' ? 'bg-[#7a3520] text-white' : 'bg-white border border-line-strong text-[#2c3e2e] hover:bg-surface-tint'"
        @click="switchVisibility('hidden')"
      >
        Đã ẩn
        <span v-if="hiddenCount > 0" class="ml-1.5 rounded-full bg-[#fef2f2] px-1.5 py-0.5 text-[0.7rem] font-bold text-[#991b1b]">{{ hiddenCount }}</span>
      </button>
    </div>

    <form class="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4" @submit.prevent="applyFilters">
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        Lọc theo mã bài viết
        <input
          v-model="filters.articleId"
          type="number"
          min="1"
          placeholder="Để trống để xem tất cả"
          class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
        />
      </label>
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        Nguồn bình luận
        <select
          v-model="filters.source"
          class="rounded-lg border border-line-strong px-3 py-2.5 font-normal outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
        >
          <option value="">Tất cả</option>
          <option value="article">Bài viết</option>
          <option value="media">Video</option>
        </select>
      </label>
      <button
        type="submit"
        class="rounded-lg bg-brand-900 px-4 py-2.5 font-bold text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/40"
      >Áp dụng</button>
      <nuxt-link
        to="/admin/readers"
        class="rounded-lg border border-line-strong bg-white px-4 py-2.5 font-semibold text-[#2c3e2e] no-underline hover:bg-surface-tint"
      >Danh sách người đọc</nuxt-link>
      <button
        type="button"
        class="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#a2cca4] bg-surface-tint px-4 py-2.5 font-bold text-brand-900 hover:bg-[#e4ece4] transition-all disabled:opacity-50 cursor-pointer shadow-2xs"
        :disabled="moderating || !comments.length"
        @click="runAiModerationScan"
      >
        <i class="fa-solid" :class="moderating ? 'fa-circle-notch fa-spin text-xs' : 'fa-shield-halved text-xs text-brand-700'"></i>
        <span>{{ moderating ? 'AI đang quét...' : '🛡️ AI Quét kiểm duyệt' }}</span>
      </button>
    </form>

    <!-- Đang tải -->
    <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-3">
      <span class="sr-only">Đang tải danh sách bình luận</span>
      <div
        v-for="n in 5"
        :key="n"
        aria-hidden="true"
        class="h-20 rounded-lg bg-[#eef3ee] animate-pulse motion-reduce:animate-none"
      ></div>
    </div>

    <!-- Lỗi -->
    <div
      v-else-if="error"
      role="alert"
      class="rounded-lg border border-dashed border-[#e0a3a1] bg-white px-5 py-6 text-center text-sm text-[#b0403c]"
    >
      <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
      {{ error }}
      <button type="button" class="ml-1 font-bold text-brand-700 underline" @click="reload">Thử lại</button>
    </div>

    <template v-else>
      <!-- Rỗng -->
      <p v-if="!comments.length" class="rounded-xl border border-line bg-white px-5 py-8 text-center text-sm text-ink-muted">
        Chưa có bình luận nào khớp bộ lọc hiện tại.
      </p>

      <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
        <li v-for="comment in comments" :key="comment.id" class="rounded-xl border border-line bg-white p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span v-if="comment.adminUserId !== null" class="rounded-full bg-brand-900 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-white">Ban quản trị</span>
                <span v-if="comment.parentId !== null" class="rounded-full bg-[#eef3ee] px-2 py-0.5 text-[0.72rem] font-bold text-[#3d4f3f]">Phản hồi</span>
                <span class="font-bold text-brand-950">
                  {{ comment.adminUserId !== null ? (comment.adminName || 'Tài khoản đã xoá') : (comment.readerName || 'Người dùng') }}
                </span>
                <span v-if="comment.readerEmail" class="text-[0.8rem] text-ink-muted">{{ comment.readerEmail }}</span>
              </div>
              <p class="m-0 mt-1 text-[0.8rem] text-ink-muted">
                {{ formatMoment(comment.createdAt) }}
                <span v-if="comment.articleTitle"> — Bài viết: {{ comment.articleTitle }}</span>
                <span v-else-if="comment.mediaItemTitle"> — Video: {{ comment.mediaItemTitle }}</span>
                <span v-else-if="comment.mediaItemId !== null"> — Video đã không còn</span>
                <span v-if="comment.ip"> — {{ comment.ip }}</span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <button
                v-if="comment.parentId === null"
                type="button"
                :disabled="busy"
                class="text-[0.82rem] font-semibold text-brand-700 hover:underline disabled:opacity-60"
                @click="toggleReply(comment)"
              >Trả lời</button>
              <nuxt-link
                v-if="comment.readerId"
                :to="`/admin/readers/${comment.readerId}`"
                class="text-[0.82rem] font-semibold text-brand-700 no-underline hover:underline"
              >Người đọc</nuxt-link>
              <button
                type="button"
                :disabled="busy"
                class="text-[0.82rem] font-semibold hover:underline disabled:opacity-60"
                :class="comment.isHidden ? 'text-[#2c6e33]' : 'text-[#7a3520]'"
                :title="comment.isHidden ? 'Hiện lại bình luận này' : 'Ẩn bình luận khỏi trang công khai'"
                @click="toggleVisibility(comment)"
              >{{ comment.isHidden ? 'Hiện lại' : 'Ẩn' }}</button>
              <button
                type="button"
                :disabled="busy"
                class="text-[0.82rem] font-semibold text-[#b0403c] hover:underline disabled:opacity-60"
                @click="deleteOne(comment)"
              >Xoá</button>
            </div>
          </div>

          <div v-if="comment.isHidden" class="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-[#7a3520]">
            <i class="fa-solid fa-eye-slash" aria-hidden="true"></i>
            <span class="font-semibold">Đã ẩn</span>
            <span v-if="comment.flagReason" class="text-ink-muted font-normal">— {{ comment.flagReason }}</span>
          </div>

          <p class="m-0 mt-2.5 whitespace-pre-line break-words text-sm" :class="comment.isHidden ? 'text-[#9a9a9a] line-through' : 'text-[#2c3529]'">{{ comment.body }}</p>

          <!-- AI Moderation Badge if scanned -->
          <div
            v-if="moderationMap[comment.id]"
            class="mt-2.5 flex items-center gap-2 rounded-lg p-2.5 text-xs"
            :class="{
              'bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0]': moderationMap[comment.id]!.verdict === 'safe',
              'bg-[#fefce8] text-[#854d0e] border border-[#fef08a]': moderationMap[comment.id]!.verdict === 'spam',
              'bg-[#fef2f2] text-[#991b1b] border border-[#fecaca]': moderationMap[comment.id]!.verdict === 'violation',
            }"
          >
            <i
              class="fa-solid text-xs shrink-0"
              :class="{
                'fa-shield-check text-[#16a34a]': moderationMap[comment.id]!.verdict === 'safe',
                'fa-triangle-exclamation text-[#ca8a04]': moderationMap[comment.id]!.verdict === 'spam',
                'fa-circle-xmark text-[#dc2626]': moderationMap[comment.id]!.verdict === 'violation',
              }"
            ></i>
            <span class="font-bold">
              AI: {{ moderationMap[comment.id]!.verdict === 'safe' ? 'An toàn' : moderationMap[comment.id]!.verdict === 'spam' ? 'Nghi vấn Spam' : 'Vi phạm tiêu chuẩn' }}
            </span>
            <span class="text-[#64748b]">• {{ moderationMap[comment.id]!.reason }}</span>
            <span v-if="moderationMap[comment.id]!.flags?.length" class="ml-auto font-semibold">
              {{ moderationMap[comment.id]!.flags.join(', ') }}
            </span>
          </div>

          <form v-if="replyTo === comment.id" class="mt-3 border-t border-[#eef3ee] pt-3" @submit.prevent="submitReply(comment)">
            <label :for="`reply-${comment.id}`" class="mb-1.5 block text-sm font-bold text-[#2c3e2e]">Phản hồi của Ban quản trị</label>
            <textarea
              :id="`reply-${comment.id}`"
              v-model="replyBody"
              rows="3"
              maxlength="2000"
              :disabled="replying"
              class="w-full rounded-lg border border-line-strong px-3 py-2.5 text-sm outline-none focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20"
            ></textarea>
            <p class="m-0 mt-1.5 text-[0.75rem] text-[#8a7320]">
              Phản hồi này bị xoá theo nếu bình luận gốc bị xoá. Câu trả lời cần giữ lâu dài nên đặt ở
              <nuxt-link to="/admin/chatbot/knowledge" class="font-semibold text-brand-700 underline">Kho kiến thức</nuxt-link>.
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                type="submit"
                :disabled="replying || !replyBody.trim()"
                class="rounded-lg bg-brand-900 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
              >{{ replying ? 'Đang gửi…' : 'Gửi phản hồi' }}</button>
              <button
                type="button"
                class="text-sm font-semibold text-[#3d4f3f] hover:underline"
                @click="replyTo = null"
              >Huỷ</button>
            </div>
          </form>
        </li>
      </ul>

      <AdminPagination
        :page="page"
        :total-pages="totalPages"
        :total="total"
        item-label="bình luận"
        @update:page="goToPage"
      />
    </template>
  </div>
</template>
