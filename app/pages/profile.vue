<!--
  Trang cá nhân của người đọc.

  Bốn ràng buộc ở đây là bắt buộc, không phải lựa chọn phong cách:

  1. **`/profile` KHÔNG có trong `routeRules`.** Mọi tuyến công khai khác phục vụ
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

  Tách ở wave3 4.2 → `components/reader-profile/*` (chỉ vẽ) + ba composable ghi. Ở lại
  đây: danh tính, mọi lượt nạp + bốn ép kiểu `$fetch`, khung chờ / lỗi `role="alert"` +
  "Thử lại" / rỗng của ba danh sách, phân trang.
-->
<template>
  <div class="bg-surface min-h-[70vh]">
    <ReaderProfileHero />

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
          <div v-if="!readerLoaded" role="status" aria-busy="true" class="rounded-xl border border-line bg-white p-6">
            <span class="sr-only">Đang tải trang cá nhân</span>
            <div aria-hidden="true" class="flex items-center gap-4">
              <div class="h-14 w-14 shrink-0 animate-pulse rounded-full bg-surface-tint motion-reduce:animate-none"></div>
              <div class="flex flex-1 flex-col gap-2">
                <div class="h-4 w-48 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                <div class="h-3 w-64 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
              </div>
            </div>
          </div>

          <!-- Chưa đăng nhập -->
          <ReaderProfileSignIn v-else-if="!reader" @sign-in="readerSignIn('/profile')" />

          <!-- Đã đăng nhập -->
          <div v-else class="flex flex-col gap-6">
            <!-- ── Khối 1: Thông tin ────────────────────────────────────────── -->
            <ReaderProfileIdentity
              v-model="nameDraft"
              :reader="reader"
              :saving="savingName"
              :error="nameError"
              :saved="nameSaved"
              @save="saveName"
            />

            <!-- ── Khối 2: Thông báo ────────────────────────────────────────── -->
            <section id="notifications" class="rounded-xl border border-line bg-white p-6 scroll-mt-24">
              <ReaderProfileNotificationsHeader :unread-count="unreadCount" @mark-all="markAllNotificationsRead" />

              <ReaderProfileEmailSwitch
                :email="reader.email"
                :on="emailNotificationsOn"
                :saving="savingEmailPref"
                :error="emailPrefError"
                @toggle="toggleEmailNotifications"
              />

              <div v-if="notifPending" role="status" aria-busy="true" class="flex flex-col gap-3">
                <span class="sr-only">Đang tải thông báo</span>
                <div v-for="n in 3" :key="n" aria-hidden="true" class="rounded-lg border border-surface-tint p-4">
                  <div class="h-3 w-44 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                  <div class="mt-2.5 h-3.5 w-full animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                </div>
              </div>

              <p v-else-if="notifFailed" role="alert" class="m-0 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-4 py-6 text-center text-[0.9rem] text-danger-soft">
                <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
                Không thể tải thông báo.
                <button type="button" class="font-bold text-brand-600 underline" @click="reloadNotifications">Thử lại</button>.
              </p>

              <p v-else-if="!notifications.length" class="m-0 rounded-lg border border-dashed border-line px-4 py-8 text-center text-[0.9rem] text-ink-soft">
                Chưa có thông báo nào. Khi có người trả lời bình luận của bạn, thông báo sẽ hiện ở đây.
              </p>

              <ReaderProfileNotificationList v-else :items="notifications" @open="onNotificationClick" />

              <ReaderProfilePager
                v-if="notifTotalPages > 1"
                :page="notifPage"
                :total-pages="notifTotalPages"
                :prev-disabled="notifPage <= 1 || notifPending"
                :next-disabled="notifPage >= notifTotalPages || notifPending"
                @prev="loadNotifications(notifPage - 1)"
                @next="loadNotifications(notifPage + 1)"
              />
            </section>

            <!-- ── Khối 3: Bình luận của tôi ───────────────────────────────── -->
            <section class="rounded-xl border border-line bg-white p-6">
              <header class="mb-4 flex items-center justify-between gap-3">
                <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
                  <i class="fa-solid fa-comments mr-2 text-accent" aria-hidden="true"></i>Bình luận của tôi
                </h2>
                <span v-if="commentsData && commentsData.total > 0" class="shrink-0 rounded-full bg-surface-tint px-2.5 py-1 text-[0.75rem] font-bold text-brand-800">
                  {{ commentsData.total }}
                </span>
              </header>

              <div v-if="commentsPending" role="status" aria-busy="true" class="flex flex-col gap-3">
                <span class="sr-only">Đang tải bình luận của bạn</span>
                <div v-for="n in 3" :key="n" aria-hidden="true" class="rounded-lg border border-surface-tint p-4">
                  <div class="h-3 w-40 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                  <div class="mt-2.5 h-3.5 w-full animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                  <div class="mt-2 h-3.5 w-2/3 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                </div>
              </div>

              <p v-else-if="commentsError" role="alert" class="m-0 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-4 py-6 text-center text-[0.9rem] text-danger-soft">
                <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
                Không thể tải bình luận của bạn.
                <button type="button" class="font-bold text-brand-600 underline" @click="loadComments">Thử lại</button>.
              </p>

              <p v-else-if="!myComments.length" class="m-0 rounded-lg border border-dashed border-line px-4 py-8 text-center text-[0.9rem] text-ink-soft">
                Bạn chưa gửi bình luận nào. Hãy mở một bài viết và đặt câu hỏi ở phần bình luận.
              </p>

              <ReaderProfileCommentList v-else :items="myComments" />

              <ReaderProfilePager
                v-if="commentsData && commentsData.totalPages > 1"
                :page="commentsData.page"
                :total-pages="commentsData.totalPages"
                :prev-disabled="commentsPage <= 1 || commentsPending"
                :next-disabled="commentsPage >= commentsData.totalPages || commentsPending"
                @prev="goToCommentPage(commentsPage - 1)"
                @next="goToCommentPage(commentsPage + 1)"
              />
            </section>

            <!-- ── Khối 4: Bài đã đọc (thiết bị này) ───────────────────────── -->
            <ReaderProfileHistory :entries="history" @remove="removeHistoryItem" @clear="clearHistory" />

            <!-- ── Khối 5: Đoạn chat của tôi ───────────────────────────────── -->
            <section class="rounded-xl border border-line bg-white p-6">
              <header class="mb-4 flex items-center justify-between gap-3">
                <h2 class="m-0 text-[0.95rem] font-extrabold uppercase tracking-wide text-brand-800">
                  <i class="fa-solid fa-robot mr-2 text-accent" aria-hidden="true"></i>Đoạn chat của tôi
                </h2>
                <nuxt-link to="/assistant" class="shrink-0 text-[0.8rem] font-semibold text-brand-600 no-underline hover:underline">
                  Mở trợ lý &rarr;
                </nuxt-link>
              </header>

              <div v-if="chatsPending" role="status" aria-busy="true" class="flex flex-col gap-3">
                <span class="sr-only">Đang tải đoạn chat của bạn</span>
                <div v-for="n in 2" :key="n" aria-hidden="true" class="rounded-lg border border-surface-tint p-4">
                  <div class="h-3.5 w-3/4 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                  <div class="mt-2.5 h-3 w-32 animate-pulse rounded bg-surface-tint motion-reduce:animate-none"></div>
                </div>
              </div>

              <p v-else-if="chatsError" role="alert" class="m-0 rounded-lg border border-dashed border-[#E2A0A0] bg-[#FDF6F6] px-4 py-6 text-center text-[0.9rem] text-danger-soft">
                <i class="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
                Không thể tải đoạn chat của bạn.
                <button type="button" class="font-bold text-brand-600 underline" @click="loadChats">Thử lại</button>.
              </p>

              <template v-else>
                <p v-if="!myChats.length" class="m-0 rounded-lg border border-dashed border-line px-4 py-8 text-center text-[0.9rem] text-ink-soft">
                  Chưa có đoạn trò chuyện nào gắn với tài khoản của bạn.
                </p>

                <ReaderProfileChatList v-else :items="myChats" />

                <ReaderProfileChatClaim :claiming="claiming" :message="claimMessage" @claim="claimNow" />
              </template>
            </section>
          </div>
        </div>
      </section>
    </client-only>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useReaderAuth } from '~/composables/useReaderAuth'
import { useReaderNotifications } from '~/composables/useReaderNotifications'
import { useReadingHistory } from '~/composables/useReadingHistory'
import { useReaderNameEdit, type SavedReaderName } from '~/composables/useReaderNameEdit'
import { useReaderEmailPreference } from '~/composables/useReaderEmailPreference'
import { useReaderChatClaim } from '~/composables/useReaderChatClaim'
import { errorStatus } from '~/utils/errorMessage'
import type { NotificationItem } from '~/composables/useReaderNotifications'
import type { ReaderChatsPayload, ReaderCommentsPayload } from '~/types/public-api'
import ReaderProfileHero from '~/components/reader-profile/ReaderProfileHero.vue'
import ReaderProfileSignIn from '~/components/reader-profile/ReaderProfileSignIn.vue'
import ReaderProfileIdentity from '~/components/reader-profile/ReaderProfileIdentity.vue'
import ReaderProfileNotificationsHeader from '~/components/reader-profile/ReaderProfileNotificationsHeader.vue'
import ReaderProfileEmailSwitch from '~/components/reader-profile/ReaderProfileEmailSwitch.vue'
import ReaderProfileNotificationList from '~/components/reader-profile/ReaderProfileNotificationList.vue'
import ReaderProfilePager from '~/components/reader-profile/ReaderProfilePager.vue'
import ReaderProfileCommentList from '~/components/reader-profile/ReaderProfileCommentList.vue'
import ReaderProfileHistory from '~/components/reader-profile/ReaderProfileHistory.vue'
import ReaderProfileChatList from '~/components/reader-profile/ReaderProfileChatList.vue'
import ReaderProfileChatClaim from '~/components/reader-profile/ReaderProfileChatClaim.vue'

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
  applyEmailPreference,
  claimChats,
  clearClaimFlag,
  forgetReader,
} = useReaderAuth()

// Lịch sử đọc: chỉ trên thiết bị này (localStorage) — khối vẽ ở ReaderProfileHistory.
const { entries: history, load: loadHistory, clear: clearHistory, remove: removeHistoryItem } = useReadingHistory()

// ─── Đổi tên ────────────────────────────────────────────────────────────────
const { nameDraft, savingName, nameError, nameSaved, saveName } = useReaderNameEdit({
  reader,
  save: displayName => ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<{ ok: boolean; reader?: SavedReaderName }>)(`/api/public/reader/profile`, {
    method: 'PUT',
    body: { displayName },
  }),
  applyDisplayName,
  forgetReader,
})

// ─── Thông báo ──────────────────────────────────────────────────────────────
// State ở cấp module trong composable, dùng chung với chuông ở header: đánh dấu
// đã đọc tại đây làm huy hiệu trên header rụng ngay, không đợi tải lại trang.
const {
  items: notifications,
  unreadCount,
  page: notifPage,
  totalPages: notifTotalPages,
  pending: notifPending,
  failed: notifFailed,
  load: loadNotifications,
  markRead: markNotificationsRead,
  markAllRead: markAllNotificationsRead,
} = useReaderNotifications()

/** Nút thử lại gọi lại CHÍNH lượt fetch đã hỏng, ở đúng trang đang xem. */
function reloadNotifications() {
  loadNotifications(notifPage.value).catch((err) => {
    if (errorStatus(err) === 401) forgetReader()
  })
}

/**
 * Bấm một thông báo: đánh dấu đã đọc, để `NuxtLink` tự điều hướng.
 *
 * Không `preventDefault`: phần tử đã là một liên kết thật khi có đích, nên chuột
 * giữa và "mở tab mới" vẫn hoạt động như người đọc mong đợi.
 */
function onNotificationClick(item: NotificationItem) {
  if (!item.isRead) void markNotificationsRead([item.id])
}

// ─── Công tắc nhận email ────────────────────────────────────────────────────
const { savingEmailPref, emailPrefError, emailNotificationsOn, toggleEmailNotifications } = useReaderEmailPreference({
  reader,
  save: enabled => ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<unknown>)('/api/public/reader/profile/email-notifications', {
    method: 'PUT',
    body: { enabled },
  }),
  applyEmailPreference,
  forgetReader,
})

// ─── Bình luận của tôi ──────────────────────────────────────────────────────
// Kiểu suy từ chính handler: `ref(null)` trần là `Ref<null>`, nên mọi phép đọc
// `.comments` / `.total` / `.totalPages` trong template thành lỗi.
const commentsData = ref<ReaderCommentsPayload | null>(null)
const commentsPending = ref(false)
const commentsError = ref(false)
const commentsPage = ref(1)

const myComments = computed(() => commentsData.value?.comments || [])

/** Nút thử lại gọi lại CHÍNH lượt fetch đã hỏng — không `location.reload()`. */
async function loadComments() {
  commentsPending.value = true
  commentsError.value = false
  try {
    commentsData.value = await ($fetch as (u: string, o: Record<string, unknown> | undefined) => Promise<ReaderCommentsPayload>)('/api/public/reader/comments', {
      query: { page: commentsPage.value },
    })
  } catch (err) {
    commentsError.value = true
    if (errorStatus(err) === 401) forgetReader()
  } finally {
    commentsPending.value = false
  }
}

function goToCommentPage(page: number) {
  commentsPage.value = page
  loadComments()
}

// ─── Đoạn chat của tôi ──────────────────────────────────────────────────────
const chatsData = ref<ReaderChatsPayload | null>(null)
const chatsPending = ref(false)
const chatsError = ref(false)

const myChats = computed(() => chatsData.value?.sessions || [])

async function loadChats() {
  chatsPending.value = true
  chatsError.value = false
  try {
    chatsData.value = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<ReaderChatsPayload>)('/api/public/reader/chats')
  } catch (err) {
    chatsError.value = true
    if (errorStatus(err) === 401) forgetReader()
  } finally {
    chatsPending.value = false
  }
}

const { claiming, claimMessage, claimNow } = useReaderChatClaim({
  claimChats,
  clearClaimFlag,
  loadChats,
  chatCount: () => myChats.value.length,
})

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
  // Ba lượt độc lập nên chạy cùng lúc: nối đuôi thì thời gian chờ là tổng, còn
  // song song thì là lượt chậm nhất. `loadNotifications` có thể ném 401 (vé hết
  // hiệu lực giữa lúc trang mở) nên bắt riêng — để lọt thì `Promise.all` huỷ cả
  // hai lượt kia và trang trống trơn không có lời giải thích nào.
  await Promise.all([
    loadComments(),
    loadChats(),
    loadNotifications().catch((err) => {
      if (errorStatus(err) === 401) forgetReader()
    }),
  ])
})
</script>
