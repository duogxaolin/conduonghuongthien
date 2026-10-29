/**
 * `/profile` — the manual "Nhận các đoạn chat trên thiết bị này" button (split out of
 * app/pages/profile.vue in wave3 4.2). The page keeps the chat list and its loader and
 * hands them in; `claimChats`/`clearClaimFlag` are the page's `useReaderAuth` ones.
 *
 * Imports are relative (no `~/`): the page's behaviour suite loads this module natively.
 */
import { ref } from 'vue'

export function useReaderChatClaim(options: {
  claimChats: () => Promise<unknown>
  clearClaimFlag: () => void
  /** Reload the chat list (never throws: a failure lands in the page's error branch). */
  loadChats: () => Promise<void>
  /** How many chats the list on screen holds now. */
  chatCount: () => number
}) {
  const claiming = ref(false)
  const claimMessage = ref('')

  async function claimNow() {
    claiming.value = true
    claimMessage.value = ''
    try {
      options.clearClaimFlag()
      await options.claimChats()
      await options.loadChats()
      // Con số lấy từ danh sách vừa nạp lại, không từ phản hồi của lượt nhận: đó là
      // thứ người đọc đang nhìn thấy ngay bên trên.
      claimMessage.value = options.chatCount()
        ? `Đã gắn ${options.chatCount()} đoạn trò chuyện vào tài khoản của bạn.`
        : 'Không tìm thấy đoạn trò chuyện nào trên thiết bị này.'
    } finally {
      claiming.value = false
    }
  }

  return { claiming, claimMessage, claimNow }
}
