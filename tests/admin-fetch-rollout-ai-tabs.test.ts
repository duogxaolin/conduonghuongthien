/**
 * Wave 3 D-FETCH, batch F: the AI panel (`/admin/ai`) — `components/admin/ai/AiServicesTab.vue`
 * (3 `$fetch` casts) and the other tabs below — call `adminFetch<T>()` with response types from
 * app/types/admin-ai-api.ts (derived from the handlers).
 *
 * The REAL components are mounted over REAL ofetch on a fake network. Pinned, green before
 * and after the conversion: the requests and their bodies, what renders, the server's sentence
 * (never ofetch's `[GET] "…"` line) on every failure.
 *
 * FINDING, RED on the base (551651c7) — AiServicesTab "Kiểm tra kết nối": the test call is a
 * real AI request (seconds). Start it on service A, close the dialog, open service B: A's
 * answer landed under B's title ("Thành công (model-a …)"), and B's own button stayed
 * "Đang test..." until A's answer came back. One ticket per test call now; opening a service
 * starts from a clean slate.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import { fire, findAll, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, OpenModal, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined
const MODAL = { '~/components/admin/AdminModal.vue': { default: OpenModal } }
const button = (from: MountedAdminPage | MiniElement, label: string): MiniElement => {
  const root = 'page' in from ? from.page.root : from
  const found = findAll(root, el => el.tag === 'button' && textOf(el) === label)
  assert.equal(found.length, 1, `one "${label}" button, found ${found.length}`)
  return found[0]!
}

// ─── components/admin/ai/AiServicesTab.vue ──────────────────────────────────

const SERVICES_TAB = 'components/admin/ai/AiServicesTab.vue'
const service = (id: number, key: string, name: string, model: string | null) => ({
  id, serviceKey: key, serviceName: name, provider: 'delify', model, systemPrompt: null, defaultSystemPrompt: `Mặc định ${key}`,
  temperature: '0.30', maxTokens: 4096, isActive: true, updatedBy: null, createdAt: null, updatedAt: '2026-10-20T02:00:00.000Z',
})
const SERVICES = [service(1, 'chatbot', 'Chatbot', 'model-a'), service(2, 'moderation', 'Kiểm duyệt', 'model-b')]
const PROVIDERS = [{ provider: 'delify', label: 'Delify', isActive: true }]

function servicesServer(overrides: Record<string, Route> = {}): Responder {
  return routes({
    'GET /api/admin/ai/services': () => json({ ok: true, services: SERVICES }),
    'PUT /api/admin/ai/services/1': () => json({ ok: true }),
    'POST /api/admin/ai/test-call': call => json({
      ok: true, model: (call.body as { model: string }).model, provider: 'delify', reply: 'Tôi là trợ lý.', durationMs: 120,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, costVnd: 3,
    }),
    ...overrides,
  })
}
function openServices(responder = servicesServer()) {
  const invalidated = { count: 0 }
  return mountAdminPage(SERVICES_TAB, responder, {
    modules: MODAL,
    props: { providers: PROVIDERS, pricingRows: [], onInvalidate: () => { invalidated.count++ } },
  }).then(opened => ({ ...opened, invalidated }))
}
const configure = async (opened: MountedAdminPage, name: string) => {
  const row = findAll(opened.page.root, el => el.tag === 'tr' && textOf(el).startsWith(name))[0]!
  await fire(button(row, 'Cấu hình'), 'click')
  await settle()
}
const dialog = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.props.role === 'dialog')[0]
const testButton = (opened: MountedAdminPage) =>
  findAll(dialog(opened)!, el => el.tag === 'button' && /Kiểm tra kết nối|Đang test/.test(textOf(el)))[0]!

describe(SERVICES_TAB, () => {
  it('mount: one GET; a row per service; "Cấu hình" opens the dialog filled from the row', async () => {
    const opened = await openServices()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/ai/services'])
    assert.deepEqual(findAll(opened.page.root, el => el.tag === 'tr').slice(1).map(tr => textOf(findAll(tr, el => el.tag === 'td')[0]!)), ['Chatbot', 'Kiểm duyệt'])
    await configure(opened, 'Kiểm duyệt')
    assert.equal(dialog(opened)!.props['aria-label'], 'Cấu hình: Kiểm duyệt')
    assert.equal(alertText(opened.page), '')
  })

  it('"Lưu cấu hình" PUTs the form, toasts, closes and reloads', async () => {
    const opened = await openServices()
    await configure(opened, 'Chatbot')
    const before = opened.calls.length
    await fire(button(dialog(opened)!, 'Lưu cấu hình'), 'click')
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      { wire: 'PUT /api/admin/ai/services/1', body: { model: 'model-a', systemPrompt: null, provider: 'delify', temperature: '0.30', maxTokens: 4096, isActive: true } },
      'GET /api/admin/ai/services',
    ])
    assert.equal(opened.lastToast('success'), 'Đã lưu cấu hình dịch vụ.')
    assert.equal(dialog(opened), undefined)
  })

  it('a refused save toasts the server\'s sentence; a dropped one the page\'s; never ofetch\'s line', async () => {
    const opened = await openServices(servicesServer({ 'PUT /api/admin/ai/services/1': () => h3Error(400, 'Nhiệt độ không hợp lệ.') }))
    await configure(opened, 'Chatbot')
    await fire(button(dialog(opened)!, 'Lưu cấu hình'), 'click')
    await settle()
    assert.equal(opened.lastToast('error'), 'Nhiệt độ không hợp lệ.')
    const dead = await openServices(servicesServer({ 'PUT /api/admin/ai/services/1': () => dropped() }))
    await configure(dead, 'Chatbot')
    await fire(button(dialog(dead)!, 'Lưu cấu hình'), 'click')
    await settle()
    assert.equal(dead.lastToast('error'), 'Không thể lưu dịch vụ.')
  })

  it('a failed load: the server\'s sentence in role="alert" with "Thử lại"; "Thử lại" asks again', async () => {
    const opened = await openServices(servicesServer({ 'GET /api/admin/ai/services': () => h3Error(403, 'Bạn không có quyền xem AI.') }))
    assert.match(alertText(opened.page), /Bạn không có quyền xem AI\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    const before = opened.calls.length
    await fire(button(opened, 'Thử lại'), 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/ai/services'])
  })

  it('"Kiểm tra kết nối": POSTs the form\'s model and prompt, shows the reply, tells the parent to refresh usage', async () => {
    const opened = await openServices()
    await configure(opened, 'Chatbot')
    const before = opened.calls.length
    await fire(testButton(opened), 'click')
    await settle()
    const [call] = sent(opened.calls, before) as Array<{ wire: string, body: Record<string, unknown> }>
    assert.equal(call!.wire, 'POST /api/admin/ai/test-call')
    assert.deepEqual({ ...call!.body, message: undefined }, { provider: 'delify', model: 'model-a', serviceKey: 'chatbot', systemPrompt: null, message: undefined, temperature: 0.3, maxTokens: 150 })
    assert.match(textOf(dialog(opened)!), /Thành công \(model-a — 120ms\): "Tôi là trợ lý\." \[15 tokens/)
    assert.equal(opened.invalidated.count, 1)
  })

  it('"Kiểm tra kết nối": `ok: false` shows the server\'s error; a refusal its sentence; a dropped call the page\'s', async () => {
    const said = async (route: Route) => {
      const opened = await openServices(servicesServer({ 'POST /api/admin/ai/test-call': route }))
      await configure(opened, 'Chatbot')
      await fire(testButton(opened), 'click')
      await settle()
      return textOf(dialog(opened)!)
    }
    assert.match(await said(() => json({ ok: false, error: 'Chưa cấu hình API key cho nhà cung cấp "Delify".' })), /Thất bại: Chưa cấu hình API key/)
    assert.match(await said(() => h3Error(429, 'Gọi quá nhanh, thử lại sau.')), /Thất bại: Gọi quá nhanh, thử lại sau\./)
    const dead = await said(() => dropped())
    assert.match(dead, /Thất bại: Lỗi kết nối tới API/)
    assert.doesNotMatch(dead, OFETCH_LINE)
  })

  it('FINDING: a test started on service A, dialog closed, service B opened — A\'s answer never shows under B; B can test at once', async () => {
    const pending: NetCall[] = []
    const opened = await openServices(servicesServer({ 'POST /api/admin/ai/test-call': (call) => { pending.push(call); return undefined } }))
    await configure(opened, 'Chatbot')
    void fire(testButton(opened), 'click')
    await settle()
    assert.equal(textOf(testButton(opened)), 'Đang test...')
    await fire(button(dialog(opened)!, 'Huỷ'), 'click')
    await configure(opened, 'Kiểm duyệt')
    assert.equal(textOf(testButton(opened)), 'Kiểm tra kết nối')
    pending[0]!.respond(json({ ok: true, model: 'model-a', provider: 'delify', reply: 'Câu của A.', durationMs: 9000, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, costVnd: 1 }))
    await settle()
    assert.equal(opened.invalidated.count, 1, 'A\'s call still cost money: the parent refreshes usage even for a retired call')
    assert.doesNotMatch(textOf(dialog(opened)!), /Câu của A|model-a/)
    assert.equal(textOf(testButton(opened)), 'Kiểm tra kết nối')
    // B's own test still works and shows B's answer.
    void fire(testButton(opened), 'click')
    await settle()
    pending[1]!.respond(json({ ok: true, model: 'model-b', provider: 'delify', reply: 'Câu của B.', durationMs: 50, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, costVnd: 1 }))
    await settle()
    assert.match(textOf(dialog(opened)!), /Câu của B/)
  })

  it('FINDING: A\'s late answer while B\'s own test is running leaves B "Đang test..." (no second paid call can start)', async () => {
    const pending: NetCall[] = []
    const opened = await openServices(servicesServer({ 'POST /api/admin/ai/test-call': (call) => { pending.push(call); return undefined } }))
    await configure(opened, 'Chatbot')
    void fire(testButton(opened), 'click')
    await settle()
    await fire(button(dialog(opened)!, 'Huỷ'), 'click')
    await configure(opened, 'Kiểm duyệt')
    void fire(testButton(opened), 'click')
    await settle()
    assert.equal(pending.length, 2)
    pending[0]!.respond(json({ ok: true, model: 'model-a', provider: 'delify', reply: 'Câu của A.', durationMs: 9000, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, costVnd: 1 }))
    await settle()
    assert.equal(textOf(testButton(opened)), 'Đang test...', 'B\'s call is still out: A\'s `finally` must not re-enable the button')
    assert.equal(testButton(opened).props.disabled, true)
    pending[1]!.respond(json({ ok: true, model: 'model-b', provider: 'delify', reply: 'Câu của B.', durationMs: 50, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, costVnd: 1 }))
    await settle()
    assert.equal(textOf(testButton(opened)), 'Kiểm tra kết nối')
    assert.match(textOf(dialog(opened)!), /Câu của B/)
  })

  it('a FINISHED result of service A is not shown when service B is opened', async () => {
    const opened = await openServices()
    await configure(opened, 'Chatbot')
    await fire(testButton(opened), 'click')
    await settle()
    assert.match(textOf(dialog(opened)!), /Tôi là trợ lý\./)
    await fire(button(dialog(opened)!, 'Huỷ'), 'click')
    await configure(opened, 'Kiểm duyệt')
    assert.doesNotMatch(textOf(dialog(opened)!), /Tôi là trợ lý|Kiểm tra thành công|Thành công/)
  })

  it('FINDING: a test call that FAILS after the dialog moved to another service shows nothing there either', async () => {
    const pending: NetCall[] = []
    const opened = await openServices(servicesServer({ 'POST /api/admin/ai/test-call': (call) => { pending.push(call); return undefined } }))
    await configure(opened, 'Chatbot')
    void fire(testButton(opened), 'click')
    await settle()
    await fire(button(dialog(opened)!, 'Huỷ'), 'click')
    await configure(opened, 'Kiểm duyệt')
    pending[0]!.respond(h3Error(400, 'Nhà cung cấp A không trả lời.'))
    await settle()
    assert.doesNotMatch(textOf(dialog(opened)!), /Thất bại|Nhà cung cấp A/)
    assert.equal(textOf(testButton(opened)), 'Kiểm tra kết nối')
  })
})

// ─── components/admin/ai/AiModerationTab.vue ────────────────────────────────

describe('components/admin/ai/AiModerationTab.vue', () => {
  const RULES = [{ id: 1, isEnabled: true }, { id: 2, isEnabled: false }, { id: 3, isEnabled: true }]
  const openModeration = (overrides: Record<string, Route> = {}) => mountAdminPage('components/admin/ai/AiModerationTab.vue', routes({
    'GET /api/admin/ai/moderation/queue': () => json({ ok: true, count: 1, total: 4, page: 1, perPage: 1, totalPages: 4, items: [] }),
    'GET /api/admin/ai/moderation/rules': () => json({ ok: true, count: 3, rules: RULES }),
    ...overrides,
  }))

  it('asks for the pending total (one row) and the rules; shows the totals', async () => {
    const opened = await openModeration()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/ai/moderation/queue?status=pending&perPage=1', 'GET /api/admin/ai/moderation/rules'])
    assert.match(textOf(opened.page.root), /4/)
    assert.equal(alertText(opened.page), '')
  })

  it('a failure: the server\'s sentence with "Thử lại"; an answer without a total the summary\'s own sentence', async () => {
    const refused = await openModeration({ 'GET /api/admin/ai/moderation/rules': () => h3Error(403, 'Không có quyền xem quy tắc.') })
    assert.match(alertText(refused.page), /Không có quyền xem quy tắc\./)
    assert.equal(findAll(refused.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại').length, 1)
    const broken = await openModeration({ 'GET /api/admin/ai/moderation/queue': () => json({ ok: true, items: [] }) })
    assert.match(alertText(broken.page), /Phản hồi hàng đối soát thiếu tổng số hợp lệ\./)
  })
})

// ─── components/admin/ai/AiDashboardTab.vue ─────────────────────────────────

describe('components/admin/ai/AiDashboardTab.vue', () => {
  const USAGE = {
    ok: true, usage: { monthlyCostVnd: 12000, totalPromptTokens: 10, totalCompletionTokens: 5, totalRequests: 3, successRate: 100 },
    byService: [{ serviceKey: 'chatbot', costVnd: 12000, promptTokens: 10, completionTokens: 5, requests: 3 }],
    daily: [{ day: '2026-10-20', costVnd: 12000, requests: 3 }], budget: { monthlyBudgetVnd: 0, warningThresholdPct: 80, usagePercent: 0 },
  }
  const openDashboard = (overrides: Record<string, Route> = {}) => mountAdminPage('components/admin/ai/AiDashboardTab.vue', routes({
    'GET /api/admin/ai/usage': () => json(USAGE),
    'GET /api/admin/ai/delify/status': () => json({ ok: false, configured: false, error: 'Chưa tạo nhà cung cấp Delify Router.' }),
    ...overrides,
  }))

  it('mount: usage and the router status for 7 days; a router refusal reads its own `error`', async () => {
    const opened = await openDashboard()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/ai/usage', 'GET /api/admin/ai/delify/status?period=7d'])
    assert.match(textOf(opened.page.root), /Chưa tạo nhà cung cấp Delify Router\./)
  })

  it('a failed usage read: the server\'s sentence in role="alert"; a period button asks with its period', async () => {
    const opened = await openDashboard({ 'GET /api/admin/ai/usage': () => h3Error(403, 'Không có quyền xem chi phí.') })
    assert.match(alertText(opened.page), /Không có quyền xem chi phí\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
  })
})

// ─── components/admin/ai/AiLogsTab.vue ──────────────────────────────────────

describe('components/admin/ai/AiLogsTab.vue', () => {
  const LOGS = '/api/admin/ai/logs'
  const logRow = (id: number, serviceKey: string) => ({
    id, serviceKey, provider: 'delify', model: 'm', promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.001, costVnd: 25,
    executionMs: 10, userId: null, success: true, errorMessage: null, createdAt: '2026-10-20T02:00:00.000Z',
  })
  const answer = (rows: unknown[]) => json({ ok: true, logs: rows, pagination: { page: 1, perPage: 20, total: rows.length, totalPages: 1 } })
  const openLogs = (route: Route) => mountAdminPage('components/admin/ai/AiLogsTab.vue', routes({ [`GET ${LOGS}`]: route }), { props: { providers: PROVIDERS } })
  const services = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'tbody')
    .flatMap(body => findAll(body, el => el.tag === 'tr')).map(tr => textOf(findAll(tr, el => el.tag === 'td')[1] ?? []))
  async function filterBy(opened: MountedAdminPage, serviceKey: string) {
    await fire(findAll(opened.page.root, el => el.tag === 'select')[0]!, 'update:modelValue', serviceKey)
    void fire(button(opened, 'Lọc'), 'click')
    await settle()
  }

  it('mount asks page 1; "Lọc" asks with the filter; a failure shows the server\'s sentence', async () => {
    const opened = await openLogs(call => answer([logRow(1, call.url.searchParams.get('serviceKey') ?? 'chatbot')]))
    assert.deepEqual(opened.calls.map(wire), [`GET ${LOGS}?page=1&perPage=20`])
    await filterBy(opened, 'moderation')
    assert.equal(wire(opened.calls.at(-1)!), `GET ${LOGS}?page=1&perPage=20&serviceKey=moderation`)
    const refused = await openLogs(() => h3Error(403, 'Không có quyền xem nhật ký.'))
    assert.match(alertText(refused.page), /Không có quyền xem nhật ký\./)
  })

  it('FINDING: the older filter\'s answer landing last does not replace the newer one\'s rows (nor its failure, nor its end)', async () => {
    const pending: NetCall[] = []
    let first = true
    // The mount's own rows (small talk): shown again if an older request ended the loading state early.
    const opened = await openLogs((call) => { if (first) { first = false; return answer([logRow(9, 'small_talk')]) } pending.push(call); return undefined })
    await filterBy(opened, 'chatbot')
    await filterBy(opened, 'moderation')
    pending[0]!.respond(answer([logRow(1, 'chatbot')]))
    await settle()
    assert.deepEqual(services(opened), [], 'the newer filter is still loading')
    pending[1]!.respond(answer([logRow(2, 'moderation')]))
    await settle()
    const shown = services(opened)
    assert.equal(shown.length, 1)
    assert.doesNotMatch(shown[0]!, /chatbot|Chatbot/)
    await filterBy(opened, 'chatbot')
    await filterBy(opened, 'translation_ui')
    pending[3]!.respond(answer([logRow(4, 'translation_ui')]))
    await settle()
    pending[2]!.respond(h3Error(403, 'Lỗi cũ.'))
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(services(opened).length, 1)
    // The older SUCCESS landing last.
    await filterBy(opened, 'chatbot')
    await filterBy(opened, 'moderation')
    pending[5]!.respond(answer([logRow(6, 'moderation')]))
    await settle()
    pending[4]!.respond(answer([logRow(5, 'chatbot'), logRow(7, 'chatbot')]))
    await settle()
    assert.equal(services(opened).length, 1, 'the older filter\'s two rows did not replace the newer one\'s')
  })
})

// ─── pages/admin/ai/index.vue — the parent's fallback read of providers + pricing ───

describe('pages/admin/ai/index.vue', () => {
  it('opening "Prompt dịch vụ" without the providers tab reads providers and pricing and hands them down', async () => {
    const opened = await mountAdminPage('pages/admin/ai/index.vue', routes({
      'GET /api/admin/ai/providers': () => json({ ok: true, providers: PROVIDERS }),
      'GET /api/admin/ai/pricing': () => json({ ok: true, pricing: [{ id: 1, provider: 'delify', model: 'm', isActive: true }] }),
    }), {
      auto: { watchEffect: Vue.watchEffect },
      modules: Object.fromEntries(['AiDashboardTab', 'AiProvidersTab', 'AiServicesTab', 'AiModerationTab', 'AiLogsTab']
        .map(name => [`~/components/admin/ai/${name}.vue`, { default: Vue.defineComponent({ name, inheritAttrs: false, props: ['providers', 'pricingRows'], setup: (props: Record<string, unknown>) => () => Vue.h('div', { 'data-tab': name, 'data-providers': JSON.stringify(props.providers), 'data-pricing': JSON.stringify(props.pricingRows) }) }) }])),
    })
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el).includes('Prompt dịch vụ'))[0]!, 'click')
    await settle()
    assert.deepEqual(opened.calls.map(wire), ['GET /api/admin/ai/providers', 'GET /api/admin/ai/pricing'])
    const tab = findAll(opened.page.root, el => el.props['data-tab'] === 'AiServicesTab')[0]!
    assert.deepEqual(JSON.parse(String(tab.props['data-providers'])), PROVIDERS)
    assert.equal(JSON.parse(String(tab.props['data-pricing'])).length, 1)
  })
})
