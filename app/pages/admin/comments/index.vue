<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * Comment moderation: newest first, optionally filtered to one article, with
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
  articleId: number
  articleTitle: string | null
  articleSlug: string | null
  readerId: number | null
  readerName: string | null
  readerEmail: string | null
  adminUserId: number | null
  adminName: string | null
  ip: string | null
}

const route = useRoute()
const toast = useToast()

const loading = ref(true)
const error = ref('')
const busy = ref(false)
const comments = ref<Comment[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)

const articleFilter = ref(route.query.articleId ? String(route.query.articleId) : '')

const replyTo = ref<number | null>(null)
const replyBody = ref('')
const replying = ref(false)

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<any>('/api/admin/comments', {
      query: { articleId: articleFilter.value || undefined, page: page.value },
    })
    if (!res?.ok) {
      error.value = 'Không tải được danh sách bình luận.'
      return
    }
    comments.value = res.comments || []
    total.value = res.total || 0
    totalPages.value = res.totalPages || 1
    page.value = res.page || 1
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được danh sách bình luận.')
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  load()
}

function goToPage(next: number) {
  if (next < 1 || next > totalPages.value) return
  page.value = next
  load()
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
    await $fetch('/api/admin/comments/reply', {
      method: 'POST',
      body: { parentId: comment.id, body: replyBody.value },
    })
    // Chỉ dọn form sau khi biết chắc đã gửi được: một lượt gửi hỏng mà mất luôn
    // nội dung đã gõ là bắt cán bộ viết lại từ đầu.
    replyBody.value = ''
    replyTo.value = null
    toast.success('Đã gửi phản hồi của Ban quản trị.')
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không gửi được phản hồi.'))
  } finally {
    replying.value = false
  }
}

async function deleteOne(comment: Comment) {
  if (!confirm(
    comment.parentId === null
      ? 'Xoá bình luận này? Mọi phản hồi bên dưới, kể cả phản hồi của Ban quản trị, sẽ bị xoá theo. Không thể hoàn tác.'
      : 'Xoá phản hồi này? Không thể hoàn tác.',
  )) return

  busy.value = true
  try {
    await $fetch(`/api/admin/comments/${comment.id}`, { method: 'DELETE' })
    toast.success('Đã xoá bình luận.')
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xoá được bình luận.'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div>
      <h1 class="m-0 text-[1.35rem] font-extrabold text-[#122815]">Kiểm duyệt bình luận</h1>
      <p class="m-0 mt-1 text-sm text-[#667768]">
        Bình luận công khai trên các bài viết, mới nhất trước. Mỗi lượt xem được ghi vào lịch sử hoạt động.
      </p>
    </div>

    <form class="flex flex-wrap items-end gap-3 rounded-xl border border-[#e2ece3] bg-white p-4" @submit.prevent="applyFilters">
      <label class="flex flex-col gap-1.5 text-sm font-bold">
        Lọc theo mã bài viết
        <input
          v-model="articleFilter"
          type="number"
          min="1"
          placeholder="Để trống để xem tất cả"
          class="rounded-lg border border-[#c8d6c9] px-3 py-2.5 font-normal outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
        />
      </label>
      <button
        type="submit"
        class="rounded-lg bg-[#1e4620] px-4 py-2.5 font-bold text-white hover:bg-[#2c6e33] focus:outline-none focus:ring-2 focus:ring-[#2c6e33]/40"
      >Áp dụng</button>
      <nuxt-link
        to="/admin/readers"
        class="rounded-lg border border-[#c8d6c9] bg-white px-4 py-2.5 font-semibold text-[#2c3e2e] no-underline hover:bg-[#f0f7f1]"
      >Danh sách người đọc</nuxt-link>
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
      <button type="button" class="ml-1 font-bold text-[#2c6e33] underline" @click="load">Thử lại</button>
    </div>

    <template v-else>
      <!-- Rỗng -->
      <p v-if="!comments.length" class="rounded-xl border border-[#e2ece3] bg-white px-5 py-8 text-center text-sm text-[#667768]">
        Chưa có bình luận nào khớp bộ lọc hiện tại.
      </p>

      <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
        <li v-for="comment in comments" :key="comment.id" class="rounded-xl border border-[#e2ece3] bg-white p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span v-if="comment.adminUserId !== null" class="rounded-full bg-[#1e4620] px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-white">Ban quản trị</span>
                <span v-if="comment.parentId !== null" class="rounded-full bg-[#eef3ee] px-2 py-0.5 text-[0.72rem] font-bold text-[#3d4f3f]">Phản hồi</span>
                <span class="font-bold text-[#122815]">
                  {{ comment.adminUserId !== null ? (comment.adminName || 'Tài khoản đã xoá') : (comment.readerName || 'Người dùng') }}
                </span>
                <span v-if="comment.readerEmail" class="text-[0.8rem] text-[#667768]">{{ comment.readerEmail }}</span>
              </div>
              <p class="m-0 mt-1 text-[0.8rem] text-[#667768]">
                {{ formatMoment(comment.createdAt) }}
                <span v-if="comment.articleTitle"> — {{ comment.articleTitle }}</span>
                <span v-if="comment.ip"> — {{ comment.ip }}</span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <button
                v-if="comment.parentId === null"
                type="button"
                :disabled="busy"
                class="text-[0.82rem] font-semibold text-[#2c6e33] hover:underline disabled:opacity-60"
                @click="toggleReply(comment)"
              >Trả lời</button>
              <nuxt-link
                v-if="comment.readerId"
                :to="`/admin/readers/${comment.readerId}`"
                class="text-[0.82rem] font-semibold text-[#2c6e33] no-underline hover:underline"
              >Người đọc</nuxt-link>
              <button
                type="button"
                :disabled="busy"
                class="text-[0.82rem] font-semibold text-[#b0403c] hover:underline disabled:opacity-60"
                @click="deleteOne(comment)"
              >Xoá</button>
            </div>
          </div>

          <p class="m-0 mt-2.5 whitespace-pre-line break-words text-sm text-[#2c3529]">{{ comment.body }}</p>

          <form v-if="replyTo === comment.id" class="mt-3 border-t border-[#eef3ee] pt-3" @submit.prevent="submitReply(comment)">
            <label :for="`reply-${comment.id}`" class="mb-1.5 block text-sm font-bold text-[#2c3e2e]">Phản hồi của Ban quản trị</label>
            <textarea
              :id="`reply-${comment.id}`"
              v-model="replyBody"
              rows="3"
              maxlength="2000"
              :disabled="replying"
              class="w-full rounded-lg border border-[#c8d6c9] px-3 py-2.5 text-sm outline-none focus:border-[#2c6e33] focus:ring-2 focus:ring-[#2c6e33]/20"
            ></textarea>
            <p class="m-0 mt-1.5 text-[0.75rem] text-[#8a7320]">
              Phản hồi này bị xoá theo nếu bình luận gốc bị xoá. Câu trả lời cần giữ lâu dài nên đặt ở
              <nuxt-link to="/admin/chatbot/knowledge" class="font-semibold text-[#2c6e33] underline">Kho kiến thức</nuxt-link>.
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                type="submit"
                :disabled="replying || !replyBody.trim()"
                class="rounded-lg bg-[#1e4620] px-4 py-2 text-sm font-bold text-white hover:bg-[#2c6e33] disabled:opacity-60"
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

      <div v-if="totalPages > 1" class="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >Trang trước</button>
        <span class="text-sm text-[#3d4f3f]">Trang {{ page }} / {{ totalPages }} — {{ total }} bình luận</span>
        <button
          type="button"
          class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >Trang sau</button>
      </div>
    </template>
  </div>
</template>
