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
 * These are source-contract assertions, not behavioural ones: they prove the
 * guard is present and cannot be dropped unnoticed, which is what the project's
 * other endpoint tests establish too.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const listSource = await readFile(new URL('../server/api/admin/activity-logs/index.get.ts', import.meta.url), 'utf8')
const retentionSource = await readFile(new URL('../server/api/admin/activity-logs/retention.get.ts', import.meta.url), 'utf8')
const pageSource = await readFile(new URL('../app/pages/admin/users/activity.vue', import.meta.url), 'utf8')
const layoutSource = await readFile(new URL('../app/layouts/admin.vue', import.meta.url), 'utf8')

/** Comments explain what the code must NOT do, so they are stripped before
 *  asserting absence — otherwise the prose trips its own assertion. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('cross-account log listing requires an explicit users.read grant', () => {
  assert.match(listSource, /requireResourcePermission\(admin, 'users', 'read'\)/)
  // Session presence alone must not be the gate.
  assert.match(listSource, /if \(!admin\) throw createError\(\{ statusCode: 401/)
})

test('reading every account\'s trail is itself written to the trail', () => {
  assert.match(listSource, /db\.insert\(activityLogs\)\.values\(\{/)
  assert.match(listSource, /resource: 'activity_logs'/)
  assert.match(listSource, /action: 'read'/)
  // The auditor is the caller, never the account being inspected.
  assert.match(listSource, /userId: admin\.id/)
})

test('listing filters are validated instead of coerced, and paging is bounded', () => {
  for (const marker of [/userId không hợp lệ/, /page phải là số nguyên/, /pageSize phải là số nguyên/]) {
    assert.match(listSource, marker)
  }
  assert.match(listSource, /MAX_PAGE_SIZE = 100/)
  assert.match(listSource, /pageSize > MAX_PAGE_SIZE/)
  // A reversed range is refused rather than silently swapped.
  assert.match(listSource, /from phải trước to/)
  // Free-text filters are length-capped before reaching the query.
  assert.match(listSource, /parseFilter\(query\.action, 'action', 32\)/)
  assert.match(listSource, /parseFilter\(query\.resource, 'resource', 64\)/)
})

test('log rows survive the account being deleted', () => {
  // An inner join would erase the trail of a removed account, which is exactly
  // the trail an audit needs to keep.
  assert.match(listSource, /leftJoin\(users, eq\(activityLogs\.userId, users\.id\)\)/)
  assert.doesNotMatch(codeOnly(listSource), /\.innerJoin\(/)
})

test('pagination is deterministic when rows share a timestamp', () => {
  assert.match(listSource, /orderBy\(desc\(activityLogs\.createdAt\), desc\(activityLogs\.id\)\)/)
})

test('only allowlisted meta keys are surfaced from free-form JSON', () => {
  assert.match(listSource, /function readMeta/)
  for (const key of ["'ip'", "'userAgent'", "'mfaMethod'"]) {
    assert.match(listSource, new RegExp(`readMeta\\(row\\.meta, ${key}\\)`))
  }
  // The raw meta column must not be handed to the client wholesale.
  assert.doesNotMatch(listSource, /meta: row\.meta/)
})

test('retention endpoint is gated, read-only, and reports a missing purge', () => {
  assert.match(retentionSource, /requireResourcePermission\(admin, 'users', 'read'\)/)
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

  assert.match(script, /\$fetch\('\/api\/admin\/activity-logs\/retention'\)/)
  /**
   * KHÔNG `$fetch<any>` ở đâu trong trang này.
   *
   * Lượt fetch trên để Nitro tự suy kiểu từ handler, và `retention` khai
   * `ActivityRetentionStatus` (cũng suy từ handler). `any` ở một trong hai chỗ
   * là mất đúng phần có giá trị: trang này đọc `retention.purgeOverdue`,
   * `retention.command`, `retention.lifetimeTotal` — một tên gõ sai hoặc một
   * trường endpoint ngừng trả về sẽ hiện ra là một ô trống trên trang cảnh báo
   * lưu trữ, tức là báo "không có gì quá hạn" cho một bảng đang quá hạn.
   */
  assert.doesNotMatch(script, /\$fetch<any>/)
  assert.match(script, /ref<ActivityRetentionStatus \| null>/)
  assert.match(script, /'\/api\/admin\/activity-logs'/)
  for (const filter of ['filterUserId', 'filterAction', 'filterResource', 'filterFrom', 'filterTo']) {
    assert.match(script, new RegExp(`${filter}`))
  }
  // A bare end date must cover the whole day, not stop at midnight.
  assert.match(script, /T23:59:59/)
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

test('the menu entry is hidden without the grant that the endpoint requires', () => {
  assert.match(layoutSource, /hasPermission\('users', 'read'\).*\/admin\/users\/activity/s)
})
