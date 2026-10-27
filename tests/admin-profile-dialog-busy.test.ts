/**
 * `/admin/profile` dialogs: closing one also ends its "busy" state (wave3 verify S2).
 *
 * Each dialog session ignores a late answer once the dialog was closed or reopened
 * (`useProfileMfaFactors.ts`, `useProfileRecoveryCodes.ts`). `close*()` starts a new
 * session first, so the `finally` of the request that was in flight — or of the request
 * that just succeeded and closed the dialog itself — no longer resets `busy`: a closed
 * dialog stayed "busy" until the next `open*()` reset it. Harmless today — the page's
 * Escape handler checks `open` first and the dialogs are `v-if`'d away — but a state that
 * says "busy" for a dialog nobody can see is a trap for the next reader of `busy`.
 * RED before `close*()` reset it (4/4 failed on the state of 7946592).
 *
 * Driven straight through the composables with a fake `$fetch` (what `adminFetch` calls);
 * the page-level behaviour is tests/admin-profile-page.test.ts.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { useMfaDisableDialog, useMfaEnrollDialog } from '../app/composables/useProfileMfaFactors.ts'
import { useProfileRecoveryCodes } from '../app/composables/useProfileRecoveryCodes.ts'

type Pending = { url: string, resolve: (value: unknown) => void }
const g = globalThis as unknown as { $fetch?: unknown }
const original = g.$fetch
let pending: Pending[] = []

/** Every request waits until the test answers it. */
function holdRequests() {
  pending = []
  g.$fetch = (url: string) => new Promise(resolve => { pending.push({ url, resolve }) })
}

afterEach(() => { g.$fetch = original })

const flush = () => new Promise(resolve => setImmediate(resolve))
const toast = { success: () => {}, info: () => {}, error: () => {} }
const focusField = () => {}

describe('profile dialogs — closing ends busy', () => {
  it('enroll: closing while the request is in flight leaves the dialog not busy, also after the answer lands', async () => {
    holdRequests()
    const { enrollDialog, openEnroll, closeEnroll, submitEnroll } = useMfaEnrollDialog({
      toast, focusField, codes: { ticket: () => 1, reveal: () => {} }, afterEnabled: async () => {},
    })
    openEnroll('totp')
    enrollDialog.currentPassword = 'x'
    const sent = submitEnroll()
    assert.equal(enrollDialog.busy, true)
    closeEnroll()
    assert.equal(enrollDialog.busy, false, 'a closed dialog is not busy')
    pending[0]!.resolve({ ok: true, secret: 'S', otpauthUri: 'otpauth://x' })
    await sent
    await flush()
    assert.equal(enrollDialog.busy, false)
    assert.equal(enrollDialog.totpSecret, '', 'the late answer wrote nothing into the closed dialog')
  })

  it('enroll: a confirm that succeeds closes the dialog and leaves it not busy', async () => {
    holdRequests()
    const { enrollDialog, openEnroll, submitConfirm } = useMfaEnrollDialog({
      toast, focusField, codes: { ticket: () => 1, reveal: () => {} }, afterEnabled: async () => {},
    })
    openEnroll('totp')
    Object.assign(enrollDialog, { stage: 'confirm', code: '123456' })
    const sent = submitConfirm()
    pending[0]!.resolve({ ok: true, message: 'Đã bật.' })
    await sent
    assert.equal(enrollDialog.open, false)
    assert.equal(enrollDialog.busy, false, 'closed by its own success, and not busy')
  })

  it('disable: a request that succeeds closes the dialog and leaves it not busy', async () => {
    holdRequests()
    const { disableDialog, openDisable, submitDisable } = useMfaDisableDialog({ toast, focusField, afterDisabled: async () => {} })
    openDisable('totp')
    disableDialog.currentPassword = 'x'
    const sent = submitDisable()
    assert.equal(disableDialog.busy, true)
    pending[0]!.resolve({ ok: true, message: 'Đã tắt.' })
    await sent
    assert.equal(disableDialog.open, false)
    assert.equal(disableDialog.busy, false)
  })

  it('recovery codes: closing while busy, and a success that closes, both leave the dialog not busy', async () => {
    holdRequests()
    const { recoveryDialog, openRecovery, closeRecovery, submitRecovery } = useProfileRecoveryCodes({
      toast, focusField, username: () => 'admin', afterChange: async () => {},
    })
    openRecovery('create')
    recoveryDialog.currentPassword = 'x'
    const first = submitRecovery()
    assert.equal(recoveryDialog.busy, true)
    closeRecovery()
    assert.equal(recoveryDialog.busy, false, 'a closed dialog is not busy')
    pending[0]!.resolve({ ok: true, codes: ['a'] })
    await first
    assert.equal(recoveryDialog.busy, false)

    openRecovery('delete')
    recoveryDialog.currentPassword = 'x'
    const second = submitRecovery()
    pending[1]!.resolve({ ok: true, message: 'Đã tắt mã dự phòng.' })
    await second
    assert.equal(recoveryDialog.open, false)
    assert.equal(recoveryDialog.busy, false)
  })
})
