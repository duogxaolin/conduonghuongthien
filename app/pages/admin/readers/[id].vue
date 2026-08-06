<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

/**
 * One reader, everything they have written, and the four destructive actions.
 *
 * Every confirmation states BOTH counts from the impact endpoint: the reader's
 * own comments, and the administrator replies that disappear with them. An
 * officer told only "3 bình luận" is agreeing to something different from what
 * happens — the portal's own published answers go too, because the parent_id
 * foreign key cascades (design.md D8). That is also why the dialog says the
 * portal's durable answers belong in the approved knowledge store instead.
 */

type Comment = {
  id: number
  body: string
  createdAt: string | null
  parentId: number | null
  articleId: number
  articleTitle: string | null
  articleSlug: string | null
}

type Reader = {
  id: number
  displayName: string | null
  email: string | null
  isBanned: boolean
  banReason: string | null
  bannedAt: string | null
  bannedByName: string | null
  createdAt: string | null
  lastSeenAt: string | null
  lastIp: string | null
  lastUserAgent: string | null
}

const route = useRoute()
const router = useRouter()
const toast = useToast()

const readerId = computed(() => Number(route.params.id))

const loading = ref(true)
const error = ref('')
const busy = ref(false)
const reader = ref<Reader | null>(null)
const comments = ref<Comment[]>([])
const impact = ref({ comments: 0, adminReplies: 0, otherReaderReplies: 0 })

function formatMoment(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', { hour12: false })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<any>(`/api/admin/readers/${readerId.value}`)
    if (!res?.ok) {
      error.value = 'Không tải được thông tin người đọc.'
      return
    }
    reader.value = res.reader
    comments.value = res.comments || []
    impact.value = res.impact || { comments: 0, adminReplies: 0 }
  } catch (err: unknown) {
    error.value = errorMessage(err, 'Không tải được thông tin người đọc.')
  } finally {
    loading.value = false
  }
}

/** Fresh counts at the moment of asking, not the ones from page load — a reply
 *  may have arrived while the officer was reading. */
async function currentImpact() {
  try {
    const res = await $fetch<any>(`/api/admin/readers/${readerId.value}/impact`)
    return res?.impact || impact.value
  } catch {
    return impact.value
  }
}

/**
 * Nêu ĐỦ ba con số, không gộp thành một tổng.
 *
 * `otherReaderReplies` là phần dễ bị bỏ sót nhất: không có ràng buộc nào về ai
 * được trả lời, nên người đọc B trả lời được câu hỏi của A — và xoá A là xoá luôn
 * phản hồi của B qua cascade `parent_id`. Bản đầu của hàm này chỉ nêu bình luận +
 * phản hồi Ban quản trị, nên hộp thoại có thể nói "2" trong khi bốn hàng biến mất.
 * Một cán bộ được cho biết con số thiếu là đang đồng ý với một việc khác việc sẽ
 * xảy ra, mà đó đúng là điều hộp thoại này tồn tại để ngăn.
 */
function impactSentence(counts: { comments: number, adminReplies: number, otherReaderReplies: number }) {
  const parts = [`${counts.comments} bình luận của người đọc này`]
  if (counts.adminReplies > 0) {
    parts.push(`${counts.adminReplies} phản hồi của Ban quản trị nằm dưới các bình luận đó`)
  }
  if (counts.otherReaderReplies > 0) {
    parts.push(`${counts.otherReaderReplies} phản hồi của người đọc khác nằm dưới các bình luận đó`)
  }
  return parts.join(', và ')
}

const DURABLE_ANSWER_NOTE = 'Câu trả lời cần giữ lâu dài nên đặt ở Kho kiến thức (có luồng duyệt và trang riêng), không nên để trong phản hồi bình luận.'

async function banReader() {
  const counts = await currentImpact()
  const reason = window.prompt('Lý do chặn (không bắt buộc, hiện trong lịch sử hoạt động):', '')
  // `prompt` trả null khi cán bộ bấm Huỷ — khác hoàn toàn với chuỗi rỗng nghĩa là
  // "chặn nhưng không ghi lý do".
  if (reason === null) return

  if (!confirm(
    `Chặn tài khoản này và xoá ${impactSentence(counts)}?\n\n`
    + `Thao tác KHÔNG THỂ HOÀN TÁC. Bỏ chặn về sau cũng không phục hồi được bình luận đã xoá.\n\n`
    + (counts.adminReplies > 0 ? `${DURABLE_ANSWER_NOTE}\n\n` : '')
    + 'Người đọc sẽ bị đăng xuất ngay lập tức.',
  )) return

  busy.value = true
  try {
    const res = await $fetch<any>(`/api/admin/readers/${readerId.value}/ban`, { method: 'POST', body: { reason } })
    toast.success(`Đã chặn tài khoản và xoá ${res?.impact?.comments ?? 0} bình luận.`)
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không chặn được tài khoản này.'))
  } finally {
    busy.value = false
  }
}

async function unbanReader() {
  if (!confirm('Bỏ chặn tài khoản này? Bình luận đã bị xoá lúc chặn sẽ KHÔNG được phục hồi, và người đọc phải đăng nhập lại.')) return
  busy.value = true
  try {
    await $fetch(`/api/admin/readers/${readerId.value}/unban`, { method: 'POST' })
    toast.success('Đã bỏ chặn tài khoản.')
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không bỏ chặn được tài khoản này.'))
  } finally {
    busy.value = false
  }
}

async function purgeComments() {
  const counts = await currentImpact()
  if (counts.comments === 0) {
    toast.info('Người đọc này chưa có bình luận nào.')
    return
  }
  if (!confirm(
    `Xoá ${impactSentence(counts)}?\n\nTài khoản vẫn hoạt động và vẫn bình luận được. Thao tác KHÔNG THỂ HOÀN TÁC.\n\n`
    + (counts.adminReplies > 0 ? DURABLE_ANSWER_NOTE : ''),
  )) return

  busy.value = true
  try {
    const res = await $fetch<any>(`/api/admin/readers/${readerId.value}/comments`, { method: 'DELETE' })
    toast.success(`Đã xoá ${res?.impact?.comments ?? 0} bình luận.`)
    await load()
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xoá được bình luận.'))
  } finally {
    busy.value = false
  }
}

async function deleteAccount() {
  const counts = await currentImpact()
  if (!confirm(
    `Xoá hẳn tài khoản này cùng ${impactSentence(counts)}?\n\nThao tác KHÔNG THỂ HOÀN TÁC.\n\n`
    + (counts.adminReplies > 0 ? DURABLE_ANSWER_NOTE : ''),
  )) return

  busy.value = true
  try {
    await $fetch(`/api/admin/readers/${readerId.value}`, { method: 'DELETE' })
    toast.success('Đã xoá tài khoản người đọc.')
    router.push('/admin/readers')
  } catch (err: unknown) {
    toast.error(errorMessage(err, 'Không xoá được tài khoản này.'))
    busy.value = false
  }
}

async function deleteOneComment(comment: Comment) {
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
    <nuxt-link to="/admin/readers" class="text-sm font-semibold text-[#2c6e33] no-underline hover:underline">&larr; Danh sách người đọc</nuxt-link>

    <!-- Đang tải -->
    <div v-if="loading" role="status" aria-busy="true" class="flex flex-col gap-3">
      <span class="sr-only">Đang tải thông tin người đọc</span>
      <div
        v-for="n in 5"
        :key="n"
        aria-hidden="true"
        class="h-14 rounded-lg bg-[#eef3ee] animate-pulse motion-reduce:animate-none"
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

    <template v-else-if="reader">
      <section class="rounded-xl border border-[#e2ece3] bg-white p-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <ReaderAvatar :initials="(reader.displayName || '?').slice(0, 1)" />
            <div>
              <h1 class="m-0 text-[1.2rem] font-extrabold text-[#122815]">{{ reader.displayName || 'Chưa có tên' }}</h1>
              <p class="m-0 text-sm text-[#667768]">{{ reader.email || '—' }}</p>
            </div>
          </div>
          <span
            v-if="reader.isBanned"
            class="rounded-full bg-[#fdecec] px-3 py-1 text-[0.8rem] font-bold text-[#b0403c]"
          >Đã chặn</span>
          <span v-else class="rounded-full bg-[#eef7ef] px-3 py-1 text-[0.8rem] font-bold text-[#2c6e33]">Hoạt động</span>
        </div>

        <dl class="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt class="font-bold text-[#2c3e2e]">Đăng nhập lần đầu</dt><dd class="m-0 text-[#3d4f3f]">{{ formatMoment(reader.createdAt) }}</dd></div>
          <div><dt class="font-bold text-[#2c3e2e]">Truy cập gần nhất</dt><dd class="m-0 text-[#3d4f3f]">{{ formatMoment(reader.lastSeenAt) }}</dd></div>
          <div><dt class="font-bold text-[#2c3e2e]">Địa chỉ gần nhất</dt><dd class="m-0 text-[#3d4f3f]">{{ reader.lastIp || '—' }}</dd></div>
          <div><dt class="font-bold text-[#2c3e2e]">Trình duyệt gần nhất</dt><dd class="m-0 break-all text-[#3d4f3f]">{{ reader.lastUserAgent || '—' }}</dd></div>
          <div v-if="reader.isBanned"><dt class="font-bold text-[#2c3e2e]">Bị chặn lúc</dt><dd class="m-0 text-[#3d4f3f]">{{ formatMoment(reader.bannedAt) }}<span v-if="reader.bannedByName"> — bởi {{ reader.bannedByName }}</span></dd></div>
          <div v-if="reader.isBanned && reader.banReason"><dt class="font-bold text-[#2c3e2e]">Lý do</dt><dd class="m-0 whitespace-pre-line text-[#3d4f3f]">{{ reader.banReason }}</dd></div>
        </dl>

        <div class="mt-4 flex flex-wrap gap-2 border-t border-[#e2ece3] pt-4">
          <button
            v-if="!reader.isBanned"
            type="button"
            :disabled="busy"
            class="rounded-lg border border-[#d12420] px-3 py-2 text-sm font-bold text-[#d12420] hover:bg-[#fff4f3] disabled:opacity-60"
            @click="banReader"
          >Chặn tài khoản</button>
          <button
            v-else
            type="button"
            :disabled="busy"
            class="rounded-lg border border-[#c8d6c9] bg-white px-3 py-2 text-sm font-bold text-[#2c3e2e] hover:bg-[#f0f7f1] disabled:opacity-60"
            @click="unbanReader"
          >Bỏ chặn</button>
          <button
            type="button"
            :disabled="busy"
            class="rounded-lg border border-[#d12420] px-3 py-2 text-sm font-bold text-[#d12420] hover:bg-[#fff4f3] disabled:opacity-60"
            @click="purgeComments"
          >Xoá toàn bộ bình luận</button>
          <button
            type="button"
            :disabled="busy"
            class="rounded-lg bg-[#d12420] px-3 py-2 text-sm font-bold text-white hover:bg-[#b01f1b] disabled:opacity-60"
            @click="deleteAccount"
          >Xoá tài khoản</button>
        </div>
      </section>

      <section class="rounded-xl border border-[#e2ece3] bg-white p-5">
        <h2 class="m-0 text-[1rem] font-extrabold text-[#122815]">
          Bình luận đã viết
          <span class="ml-1 text-sm font-semibold text-[#667768]">({{ impact.comments }})</span>
        </h2>
        <p v-if="impact.adminReplies > 0 || impact.otherReaderReplies > 0" class="m-0 mt-1 text-sm text-[#8a7320]">
          <i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>
          Nằm dưới các bình luận này còn có
          <template v-if="impact.adminReplies > 0">{{ impact.adminReplies }} phản hồi của Ban quản trị</template>
          <template v-if="impact.adminReplies > 0 && impact.otherReaderReplies > 0"> và </template>
          <template v-if="impact.otherReaderReplies > 0">{{ impact.otherReaderReplies }} phản hồi của người đọc khác</template>
          — tất cả sẽ bị xoá theo nếu bạn chặn hoặc xoá tài khoản này.
        </p>

        <p v-if="!comments.length" class="m-0 mt-4 rounded-lg bg-[#f8faf8] px-4 py-6 text-center text-sm text-[#667768]">
          Người đọc này chưa viết bình luận nào.
        </p>

        <ul v-else class="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          <li v-for="comment in comments" :key="comment.id" class="rounded-lg border border-[#eef3ee] p-3.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-[0.8rem] text-[#667768]">
                <span v-if="comment.parentId !== null" class="mr-1.5 rounded-full bg-[#eef3ee] px-2 py-0.5 font-bold text-[#3d4f3f]">Phản hồi</span>
                {{ formatMoment(comment.createdAt) }}
                <span v-if="comment.articleTitle"> — {{ comment.articleTitle }}</span>
              </div>
              <button
                type="button"
                :disabled="busy"
                class="text-[0.82rem] font-semibold text-[#b0403c] hover:underline disabled:opacity-60"
                @click="deleteOneComment(comment)"
              >Xoá</button>
            </div>
            <p class="m-0 mt-2 whitespace-pre-line break-words text-sm text-[#2c3529]">{{ comment.body }}</p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
