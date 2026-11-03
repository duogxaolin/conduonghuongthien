import { reactive, ref } from 'vue'

// Relative paths, not `~/`: the page's tests load this file through Node, and the test
// loader (scripts/ts-resolver.mjs) only knows `~~/`.
import { adminFetch } from './adminFetch'
import { errorMessage } from '../utils/errorMessage'
import type { useToast } from './useToast'
import type { PasswordChangeResponse } from '../types/admin-profile'

/**
 * "Đổi mật khẩu" on `/admin/profile`: the form's three fields, its saving flag and its
 * error line. Moved out of the page verbatim when it was split (wave3 4.1); the markup is
 * `ProfilePasswordSection.vue`. `toast` is the page's own, handed in, so this file needs no
 * Nuxt auto-import (tests/admin-profile-page.test.ts drives it through the page's form).
 *
 * The policy sentence comes from the server (`password.put.ts` →
 * `passwordRejectionMessage`), so the rules live in one place; the two checks here only
 * spare a request that cannot succeed.
 */
export function useProfilePassword(toast: Pick<ReturnType<typeof useToast>, 'success'>) {
  const pw = reactive({ current: '', next: '', confirm: '' })
  const pwSaving = ref(false)
  const pwError = ref('')

  async function changePassword() {
    pwError.value = ''
    if (!pw.current || !pw.next) {
      pwError.value = 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.'
      return
    }
    if (pw.next !== pw.confirm) {
      pwError.value = 'Mật khẩu mới và ô nhập lại không khớp.'
      return
    }
    pwSaving.value = true
    try {
      const res = await adminFetch<PasswordChangeResponse>('/api/admin/profile/password', {
        method: 'PUT',
        body: { currentPassword: pw.current, newPassword: pw.next },
      })
      toast.success(res.message || 'Đã đổi mật khẩu.')
      pw.current = ''; pw.next = ''; pw.confirm = ''
    } catch (err: unknown) {
      pwError.value = errorMessage(err, 'Không đổi được mật khẩu.')
    } finally {
      pwSaving.value = false
    }
  }

  return { pw, pwSaving, pwError, changePassword }
}
