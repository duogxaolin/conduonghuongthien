/**
 * "Sửa hạn mức" on the AI dashboard (§ 68) — the interface to `PUT /api/admin/ai/budget`
 * (server/api/admin/ai/budget/index.put.ts; the route's own invariants are pinned by
 * tests/ai-budget-update-behavior.test.ts, what the cap does by tests/ai-budget*.test.ts).
 *
 * Two layers, each driven for real:
 *   - `app/utils/ai-budget-form.ts` — parsing, the blocking check, the request — called directly;
 *   - `components/admin/ai/AiDashboardTab.vue` mounted WITH the real `AiBudgetEditor.vue` it
 *     imports (tests/_admin-page-harness.ts: real ofetch on a fake network, real `adminFetch`),
 *     so the save → reload round trip is the dashboard's own.
 *
 * The handler IGNORES a value it cannot use and still answers 200 "Không có thay đổi.", so the
 * client is the only place a typo is refused. Mutations each test is meant to catch: a string,
 * an empty field, a negative, a fraction, a grouped number or an out-of-range threshold reaching
 * the network; the body sent as strings; a clamp instead of a refusal; a blocking cap saved
 * without the confirmation, or "Hủy" still saving; "Không có thay đổi." toasted as saved; a failed
 * save not showing the server's sentence; no reload after a save; the editor shown without
 * `ai.update`; a request on mount.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  blockingBudgetConfirm, budgetBlocksAiNow, checkBudgetForm, MAX_BUDGET_VND, parseBudgetVnd, parseThresholdPct, saveAiBudget,
  type SaveBudgetDeps,
} from '../app/utils/ai-budget-form.ts'
import { formatVnd } from '../app/utils/ai-service-labels.ts'
import { click, findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

// ─── Parsing: stricter than the server, never looser ────────────────────────

describe('parseBudgetVnd — whole đồng, digits only', () => {
  it('accepts 0 (no cap set here), plain digits, spaces around, leading zeros, up to the server\'s cap', () => {
    for (const [raw, value] of [['0', 0], ['2000000', 2_000_000], ['  5000 ', 5000], ['007', 7], [String(MAX_BUDGET_VND), MAX_BUDGET_VND]] as const) {
      assert.deepEqual(parseBudgetVnd(raw), { ok: true, value }, raw)
    }
  })

  it('refuses what the server would ignore, clamp or round — never coerces', () => {
    for (const raw of ['', '   ', null, undefined, 'abc', '-1', '1.5', '1,5', '2.000.000', '2 000 000', '1e6', '0x10', '+5', 'Infinity', 'NaN', 1.5, -1]) {
      const parsed = parseBudgetVnd(raw)
      assert.equal(parsed.ok, false, JSON.stringify(raw))
    }
    assert.match((parseBudgetVnd('') as { error: string }).error, /0 = không đặt hạn mức/)
    assert.match((parseBudgetVnd('2.000.000') as { error: string }).error, /chỉ gồm chữ số/)
  })

  it('above Number.MAX_SAFE_INTEGER (the server\'s clamp) is refused, not clamped', () => {
    assert.deepEqual(parseBudgetVnd('9007199254740992'), { ok: false, error: 'Hạn mức quá lớn.' })
    assert.equal(MAX_BUDGET_VND, Number.MAX_SAFE_INTEGER)
  })
})

describe('parseThresholdPct — a whole percent, 1–100', () => {
  it('accepts the ends and the default', () => {
    for (const [raw, value] of [['1', 1], ['80', 80], ['100', 100], [' 75 ', 75]] as const) {
      assert.deepEqual(parseThresholdPct(raw), { ok: true, value }, raw)
    }
  })

  it('refuses what the server would clamp (0, 101, -20) or floor (55.9), and non-numbers', () => {
    for (const raw of ['0', '101', '-20', '55.9', '55,5', '', 'abc', null, 150]) {
      assert.deepEqual(parseThresholdPct(raw), { ok: false, error: 'Ngưỡng cảnh báo là số nguyên từ 1 đến 100.' }, JSON.stringify(raw))
    }
  })
})

describe('budgetBlocksAiNow — checkBudget refuses at usagePercent >= 100', () => {
  it('0 never blocks from here; a cap blocks once this month\'s spend reaches it', () => {
    assert.equal(budgetBlocksAiNow(0, 999_999), false)
    assert.equal(budgetBlocksAiNow(1000, 999), false)
    assert.equal(budgetBlocksAiNow(1000, 1000), true, 'equal is exhausted (remaining 0)')
    assert.equal(budgetBlocksAiNow(1000, 1001), true)
  })

  it('the confirmation names both sums and what stops', () => {
    const options = blockingBudgetConfirm(10_000, 12_000)
    assert.equal(options.danger, true)
    assert.equal(options.confirmLabel, 'Vẫn lưu')
    assert.ok(options.message.includes(formatVnd(12_000)) && options.message.includes(formatVnd(10_000)))
    for (const effect of [/dịch bài/, /trợ lý biên tập/, /gọi thử/, /kho kiến thức/, /luật từ khoá/, /sang tháng mới/]) {
      assert.match(options.message, effect)
    }
  })
})

describe('checkBudgetForm', () => {
  it('both valid → the body, as numbers', () => {
    assert.deepEqual(checkBudgetForm({ budget: '5000000', threshold: '75' }), { ok: true, body: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 } })
  })
  it('each invalid field carries its own error, and only its own', () => {
    assert.deepEqual(Object.keys((checkBudgetForm({ budget: 'x', threshold: '0' }) as { errors: object }).errors), ['budget', 'threshold'])
    assert.deepEqual(Object.keys((checkBudgetForm({ budget: '1', threshold: '0' }) as { errors: object }).errors), ['threshold'])
    assert.deepEqual(Object.keys((checkBudgetForm({ budget: '-1', threshold: '80' }) as { errors: object }).errors), ['budget'])
  })
})

describe('saveAiBudget', () => {
  function recorder(options: { spend?: number, confirm?: boolean, response?: () => Promise<{ message?: string }> } = {}) {
    const requests: Array<{ url: string, options: unknown }> = []
    const confirms: unknown[] = []
    const deps: SaveBudgetDeps = {
      monthSpendVnd: options.spend ?? 0,
      confirm: async (o) => { confirms.push(o); return options.confirm ?? true },
      request: (url, o) => { requests.push({ url, options: o }); return (options.response ?? (async () => ({ ok: true })))() },
    }
    return { deps, requests, confirms }
  }

  it('invalid input sends nothing and asks nothing', async () => {
    const r = recorder({ spend: 10 })
    const outcome = await saveAiBudget({ budget: '1.5', threshold: '80' }, r.deps)
    assert.equal(outcome.status, 'invalid')
    assert.deepEqual(r.requests, [])
    assert.deepEqual(r.confirms, [])
  })

  it('a cap above this month\'s spend: no question, one PUT with two numbers', async () => {
    const r = recorder({ spend: 12_000 })
    assert.deepEqual(await saveAiBudget({ budget: '5000000', threshold: '75' }, r.deps), { status: 'saved' })
    assert.deepEqual(r.confirms, [])
    assert.deepEqual(r.requests, [{ url: '/api/admin/ai/budget', options: { method: 'PUT', body: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 } } }])
    const { body } = r.requests[0]!.options as { body: Record<string, unknown> }
    assert.equal(typeof body.monthlyBudgetVnd, 'number')
    assert.equal(typeof body.warningThresholdPct, 'number')
  })

  it('0 never asks (no cap set here)', async () => {
    const r = recorder({ spend: 12_000 })
    assert.deepEqual(await saveAiBudget({ budget: '0', threshold: '80' }, r.deps), { status: 'saved' })
    assert.deepEqual(r.confirms, [])
  })

  it('a cap at or below this month\'s spend asks first; "Hủy" sends nothing, "Vẫn lưu" sends', async () => {
    const declined = recorder({ spend: 12_000, confirm: false })
    assert.deepEqual(await saveAiBudget({ budget: '12000', threshold: '80' }, declined.deps), { status: 'cancelled' })
    assert.equal(declined.confirms.length, 1)
    assert.deepEqual(declined.requests, [])
    const accepted = recorder({ spend: 12_000, confirm: true })
    assert.deepEqual(await saveAiBudget({ budget: '10000', threshold: '80' }, accepted.deps), { status: 'saved' })
    assert.equal(accepted.requests.length, 1)
  })

  it('"Không có thay đổi." is not a save', async () => {
    const r = recorder({ response: async () => ({ message: 'Không có thay đổi.' }) })
    assert.deepEqual(await saveAiBudget({ budget: '1', threshold: '80' }, r.deps), { status: 'unchanged', message: 'Không có thay đổi.' })
  })

  it('a refusal carries the server\'s sentence; an ofetch line never does', async () => {
    const refused = recorder({ response: async () => { throw Object.assign(new Error('[PUT] "/api/admin/ai/budget": 403 Forbidden'), { name: 'FetchError', data: { statusMessage: 'Bạn không có quyền sửa AI.' } }) } })
    assert.deepEqual(await saveAiBudget({ budget: '1', threshold: '80' }, refused.deps), { status: 'failed', message: 'Bạn không có quyền sửa AI.' })
    const dropped = recorder({ response: async () => { throw Object.assign(new Error('[PUT] "/api/admin/ai/budget": <no response> fetch failed'), { name: 'FetchError' }) } })
    assert.deepEqual(await saveAiBudget({ budget: '1', threshold: '80' }, dropped.deps), { status: 'failed', message: 'Không lưu được hạn mức chi AI.' })
  })
})

// ─── The dashboard with the real editor ──────────────────────────────────────

describe('components/admin/ai/AiDashboardTab.vue — the budget editor', () => {
  afterEach(unmountAll)

  const usage = (budget: { monthlyBudgetVnd: number, warningThresholdPct: number }) => json({
    ok: true, usage: { monthlyCostVnd: 12_000, totalPromptTokens: 10, totalCompletionTokens: 5, totalRequests: 3, successRate: 100 },
    byService: [], daily: [], budget: { ...budget, usagePercent: 0 },
  })
  type Route = (call: NetCall) => Response | Error | undefined
  function openDashboard(options: { put?: Route, can?: (resource: string, action: string) => boolean } = {}) {
    let stored = { monthlyBudgetVnd: 0, warningThresholdPct: 80 }
    return mountAdminPage('components/admin/ai/AiDashboardTab.vue', routes({
      'GET /api/admin/ai/usage': () => usage(stored),
      'GET /api/admin/ai/delify/status': () => json({ ok: false, configured: false, error: 'Chưa tạo nhà cung cấp Delify Router.' }),
      'PUT /api/admin/ai/budget': options.put ?? ((call) => { stored = call.body as typeof stored; return json({ ok: true }) }),
    }), { can: options.can })
  }

  const editButton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Sửa hạn mức'))
  const field = (opened: MountedAdminPage, id: string) => findAll(opened.page.root, el => el.tag === 'input' && el.props.id === id)[0]!
  const form = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'form')[0]
  const editorCard = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'section' && el.props['aria-labelledby'] === 'ai-budget-editor-title')[0]

  async function fill(opened: MountedAdminPage, budget: string, threshold: string) {
    await click(editButton(opened)[0]!)
    await settle()
    await input(field(opened, 'ai-budget-vnd'), budget)
    await input(field(opened, 'ai-budget-threshold'), threshold)
    await settle()
  }
  async function submit(opened: MountedAdminPage) {
    await fire(form(opened)!, 'submit')
    await settle()
  }

  it('with ai.update: the current values from the usage read, and no request of its own on mount or on open', async () => {
    const opened = await openDashboard()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/ai/usage', 'GET /api/admin/ai/delify/status?period=7d'])
    assert.match(textOf(editorCard(opened)!), /Chưa đặt \(0\) · Ngưỡng cảnh báo 80%/)
    await click(editButton(opened)[0]!)
    await settle()
    assert.equal(field(opened, 'ai-budget-vnd').model?.value, '0')
    assert.equal(field(opened, 'ai-budget-threshold').model?.value, '80')
    assert.equal(opened.calls.length, 2)
  })

  it('without ai.update (a dashboard reader): no editor at all', async () => {
    const opened = await openDashboard({ can: (resource, action) => !(resource === 'ai' && action === 'update') })
    assert.equal(editorCard(opened), undefined)
    assert.deepEqual(editButton(opened), [])
  })

  it('save: one PUT with two numbers, a toast, then the dashboard reads usage again and shows the new cap', async () => {
    const opened = await openDashboard()
    await fill(opened, '5000000', '75')
    assert.match(textOf(editorCard(opened)!), new RegExp(`= ${formatVnd(5_000_000)}`))
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 } },
      'GET /api/admin/ai/usage',
    ])
    assert.equal(opened.lastToast('success'), 'Đã lưu hạn mức chi AI.')
    assert.equal(form(opened), undefined, 'closed after the save')
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(5_000_000)} mỗi tháng · Ngưỡng cảnh báo 75%`))
  })

  it('invalid input: the error beside its field, aria-invalid, nothing sent', async () => {
    const opened = await openDashboard()
    await fill(opened, '1.5', '101')
    const before = opened.calls.length
    await submit(opened)
    assert.equal(opened.calls.length, before)
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-invalid'], 'true')
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-describedby'], 'ai-budget-vnd-error')
    assert.equal(field(opened, 'ai-budget-threshold').props['aria-invalid'], 'true')
    const card = textOf(editorCard(opened)!)
    assert.match(card, /chỉ gồm chữ số/)
    assert.match(card, /Ngưỡng cảnh báo là số nguyên từ 1 đến 100\./)
  })

  it('a cap at or below this month\'s spend: warned while typing, asked on save; "Hủy" sends nothing', async () => {
    const opened = await openDashboard()
    await fill(opened, '10000', '80')
    assert.match(textOf(editorCard(opened)!), new RegExp(`Tháng này đã chi ${formatVnd(12_000)} — hạn mức này chặn mọi lượt gọi AI ngay khi lưu\\.`))
    opened.answers.confirm = false
    const before = opened.calls.length
    await submit(opened)
    assert.equal(opened.confirms.length, 1)
    assert.equal(opened.confirms[0]!.danger, true)
    assert.equal(opened.calls.length, before)
    assert.ok(form(opened), 'still open to change the number')
    opened.answers.confirm = true
    await submit(opened)
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: 10_000, warningThresholdPct: 80 } },
      'GET /api/admin/ai/usage',
    ])
  })

  it('a cap above the spend (or 0) shows no blocking warning and asks nothing', async () => {
    const opened = await openDashboard()
    await fill(opened, '12001', '80')
    assert.doesNotMatch(textOf(editorCard(opened)!), /chặn mọi lượt gọi AI ngay/)
    await input(field(opened, 'ai-budget-vnd'), '0')
    await settle()
    assert.doesNotMatch(textOf(editorCard(opened)!), /chặn mọi lượt gọi AI ngay/)
    await submit(opened)
    assert.deepEqual(opened.confirms, [])
  })

  it('a refused save: the server\'s sentence in role="alert", the form stays open, no reload', async () => {
    const opened = await openDashboard({ put: () => h3Error(403, 'Bạn không có quyền sửa cấu hình AI.') })
    await fill(opened, '5000000', '80')
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/ai/budget'])
    assert.match(alertText(opened.page), /Bạn không có quyền sửa cấu hình AI\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    assert.ok(form(opened))
    assert.equal(opened.toasts.length, 0)
  })

  it('"Không có thay đổi." is said as information, not as a save, and nothing is reloaded', async () => {
    const opened = await openDashboard({ put: () => json({ ok: true, message: 'Không có thay đổi.' }) })
    await fill(opened, '5000000', '80')
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/ai/budget'])
    assert.equal(opened.lastToast('info'), 'Không có thay đổi.')
    assert.equal(opened.lastToast('success'), undefined)
  })

  it('"Hủy" closes without sending', async () => {
    const opened = await openDashboard()
    await fill(opened, '5000000', '80')
    const before = opened.calls.length
    const cancel = findAll(form(opened)! as MiniElement, el => el.tag === 'button' && textOf(el) === 'Hủy')[0]!
    await click(cancel)
    await settle()
    assert.equal(form(opened), undefined)
    assert.equal(opened.calls.length, before)
  })

  it('a second submit while the first is in flight sends nothing more', async () => {
    const pending: NetCall[] = []
    const opened = await openDashboard({ put: (call) => { pending.push(call); return undefined } })
    await fill(opened, '5000000', '80')
    const before = opened.calls.length
    void fire(form(opened)!, 'submit')
    await settle()
    void fire(form(opened)!, 'submit')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/ai/budget'])
    const save = findAll(form(opened)!, el => el.tag === 'button' && el.props.type === 'submit')[0]!
    assert.equal(save.props.disabled, true)
    assert.equal(textOf(save), 'Đang lưu…')
    pending[0]!.respond(json({ ok: true }))
    await settle()
    assert.equal(opened.lastToast('success'), 'Đã lưu hạn mức chi AI.')
  })
})
