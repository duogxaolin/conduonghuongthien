/**
 * What an officer SEES of a manual retention run's audit trail (FINDING-R3-2 follow-up).
 *
 * `POST /api/admin/settings/retention-run` writes two `activity_logs` rows for a manual run: a
 * `phase: 'started'` row under the lock before the first DELETE (fail-closed — no row, no
 * purge), and a `phase: 'finished'` row with what each table lost. The second is best-effort
 * — the rows are already gone — so its failure answers 200 with `auditFailed: true`.
 *
 *   - `/admin/settings/data-retention` ignored `auditFailed`: the officer saw only the success
 *     toast for a run whose result is missing from the activity log. It now says so on the
 *     page — a `role="alert"` block outside the toast, kept through the reload that follows
 *     the run, cleared when the next run starts.
 *   - `/admin/users/activity` printed both rows as the same "Xoá · Tự động dọn dữ liệu". The
 *     label now carries the phase (bắt đầu / kết thúc) when the row has one; a row without
 *     one — every other row, and old rows whose meta is a JSON string — reads as before.
 *
 * The REAL pages (`<script setup>` and template) over real ofetch on a fake network
 * (`tests/_admin-page-harness.ts`). The server side of the phase is pinned in
 * `admin-activity-logs-phase-behavior`.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { textOf } from './_sfc-mount.ts'
import { alerts, buttons, json, mountAdminPage, routes, screenText, settle, unmountAll, type NetCall } from './_admin-page-harness.ts'

afterEach(unmountAll)

const AUDIT_WARNING = 'Đã dọn xong nhưng chưa ghi được nhật ký kết quả'

// ─── pages/admin/settings/data-retention.vue ─────────────────────────────────

const SCOPE = {
  scope: 'activity_logs', days: 365, daysSource: 'database', maxRows: 0, maxRowsSource: 'default',
  total: 1200, oldest: '2025-01-01T00:00:00.000Z', overdue: 5, overRowCap: 0, purgedTotal: 40, lifetimeTotal: 1240,
  lastRunAt: null, lastDeleted: 0, lastTrigger: null, lastStatus: null, lastMessage: null,
}

function retentionServer(runAnswers: Array<Record<string, unknown>>) {
  const answers = [...runAnswers]
  return routes({
    'GET /api/admin/settings/retention': () => json({
      ok: true, scopes: [SCOPE], command: 'npm run analytics:maintenance',
      autoEnabled: true, runHour: 3, autoEnabledSource: 'default', runHourSource: 'default',
    }),
    'POST /api/admin/settings/retention-run': () => json(answers.shift()),
  })
}

const run = (auditFailed: boolean) => ({ ok: true, status: 'success', tables: [{ table: 'activity_logs', deleted: 5 }], message: null, auditFailed })
/**
 * The TEXT of each `role="alert"` block carrying the warning. Strings, not the elements: an
 * element links to its parent, and a failed `deepEqual` on one renders the whole tree.
 */
const auditAlerts = (page: Parameters<typeof alerts>[0]) => alerts(page).map(textOf).filter(text => text.includes(AUDIT_WARNING))

async function runNow(opened: Awaited<ReturnType<typeof mountAdminPage>>) {
  const [button] = buttons(opened.page, 'Dọn ngay')
  assert.ok(button, 'the "Dọn ngay" button')
  await (button!.props.onClick as () => Promise<void>)()
  await settle()
}

describe('data-retention: a run whose result row was not written says so on the page', () => {
  it('auditFailed → the success toast AND a role="alert" block that survives the reload', async () => {
    const opened = await mountAdminPage('pages/admin/settings/data-retention.vue', retentionServer([run(true)]))
    assert.deepEqual(auditAlerts(opened.page), [], 'nothing to warn about before a run')
    await runNow(opened)
    assert.equal(opened.lastToast('success'), 'Đã xoá 5 bản ghi.', 'the purge did run — the toast still says what it deleted')
    const warning = auditAlerts(opened.page)
    assert.equal(warning.length, 1, `the page does not say the result row is missing: ${screenText(opened.page).slice(0, 300)}`)
    assert.ok(!opened.toasts.some(t => t.message.includes(AUDIT_WARNING)), 'the warning is not (only) a toast that fades')
    assert.deepEqual(opened.calls.map(call => `${call.method} ${call.url.pathname}`), [
      'GET /api/admin/settings/retention',
      'POST /api/admin/settings/retention-run',
      'GET /api/admin/settings/retention',
    ], 'the run reloads the page data — the warning is still there after it')
  })

  it('auditFailed false (or absent) → no warning; a clean run clears an earlier one', async () => {
    const opened = await mountAdminPage('pages/admin/settings/data-retention.vue', retentionServer([run(true), run(false), { ok: true, status: 'success', tables: [] }]))
    await runNow(opened)
    assert.equal(auditAlerts(opened.page).length, 1)
    await runNow(opened)
    assert.deepEqual(auditAlerts(opened.page), [], 'a later run with its result row on record still shows the old warning')
    await runNow(opened)
    assert.deepEqual(auditAlerts(opened.page), [], 'an answer without the field is not a failure')
  })
})

// ─── pages/admin/users/activity.vue ──────────────────────────────────────────

const LOG_ITEMS = [
  { id: 4, userId: 1, username: 'admin', action: 'delete', resource: 'data_retention', resourceId: null, createdAt: '2026-10-28T03:00:05.000Z', ip: null, userAgent: null, mfaMethod: null, phase: 'finished' },
  { id: 3, userId: 1, username: 'admin', action: 'delete', resource: 'data_retention', resourceId: null, createdAt: '2026-10-28T03:00:00.000Z', ip: null, userAgent: null, mfaMethod: null, phase: 'started' },
  // A row written before the phase existed (no `phase` in its meta, or a string meta): null.
  { id: 2, userId: 1, username: 'admin', action: 'delete', resource: 'data_retention', resourceId: null, createdAt: '2026-10-01T03:00:00.000Z', ip: null, userAgent: null, mfaMethod: null, phase: null },
  // A phase this page has no label for is not printed raw.
  { id: 1, userId: 1, username: 'admin', action: 'login', resource: 'auth', resourceId: null, createdAt: '2026-09-01T03:00:00.000Z', ip: '10.0.0.1', userAgent: null, mfaMethod: null, phase: 'comments' },
]

function activityServer() {
  return routes({
    'GET /api/admin/activity-logs': () => json({ ok: true, page: 1, pageSize: 25, total: LOG_ITEMS.length, totalPages: 1, items: LOG_ITEMS }),
    'GET /api/admin/users': () => json({ ok: true, users: [{ id: 1, username: 'admin' }] }),
    'GET /api/admin/activity-logs/retention': (_call: NetCall) => json({ statusCode: 404, statusMessage: 'Not Found' }, 404),
  })
}

describe('activity: the two rows of a manual retention run are told apart', () => {
  it('a row with meta.phase shows it (bắt đầu / kết thúc); a row without one, or with an unknown one, reads as before', async () => {
    const opened = await mountAdminPage('pages/admin/users/activity.vue', activityServer())
    const text = screenText(opened.page)
    const count = (needle: string) => text.split(needle).length - 1
    // The list renders twice (cards on a phone, a table on a wide screen).
    assert.equal(count('Xoá · Tự động dọn dữ liệu (bắt đầu)'), 2, text.slice(0, 600))
    assert.equal(count('Xoá · Tự động dọn dữ liệu (kết thúc)'), 2)
    assert.equal(count('Xoá · Tự động dọn dữ liệu'), 6, 'the row with no phase keeps the plain label')
    assert.equal(count('Đăng nhập · Xác thực'), 2)
    assert.ok(!text.includes('comments)') && !text.includes('(comments'), 'an unknown phase value is never printed raw')
  })
})
