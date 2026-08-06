<script setup>
/**
 * Chuông thông báo ở header desktop.
 *
 * Tách khỏi `app/layouts/default.vue` (991 dòng) vì khối này là thứ **duy nhất**
 * trong layout có state riêng, listener riêng và ba nhánh tải/lỗi/rỗng của
 * riêng nó — mọi thứ còn lại trong tệp đó là khung trang. Nhưng phần đáng tách
 * không phải ~120 dòng template: nó là **hai listener cấp document** mà chuông
 * dùng chung với menu danh tính. Chừng nào chúng còn nằm chung, layout vẫn phải
 * giữ `notifMenuRef` và hai nhánh `if (isNotifMenuOpen)` — tức là một lần "tách
 * component" chỉ dời chữ đi chỗ khác mà không gỡ được cái ràng buộc.
 *
 * Nên component này **tự sở hữu cách đóng của nó**: Escape và mousedown ra ngoài
 * được đăng ký và gỡ bỏ ngay tại đây, đúng vòng đời của chính nó.
 *
 * `.client` là **bắt buộc, không phải tối ưu hoá**: mọi tuyến công khai chạy
 * `swr: 60`, nên một khối dựng phía máy chủ có tên và số chưa đọc của một người
 * sẽ được phát lại cho người kế tiếp ghé vào trong cùng 60 giây. Đây là chính
 * ràng buộc đã ghi trong CLAUDE.md cho mọi thứ liên quan tới người đọc.
 */
const NuxtLink = resolveComponent('NuxtLink')

const {
  items: notifications,
  unreadCount,
  pending,
  failed,
  loaded,
  load,
  markRead,
  markAllRead,
} = useReaderNotifications()

const isOpen = ref(false)
const rootRef = ref(null)

/**
 * Danh sách đã được nạp bởi layout ngay khi biết người đọc là ai — huy hiệu ở
 * ngăn kéo mobile cần con số đó mà không có cú mở nào để bám vào. Ở đây chỉ nạp
 * bù cho trường hợp lượt đầu đã hỏng, để cú bấm không mở ra một danh sách rỗng
 * vĩnh viễn.
 */
function toggle() {
  isOpen.value = !isOpen.value
  if (isOpen.value && !loaded.value && !pending.value) {
    void load().catch(() => {})
  }
}

/**
 * Bấm một thông báo: đánh dấu đã đọc rồi để `NuxtLink` điều hướng.
 *
 * Không `preventDefault`, không tự `navigateTo`: phần tử đã là một liên kết thật
 * khi có đích, nên chuột giữa và "mở tab mới" vẫn hoạt động. Lượt đánh dấu là
 * lạc quan trong composable nên nó không chặn cú điều hướng.
 */
function onItemClick(item) {
  isOpen.value = false
  if (!item.isRead) void markRead([item.id])
}

/**
 * Menu mở mà không thoát được bằng bàn phím là một cái bẫy bàn phím.
 */
function onKeydown(event) {
  if (event.key === 'Escape' && isOpen.value) isOpen.value = false
}

/**
 * Bắt ở pha `mousedown` chứ không `click`: menu này chứa toàn liên kết điều
 * hướng, và đóng ở `click` thì handler chạy **sau** khi Vue đã tháo phần tử —
 * cú bấm không bao giờ tới được liên kết.
 */
function onPointerDown(event) {
  if (!isOpen.value) return
  const root = rootRef.value
  if (root && !root.contains(event.target)) isOpen.value = false
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onPointerDown)
})

/**
 * Đăng xuất tháo component này bằng `v-if`, nên `onBeforeUnmount` đã gỡ listener.
 * Nhưng menu phải đóng lại **trước** lúc đó, nếu không lần đăng nhập sau nó vẫn
 * còn mở đúng ở chỗ đó, treo dưới một cái tên đã không còn.
 */
defineExpose({ close: () => { isOpen.value = false } })
</script>

<template>
  <!--
    `relative` ở đây, và tổ tiên của nó **không được** có `overflow-x` khác
    `visible` — `overflow-x: auto` biến `overflow-y: visible` thành `auto` và cắt
    mất menu này. Cùng cái bẫy đã ghi ở menu danh tính và ở thanh điều hướng.
  -->
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="relative flex items-center justify-center w-9 h-9 rounded-full bg-[#F8FAF7] border border-[#E2E8DF] text-[#385130] transition-all hover:bg-[#EEF2EC] hover:border-[#CFDDC8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342]"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      :aria-label="unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : 'Thông báo'"
      @click="toggle"
    >
      <i class="fa-solid fa-bell text-[0.9rem]" aria-hidden="true"></i>
      <!-- Huy hiệu là chỉ báo trạng thái, không phải khung chờ, nên không có
           `animate-pulse` để phải miễn trừ. -->
      <span
        v-if="unreadCount > 0"
        class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-[#B04A4A] text-white text-[0.65rem] font-bold leading-none"
      >{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
    </button>

    <div
      v-if="isOpen"
      role="menu"
      class="absolute right-0 top-[calc(100%+8px)] z-[10004] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#E2E8DF] bg-white shadow-[0_12px_32px_rgba(15,35,18,0.14)]"
    >
      <div class="flex items-center justify-between gap-2 border-b border-[#EEF2EC] px-3.5 py-2.5">
        <span class="text-[0.82rem] font-extrabold uppercase tracking-wide text-[#385130]">Thông báo</span>
        <button
          v-if="unreadCount > 0"
          type="button"
          class="text-[0.75rem] font-semibold text-[#4A6741] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7CB342] rounded"
          @click="markAllRead"
        >Đánh dấu đã đọc</button>
      </div>

      <div class="max-h-[380px] overflow-y-auto">
        <div v-if="pending" role="status" aria-busy="true" class="p-3.5">
          <span class="sr-only">Đang tải thông báo</span>
          <div v-for="n in 3" :key="n" aria-hidden="true" class="mb-3 last:mb-0">
            <div class="h-3 w-28 animate-pulse rounded bg-[#EEF2EC] motion-reduce:animate-none"></div>
            <div class="mt-2 h-3.5 w-full animate-pulse rounded bg-[#F1F5F0] motion-reduce:animate-none"></div>
          </div>
        </div>

        <p v-else-if="failed" role="alert" class="m-0 px-3.5 py-6 text-center text-[0.85rem] text-[#B04A4A]">
          <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>
          Không thể tải thông báo.
          <button type="button" class="font-bold text-[#4A6741] underline" @click="load()">Thử lại</button>.
        </p>

        <p v-else-if="!notifications.length" class="m-0 px-3.5 py-8 text-center text-[0.85rem] text-[#7A8675]">
          Chưa có thông báo nào. Khi có người trả lời bình luận của bạn, thông báo sẽ hiện ở đây.
        </p>

        <ul v-else class="m-0 list-none p-0">
          <li v-for="item in notifications" :key="item.id" class="border-b border-[#F1F5F0] last:border-b-0">
            <component
              :is="item.target ? NuxtLink : 'div'"
              v-bind="item.target ? { to: item.target.url } : {}"
              class="flex w-full gap-2.5 px-3.5 py-3 no-underline transition-colors"
              :class="[
                item.target ? 'cursor-pointer hover:bg-[#F7FAF6]' : 'cursor-default',
                item.isRead ? '' : 'bg-[#F4F9F0]',
              ]"
              @click="onItemClick(item)"
            >
              <span
                class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                :class="item.isRead ? 'bg-transparent' : 'bg-[#7CB342]'"
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="block text-[0.83rem] leading-snug text-[#1E251C]">
                  <strong class="font-bold">{{ item.authorName }}</strong>
                  đã trả lời bình luận của bạn
                </span>
                <span class="mt-0.5 block line-clamp-2 break-words text-[0.8rem] leading-snug text-[#4A5545]">{{ item.excerpt }}</span>
                <span v-if="item.target" class="mt-1 block truncate text-[0.74rem] text-[#7A8675]">{{ item.target.articleTitle }}</span>
                <span v-else class="mt-1 block text-[0.74rem] italic text-[#7A8675]">Bài viết hiện không mở bình luận</span>
              </span>
            </component>
          </li>
        </ul>
      </div>

      <nuxt-link
        to="/profile"
        class="block border-t border-[#EEF2EC] px-3.5 py-2.5 text-center text-[0.8rem] font-bold text-[#4A6741] no-underline transition-colors hover:bg-[#F7FAF6]"
        @click="isOpen = false"
      >Xem tất cả trên trang cá nhân</nuxt-link>
    </div>
  </div>
</template>
