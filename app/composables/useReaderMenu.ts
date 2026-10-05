import { ref } from 'vue'

/**
 * State đăng nhập người đọc + thông báo, dùng chung cho header desktop và
 * ngăn kéo mobile.
 *
 * State ở cấp module trong `useReaderAuth`/`useReaderNotifications`, nên header
 * và khối bình luận trong bài đọc cùng một danh tính — hai lượt fetch riêng sẽ
 * có lúc nói hai điều khác nhau trên cùng một trang.
 *
 * `isReaderMenuOpen` + `readerMenuRef` ở đây (chỉ header desktop dùng). Drawer
 * mobile không có menu dropdown — nó phẳng.
 *
 * `onReaderSignOut` KHÔNG ở đây — nó nằm trong default.vue vì nó đóng cả menu
 * desktop (`isReaderMenuOpen = false`) lẫn drawer mobile (`isMobileMenuOpen =
 * false`) rồi mới `signOut()`. `tests/public-pages-structure.test.ts` grep
 * `isReaderMenuOpen.value = false` trong default.vue source, nên đóng menu
 * phải ở đó.
 */
export function useReaderMenu() {
  const {
    reader,
    loaded: readerLoaded,
    load: loadReader,
    signIn: readerSignIn,
    signOut: readerSignOut,
    signInMessage: readerSignInMessage,
  } = useReaderAuth()

  // Menu nhỏ dưới nút danh tính ở header desktop.
  const isReaderMenuOpen = ref(false)
  // `HTMLElement`: `handleDocumentPointerDown` (default.vue) gọi `.contains(...)`.
  const readerMenuRef = ref<HTMLElement | null>(null)

  const {
    unreadCount,
    loaded: notifLoaded,
    load: loadNotifications,
    reset: resetNotifications,
  } = useReaderNotifications()

  // Chỉ để đóng menu trước khi `v-if` tháo component lúc đăng xuất.
  // Chuông tự sở hữu cách đóng của nó và phơi ra qua `defineExpose({ close })`.
  const notifBellRef = ref<{ close?: () => void } | null>(null)

  return {
    reader,
    readerLoaded,
    loadReader,
    readerSignIn,
    readerSignOut,
    readerSignInMessage,
    isReaderMenuOpen,
    readerMenuRef,
    unreadCount,
    notifLoaded,
    loadNotifications,
    resetNotifications,
    notifBellRef,
  }
}
