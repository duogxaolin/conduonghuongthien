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
 * the network; the body sent as strings; a clamp instead of a refusal; a blocking cap — or 0,
 * which hands the decision to the Delify key — saved without the confirmation, or "Hủy" still
 * saving; "Không có thay đổi." toasted as saved; a failed save not showing the server's sentence,
 * or its alert surviving a reopen; no reload after a save; the editor seeded, or warned, from the
 * Delify card's figures instead of the portal cap and this month's spend; the stored threshold
 * reset to 80 on open; field errors swapped; focus not moved into the form on open, or not given
 * back to "Sửa hạn mức" on close; the editor shown without `ai.update`; a request on mount.
 * Verifier round 2 (W1–W5, S1–S4): "Lưu hạn mức" marked busy/disabled while the question is open
 * (the dialog cannot give focus back to it); an older re-read answering last putting the old cap
 * back; a failed re-read after a good save taking the whole tab down; the zero-cap text stated
 * the same whatever the Delify key says; "chatbot answers from the knowledge base only" stated
 * without the legacy-provider exception; regex rules left out of the moderation sentence.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  BUDGET_REACHED_EFFECTS, blockingBudgetConfirm, budgetBlocksAiNow, checkBudgetForm, delifyKeyState, MAX_BUDGET_VND, parseBudgetVnd,
  parseThresholdPct, saveAiBudget, ZERO_BUDGET_RULE, zeroBudgetBlocks, zeroBudgetConfirm, zeroBudgetWarning,
  type DelifyKeyState, type SaveBudgetDeps,
} from '../app/utils/ai-budget-form.ts'
import { formatVnd } from '../app/utils/ai-service-labels.ts'
import { click, findAll, fire, input, recordFocus, textOf, type MiniElement } from './_sfc-mount.ts'
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

  it('the confirmation names both sums, what stops, and until when', () => {
    const options = blockingBudgetConfirm(10_000, 12_000)
    assert.equal(options.danger, true)
    assert.equal(options.confirmLabel, 'Vẫn lưu')
    assert.ok(options.message.includes(formatVnd(12_000)) && options.message.includes(formatVnd(10_000)))
    assert.ok(options.message.includes(BUDGET_REACHED_EFFECTS))
    assert.match(options.message, /cho tới khi nâng hạn mức hoặc sang tháng mới/)
  })
})

describe('BUDGET_REACHED_EFFECTS — what checkBudget\'s `budget_exceeded` does, said once for the form and both dialogs', () => {
  it('every AI call refused, the chatbot as each path really degrades, moderation as moderation-worker-check.ts degrades', () => {
    for (const effect of [
      /từ chối mọi lượt gọi AI \(dịch bài, trợ lý biên tập, gọi thử\)/,
      // The gateway path: `budget_exceeded` → knowledge base only (chat-policy-provider.ts)…
      /chatbot chạy qua dịch vụ AI "Chatbot" chỉ còn trả lời từ kho kiến thức/,
      // …but service_not_found/inactive/no_api_key come BEFORE the budget check and the chatbot calls
      // the provider set in "Cài đặt Chatbot" (pinned as intended, chat-policy-seams-behavior.test.ts).
      /riêng chatbot còn dùng nhà cung cấp cấu hình ở "Cài đặt Chatbot" \(dịch vụ "Chatbot" chưa tạo, đang tắt hoặc thiếu khoá\) vẫn gọi nhà cung cấp đó, hạn mức không chặn đường này/,
      // fastPreModerate still runs first; then only a `critical` rule — keyword OR regex — hides (and queues)…
      /kiểm duyệt tự động chỉ còn luật chặn tức thì và quy tắc từ khoá hoặc mẫu \(regex\) mức critical \(tự ẩn\)/,
      // …and a match below `critical` is let through without a queue row.
      /nội dung chỉ khớp quy tắc mức low, medium hoặc high được cho qua, không vào hàng chờ duyệt/,
    ]) {
      assert.match(BUDGET_REACHED_EFFECTS, effect)
    }
    assert.doesNotMatch(BUDGET_REACHED_EFFECTS, /chỉ còn luật từ khoá[.,]/, 'not the old "keyword rules only", which hid that most matches pass')
    assert.doesNotMatch(BUDGET_REACHED_EFFECTS, /; chatbot chỉ trả lời từ kho kiến thức;/, 'not the unconditional chatbot claim')
  })
})

describe('a cap of 0 — what the Delify key says decides, and the text says so', () => {
  const NONE: DelifyKeyState = { kind: 'none' }
  const UNKNOWN: DelifyKeyState = { kind: 'unknown' }
  const INACTIVE: DelifyKeyState = { kind: 'inactive' }
  const UNLIMITED: DelifyKeyState = { kind: 'unlimited' }
  const UNDER: DelifyKeyState = { kind: 'budget', budgetVnd: 255_000, spentVnd: 50_000 }
  const REACHED: DelifyKeyState = { kind: 'budget', budgetVnd: 255_000, spentVnd: 255_000 }

  it('budgetBlocksAiNow stays about the portal cap: 0 never blocks from here', () => {
    assert.equal(budgetBlocksAiNow(0, 0), false)
    assert.equal(budgetBlocksAiNow(0, 999_999), false)
  })

  it('delifyKeyState reads GET /api/admin/ai/delify/status the way checkBudget decides', () => {
    const key = (keyInfo: Record<string, unknown>) => ({ ok: true, configured: true, keyInfo })
    assert.deepEqual(delifyKeyState(null), UNKNOWN, 'not read yet (or the read failed)')
    assert.deepEqual(delifyKeyState({ ok: false, configured: false }), NONE, 'no provider row / no key: no cap at all')
    assert.deepEqual(delifyKeyState({ ok: false, configured: true }), UNKNOWN, 'key there but the router did not answer')
    assert.deepEqual(delifyKeyState(key({ active: false, budgetUsd: 10 })), INACTIVE, 'a switched-off key blocks whatever its budget')
    assert.deepEqual(delifyKeyState(key({ active: true, budgetUsd: null })), UNLIMITED)
    assert.deepEqual(delifyKeyState(key({ active: true, budgetUsd: 0 })), UNLIMITED, 'checkBudget uses the budget only when > 0')
    // budgetUsd × 25 500 against the all-time ai_usage_logs total — the two numbers checkBudget compares.
    assert.deepEqual(delifyKeyState(key({ active: true, budgetUsd: 10, usedCostVnd: 50_000 })), UNDER)
    assert.deepEqual(delifyKeyState(key({ active: true, budgetUsd: 10 })), { kind: 'budget', budgetVnd: 255_000, spentVnd: 0 })
  })

  it('zeroBudgetBlocks: known yes, known no, or unknown', () => {
    assert.equal(zeroBudgetBlocks(INACTIVE), true)
    assert.equal(zeroBudgetBlocks(REACHED), true, 'checkBudget refuses at remaining <= 0')
    assert.equal(zeroBudgetBlocks({ kind: 'budget', budgetVnd: 255_000, spentVnd: 254_999 }), false)
    assert.equal(zeroBudgetBlocks(UNDER), false)
    assert.equal(zeroBudgetBlocks(NONE), false)
    assert.equal(zeroBudgetBlocks(UNLIMITED), false)
    assert.equal(zeroBudgetBlocks(UNKNOWN), null)
  })

  it('the warning beside the field states the outcome for the key as it is — never "dùng hạn mức của khoá" when there is none', () => {
    assert.equal(zeroBudgetWarning(NONE), 'Hạn mức 0 = không giới hạn: chưa có khoá Delify, máy chủ không áp hạn mức chi AI nào.')
    assert.equal(zeroBudgetWarning(UNLIMITED), 'Hạn mức 0 = không giới hạn: khoá Delify không có ngân sách riêng, máy chủ không áp hạn mức chi AI nào.')
    assert.equal(zeroBudgetWarning(INACTIVE), 'Hạn mức 0 = dùng khoá Delify, mà khoá đang tắt: máy chủ chặn mọi lượt gọi AI ngay khi lưu.')
    const under = zeroBudgetWarning(UNDER)
    assert.ok(under.startsWith(`Hạn mức 0 = dùng hạn mức của khoá Delify: ${formatVnd(255_000)}, so với tổng chi AI từ trước tới nay (${formatVnd(50_000)}) — không phải tháng này.`), under)
    assert.ok(under.endsWith('Khi tổng đó chạm hạn mức của khoá, AI bị chặn.'))
    assert.ok(zeroBudgetWarning(REACHED).endsWith('Tổng đó đã chạm hạn mức của khoá: AI bị chặn ngay khi lưu.'))
    assert.match(zeroBudgetWarning(UNKNOWN), /chưa đọc được trạng thái khoá: khoá tắt hoặc đã hết ngân sách thì AI bị chặn ngay khi lưu, không có khoá hay ngân sách thì không giới hạn\.$/)
    for (const state of [NONE, UNLIMITED, UNKNOWN]) assert.doesNotMatch(zeroBudgetWarning(state), /dùng hạn mức của khoá Delify/)
  })

  it('its confirmation is always a danger dialog, titled and worded by the same state', () => {
    const cases: Array<[DelifyKeyState, string, RegExp]> = [
      [INACTIVE, 'Hạn mức 0 chặn gọi AI ngay', /\n\nNgay khi lưu, máy chủ từ chối/],
      [REACHED, 'Hạn mức 0 chặn gọi AI ngay', /\n\nNgay khi lưu, máy chủ từ chối/],
      [UNDER, 'Lưu hạn mức 0 — dùng hạn mức của khoá Delify', /\n\nKhi tổng chi chạm hạn mức của khoá, máy chủ từ chối/],
      [NONE, 'Lưu hạn mức 0 — không giới hạn chi AI', /\n\nMáy chủ không chặn lượt gọi AI nào vì chi phí cho tới khi đặt lại hạn mức\.$/],
      [UNLIMITED, 'Lưu hạn mức 0 — không giới hạn chi AI', /\n\nMáy chủ không chặn lượt gọi AI nào vì chi phí/],
      [UNKNOWN, 'Lưu hạn mức 0 — khoá Delify quyết định', /\n\nNếu khoá tắt hoặc đã hết ngân sách, ngay khi lưu máy chủ từ chối/],
    ]
    for (const [state, title, effects] of cases) {
      const options = zeroBudgetConfirm(state)
      assert.equal(options.title, title, state.kind)
      assert.equal(options.danger, true)
      assert.equal(options.confirmLabel, 'Vẫn lưu 0')
      assert.ok(options.message.startsWith(zeroBudgetWarning(state)), `${state.kind}: the same sentence as the field`)
      assert.match(options.message, effects, state.kind)
      const canEverBlock = state.kind !== 'none' && state.kind !== 'unlimited'
      assert.equal(options.message.includes(BUDGET_REACHED_EFFECTS), canEverBlock, `${state.kind}: what stops, only when something can stop`)
    }
  })

  it('the static rule in the form names every branch checkBudget takes', () => {
    assert.equal(ZERO_BUDGET_RULE, 'Đặt 0: cổng không đặt hạn mức; máy chủ hỏi khoá Delify — khoá có ngân sách thì dùng ngân sách đó '
      + '(so với tổng chi AI từ trước tới nay, không phải tháng này), khoá bị tắt thì chặn mọi lượt gọi AI, '
      + 'không có khoá hoặc khoá không có ngân sách thì không giới hạn.')
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
  function recorder(options: { spend?: number, confirm?: boolean, delifyKey?: DelifyKeyState, response?: () => Promise<{ message?: string }> } = {}) {
    const requests: Array<{ url: string, options: unknown }> = []
    const confirms: unknown[] = []
    const deps: SaveBudgetDeps = {
      monthSpendVnd: options.spend ?? 0,
      delifyKey: options.delifyKey ?? { kind: 'none' },
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
    assert.deepEqual(await saveAiBudget({ budget: '5000000', threshold: '75' }, r.deps), { status: 'saved', saved: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 } })
    assert.deepEqual(r.confirms, [])
    assert.deepEqual(r.requests, [{ url: '/api/admin/ai/budget', options: { method: 'PUT', body: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 } } }])
    const { body } = r.requests[0]!.options as { body: Record<string, unknown> }
    assert.equal(typeof body.monthlyBudgetVnd, 'number')
    assert.equal(typeof body.warningThresholdPct, 'number')
  })

  it('0 always asks the zero question for the key as it is — whatever this month\'s spend; "Hủy" sends nothing, "Vẫn lưu 0" sends', async () => {
    const states: DelifyKeyState[] = [{ kind: 'none' }, { kind: 'inactive' }, { kind: 'budget', budgetVnd: 255_000, spentVnd: 1 }, { kind: 'unknown' }]
    for (const spend of [0, 12_000]) {
      for (const delifyKey of states) {
        const declined = recorder({ spend, confirm: false, delifyKey })
        assert.deepEqual(await saveAiBudget({ budget: '0', threshold: '80' }, declined.deps), { status: 'cancelled' })
        assert.deepEqual(declined.confirms, [zeroBudgetConfirm(delifyKey)], `spend ${spend}, ${delifyKey.kind}`)
        assert.deepEqual(declined.requests, [])
        const accepted = recorder({ spend, confirm: true, delifyKey })
        assert.deepEqual(await saveAiBudget({ budget: ' 000 ', threshold: '80' }, accepted.deps), { status: 'saved', saved: { monthlyBudgetVnd: 0, warningThresholdPct: 80 } })
        assert.deepEqual(accepted.confirms, [zeroBudgetConfirm(delifyKey)])
        assert.deepEqual(accepted.requests, [{ url: '/api/admin/ai/budget', options: { method: 'PUT', body: { monthlyBudgetVnd: 0, warningThresholdPct: 80 } } }])
      }
    }
  })

  it('the request is made only after the question is answered — the caller marks "saving" inside it (W2)', async () => {
    const order: string[] = []
    const deps: SaveBudgetDeps = {
      monthSpendVnd: 12_000,
      delifyKey: { kind: 'none' },
      confirm: async () => { order.push('asked'); await Promise.resolve(); order.push('answered'); return true },
      request: async () => { order.push('request'); return { ok: true } },
    }
    await saveAiBudget({ budget: '10000', threshold: '80' }, deps)
    await saveAiBudget({ budget: '0', threshold: '80' }, deps)
    assert.deepEqual(order, ['asked', 'answered', 'request', 'asked', 'answered', 'request'])
  })

  it('a cap at or below this month\'s spend asks the blocking question; "Hủy" sends nothing, "Vẫn lưu" sends', async () => {
    const declined = recorder({ spend: 12_000, confirm: false })
    assert.deepEqual(await saveAiBudget({ budget: '12000', threshold: '80' }, declined.deps), { status: 'cancelled' })
    assert.deepEqual(declined.confirms, [blockingBudgetConfirm(12_000, 12_000)])
    assert.deepEqual(declined.requests, [])
    const accepted = recorder({ spend: 12_000, confirm: true })
    assert.deepEqual(await saveAiBudget({ budget: '10000', threshold: '80' }, accepted.deps), { status: 'saved', saved: { monthlyBudgetVnd: 10_000, warningThresholdPct: 80 } })
    assert.deepEqual(accepted.confirms, [blockingBudgetConfirm(10_000, 12_000)])
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
  // Every `focus()` the page calls, in order (tests/_sfc-mount.ts `recordFocus`).
  let focused: MiniElement[] = []
  beforeEach(() => {
    focused = []
    recordFocus(el => { focused.push(el) })
  })
  afterEach(() => {
    recordFocus(null)
    unmountAll()
  })

  type Stored = { monthlyBudgetVnd: number, warningThresholdPct: number }
  const usage = (budget: Stored) => json({
    ok: true, usage: { monthlyCostVnd: 12_000, totalPromptTokens: 10, totalCompletionTokens: 5, totalRequests: 3, successRate: 100 },
    byService: [], daily: [], budget: { ...budget, usagePercent: 0 },
  })
  type Route = (call: NetCall) => Response | Error | undefined
  const NO_DELIFY = () => json({ ok: false, configured: false, error: 'Chưa tạo nhà cung cấp Delify Router.' })
  /**
   * `heldReads`: every usage read after the mount's is left pending there, with the row as the
   * server read it AT THAT MOMENT (the test answers it). `rereads`: what each later read answers.
   * `auto`: harness auto-imports to replace (a `useConfirm` whose question stays open).
   */
  function openDashboard(options: {
    put?: Route, delify?: Route, stored?: Stored, heldReads?: Array<{ call: NetCall, snapshot: Stored }>, rereads?: () => Response,
    auto?: Record<string, unknown>, can?: (resource: string, action: string) => boolean,
  } = {}) {
    let stored = options.stored ?? { monthlyBudgetVnd: 0, warningThresholdPct: 80 }
    let reads = 0
    return mountAdminPage('components/admin/ai/AiDashboardTab.vue', routes({
      'GET /api/admin/ai/usage': (call) => {
        if (reads++ === 0) return usage(stored)
        if (options.heldReads) { options.heldReads.push({ call, snapshot: { ...stored } }); return undefined }
        return options.rereads ? options.rereads() : usage(stored)
      },
      'GET /api/admin/ai/delify/status': options.delify ?? NO_DELIFY,
      'PUT /api/admin/ai/budget': options.put ?? ((call) => { stored = call.body as Stored; return json({ ok: true }) }),
    }), { can: options.can, auto: options.auto })
  }
  /** A `useConfirm` whose `confirm()` stays open until the test answers (`answer`). */
  function heldConfirm() {
    const held = { asked: [] as unknown[], answer: (_yes: boolean) => {} }
    const useConfirm = () => ({
      confirm: (options: unknown) => { held.asked.push(options); return new Promise<boolean>((resolve) => { held.answer = resolve }) },
      prompt: async () => null,
    })
    return { held, auto: { useConfirm } }
  }
  const saveButton = (opened: MountedAdminPage) => findAll(form(opened)!, el => el.tag === 'button' && el.props.type === 'submit')[0]!
  const cancelButton = (opened: MountedAdminPage) => findAll(form(opened)!, el => el.tag === 'button' && textOf(el) === 'Hủy')[0]!

  const editButton = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Sửa hạn mức'))
  const field = (opened: MountedAdminPage, id: string) => findAll(opened.page.root, el => el.tag === 'input' && el.props.id === id)[0]!
  const fieldError = (opened: MountedAdminPage, id: string) => findAll(opened.page.root, el => el.props.id === `${id}-error`)[0]
  const form = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'form')[0]
  const editorCard = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'section' && el.props['aria-labelledby'] === 'ai-budget-editor-title')[0]
  // The Delify card has its own `role="alert"` when the router is not set up: read the editor's only.
  const editorAlerts = (opened: MountedAdminPage) => findAll(editorCard(opened)!, el => el.props.role === 'alert')
  const BLOCKING_WARNING = /hạn mức này chặn mọi lượt gọi AI ngay khi lưu/

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

  it('a stored threshold other than 80 is what the form opens with, and what the next save sends back', async () => {
    const opened = await openDashboard({ stored: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 65 } })
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(5_000_000)} mỗi tháng · Ngưỡng cảnh báo 65%`))
    await click(editButton(opened)[0]!)
    await settle()
    assert.equal(field(opened, 'ai-budget-vnd').model?.value, '5000000')
    assert.equal(field(opened, 'ai-budget-threshold').model?.value, '65')
    await input(field(opened, 'ai-budget-vnd'), '6000000') // only the cap is changed
    await settle()
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(sent(opened.calls, before)[0], { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: 6_000_000, warningThresholdPct: 65 } })
  })

  it('with Delify set up: the form reads the portal cap and THIS MONTH\'s spend, not the Delify card\'s figures', async () => {
    // The KPI card shows the Delify key's budget (255 000 ₫) and its all-time spend (50 000 ₫) when the
    // portal sets no cap; `checkBudget` compares a portal cap with this month's spend (12 000 ₫).
    const DELIFY = {
      ok: true, configured: true, host: 'router.test', period: '7d',
      keyInfo: {
        name: 'cdkt', groupName: 'g', active: true, budgetUsd: 10, budgetVnd: 255_000, usedCostUsd: 2, usedCostVnd: 50_000,
        remainingBudgetUsd: 8, remainingBudgetVnd: 205_000, totalRequests: 4, allowedModels: [], rpm: null, windowStartedAt: null,
      },
      periodSummary: { totals: { input: 1, output: 1, requests: 1, cost: 0.1 } }, recentHistory: [], availableModels: [],
    }
    const opened = await openDashboard({ delify: () => json(DELIFY) })
    const page = textOf(opened.page.root)
    assert.ok(page.includes(formatVnd(255_000)) && page.includes(`đã dùng ${formatVnd(50_000)}`), 'the Delify figures really are on the page')
    assert.match(textOf(editorCard(opened)!), /Chưa đặt \(0\) · Ngưỡng cảnh báo 80%/)
    await click(editButton(opened)[0]!)
    await settle()
    assert.equal(field(opened, 'ai-budget-vnd').model?.value, '0', 'seeded from the portal cap, not the Delify budget')
    // 20 000 ₫ is above this month's 12 000 ₫ and below the Delify key's 50 000 ₫: it does not block.
    await input(field(opened, 'ai-budget-vnd'), '20000')
    await settle()
    assert.doesNotMatch(textOf(editorCard(opened)!), BLOCKING_WARNING)
    await input(field(opened, 'ai-budget-vnd'), '12000')
    await settle()
    assert.match(textOf(editorCard(opened)!), new RegExp(`Tháng này đã chi ${formatVnd(12_000)} — `))
    await input(field(opened, 'ai-budget-vnd'), '20000')
    await settle()
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(opened.confirms, [], 'nothing to ask: the cap is above this month\'s spend')
    assert.deepEqual(sent(opened.calls, before)[0], { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: 20_000, warningThresholdPct: 80 } })
  })

  it('save: one PUT with two numbers, a toast, then the dashboard re-reads usage IN PLACE and shows the new cap', async () => {
    const opened = await openDashboard()
    const card = editorCard(opened)
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
    assert.equal(editorCard(opened), card, 'the same card: re-read without the loading state, not unmounted and rebuilt')
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(5_000_000)} mỗi tháng · Ngưỡng cảnh báo 75%`))
  })

  it('right after a save, before the re-read answers: the card shows what was saved, and reopening seeds it — a second save cannot revert the first', async () => {
    const held: Array<{ call: NetCall, snapshot: Stored }> = []
    const opened = await openDashboard({ heldReads: held })
    await fill(opened, '5000000', '75')
    await submit(opened)
    assert.equal(held.length, 1, 'the re-read is on its way, not answered yet')
    assert.equal(form(opened), undefined)
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(5_000_000)} mỗi tháng · Ngưỡng cảnh báo 75%`))
    await click(editButton(opened)[0]!) // focus is on this button: Enter right away
    await settle()
    assert.equal(field(opened, 'ai-budget-vnd').model?.value, '5000000', 'not the cap from before the save')
    assert.equal(field(opened, 'ai-budget-threshold').model?.value, '75')
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(sent(opened.calls, before)[0], { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 75 } })
    for (const { call, snapshot } of held) call.respond(usage(snapshot))
    await settle()
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(5_000_000)} mỗi tháng · Ngưỡng cảnh báo 75%`))
  })

  it('two saves inside one re-read, the OLDER re-read answering last: the card and the next form keep the last saved cap (W3)', async () => {
    // Verifier probe (a), Chromium-reproduced: the first re-read is read by the server before the
    // second save and answers last — it used to put 1.111.111 back while the row held 2.222.222.
    const held: Array<{ call: NetCall, snapshot: Stored }> = []
    const opened = await openDashboard({ heldReads: held })
    await fill(opened, '1111111', '80')
    await submit(opened)
    await fill(opened, '2222222', '80')
    await submit(opened)
    assert.equal(held.length, 2)
    assert.deepEqual(held.map(h => h.snapshot.monthlyBudgetVnd), [1_111_111, 2_222_222], 'each read saw the row as it was then')
    held[1]!.call.respond(usage(held[1]!.snapshot)) // the newer read answers first…
    await settle()
    held[0]!.call.respond(usage(held[0]!.snapshot)) // …the older one last
    await settle()
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(2_222_222)} mỗi tháng`), textOf(editorCard(opened)!))
    await click(editButton(opened)[0]!)
    await settle()
    assert.equal(field(opened, 'ai-budget-vnd').model?.value, '2222222', 'the next form must not seed the first cap')
    assert.equal(opened.toasts.filter(t => t.type === 'error').length, 0)
  })

  it('a save that succeeds, then a re-read that fails: the cards and the editor stay, the failure is a toast (S1)', async () => {
    const opened = await openDashboard({ rereads: () => h3Error(500, 'Lỗi máy chủ') })
    const card = editorCard(opened)
    await fill(opened, '5000000', '80')
    await submit(opened)
    assert.equal(opened.lastToast('success'), 'Đã lưu hạn mức chi AI.')
    assert.equal(opened.lastToast('error'), 'Không tải lại được số liệu chi phí: Lỗi máy chủ')
    assert.equal(editorCard(opened), card, 'not taken down with the rest of the tab')
    assert.match(textOf(editorCard(opened)!), new RegExp(`${formatVnd(5_000_000)} mỗi tháng`), 'what was saved')
    assert.doesNotMatch(alertText(opened.page), /Lỗi máy chủ/, 'no tab-wide error branch for a re-read')
    assert.equal(focused.at(-1), editButton(opened)[0], 'focus still on "Sửa hạn mức"')
    // A first load that fails is still the tab's error branch with its retry.
    const failing = await mountAdminPage('components/admin/ai/AiDashboardTab.vue', routes({
      'GET /api/admin/ai/usage': () => h3Error(500, 'Lỗi máy chủ'),
      'GET /api/admin/ai/delify/status': NO_DELIFY,
    }))
    assert.match(alertText(failing.page), /Lỗi máy chủ/)
    assert.equal(failing.toasts.length, 0)
  })

  it('invalid input: each error beside ITS field, aria-invalid on that field only, nothing sent', async () => {
    const opened = await openDashboard()
    await fill(opened, '1.5', '101')
    const before = opened.calls.length
    await submit(opened)
    assert.equal(opened.calls.length, before)
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-invalid'], 'true')
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-describedby'], 'ai-budget-vnd-error')
    assert.equal(field(opened, 'ai-budget-threshold').props['aria-invalid'], 'true')
    assert.equal(field(opened, 'ai-budget-threshold').props['aria-describedby'], 'ai-budget-threshold-error')
    assert.match(textOf(fieldError(opened, 'ai-budget-vnd')!), /^Hạn mức là số nguyên đồng, chỉ gồm chữ số/)
    assert.equal(textOf(fieldError(opened, 'ai-budget-threshold')!), 'Ngưỡng cảnh báo là số nguyên từ 1 đến 100.')
    // Only the threshold wrong: the cap's field stays clean.
    await input(field(opened, 'ai-budget-vnd'), '5000000')
    await input(field(opened, 'ai-budget-threshold'), '0')
    await submit(opened)
    assert.equal(opened.calls.length, before)
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-invalid'], undefined)
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-describedby'], 'ai-budget-vnd-hint')
    assert.equal(fieldError(opened, 'ai-budget-vnd'), undefined)
    assert.equal(textOf(fieldError(opened, 'ai-budget-threshold')!), 'Ngưỡng cảnh báo là số nguyên từ 1 đến 100.')
  })

  it('the form says what reaching the cap does — the same sentence as the dialogs — what 0 means, and that the threshold blocks nothing', async () => {
    const opened = await openDashboard()
    await fill(opened, '5000000', '80')
    const text = textOf(form(opened)!)
    assert.ok(text.includes(`chạm hạn mức, ${BUDGET_REACHED_EFFECTS}`))
    assert.ok(text.includes(ZERO_BUDGET_RULE), 'the general rule of 0 is on the form even when 0 is not typed')
    const hint = findAll(form(opened)!, el => el.props.id === 'ai-budget-threshold-hint')[0]!
    assert.equal(textOf(hint), 'Số nguyên 1–100. Chi tới ngưỡng này, máy chủ ghi một dòng cảnh báo vào nhật ký (tối đa mỗi ngày một lần); ngưỡng không chặn gọi AI.')
  })

  it('a cap at or below this month\'s spend: warned while typing, asked on save; "Hủy" sends nothing', async () => {
    const opened = await openDashboard()
    await fill(opened, '10000', '80')
    assert.match(textOf(editorCard(opened)!), new RegExp(`Tháng này đã chi ${formatVnd(12_000)} — hạn mức này chặn mọi lượt gọi AI ngay khi lưu\\.`))
    assert.ok(!textOf(editorCard(opened)!).includes(zeroBudgetWarning({ kind: 'none' })))
    // The field is described by its hint AND the warning its value raises (S3).
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-describedby'], 'ai-budget-vnd-hint ai-budget-blocking-warning')
    assert.ok(findAll(editorCard(opened)!, el => el.props.id === 'ai-budget-blocking-warning').length === 1)
    opened.answers.confirm = false
    const before = opened.calls.length
    await submit(opened)
    assert.equal(opened.confirms.length, 1)
    assert.equal(opened.confirms[0]!.title, 'Hạn mức này chặn gọi AI ngay')
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

  it('a cap above the spend: no warning of either kind, and nothing is asked', async () => {
    const opened = await openDashboard()
    await fill(opened, '12001', '80')
    assert.doesNotMatch(textOf(editorCard(opened)!), BLOCKING_WARNING)
    assert.ok(!textOf(editorCard(opened)!).includes(zeroBudgetWarning({ kind: 'none' })))
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-describedby'], 'ai-budget-vnd-hint')
    await submit(opened)
    assert.deepEqual(opened.confirms, [])
  })

  it('0: the warning for the key as it is while typed (not the month-spend one) — also as "000"; saving asks the zero question; "Hủy" sends nothing', async () => {
    const opened = await openDashboard({ stored: { monthlyBudgetVnd: 5_000_000, warningThresholdPct: 80 } })
    await fill(opened, '0', '80')
    // No Delify provider in this fixture: 0 means no cap at all, and the text says exactly that.
    assert.ok(textOf(editorCard(opened)!).includes(zeroBudgetWarning({ kind: 'none' })))
    assert.doesNotMatch(textOf(editorCard(opened)!), BLOCKING_WARNING)
    assert.equal(field(opened, 'ai-budget-vnd').props['aria-describedby'], 'ai-budget-vnd-hint ai-budget-zero-warning', 'S3: the warning describes the field')
    await input(field(opened, 'ai-budget-vnd'), '12001')
    await settle()
    assert.ok(!textOf(editorCard(opened)!).includes(zeroBudgetWarning({ kind: 'none' })), 'gone once the cap is not 0')
    await input(field(opened, 'ai-budget-vnd'), '000') // N16: 0 by value, not by text
    await settle()
    assert.ok(textOf(editorCard(opened)!).includes(zeroBudgetWarning({ kind: 'none' })), '"000" is 0 too')
    await input(field(opened, 'ai-budget-vnd'), '0')
    await settle()
    opened.answers.confirm = false
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(opened.confirms, [zeroBudgetConfirm({ kind: 'none' })])
    assert.equal(opened.calls.length, before, '"Hủy" sends nothing')
    assert.ok(form(opened), 'still open to change the number')
    opened.answers.confirm = true
    await submit(opened)
    assert.equal(opened.confirms.length, 2)
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: 0, warningThresholdPct: 80 } },
      'GET /api/admin/ai/usage',
    ])
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

  it('a refused save, "Hủy", then "Sửa hạn mức" again: the form opens clean — no stale alert, the stored values back', async () => {
    const opened = await openDashboard({ put: () => h3Error(403, 'Bạn không có quyền sửa cấu hình AI.') })
    await fill(opened, '5000000', '75')
    await submit(opened)
    assert.equal(editorAlerts(opened).length, 1)
    await click(findAll(form(opened)!, el => el.tag === 'button' && textOf(el) === 'Hủy')[0]!)
    await settle()
    await click(editButton(opened)[0]!)
    await settle()
    assert.ok(form(opened))
    assert.deepEqual(editorAlerts(opened), [], 'the last save\'s failure is not shown on a new attempt')
    assert.equal(field(opened, 'ai-budget-vnd').model?.value, '0')
    assert.equal(field(opened, 'ai-budget-threshold').model?.value, '80')
  })

  it('"Không có thay đổi." is said as information, not as a save: the form closes, nothing is reloaded, focus goes back', async () => {
    const opened = await openDashboard({ put: () => json({ ok: true, message: 'Không có thay đổi.' }) })
    await fill(opened, '5000000', '80')
    const before = opened.calls.length
    await submit(opened)
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/ai/budget'])
    assert.equal(opened.lastToast('info'), 'Không có thay đổi.')
    assert.equal(opened.lastToast('success'), undefined)
    assert.equal(form(opened), undefined)
    assert.equal(focused.at(-1), editButton(opened)[0])
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

  it('focus: opening moves it to the cap field; "Hủy" gives it back to "Sửa hạn mức" — the button now on the page', async () => {
    const opened = await openDashboard()
    assert.deepEqual(focused, [], 'nothing is focused on mount')
    await click(editButton(opened)[0]!)
    await settle()
    assert.equal(focused.length, 1)
    assert.equal(focused[0], field(opened, 'ai-budget-vnd'))
    await click(findAll(form(opened)!, el => el.tag === 'button' && textOf(el) === 'Hủy')[0]!)
    await settle()
    assert.equal(focused.length, 2)
    const shown = editButton(opened)
    assert.equal(shown.length, 1)
    assert.equal(focused[1], shown[0], 'the re-rendered button, not the one removed when the form opened')
  })

  it('focus: after a save it goes back to "Sửa hạn mức" on the re-read card', async () => {
    const opened = await openDashboard()
    await fill(opened, '5000000', '80')
    await submit(opened)
    assert.equal(opened.lastToast('success'), 'Đã lưu hạn mức chi AI.')
    assert.equal(focused.length, 2)
    assert.equal(focused[1], editButton(opened)[0])
  })

  it('a second submit while the first is in flight sends nothing more; "Lưu" is aria-disabled + aria-busy (never `disabled`), "Hủy" disabled', async () => {
    const pending: NetCall[] = []
    const opened = await openDashboard({ put: (call) => { pending.push(call); return undefined } })
    await fill(opened, '5000000', '80')
    assert.equal(saveButton(opened).props['aria-busy'], false)
    assert.equal(saveButton(opened).props['aria-disabled'], false)
    assert.equal(cancelButton(opened).props.disabled, false)
    const before = opened.calls.length
    void fire(form(opened)!, 'submit')
    await settle()
    void fire(form(opened)!, 'submit')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['PUT /api/admin/ai/budget'])
    const save = saveButton(opened)
    assert.equal(save.props['aria-disabled'], true)
    assert.equal(save.props['aria-busy'], true, 'N29')
    assert.equal('disabled' in save.props, false, 'focusable throughout: a dialog may give focus back to it, a failed save leaves the officer on it')
    assert.equal(textOf(save), 'Đang lưu…')
    assert.equal(cancelButton(opened).props.disabled, true, 'N28: no closing the form under a save in flight')
    pending[0]!.respond(json({ ok: true }))
    await settle()
    assert.equal(opened.lastToast('success'), 'Đã lưu hạn mức chi AI.')
  })

  it('while the question is open nothing is marked "saving": "Lưu hạn mức" stays as it was, so the dialog can give focus back to it (W2)', async () => {
    for (const [budget, title] of [['10000', 'Hạn mức này chặn gọi AI ngay'], ['0', 'Lưu hạn mức 0 — không giới hạn chi AI']] as const) {
      const { held, auto } = heldConfirm()
      const opened = await openDashboard({ auto })
      await fill(opened, budget, '80')
      const save = saveButton(opened)
      const before = opened.calls.length
      void fire(form(opened)!, 'submit')
      await settle()
      assert.equal((held.asked[0] as { title: string }).title, title, 'the question is open')
      assert.equal(saveButton(opened), save, 'the same element')
      assert.equal(save.props['aria-busy'], false, `${budget}: not busy while asking`)
      assert.equal(save.props['aria-disabled'], false)
      assert.equal('disabled' in save.props, false)
      assert.equal(textOf(save), 'Lưu hạn mức')
      assert.equal(cancelButton(opened).props.disabled, false)
      void fire(form(opened)!, 'submit') // a second submit while asking asks nothing more
      await settle()
      assert.equal(held.asked.length, 1)
      held.answer(false) // Esc / "Hủy"
      await settle()
      assert.equal(opened.calls.length, before, 'nothing sent')
      assert.ok(form(opened), 'the form stays open')
      assert.equal(saveButton(opened).props['aria-disabled'], false)
      void fire(form(opened)!, 'submit') // and it asks again afterwards
      await settle()
      assert.equal(held.asked.length, 2)
      held.answer(true)
      await settle()
      assert.deepEqual(sent(opened.calls, before)[0], { wire: 'PUT /api/admin/ai/budget', body: { monthlyBudgetVnd: Number(budget), warningThresholdPct: 80 } })
      unmountAll()
    }
  })

  it('a cap of 0 with the Delify key as the dashboard read it: budget left, budget reached, switched off, not readable', async () => {
    const delifyAnswer = (keyInfo: Record<string, unknown>) => () => json({
      ok: true, configured: true, host: 'router.test', period: '7d',
      keyInfo: {
        name: 'cdkt', groupName: 'g', budgetVnd: null, usedCostUsd: 0, remainingBudgetUsd: null, remainingBudgetVnd: null,
        totalRequests: 1, allowedModels: [], rpm: null, windowStartedAt: null, ...keyInfo,
      },
      periodSummary: null, recentHistory: [], availableModels: [],
    })
    const cases: Array<[string, () => Response, DelifyKeyState, boolean]> = [
      ['budget left', delifyAnswer({ active: true, budgetUsd: 10, usedCostVnd: 50_000 }), { kind: 'budget', budgetVnd: 255_000, spentVnd: 50_000 }, false],
      ['budget reached', delifyAnswer({ active: true, budgetUsd: 10, usedCostVnd: 300_000 }), { kind: 'budget', budgetVnd: 255_000, spentVnd: 300_000 }, true],
      ['switched off', delifyAnswer({ active: false, budgetUsd: 10, usedCostVnd: 0 }), { kind: 'inactive' }, true],
      ['no budget', delifyAnswer({ active: true, budgetUsd: null, usedCostVnd: 0 }), { kind: 'unlimited' }, false],
      ['not readable', () => h3Error(500, 'Lỗi máy chủ'), { kind: 'unknown' }, false],
    ]
    for (const [label, delify, state, danger] of cases) {
      const opened = await openDashboard({ delify })
      await fill(opened, '0', '80')
      const warning = findAll(editorCard(opened)!, el => el.props.id === 'ai-budget-zero-warning')[0]
      assert.ok(warning, label)
      assert.equal(textOf(warning), zeroBudgetWarning(state), label)
      assert.equal(String(warning.props.class).includes('text-danger'), danger, `${label}: red only when it blocks at once`)
      assert.equal(String(warning.props.class).includes('text-warn-ink'), !danger)
      opened.answers.confirm = false
      await submit(opened)
      assert.deepEqual(opened.confirms, [zeroBudgetConfirm(state)], label)
      unmountAll()
    }
  })
})
