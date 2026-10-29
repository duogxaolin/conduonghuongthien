/**
 * `/profile` — the manual "Nhận các đoạn chat trên thiết bị này" button (split out of
 * app/pages/profile.vue in wave3 4.2). The page keeps the chat list and its loader and
 * hands them in; `claimChats`/`clearClaimFlag` are the page's `useReaderAuth` ones.
 *
 * It reports only what it knows (FINDING-R1). `claimChats()` never throws — right for the
 * silent claim on every page load — so the outcome it RETURNS decides: a claim that did
 * not reach the server is said to have failed (`claimError`, an alert), never "Đã gắn …";
 * and when the list cannot be reloaded, no sentence is made up from the list that was on
 * screen before — the list's own error branch speaks.
 *
 * Imports are relative (no `~/`): the page's behaviour suite loads this module natively.
 */
import { ref } from 'vue'
import type { ClaimOutcome } from './useReaderAuth'

export function useReaderChatClaim(options: {
  claimChats: () => Promise<ClaimOutcome>
  clearClaimFlag: () => void
  /** Reload the chat list (never throws: a failure lands in the page's error branch). */
  loadChats: () => Promise<void>
  /** Whether the last reload of the list failed. */
  chatsFailed: () => boolean
  /** How many chats the list on screen holds now. */
  chatCount: () => number
}) {
  const claiming = ref(false)
  const claimMessage = ref('')
  const claimError = ref('')

  async function claimNow() {
    claiming.value = true
    claimMessage.value = ''
    claimError.value = ''
    try {
      options.clearClaimFlag()
      const outcome = await options.claimChats()
      await options.loadChats()
      if (outcome === 'failed') {
        claimError.value = 'Không thể gắn các đoạn trò chuyện vào tài khoản. Vui lòng thử lại.'
        return
      }
      if (options.chatsFailed()) return
      // Con số lấy từ danh sách vừa nạp lại, không từ phản hồi của lượt nhận: đó là
      // thứ người đọc đang nhìn thấy ngay bên trên.
      claimMessage.value = options.chatCount()
        ? `Đã gắn ${options.chatCount()} đoạn trò chuyện vào tài khoản của bạn.`
        : 'Không tìm thấy đoạn trò chuyện nào trên thiết bị này.'
    } finally {
      claiming.value = false
    }
  }

  return { claiming, claimMessage, claimError, claimNow }
}
