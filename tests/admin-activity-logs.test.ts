/**
 * The system-wide activity log is the one page that reads every administrator's
 * trail, so the properties worth pinning down are the ones that make it an audit
 * tool rather than a surveillance tool:
 *
 *   GATED. `/admin/profile/history` intentionally carries no RBAC check — it
 *   answers "what did I do", identified from the session. This route answers
 *   "what did everyone do", which is a different capability, so it must require
 *   an explicit grant. Losing that check would let any authenticated operator
 *   read every colleague's IP and login times.
 *
 *   RECORDED. The read writes its own audit row. A trail that can be swept
 *   silently tells you nothing about who looked.
 *
 *   READ-ONLY RETENTION. The retention endpoint reports; it never purges. A
 *   purge reachable from a GET would delete audit rows on a stray refresh.
 *
 * GATED and RECORDED are run for real in tests/admin-activity-logs-access-behavior.test.ts.
 * What remains here are source-contract assertions (the page, the menu entry, the retention
 * endpoint's read-only shape): they prove a guard is present, not that it runs.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { ADMIN_LAYOUT_FAMILY, familySource, readAppFile } from './_component-family.ts'

const listSource = await readFile(new URL('../server/api/admin/activity-logs/index.get.ts', import.meta.url), 'utf8')
// The list's query and the retention aggregate moved into services (2026-11-08); what they assert
// follows the code: the WHERE of the list, and "no destructive statement" over handler + service.
const listQuerySource = await readFile(new URL('../server/services/admin-activity-logs-queries.ts', import.meta.url), 'utf8')
const retentionSource = await readFile(new URL('../server/api/admin/activity-logs/retention.get.ts', import.meta.url), 'utf8')
  + await readFile(new URL('../server/services/admin-activity-logs-retention.ts', import.meta.url), 'utf8')
const pageSource = await readFile(new URL('../app/pages/admin/users/activity.vue', import.meta.url), 'utf8')
// The admin layout was split (wave3 D-SPLIT): its menu lives in `useAdminLayoutMenu`, so the
// menu guard reads the layout's whole family (tests/_component-family.ts).
const layoutSource = familySource(ADMIN_LAYOUT_FAMILY)

/** Comments explain what the code must NOT do, so they are stripped before
 *  asserting absence — otherwise the prose trips its own assertion. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// The gate (users.read), "the read is itself recorded", validated filters and paging bounds,
// rows surviving a deleted account and the stable ordering are run for real in
// tests/admin-activity-logs-access-behavior.test.ts. The checks below are structure.

test('only allowlisted meta keys are surfaced from free-form JSON', () => {
  assert.match(listSource, /function readMeta/)
  for (const key of ["'ip'", "'userAgent'", "'mfaMethod'", "'phase'"]) {
    assert.match(listSource, new RegExp(`readMeta\\(row\\.meta, ${key}\\)`))
  }
  // The raw meta column must not be handed to the client wholesale.
  assert.doesNotMatch(listSource, /meta: row\.meta/)
})

test('retention endpoint is read-only and reports a missing purge', () => {
  // Its users.read gate is run for real in tests/admin-activity-logs-access-behavior.test.ts.
  // Reporting only: no destructive statement may be reachable from a GET.
  assert.doesNotMatch(codeOnly(retentionSource), /\.delete\(|runDataRetention|DELETE FROM/)
  assert.match(retentionSource, /purgeOverdue/)
  assert.match(retentionSource, /purgeDisabled/)
  // The effective policy, not the raw environment: a value edited in the admin
  // form has to be the one this page reports, or the page contradicts itself.
  assert.match(retentionSource, /resolveRetentionPolicy/)
  // 0 days means the age condition is off, so nothing can be counted as overdue.
  assert.match(retentionSource, /retentionDays > 0/)
  // The banked counter is what makes a completed purge visible after its rows
  // are gone. Lifetime volume is that counter plus what is still live.
  assert.match(retentionSource, /purgedTotal/)
  assert.match(retentionSource, /lifetimeTotal: total \+ purgedTotal/)
  assert.match(retentionSource, /command: 'npm run analytics:maintenance'/)
})

test('the page renders the log, its filters, and the retention warning', () => {
  const descriptor = parse(pageSource, { filename: 'activity.vue' })
  assert.equal(descriptor.errors.length, 0)
  const template = descriptor.descriptor.template?.content ?? ''
  const script = descriptor.descriptor.scriptSetup?.content ?? ''

  // `$fetch` ép kiểu hàm (`($fetch as ...)('...')`) thay vì generic để tránh
  // TS2589 "Type instantiation is excessively deep". URL vẫn ở nháy đơn.
  assert.match(script, /\/api\/admin\/activity-logs\/retention'/)
  /**
   * KHÔNG `$fetch<any>` ở đâu trong trang này.
   *
   * Lượt fetch trên để Nitro tự suy kiểu từ handler, và `retention` khai
   * `ActivityRetentionStatus` (cũng suy từ handler). `any` ở một trong hai chỗ
   * là mất đúng phần có giá trị: trang này đọc `retention.purgeOverdue`,
   * `retention.command`, `retention.lifetimeTotal` — một tên gõ sai hoặc một
   * trường endpoint ngừng trả về sẽ hiện ra là một ô trống trên trang cảnh báo
   * lưu trữ, tức là báo "không có gì quá hạn" cho một bảng đang quá hạn.
   *
   * `$fetch<any>` nay đổi sang `($fetch as (u, o?) => Promise<Type>)` — cùng ý
   * "không `any`", chỉ khác cú pháp. Pattern dưới bắt cả hai dạng.
   */
  assert.doesNotMatch(script, /\$fetch<any>/)
  assert.match(script, /ref<ActivityRetentionStatus \| null>/)
  // Endpoint list — URL có thể ở nháy đơn `'...'` hoặc backtick `...`.
  assert.match(script, /\/api\/admin\/activity-logs[`']/)
  for (const filter of ['filterUserId', 'filterAction', 'filterResource', 'filterFrom', 'filterTo']) {
    assert.match(script, new RegExp(`${filter}`))
  }
  // A bare end date must cover the whole day, not stop at midnight. The page sends
  // the bare `YYYY-MM-DD` (no zone-less time that the server would read in its own
  // TZ); the handler makes the end day inclusive as a Vietnam day — behaviour pinned
  // by tests/admin-date-filters-vn-day.test.ts under several TZs.
  assert.match(script, /\{ to: filterTo\.value \}/)
  assert.doesNotMatch(script, /T23:59:59|T00:00:00/)
  assert.match(listQuerySource, /lt\(activityLogs\.createdAt, toExclusive\)/)
  assert.match(template, /v-for="item in items"/)
  assert.match(template, /retention\.purgeOverdue/)
  assert.match(template, /analytics:maintenance|retention\.command/)
  // Log content is operator- and visitor-supplied; interpolation only.
  assert.doesNotMatch(template, /v-html/)
  // Loading, empty, and error states are all explicit.
  for (const state of [/v-if="loading"/, /v-else-if="!items\.length"/, /role="alert"/]) {
    assert.match(template, state)
  }
})

const ACTIVITY_MENU_GATE = /hasPermission\('users', 'read'\).*\/admin\/users\/activity/s

test('the menu entry is hidden without the grant that the endpoint requires', () => {
  assert.match(layoutSource, ACTIVITY_MENU_GATE)
})

test('proof: the guard reads the split layout — the grant dropped from the menu composable is caught', () => {
  const menu = 'composables/useAdminLayoutMenu.ts'
  const ungated = readAppFile(menu).replace("...(hasPermission('users', 'read') ? [{ label: 'Lịch sử hoạt động'", "...(true ? [{ label: 'Lịch sử hoạt động'")
  assert.notEqual(ungated, readAppFile(menu), 'the planted change must apply')
  assert.doesNotMatch(familySource(ADMIN_LAYOUT_FAMILY, { [menu]: ungated }), ACTIVITY_MENU_GATE)
})
