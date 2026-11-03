import { reactive, ref } from 'vue'

// Relative paths, not `~/`: the page's tests load this file through Node, and the test
// loader (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { useToast } from './useToast'
import type { RecoveryCodesCreateResponse, RecoveryCodesDeleteResponse } from '../types/admin-profile'

/**
 * Recovery codes on `/admin/profile`: the password dialog that creates (or re-creates) or
 * turns them off, and the batch shown ONCE — copy, download, hide. Moved out of the page
 * when it was split (wave3 4.1); the markup is `ProfileRecoveryCodesCard.vue` and
 * `ProfileRecoveryDialog.vue`. The page hands in its toast, its focus helper, the account
 * name (for the downloaded file) and the status re-read.
 *
 * The codes are stored as bcrypt hashes: what is on screen is the only readable copy.
 * Hence two rules, new in the split (each pinned by a test that was red before it):
 *   - every answer that changes the batch on screen holds a TICKET taken when its request
 *     was sent, and an answer older than the batch already shown changes nothing — two
 *     "Tạo mã" in flight (the first cancelled with "Huỷ") used to leave the batch the
 *     server had just discarded on screen when the answers crossed;
 *   - one request at a time (Enter in the field used to send a second one), and an
 *     answer that lands after its dialog was closed or reopened writes nothing into the
 *     dialog — the codes, the toast and the re-read still happen.
 */
export interface RecoveryCodesDeps {
  toast: Pick<ReturnType<typeof useToast>, 'success' | 'error'>
  focusField: (id: string) => void
  /** The signed-in account's name, for the downloaded file. */
  username: () => string | undefined
  /** After the codes changed: the page re-reads the status (count, lockout warning). */
  afterChange: () => Promise<unknown>
}

export function useProfileRecoveryCodes({ toast, focusField, username, afterChange }: RecoveryCodesDeps) {
  const recoveryDialog = reactive({
    open: false,
    mode: 'create' as 'create' | 'delete',
    currentPassword: '',
    busy: false,
    error: '',
  })
  // Chỉ tồn tại trong bộ nhớ trang, đúng một lần, ngay sau khi sinh.
  const revealedCodes = ref<string[]>([])
  let session = 0
  let ticketsIssued = 0
  let ticketShown = 0

  /** Taken when a request that may change the batch is sent (create, turn off, a first factor's confirm). */
  function codesTicket() {
    ticketsIssued += 1
    return ticketsIssued
  }

  /** Show `codes` (`[]` = none) unless a batch from a later request is already on screen. */
  function revealCodes(ticket: number, codes: string[]) {
    if (ticket < ticketShown) return
    ticketShown = ticket
    revealedCodes.value = codes
  }

  function hideCodes() {
    revealedCodes.value = []
  }

  function openRecovery(mode: 'create' | 'delete') {
    session += 1
    Object.assign(recoveryDialog, { open: true, mode, currentPassword: '', busy: false, error: '' })
    focusField('recovery-pw')
  }

  function closeRecovery() {
    session += 1
    recoveryDialog.open = false
    // The request in flight (or the one whose success is closing the dialog) belongs to
    // the session just ended, so its `finally` no longer resets this: a closed dialog is
    // never left busy.
    recoveryDialog.busy = false
    recoveryDialog.currentPassword = ''
  }

  async function submitRecovery() {
    if (recoveryDialog.busy) return
    recoveryDialog.error = ''
    if (!recoveryDialog.currentPassword) {
      recoveryDialog.error = 'Vui lòng nhập mật khẩu hiện tại.'
      return
    }
    const mine = session
    const ticket = codesTicket()
    recoveryDialog.busy = true
    try {
      if (recoveryDialog.mode === 'create') {
        const res = await adminFetch<RecoveryCodesCreateResponse>('/api/admin/profile/mfa/recovery-codes', {
          method: 'POST',
          body: { currentPassword: recoveryDialog.currentPassword },
        })
        revealCodes(ticket, res.codes ?? [])
        toast.success('Đã tạo mã dự phòng mới. Lưu lại ngay — sẽ không hiện lại.')
      } else {
        const res = await adminFetch<RecoveryCodesDeleteResponse>('/api/admin/profile/mfa/recovery-codes', {
          method: 'DELETE',
          body: { currentPassword: recoveryDialog.currentPassword },
        })
        revealCodes(ticket, [])
        toast.success(res.message || 'Đã tắt mã dự phòng.')
      }
      if (mine === session) closeRecovery()
      await afterChange()
    } catch (err: unknown) {
      if (mine === session) recoveryDialog.error = errorMessage(err, 'Không thực hiện được.')
    } finally {
      if (mine === session) recoveryDialog.busy = false
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(revealedCodes.value.join('\n'))
      toast.success('Đã copy toàn bộ mã dự phòng.')
    } catch {
      toast.error('Trình duyệt không cho copy. Vui lòng chọn và copy thủ công.')
    }
  }

  function downloadCodes() {
    const body = [
      'Mã dự phòng — Con Đường Hướng Thiện (Admin)',
      `Tài khoản: ${username() ?? ''}`,
      `Tạo lúc: ${new Date().toLocaleString('vi-VN')}`,
      'Mỗi mã chỉ dùng được MỘT lần. Giữ tệp này ở nơi an toàn.',
      '',
      ...revealedCodes.value,
    ].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ma-du-phong-${username() ?? 'admin'}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    recoveryDialog, revealedCodes, codesTicket, revealCodes, hideCodes,
    openRecovery, closeRecovery, submitRecovery, copyCodes, downloadCodes,
  }
}
