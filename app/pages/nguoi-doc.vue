<!--
  Trang cá nhân của người đọc.

  Bốn ràng buộc ở đây là bắt buộc, không phải lựa chọn phong cách:

  1. **`/nguoi-doc` KHÔNG có trong `routeRules`.** Mọi tuyến công khai khác phục vụ
     qua `swr: 60`; một cửa sổ đệm ở trang này là phát tên, email, bình luận và
     đoạn chat của người này cho người kế tiếp ghé vào trong 60 giây.
  2. **Mọi dữ liệu nạp SAU MOUNT.** Không `await useFetch` ở cấp thiết lập, không
     `useAsyncData` phía máy chủ — cùng hình dạng mà lượt ping đếm lượt xem và
     luồng bình luận đã dùng. HTML dựng phía máy chủ của trang này không được chứa
     một chữ nào của riêng ai.
  3. **Không chuyển hướng cứng khi chưa đăng nhập.** `useReaderAuth` chỉ biết người
     đọc là ai sau mount, nên một `middleware` chuyển hướng sẽ chạy trước khi biết
     — và đá cả người đã đăng nhập ra ngoài. Trang hiện khối mời đăng nhập.
  4. **Không `v-html`, ở đâu cũng vậy.** Bình luận, tiêu đề đoạn chat, tên bài viết
     đều là văn bản do người dùng hoặc cán bộ gõ, hiện qua `{{ }}`.
-->
<template>
  <div class="bg-[#F8FAF7] min-h-[70vh]">
    <section class="bg-gradient-to-br from-[#1e4620] to-[#133215] py-10 text-white">
      <div class="container">
        <nav aria-label="Đường dẫn" class="mb-3 text-[0.82rem] text-white/70">
          <nuxt-link to="/" class="text-white/80 no-underline hover:underline">Trang chủ</nuxt-link> &raquo;
          <span class="text-white/95 font-semibold">Trang cá nhân</span>
        </nav>
        <h1 class="m-0 text-[1.7rem] font-extrabold">Trang cá nhân</h1>
        <p class="mt-2 mb-0 text-[0.92rem] text-white/80">
          Tên hiển thị, bình luận đã gửi, bài đã đọc và các đoạn trò chuyện của bạn.
        </p>
      </div>
    </section>

    <!--
      `<client-only>` bọc toàn bộ nội dung, không riêng vài khối.

      Không có `fallback`: một khối "mời đăng nhập" nhấp nháy rồi đổi thành trang cá
      nhân là câu trả lời sai hiện ra trước câu trả lời đúng — và ở đây nó nói với
      người đọc rằng họ chưa đăng nhập, đúng lúc họ vừa bấm vào tên của mình.
    -->
    <client-only>
      <section class="py-10">
        <div class="container max-w-[900px]">
          <!-- Đang xác định danh tính -->
          <div v-if="!readerLoaded" role="status" aria-busy="true" class="rounded-xl border border-[#E2E8DF] bg-white p-6">
            <span class="sr-only">Đang tải trang cá nhân</span>
            <div aria-hidden="true" class="flex items-center gap-4">
              <div class="h-14 w-14 shrink-0 animate-pulse rounded-full bg-[#EEF2EC] motion-reduce:animate-none"></div>
              <div class="flex flex-1 flex-col gap-2">
                <div class="h-4 w-48 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
                <div class="h-3 w-64 animate-pulse rounded bg-[#F1F5F0] motion-reduce:animate-none"></div>
              </div>
            </div>
          </div>

          <!-- Chưa đăng nhập -->
          <div v-else-if="!reader" class="rounded-xl border border-[#E2E8DF] bg-white px-6 py-12 text-center">
            <i class="fa-solid fa-user-lock mb-4 text-[2rem] text-[#CFDDC8]" aria-hidden="true"></i>
            <h2 class="m-0 mb-2 text-[1.1rem] font-extrabold text-[#122815]">Bạn chưa đăng nhập</h2>
            <p class="mx-auto mb-6 max-w-[460px] text-[0.9rem] leading-relaxed text-[#4A5545]">
              Đăng nhập bằng tài khoản Google để đặt câu hỏi dưới các bài viết, xem lại bình luận đã gửi
              và các đoạn trò chuyện với trợ lý.
            </p>
            <button
              type="button"
              class="btn btn-primary inline-flex items-center gap-2 px-6 py-3 text-[0.9rem]"
              @click="readerSignIn('/nguoi-doc')"
            >
              <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Đăng nhập bằng Google
            </button>
          </div>

          <!-- Đã đăng nhập -->
          <div v-else class="flex flex-col gap-6">
            <!-- ── Khối 1: Thông tin ────────────────────────────────────────── -->
            <section class="rounded-xl border border-[#E2E8DF] bg-white p-6">
              <div class="flex flex-wrap items-center gap-4 border-b border-[#EEF2EC] pb-5">
                <ReaderAvatar :initials="reader.initials" size="lg" />
                <div class="min-w-0 flex-1">
                  <p class="m-0 truncate text-[1.15rem] font-extrabold text-[#122815]">{{ reader.displayName }}</p>
                  <p v-if="reader.email" class="m-0 mt-0.5 truncate text-[0.85rem] text-[#7A8675]">{{ reader.email }}</p>
                </div>
              </div>

              <form class="mt-5" @submit.prevent="saveName">
                <label for="reader-display-name" class="mb-2 block text-[0.85rem] font-bold text-[#385130]">
                  Tên hiển thị
                </label>
                <p class="mb-2.5 mt-0 text-[0.8rem] leading-relaxed text-[#7A8675]">
                  Tên này hiện cùng mọi bình luận của bạn trên cổng thông tin. Từ
                  {{ DISPLAY_NAME_MIN_LENGTH }} đến {{ DISPLAY_NAME_MAX_LENGTH }} ký tự.
                  Địa chỉ email của bạn không bao giờ hiện công khai.
                </p>
                <div class="flex flex-wrap gap-2.5">
                  <input
                    id="reader-display-name"
                    v-model="nameDraft"
                    type="text"
                    :maxlength="DISPLAY_NAME_MAX_LENGTH"
                    autocomplete="nickname"
                    class="min-w-0 flex-1 rounded-lg border border-[#E2E8DF] bg-white px-3.5 py-2.5 text-[0.9rem] text-[#1E251C] outline-none transition-colors focus:border-[#7CB342] focus:ring-2 focus:ring-[#7CB342]/30"
                    placeholder="Ví dụ: Nguyễn Văn A"
                  />
                  <button
                    type="submit"
                    class="btn btn-primary px-5 py-2.5 text-[0.88rem] disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="savingName || !nameDraft.trim() || nameDraft.trim() === reader.displayName"
                  >
                    {{ savingName ? 'Đang lưu…' : 'Lưu tên' }}
                  </button>
                </div>

                <!-- Nhánh lỗi thường trực mang `role="alert"`: không có nó, người
                     dùng sáng mắt thấy một khối đỏ còn người dùng trình đọc màn
                     hình không được thông báo gì. -->
                <p v-if="nameError" role="alert" class="mt-2.5 mb-0 flex items-start gap-2 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-3 py-2.5 text-[0.85rem] text-[#B04A4A]">
                  <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
                  <span>{{ nameError }}</span>
                </p>
                <p v-else-if="nameSaved" role="status" class="mt-2.5 mb-0 flex items-center gap-2 text-[0.85rem] font-semibold text-[#4A6741]">
                  <i class="fa-solid fa-circle-check" aria-hidden="true"></i> Đã lưu tên hiển thị mới.
                </p>
              </form>
            </section>

            <!-- ── Khối 2: Bình luận của tôi ───────────────────────────────── -->
            <section class="rounded-xl border border-[#E2E8DF] bg-white p-6">
              <header class="mb-4 flex items-center justify-between gap-3">
                <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-[#385130]">
                  <i class="fa-solid fa-comments mr-2 text-[#7CB342]" aria-hidden="true"></i>Bình luận của tôi
                </h2>
                <span v-if="commentsData && commentsData.total > 0" class="shrink-0 rounded-full bg-[#EEF2EC] px-2.5 py-1 text-[0.75rem] font-bold text-[#385130]">
                  {{ commentsData.total }}
                </span>
              </header>

              <div v-if="commentsPending" role="status" aria-busy="true" class="flex flex-col gap-3">
                <span class="sr-only">Đang tải bình luận của bạn</span>
                <div v-for="n in 3" :key="n" aria-hidden="true" class="rounded-lg border border-[#EEF2EC] p-4">
                  <div class="h-3 w-40 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
                  <div class="mt-2.5 h-3.5 w-full animate-pulse rounded bg-[#F1F5F0] motion-reduce:animate-none"></div>
                  <div class="mt-2 h-3.5 w-2/3 animate-pulse rounded bg-[#F1F5F0] motion-reduce:animate-none"></div>
                </div>
              </div>

              <p v-else-if="commentsError" role="alert" class="m-0 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-4 py-6 text-center text-[0.9rem] text-[#B04A4A]">
                <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
                Không thể tải bình luận của bạn.
                <button type="button" class="font-bold text-[#4A6741] underline" @click="loadComments">Thử lại</button>.
              </p>

              <p v-else-if="!myComments.length" class="m-0 rounded-lg border border-dashed border-[#E2E8DF] px-4 py-8 text-center text-[0.9rem] text-[#7A8675]">
                Bạn chưa gửi bình luận nào. Hãy mở một bài viết và đặt câu hỏi ở phần bình luận.
              </p>

              <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
                <li v-for="item in myComments" :key="item.id" class="rounded-lg border border-[#EEF2EC] bg-[#FCFDFC] p-4">
                  <div class="mb-2 flex flex-wrap items-center gap-2 text-[0.78rem] text-[#7A8675]">
                    <span class="font-semibold">{{ formatDateVN(item.createdAt) }}</span>
                    <span v-if="item.isReply" class="rounded bg-[#EEF2EC] px-1.5 py-0.5 font-semibold text-[#385130]">Phản hồi</span>
                    <span v-if="item.replyCount > 0" class="rounded bg-[#4A6741] px-1.5 py-0.5 font-semibold text-white">
                      {{ item.replyCount }} trả lời
                    </span>
                  </div>
                  <p class="m-0 whitespace-pre-line break-words text-[0.9rem] leading-relaxed text-[#1E251C]">{{ item.body }}</p>
                  <p v-if="item.article" class="mt-2.5 mb-0 text-[0.82rem]">
                    <template v-if="item.article.readable">
                      <nuxt-link :to="item.article.url" class="font-semibold text-[#4A6741] no-underline hover:underline">
                        {{ item.article.title }}
                      </nuxt-link>
                    </template>
                    <!-- Bài đã ẩn hoặc đã đóng bình luận: nói ra thay vì đưa một
                         liên kết dẫn tới một trang không có luồng bình luận nào —
                         người đọc sẽ hiểu là bình luận của họ đã bị xoá. -->
                    <span v-else class="text-[#7A8675]">
                      {{ item.article.title }}
                      <span class="italic">(bài viết hiện không mở bình luận)</span>
                    </span>
                  </p>
                </li>
              </ul>

              <div v-if="commentsData && commentsData.totalPages > 1" class="mt-4 flex items-center justify-center gap-3">
                <button
                  type="button"
                  class="rounded-lg border border-[#E2E8DF] px-3 py-2 text-[0.82rem] font-semibold text-[#385130] disabled:opacity-50"
                  :disabled="commentsPage <= 1 || commentsPending"
                  @click="goToCommentPage(commentsPage - 1)"
                >Trước</button>
                <span class="text-[0.82rem] text-[#7A8675]">Trang {{ commentsData.page }} / {{ commentsData.totalPages }}</span>
                <button
                  type="button"
                  class="rounded-lg border border-[#E2E8DF] px-3 py-2 text-[0.82rem] font-semibold text-[#385130] disabled:opacity-50"
                  :disabled="commentsPage >= commentsData.totalPages || commentsPending"
                  @click="goToCommentPage(commentsPage + 1)"
                >Sau</button>
              </div>
            </section>

            <!-- ── Khối 3: Bài đã đọc ──────────────────────────────────────── -->
            <section class="rounded-xl border border-[#E2E8DF] bg-white p-6">
              <header class="mb-2 flex items-center justify-between gap-3">
                <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-[#385130]">
                  <i class="fa-solid fa-book-open mr-2 text-[#7CB342]" aria-hidden="true"></i>Bài đã đọc
                </h2>
                <button
                  v-if="history.length"
                  type="button"
                  class="shrink-0 text-[0.8rem] font-semibold text-[#7A8675] underline transition-colors hover:text-[#B04A4A]"
                  @click="clearHistory"
                >Xoá danh sách</button>
              </header>

              <!--
                Câu này phải hiện ra, không phải để người đọc tự suy ra.

                Lịch sử đọc lưu trong trình duyệt này chứ không trên máy chủ — cổ ý,
                để không tồn tại bảng nào ghi "công dân nào đã đọc bài nào, lúc
                nào" (xem app/composables/useReadingHistory.ts). Hệ quả là đổi máy
                hay xoá dữ liệu trình duyệt là mất, và một người tưởng nó theo tài
                khoản sẽ kết luận cổng đã làm mất dữ liệu của họ.
              -->
              <p class="mb-4 mt-0 flex items-start gap-2 rounded-lg bg-[#F3F7F1] px-3 py-2.5 text-[0.8rem] leading-relaxed text-[#4A5545]">
                <i class="fa-solid fa-circle-info mt-0.5 text-[#7CB342]" aria-hidden="true"></i>
                <span>
                  Danh sách này được lưu trên <strong>thiết bị này</strong>, không lưu trên máy chủ và không gắn với
                  tài khoản của bạn. Cổng thông tin không ghi lại việc bạn đã đọc những bài nào.
                </span>
              </p>

              <p v-if="!history.length" class="m-0 rounded-lg border border-dashed border-[#E2E8DF] px-4 py-8 text-center text-[0.9rem] text-[#7A8675]">
                Chưa có bài viết nào được đọc trên thiết bị này.
              </p>

              <ul v-else class="m-0 flex list-none flex-col divide-y divide-[#EEF2EC] p-0">
                <li v-for="item in history" :key="item.slug" class="py-2.5 first:pt-0 last:pb-0">
                  <nuxt-link
                    :to="`/news/${item.slug}`"
                    class="flex items-start justify-between gap-3 no-underline"
                  >
                    <span class="min-w-0 flex-1 text-[0.9rem] font-semibold leading-snug text-[#1E251C] transition-colors hover:text-[#4A6741]">
                      {{ item.title || item.slug }}
                    </span>
                    <span v-if="item.readAt" class="shrink-0 text-[0.76rem] text-[#7A8675]">{{ formatReadAt(item.readAt) }}</span>
                  </nuxt-link>
                </li>
              </ul>
            </section>

            <!-- ── Khối 4: Đoạn chat của tôi ───────────────────────────────── -->
            <section class="rounded-xl border border-[#E2E8DF] bg-white p-6">
              <header class="mb-4 flex items-center justify-between gap-3">
                <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-[#385130]">
                  <i class="fa-solid fa-robot mr-2 text-[#7CB342]" aria-hidden="true"></i>Đoạn chat của tôi
                </h2>
                <nuxt-link to="/tro-ly" class="shrink-0 text-[0.8rem] font-semibold text-[#4A6741] no-underline hover:underline">
                  Mở trợ lý &rarr;
                </nuxt-link>
              </header>

              <div v-if="chatsPending" role="status" aria-busy="true" class="flex flex-col gap-3">
                <span class="sr-only">Đang tải đoạn chat của bạn</span>
                <div v-for="n in 2" :key="n" aria-hidden="true" class="rounded-lg border border-[#EEF2EC] p-4">
                  <div class="h-3.5 w-3/4 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
                  <div class="mt-2.5 h-3 w-32 animate-pulse rounded bg-[#F1F5F0] motion-reduce:animate-none"></div>
                </div>
              </div>

              <p v-else-if="chatsError" role="alert" class="m-0 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-4 py-6 text-center text-[0.9rem] text-[#B04A4A]">
                <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
                Không thể tải đoạn chat của bạn.
                <button type="button" class="font-bold text-[#4A6741] underline" @click="loadChats">Thử lại</button>.
              </p>

              <template v-else>
                <p v-if="!myChats.length" class="m-0 rounded-lg border border-dashed border-[#E2E8DF] px-4 py-8 text-center text-[0.9rem] text-[#7A8675]">
                  Chưa có đoạn trò chuyện nào gắn với tài khoản của bạn.
                </p>

                <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
                  <li v-for="item in myChats" :key="item.id" class="rounded-lg border border-[#EEF2EC] bg-[#FCFDFC] p-4">
                    <p class="m-0 line-clamp-2 break-words text-[0.9rem] font-semibold leading-snug text-[#1E251C]">{{ item.title }}</p>
                    <p class="mt-1.5 mb-0 text-[0.78rem] text-[#7A8675]">
                      {{ formatDateVN(item.lastMessageAt) }} • {{ item.messageCount }} tin nhắn
                    </p>
                  </li>
                </ul>

                <!--
                  Nút nhận thủ công.

                  `load()` đã tự gửi một lượt nhận mỗi phiên trình duyệt, nên nút này
                  là đường dự phòng cho lượt tự động đã trượt (mất mạng giữa lúc
                  đăng nhập) — chứ không phải cách chính. Nó gọi `clearClaimFlag()`
                  trước, không thì lượt bấm thứ hai sẽ trả về ngay mà không làm gì.
                -->
                <div class="mt-4 border-t border-[#EEF2EC] pt-4">
                  <p class="mb-2.5 mt-0 text-[0.8rem] leading-relaxed text-[#7A8675]">
                    Nếu bạn đã trò chuyện với trợ lý trên thiết bị này trước khi đăng nhập, hãy gắn các đoạn đó vào tài khoản.
                  </p>
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-lg border border-[#E2E8DF] bg-[#F8FAF7] px-4 py-2.5 text-[0.85rem] font-bold text-[#385130] transition-colors hover:bg-[#EEF2EC] disabled:opacity-60"
                    :disabled="claiming"
                    @click="claimNow"
                  >
                    <i class="fa-solid fa-link" aria-hidden="true"></i>
                    {{ claiming ? 'Đang gắn…' : 'Nhận các đoạn chat trên thiết bị này' }}
                  </button>
                  <p v-if="claimMessage" role="status" class="mt-2.5 mb-0 text-[0.83rem] font-semibold text-[#4A6741]">{{ claimMessage }}</p>
                </div>
              </template>
            </section>
          </div>
        </div>
      </section>
    </client-only>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { formatDateVN } from '~/utils/formatDate'
import { useReaderAuth } from '~/composables/useReaderAuth'
import { useReadingHistory } from '~/composables/useReadingHistory'

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

useSeoMeta({
  title: 'Trang cá nhân | Con Đường Hướng Thiện',
  description: 'Quản lý tên hiển thị, xem lại bình luận đã gửi và các đoạn trò chuyện với trợ lý.',
  // Trang riêng tư: không có gì ở đây thuộc về kết quả tìm kiếm.
  robots: 'noindex, nofollow',
})

const {
  reader,
  loaded: readerLoaded,
  load: loadReader,
  signIn: readerSignIn,
  applyDisplayName,
  claimChats,
  clearClaimFlag,
  forgetReader,
} = useReaderAuth()

const { entries: history, load: loadHistory, clear: clearHistory } = useReadingHistory()

/**
 * Ngày đọc, định dạng theo múi giờ CỦA MÁY người đọc — cố ý không dùng
 * `formatDateVN`.
 *
 * `formatDateVN` đọc bằng `getUTC*`, đúng cho các cột DATETIME mà Drizzle ghi
 * dưới dạng giờ treo tường UTC và cần khớp giữa lượt dựng phía máy chủ với trình
 * duyệt. Nhưng `readAt` ở đây là một mốc thời gian thật do `Date.now()` sinh ra
 * ngay trên máy này, nên đọc nó bằng UTC là **lùi 7 giờ**: một bài đọc lúc 6 giờ
 * sáng ở Việt Nam sẽ hiện ngày hôm trước.
 *
 * Không có vấn đề khớp SSR để lo: cả khối này nằm trong `<client-only>` và dữ
 * liệu chỉ tồn tại trong `localStorage` của chính trình duyệt đang xem.
 */
function formatReadAt(epochMs) {
  if (!epochMs) return ''
  const d = new Date(epochMs)
  if (Number.isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

// ─── Đổi tên ────────────────────────────────────────────────────────────────
const nameDraft = ref('')
const savingName = ref(false)
const nameError = ref('')
const nameSaved = ref(false)

async function saveName() {
  const value = nameDraft.value.trim()
  if (!value || savingName.value) return

  savingName.value = true
  nameError.value = ''
  nameSaved.value = false
  try {
    const response = await $fetch('/api/public/reader/profile', {
      method: 'PUT',
      body: { displayName: value },
    })
    // State ở cấp module, nên header đổi tên ngay — không đợi tải lại trang.
    if (response?.reader) applyDisplayName(response.reader)
    nameSaved.value = true
  } catch (err) {
    /**
     * 401 nghĩa là vé đã hết hiệu lực trong lúc trang đang mở (hết 30 ngày, hoặc
     * `tokenVersion` bị tăng). Bỏ danh tính đã cache để trang đổi sang khối mời
     * đăng nhập — giữ nguyên thì form vẫn còn đó kèm một dòng lỗi, và không có nút
     * đăng nhập nào: một ngõ cụt mà đường ra duy nhất là tự tải lại trang.
     *
     * 403 thì KHÔNG xử lý như vậy: đó là lệnh chặn, người đọc **vẫn** đang đăng
     * nhập, và mời họ đăng nhập lại là mời một lượt sẽ thành công mà không đổi gì.
     */
    nameError.value = err?.statusMessage || err?.data?.statusMessage || 'Không thể lưu tên hiển thị. Vui lòng thử lại.'
    if (err?.statusCode === 401) forgetReader()
  } finally {
    savingName.value = false
  }
}

// Đồng bộ ô nhập với tên đang có hiệu lực. `immediate` không dùng được vì danh
// tính về sau mount; watch bắt đúng lúc nó về, và cũng bắt lượt lưu thành công.
watch(reader, value => {
  if (value && !nameDraft.value) nameDraft.value = value.displayName
})

// Xoá thông báo "đã lưu" ngay khi người đọc gõ tiếp: để nó ở lại thì lần sửa sau
// trông như đã được lưu trong khi chưa.
watch(nameDraft, () => { nameSaved.value = false })

// ─── Bình luận của tôi ──────────────────────────────────────────────────────
const commentsData = ref(null)
const commentsPending = ref(false)
const commentsError = ref(false)
const commentsPage = ref(1)

const myComments = computed(() => commentsData.value?.comments || [])

/** Nút thử lại gọi lại CHÍNH lượt fetch đã hỏng — không `location.reload()`. */
async function loadComments() {
  commentsPending.value = true
  commentsError.value = false
  try {
    commentsData.value = await $fetch('/api/public/reader/comments', {
      query: { page: commentsPage.value },
    })
  } catch (err) {
    commentsError.value = true
    if (err?.statusCode === 401) forgetReader()
  } finally {
    commentsPending.value = false
  }
}

function goToCommentPage(page) {
  commentsPage.value = page
  loadComments()
}

// ─── Đoạn chat của tôi ──────────────────────────────────────────────────────
const chatsData = ref(null)
const chatsPending = ref(false)
const chatsError = ref(false)
const claiming = ref(false)
const claimMessage = ref('')

const myChats = computed(() => chatsData.value?.sessions || [])

async function loadChats() {
  chatsPending.value = true
  chatsError.value = false
  try {
    chatsData.value = await $fetch('/api/public/reader/chats')
  } catch (err) {
    chatsError.value = true
    if (err?.statusCode === 401) forgetReader()
  } finally {
    chatsPending.value = false
  }
}

async function claimNow() {
  claiming.value = true
  claimMessage.value = ''
  try {
    clearClaimFlag()
    await claimChats()
    await loadChats()
    // Con số lấy từ danh sách vừa nạp lại, không từ phản hồi của lượt nhận: đó là
    // thứ người đọc đang nhìn thấy ngay bên trên.
    claimMessage.value = myChats.value.length
      ? `Đã gắn ${myChats.value.length} đoạn trò chuyện vào tài khoản của bạn.`
      : 'Không tìm thấy đoạn trò chuyện nào trên thiết bị này.'
  } finally {
    claiming.value = false
  }
}

/**
 * Mọi lượt nạp đi sau mount.
 *
 * `loadReader()` là điều kiện tiên quyết cho hai lượt còn lại — chúng cần vé, và
 * gọi song song sẽ nhận 401 nếu danh tính chưa xác định. Lịch sử đọc thì đọc
 * localStorage nên không phụ thuộc gì.
 */
onMounted(async () => {
  loadHistory()
  await loadReader()
  if (!reader.value) return
  // Hai lượt độc lập nên chạy cùng lúc: nối đuôi thì thời gian chờ là tổng, còn
  // song song thì là lượt chậm hơn.
  await Promise.all([loadComments(), loadChats()])
})
</script>
