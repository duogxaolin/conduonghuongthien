/**
 * The "Nhà cung cấp & Models" tab of `/admin/ai` (`app/components/admin/ai/AiProvidersTab.vue`),
 * driven through its own buttons, fields and checkboxes — written BEFORE the wave3 4.2 split
 * and run on both versions (`AI_PROVIDERS_TAB_FILE=<original>`). The harness
 * (tests/_ai-providers-tab-harness.ts) mounts the real tab, its parts and composables over
 * real ofetch on a fake network that answers like `server/api/admin/ai/**`.
 *
 * tests/admin-fetch-rollout.test.ts already pins every action at the function level (same
 * requests, server sentences); this suite pins what the officer SEES and what each control
 * sends, so every seam the split introduces (props, emits, `defineModel`) is crossed.
 *
 * Every test here is green on the original and on the split. The four bugs found while
 * writing it (red on the original) live in tests/admin-ai-providers-tab-findings.test.ts.
 *
 * A request the test holds (`HOLD`) keeps the handler that sent it waiting, so a click that
 * sends one is not awaited until the request is answered (`const pending = click(…)`).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HOLD, OFETCH_LINE, STORED_KEY, aiServer, alerts, button, buttonsWith, card, cards, cellsOf, checkboxes, dialog, dialogs,
  dropped, field, findAll, h3Error, json, lastToast, modelOf, openTab, row, sent, skeleton, spaced, tick, wire,
  type NetCall,
} from './_ai-providers-tab-harness.ts'
import { click, fire, input, type MiniElement } from './_sfc-mount.ts'

const RELOAD = ['GET /api/admin/ai/providers', 'GET /api/admin/ai/pricing']
const trash = (c: MiniElement) =>
  findAll(c, el => el.tag === 'button' && findAll(el, i => String(i.props.class).includes('fa-trash')).length > 0)[0]!
const statusLines = (from: MiniElement) => findAll(from, el => el.props.role === 'status').map(spaced)
const closeX = (d: MiniElement) => findAll(d, el => el.props['aria-label'] === 'Đóng')[0]!

describe('loading the providers and their models', () => {
  it('shows the placeholder while both lists load, then one card per provider with its models', async (t) => {
    const server = aiServer()
    const held: NetCall[] = []
    server.state.override = (call) => { held.push(call); return HOLD }
    const { page, calls, settle } = await openTab(t, server)
    assert.deepEqual(calls.map(wire), RELOAD)
    const placeholder = skeleton(page)
    assert.ok(placeholder, 'role="status" aria-busy="true" while loading')
    assert.equal(spaced(placeholder!), 'Đang tải danh sách nhà cung cấp')
    assert.equal(cards(page).length, 0)

    server.state.override = () => undefined
    for (const call of held) server.answer(call)
    await settle()
    assert.equal(skeleton(page), null)
    assert.deepEqual(alerts(page), [])
    assert.deepEqual(cards(page).map(c => spaced(findAll(c, h => h.tag === 'h2')[0]!)), ['Delify Router', 'OpenAI'])

    const delify = spaced(card(page, 'Delify Router'))
    assert.match(delify, /^Delify Router \(delify\) Hoạt động Base URL: https:\/\/router\.delify\.vn\/v1 • API Key: ••••a1b2 Test kết nối Cài đặt /)
    assert.match(delify, /Danh sách Models của Delify Router \(2 models, 1 đang bật\) ⚡ Tải model & giá từ Delify API Thêm Model /)
    const openai = spaced(card(page, 'OpenAI'))
    assert.match(openai, /^OpenAI \(openai\) Tắt Base URL: Chưa cấu hình • API Key: Chưa nhập /)
    assert.match(openai, /\(0 models, 0 đang bật\) Thêm Model Chưa có model nào cho nhà cung cấp này\. Bấm "Thêm Model" để cấu hình model đầu tiên\.$/)
  })

  it('prints each model with its prices and the estimated cost of one call; an inactive model is dimmed', async (t) => {
    const { page } = await openTab(t)
    assert.deepEqual(cellsOf(row(page, 'org/flash')), ['', '', 'org/flash', '—', '$1', '$4', '77 ₫', 'Test Sửa giá Xoá'])
    assert.deepEqual(cellsOf(row(page, 'glm-5.3')), ['', '', 'glm-5.3', 'GLM 5.3', '$0.6', '$2.2', '43 ₫', 'Test Sửa giá Xoá'])
    assert.match(String(row(page, 'glm-5.3').props.class), /opacity-50/)
    assert.doesNotMatch(String(row(page, 'org/flash').props.class), /opacity-50/)
  })

  it('the API key never reaches the screen: the card shows the last four characters the server sends', async (t) => {
    const { page } = await openTab(t)
    assert.ok(!page.html().includes(STORED_KEY))
    assert.ok(!page.html().includes(STORED_KEY.slice(0, -4)))
  })

  it('a failed load shows the server\'s sentence in role="alert", and "Thử lại" re-runs exactly the two list requests', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/pricing') ? h3Error(400, 'Bảng giá model đang được cập nhật, thử lại sau.') : undefined)
    const { page, calls, settle } = await openTab(t, server)
    assert.deepEqual(alerts(page), ['Lỗi: Bảng giá model đang được cập nhật, thử lại sau. Thử lại'])
    assert.equal(cards(page).length, 0)
    assert.equal(buttonsWith(page, 'Thêm nhà cung cấp').length, 0, 'no action bar over a list that did not load')

    server.state.override = () => undefined
    await click(button(page, 'Thử lại'))
    await settle()
    assert.deepEqual(sent(calls, 2), RELOAD)
    assert.deepEqual(alerts(page), [])
    assert.equal(cards(page).length, 2)
  })

  it('a dropped connection shows the tab\'s own sentence, never ofetch\'s line', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/providers') ? dropped() : undefined)
    const { page } = await openTab(t, server)
    assert.deepEqual(alerts(page), ['Lỗi: Không thể tải danh sách nhà cung cấp. Thử lại'])
    assert.doesNotMatch(page.html(), OFETCH_LINE)
  })

  it('no provider at all: the action bar and nothing else (no empty-state sentence today)', async (t) => {
    const server = aiServer()
    server.state.providers = []
    server.state.models = []
    const { page } = await openTab(t, server)
    assert.equal(cards(page).length, 0)
    assert.deepEqual(alerts(page), [])
    assert.equal(spaced(page), 'Quản lý API Key, kết nối và cấu hình từng model được phép dùng cho mỗi Nhà cung cấp. Thêm nhà cung cấp')
  })

  it('exposes loadProviders/providers/pricingRows to ai/index.vue, live after a reload', async (t) => {
    const { exposed, server, calls, settle } = await openTab(t)
    assert.deepEqual(exposed.providers.map(p => p.provider), ['delify', 'openai'])
    assert.deepEqual(exposed.pricingRows.map(m => m.model), ['org/flash', 'glm-5.3'])
    server.state.providers.pop()
    await exposed.loadProviders()
    await settle()
    assert.deepEqual(sent(calls, 2), RELOAD)
    assert.deepEqual(exposed.providers.map(p => p.provider), ['delify'])
  })
})

describe('adding a provider', () => {
  it('opens on the Delify preset; picking a preset fills label and Base URL; the key field is a password field', async (t) => {
    const { page, settle } = await openTab(t)
    await click(button(page, 'Thêm nhà cung cấp'))
    await settle()
    const d = dialog(page, 'Thêm nhà cung cấp mới')
    assert.equal(modelOf(field(d, 'Loại nhà cung cấp')), 'delify')
    assert.equal(modelOf(field(d, 'Nhãn hiển thị')), 'Delify Router')
    assert.equal(modelOf(field(d, 'Base URL')), 'https://router.delify.vn/v1')
    assert.equal(modelOf(field(d, 'Kích hoạt nhà cung cấp')), true)
    assert.equal(field(d, 'API Key').props.type, 'password')
    assert.match(spaced(d), /glm-5\.3, claude-opus-5, flash — hỗ trợ tự động tải model & giá/)

    const preset = field(d, 'Loại nhà cung cấp')
    await input(preset, 'google')
    await fire(preset, 'change')
    await settle()
    const after = dialog(page, 'Thêm nhà cung cấp mới')
    assert.equal(modelOf(field(after, 'Nhãn hiển thị')), 'Google Gemini')
    assert.equal(modelOf(field(after, 'Base URL')), 'https://generativelanguage.googleapis.com/v1beta/openai')
    assert.match(spaced(after), /Gemini 1\.5 Flash \/ Pro/)
  })

  it('an empty label is refused in the dialog without a request; a valid one is sent while the dialog is busy, then the list reloads', async (t) => {
    const server = aiServer()
    const { page, calls, toasts, settle } = await openTab(t, server)
    await click(button(page, 'Thêm nhà cung cấp'))
    await settle()
    await input(field(dialog(page), 'Nhãn hiển thị'), '   ')
    await settle()
    await click(button(dialog(page), 'Thêm'))
    await settle()
    assert.deepEqual(alerts(dialog(page)), ['Nhãn hiển thị là bắt buộc.'])
    assert.equal(calls.length, 2)

    let d = dialog(page)
    await input(field(d, 'Loại nhà cung cấp'), 'deepseek')
    await input(field(d, 'Nhãn hiển thị'), 'DeepSeek chính')
    await input(field(d, 'Base URL'), 'https://api.deepseek.com/v1')
    await input(field(d, 'API Key'), 'sk-fake-typed-0000-c3d4')
    await settle()
    server.state.override = call => (call.method === 'POST' ? HOLD : undefined)
    const pending = click(button(dialog(page), 'Thêm'))
    await settle()
    d = dialog(page)
    assert.equal(d.props['aria-busy'], 'true')
    assert.equal(button(d, 'Đang thêm...').props.disabled, true)
    assert.throws(() => click(closeX(d)), /disabled/, 'a busy dialog cannot be closed')

    server.state.override = () => undefined
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.deepEqual(sent(calls, 2), [{
      wire: 'POST /api/admin/ai/providers',
      body: { provider: 'deepseek', label: 'DeepSeek chính', baseUrl: 'https://api.deepseek.com/v1', isActive: true, apiKey: 'sk-fake-typed-0000-c3d4' },
    }, ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã thêm nhà cung cấp mới.')
    assert.equal(dialogs(page).length, 0)
    assert.match(spaced(card(page, 'DeepSeek chính')), /API Key: ••••c3d4/)
    assert.ok(!page.html().includes('sk-fake-typed-0000-c3d4'))
  })

  it('a refusal is shown in the dialog with the server\'s sentence; reopening starts from a clean form', async (t) => {
    const { page, settle } = await openTab(t)
    await click(button(page, 'Thêm nhà cung cấp'))
    await settle()
    await click(button(dialog(page), 'Thêm'))
    await settle()
    assert.deepEqual(alerts(dialog(page)), ['Nhà cung cấp "delify" đã tồn tại.'])
    await input(field(dialog(page), 'Nhãn hiển thị'), 'Sửa dở')
    await click(button(dialog(page), 'Huỷ'))
    await settle()
    assert.equal(dialogs(page).length, 0)
    await click(button(page, 'Thêm nhà cung cấp'))
    await settle()
    assert.deepEqual(alerts(dialog(page)), [])
    assert.equal(modelOf(field(dialog(page), 'Nhãn hiển thị')), 'Delify Router')
  })
})

describe('provider settings', () => {
  it('opens with the saved values, never the key; saving sends the form and reloads', async (t) => {
    const { page, calls, toasts, settle } = await openTab(t)
    await click(button(card(page, 'Delify Router'), 'Cài đặt'))
    await settle()
    const d = dialog(page, 'Cài đặt kết nối: Delify Router')
    assert.equal(modelOf(field(d, 'Nhãn hiển thị')), 'Delify Router')
    assert.equal(modelOf(field(d, 'Base URL')), 'https://router.delify.vn/v1')
    assert.equal(modelOf(field(d, 'Kích hoạt nhà cung cấp')), true)
    const key = field(d, 'API Key mới')
    assert.equal(key.props.type, 'password')
    assert.equal(modelOf(key), '')
    assert.equal(key.props.placeholder, '••••a1b2 (đã lưu)')
    assert.match(spaced(d), /Đổi Base URL thì phải nhập lại API key bên dưới\./)

    await input(field(d, 'Nhãn hiển thị'), 'Delify chính')
    await input(field(d, 'Kích hoạt nhà cung cấp'), false)
    await click(button(d, 'Lưu'))
    await settle()
    assert.deepEqual(sent(calls, 2), [{
      wire: 'PUT /api/admin/ai/providers/1',
      body: { label: 'Delify chính', baseUrl: 'https://router.delify.vn/v1', isActive: false, apiKey: null },
    }, ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã lưu cấu hình nhà cung cấp.')
    assert.equal(dialogs(page).length, 0)
    assert.match(spaced(card(page, 'Delify chính')), /\(delify\) Tắt/)
  })

  it('changing the Base URL without a new key is refused with the server\'s sentence; the dialog and the form stay; with a key it saves', async (t) => {
    const { page, calls, toasts, settle } = await openTab(t)
    await click(button(card(page, 'Delify Router'), 'Cài đặt'))
    await settle()
    await input(field(dialog(page), 'Base URL'), 'https://router2.delify.vn/v1')
    await click(button(dialog(page), 'Lưu'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Đổi địa chỉ nhà cung cấp (Base URL) phải nhập lại API key trong cùng lần lưu.')
    const d = dialog(page, 'Cài đặt kết nối: Delify Router')
    assert.equal(modelOf(field(d, 'Base URL')), 'https://router2.delify.vn/v1')
    assert.equal(calls.length, 3, 'no reload after a refusal')

    const typed = 'sk-fake-new-0000-z9y8'
    await input(field(d, 'API Key mới'), typed)
    await settle()
    // The typed key lives in the password field's value only — no text, no other attribute.
    const holders = findAll(page.root, el => JSON.stringify(el.props).includes(typed) || JSON.stringify(el.model ?? null).includes(typed))
    assert.deepEqual(holders.map(el => [el.tag, el.props.type]), [['input', 'password']])
    assert.ok(!spaced(page).includes(typed))

    await click(button(dialog(page), 'Lưu'))
    await settle()
    assert.deepEqual(sent(calls, 3), [{
      wire: 'PUT /api/admin/ai/providers/1',
      body: { label: 'Delify Router', baseUrl: 'https://router2.delify.vn/v1', isActive: true, apiKey: typed },
    }, ...RELOAD])
    assert.equal(dialogs(page).length, 0)
    assert.match(spaced(card(page, 'Delify Router')), /Base URL: https:\/\/router2\.delify\.vn\/v1 • API Key: ••••z9y8/)
    assert.ok(!page.html().includes(typed))
  })

  it('clearing the Base URL sends null, which the server reads as "unchanged" (pinned as found — see open items)', async (t) => {
    const { page, calls, toasts, settle } = await openTab(t)
    await click(button(card(page, 'Delify Router'), 'Cài đặt'))
    await settle()
    await input(field(dialog(page), 'Base URL'), '')
    await click(button(dialog(page), 'Lưu'))
    await settle()
    assert.equal((sent(calls, 2)[0] as { body: { baseUrl: unknown } }).body.baseUrl, null)
    assert.equal(lastToast(toasts, 'success'), 'Đã lưu cấu hình nhà cung cấp.')
    assert.match(spaced(card(page, 'Delify Router')), /Base URL: https:\/\/router\.delify\.vn\/v1/)
  })

  it('while saving: busy dialog, close refused, "Đang lưu..." locked', async (t) => {
    const server = aiServer()
    const { page, calls, settle } = await openTab(t, server)
    await click(button(card(page, 'OpenAI'), 'Cài đặt'))
    await settle()
    assert.equal(field(dialog(page), 'API Key mới').props.placeholder, 'Nhập API key')
    server.state.override = call => (call.method === 'PUT' ? HOLD : undefined)
    const pending = click(button(dialog(page), 'Lưu'))
    await settle()
    const d = dialog(page)
    assert.equal(d.props['aria-busy'], 'true')
    assert.equal(button(d, 'Đang lưu...').props.disabled, true)
    assert.throws(() => click(closeX(d)), /disabled/)
    server.state.override = () => undefined
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.equal(dialogs(page).length, 0)
  })

  it('"Kiểm tra kết nối" in the dialog probes the saved provider and shows the answer there', async (t) => {
    const server = aiServer()
    server.state.probe = { ok: false, error: 'Chưa cấu hình base URL.' }
    const { page, calls, settle } = await openTab(t, server)
    await click(button(card(page, 'OpenAI'), 'Cài đặt'))
    await settle()
    server.state.override = call => (call.url.pathname.endsWith('/test') ? HOLD : undefined)
    const pending = click(button(dialog(page), 'Kiểm tra kết nối'))
    await settle()
    assert.equal(button(dialog(page), 'Đang kiểm tra...').props.disabled, true)
    server.state.override = () => undefined
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.deepEqual(sent(calls, 2), ['POST /api/admin/ai/providers/2/test'])
    assert.deepEqual(statusLines(dialog(page)), ['Thất bại: Chưa cấu hình base URL.'])
  })
})

describe('"Test kết nối" on a card', () => {
  it('probes that provider and locks its button meanwhile; opening the settings afterwards starts without an old result', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/test') ? HOLD : undefined)
    const { page, calls, settle } = await openTab(t, server)
    const pending = click(button(card(page, 'OpenAI'), 'Test kết nối'))
    await settle()
    assert.deepEqual(sent(calls, 2), ['POST /api/admin/ai/providers/2/test'])
    assert.equal(button(card(page, 'OpenAI'), 'Đang test...').props.disabled, true)
    assert.equal(button(card(page, 'Delify Router'), 'Test kết nối').props.disabled, false)
    server.state.override = () => undefined
    calls.at(-1)!.respond(h3Error(403, 'Forbidden: Insufficient permissions'))
    await pending
    await settle()
    assert.equal(button(card(page, 'OpenAI'), 'Test kết nối').props.disabled, false)
    await click(button(card(page, 'OpenAI'), 'Cài đặt'))
    await settle()
    assert.deepEqual(statusLines(dialog(page)), [])
  })
})

describe('deleting providers', () => {
  it('asks first; declined sends nothing; confirmed deletes, locks the button meanwhile and reloads', async (t) => {
    const server = aiServer()
    const { page, calls, confirms, answers, toasts, settle } = await openTab(t, server)
    answers.confirm = false
    await click(trash(card(page, 'OpenAI')))
    await settle()
    assert.deepEqual(confirms, [{ title: 'Xoá nhà cung cấp', message: 'Xoá "OpenAI"? Dịch vụ đang dùng nhà cung cấp này sẽ cần gán lại.', danger: true, confirmLabel: 'Xoá' }])
    assert.equal(calls.length, 2)

    answers.confirm = true
    server.state.override = call => (call.method === 'DELETE' ? HOLD : undefined)
    const pending = click(trash(card(page, 'OpenAI')))
    await settle()
    assert.equal(trash(card(page, 'OpenAI')).props.disabled, true)
    assert.equal(trash(card(page, 'Delify Router')).props.disabled, false)
    server.state.override = () => undefined
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.deepEqual(sent(calls, 2), ['DELETE /api/admin/ai/providers/2', ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã xoá nhà cung cấp.')
    assert.equal(cards(page).length, 1)
  })

  it('a refusal (provider in use) reads the server\'s sentence in a toast and keeps the card', async (t) => {
    const server = aiServer()
    server.state.linked.delify = 'chatbot'
    const { page, toasts, settle } = await openTab(t, server)
    await click(trash(card(page, 'Delify Router')))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Không thể xoá: nhà cung cấp "delify" đang được dùng bởi dịch vụ "chatbot". Gán dịch vụ sang nhà cung cấp khác trước khi xoá.')
    assert.equal(cards(page).length, 2)
  })

  it('ticked providers get an action bar: "Bỏ chọn" clears it, the delete asks, sends the ids and reloads', async (t) => {
    const server = aiServer()
    const { page, calls, confirms, toasts, settle } = await openTab(t, server)
    await tick(checkboxes(card(page, 'Delify Router'))[0]!)
    await settle()
    assert.match(spaced(page), /Đã chọn 1 nhà cung cấp Bỏ chọn Xoá 1 nhà cung cấp đã chọn/)
    await click(button(page, 'Bỏ chọn'))
    await settle()
    assert.doesNotMatch(spaced(page), /Đã chọn \d+ nhà cung cấp/)

    await tick(checkboxes(card(page, 'Delify Router'))[0]!)
    await tick(checkboxes(card(page, 'OpenAI'))[0]!)
    await settle()
    assert.equal(checkboxes(card(page, 'OpenAI'))[0]!.props.checked, true)
    server.state.override = call => (call.url.pathname.endsWith('/bulk-delete') ? HOLD : undefined)
    const pending = click(button(page, 'Xoá 2 nhà cung cấp đã chọn'))
    await settle()
    assert.deepEqual(confirms.at(-1), { title: 'Xoá nhiều nhà cung cấp', message: 'Bạn có chắc muốn xoá 2 nhà cung cấp đã chọn? Tất cả model thuộc các nhà cung cấp này cũng sẽ bị xoá.', danger: true, confirmLabel: 'Xoá 2 NCC' })
    assert.equal(button(page, 'Đang xoá...').props.disabled, true)
    server.state.override = () => undefined
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.deepEqual(sent(calls, 2), [{ wire: 'POST /api/admin/ai/providers/bulk-delete', body: { ids: [1, 2] } }, ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã xoá 2 nhà cung cấp.')
    assert.equal(cards(page).length, 0)
    assert.doesNotMatch(spaced(page), /Đã chọn/)
  })
})

describe('models of a provider', () => {
  it('the switch flips at once and sends the new state; a refusal flips it back with the server\'s sentence', async (t) => {
    const server = aiServer()
    const { page, calls, toasts, settle } = await openTab(t, server)
    const sw = () => findAll(row(page, 'org/flash'), el => el.tag === 'button' && String(el.props.title).startsWith('Bấm để'))[0]!
    assert.equal(sw().props.title, 'Bấm để tắt model này')
    await click(sw())
    await settle()
    assert.deepEqual(sent(calls, 2), [{ wire: 'PUT /api/admin/ai/pricing/org%2Fflash', body: { isActive: false } }])
    assert.equal(sw().props.title, 'Bấm để bật model này')
    assert.equal(lastToast(toasts, 'success'), 'org/flash: Đã tắt')

    server.state.override = call => (call.method === 'PUT' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    await click(sw())
    await settle()
    assert.equal(sw().props.title, 'Bấm để bật model này', 'reverted')
    assert.equal(lastToast(toasts, 'error'), 'Forbidden: Insufficient permissions')
  })

  it('"Thêm Model" adds to that provider: empty id refused in the dialog, then sent trimmed and the list reloads', async (t) => {
    const { page, calls, toasts, settle } = await openTab(t)
    await click(button(card(page, 'OpenAI'), 'Thêm Model'))
    await settle()
    let d = dialog(page, 'Thêm Model cho openai')
    assert.equal(modelOf(field(d, 'Giá Input ($ / 1M)')), 1)
    assert.equal(modelOf(field(d, 'Giá Output ($ / 1M)')), 4)
    assert.equal(modelOf(field(d, 'Kích hoạt model (cho phép các dịch vụ sử dụng)')), true)
    await click(button(d, 'Thêm Model'))
    await settle()
    assert.deepEqual(alerts(dialog(page)), ['Mã model là bắt buộc (ví dụ: glm-5.3, flash).'])
    assert.equal(calls.length, 2)

    d = dialog(page)
    await input(field(d, 'Mã Model (ID gọi API)'), ' gpt-4o ')
    await input(field(d, 'Giá Output ($ / 1M)'), 10)
    await click(button(d, 'Thêm Model'))
    await settle()
    assert.deepEqual(sent(calls, 2), [{
      wire: 'POST /api/admin/ai/pricing',
      body: { model: 'gpt-4o', provider: 'openai', label: null, isActive: true, promptCostPerMillion: 1, completionCostPerMillion: 10 },
    }, ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã thêm model " gpt-4o " cho openai.')
    assert.equal(dialogs(page).length, 0)
    assert.ok(row(card(page, 'OpenAI'), 'gpt-4o'))
  })

  it('"Thêm Model" refused by the server shows the sentence in the dialog', async (t) => {
    const { page, settle } = await openTab(t)
    await click(button(card(page, 'Delify Router'), 'Thêm Model'))
    await settle()
    await input(field(dialog(page), 'Mã Model (ID gọi API)'), 'org/flash')
    await click(button(dialog(page), 'Thêm Model'))
    await settle()
    assert.deepEqual(alerts(dialog(page)), ['Model "org/flash" đã tồn tại trong bảng giá.'])
  })

  it('"Sửa giá" opens with the saved values and saves to the encoded path', async (t) => {
    const { page, calls, toasts, settle } = await openTab(t)
    await click(button(row(page, 'org/flash'), 'Sửa giá'))
    await settle()
    const d = dialog(page, 'Sửa Model: org/flash')
    assert.match(spaced(d), /Nhà cung cấp: delify/)
    assert.equal(modelOf(field(d, 'Tên hiển thị')), '')
    assert.equal(modelOf(field(d, 'Kích hoạt model này')), true)
    await input(field(d, 'Tên hiển thị'), ' Flash nhanh ')
    await input(field(d, 'Giá Input ($ / 1M)'), 1.5)
    await click(button(d, 'Lưu'))
    await settle()
    assert.deepEqual(sent(calls, 2), [{
      wire: 'PUT /api/admin/ai/pricing/org%2Fflash',
      body: { label: 'Flash nhanh', promptCostPerMillion: 1.5, completionCostPerMillion: 4, isActive: true },
    }, ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã lưu cấu hình model "org/flash".')
    assert.equal(dialogs(page).length, 0)
    assert.deepEqual(cellsOf(row(page, 'org/flash')).slice(2, 7), ['org/flash', 'Flash nhanh', '$1.5', '$4', '89 ₫'])
  })

  it('every dialog closes from its ✕ (the dialog frame\'s close event) and from "Huỷ"/"Đóng", sending nothing', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/test-call') ? json({ ok: false, error: 'Hết hạn mức.' }) : undefined)
    const { page, calls, settle } = await openTab(t, server)
    const openers: Array<[string, () => MiniElement, string]> = [
      ['Thêm nhà cung cấp mới', () => button(page, 'Thêm nhà cung cấp'), 'Huỷ'],
      ['Cài đặt kết nối: Delify Router', () => button(card(page, 'Delify Router'), 'Cài đặt'), 'Huỷ'],
      ['Thêm Model cho delify', () => button(card(page, 'Delify Router'), 'Thêm Model'), 'Huỷ'],
      ['Sửa Model: org/flash', () => button(row(page, 'org/flash'), 'Sửa giá'), 'Huỷ'],
      ['Test Call: org/flash', () => button(row(page, 'org/flash'), 'Test'), 'Đóng'],
    ]
    for (const [title, opener, cancel] of openers) {
      for (const close of [(d: MiniElement) => closeX(d), (d: MiniElement) => button(d, cancel)]) {
        await click(opener())
        await settle()
        const from = calls.length
        await click(close(dialog(page, title)))
        await settle()
        assert.equal(dialogs(page).length, 0, `${title} stays open`)
        assert.equal(calls.length, from, `${title}: closing sends nothing`)
      }
    }
  })

  it('the dialogs live inside the loaded list: none is drawn while the list reloads, an open one is back after', async (t) => {
    const server = aiServer()
    const { page, calls, exposed, settle } = await openTab(t, server)
    await click(button(row(page, 'org/flash'), 'Sửa giá'))
    await settle()
    assert.equal(dialogs(page).length, 1)
    server.state.override = call => (call.method === 'GET' ? HOLD : undefined)
    const pending = exposed.loadProviders()
    await settle()
    assert.ok(skeleton(page))
    assert.equal(dialogs(page).length, 0)
    server.state.override = () => undefined
    for (const call of calls.slice(-2)) server.answer(call)
    await pending
    await settle()
    assert.equal(skeleton(page), null)
    assert.deepEqual(dialogs(page).map(d => d.props['aria-label']), ['Sửa Model: org/flash'])
  })

  it('"Xoá" on a row asks, then deletes the encoded path and reloads', async (t) => {
    const { page, calls, confirms, toasts, settle } = await openTab(t)
    await click(button(row(page, 'org/flash'), 'Xoá'))
    await settle()
    assert.deepEqual(confirms, [{ title: 'Xoá Model', message: 'Xoá model "org/flash" khỏi delify?', danger: true, confirmLabel: 'Xoá' }])
    assert.deepEqual(sent(calls, 2), ['DELETE /api/admin/ai/pricing/org%2Fflash', ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã xoá model "org/flash".')
  })

  it('ticked models get a bar per provider; the header box ticks all of them; the delete asks and reloads', async (t) => {
    const { page, calls, confirms, toasts, settle } = await openTab(t)
    const head = () => checkboxes(card(page, 'Delify Router')).find(el => el.props.title === 'Chọn tất cả model của nhà cung cấp này')!
    await tick(head())
    await settle()
    assert.equal(head().props.checked, true)
    assert.match(spaced(card(page, 'Delify Router')), /Đã chọn 2 model của Delify Router Bỏ chọn Xoá 2 model đã chọn/)
    await click(button(card(page, 'Delify Router'), 'Bỏ chọn'))
    await settle()
    assert.equal(head().props.checked, false)

    await tick(head())
    await settle()
    await click(button(card(page, 'Delify Router'), 'Xoá 2 model đã chọn'))
    await settle()
    assert.deepEqual(confirms.at(-1), { title: 'Xoá nhiều Model', message: 'Bạn có chắc muốn xoá 2 model đã chọn?', danger: true, confirmLabel: 'Xoá 2 model' })
    assert.deepEqual(sent(calls, 2), [{ wire: 'POST /api/admin/ai/pricing/bulk-delete', body: { models: ['org/flash', 'glm-5.3'] } }, ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã xoá 2 model.')
    assert.match(spaced(card(page, 'Delify Router')), /Bấm nút "⚡ Tải model & giá từ Delify API" ở trên để nạp tự động toàn bộ model của Delify!/)
  })
})

describe('calling a model, syncing Delify', () => {
  it('"Test" locks while the call runs, then the result dialog shows time, tokens, cost and the reply; the parent is told', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/test-call') ? HOLD : undefined)
    const { page, calls, invalidates, settle } = await openTab(t, server)
    const pending = click(button(row(page, 'org/flash'), 'Test'))
    await settle()
    assert.equal(button(row(page, 'org/flash'), 'Đang gọi...').props.disabled, true)
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.deepEqual(sent(calls, 2), [{
      wire: 'POST /api/admin/ai/test-call',
      body: { provider: 'delify', model: 'org/flash', serviceKey: 'test_call', message: 'Xin chào! Hãy phản hồi ngắn gọn 1 câu để kiểm tra kết nối.', maxTokens: 100 },
    }])
    const d = dialog(page, 'Test Call: org/flash')
    assert.equal(d.props['data-icon'], 'fa-solid fa-bolt')
    assert.equal(d.props['data-size'], 'lg')
    assert.equal(spaced(findAll(d, el => el.props['data-slot'] === 'body')[0]!),
      'Nhà cung cấp: delify Thành công (200 OK) Thời gian 420ms Tokens tiêu thụ 12 (9 in / 3 out) Chi phí ước tính 2 ₫ Phản hồi từ Model: Xin chào, tôi đang hoạt động.')
    assert.equal(invalidates.count, 1)
    await click(button(d, 'Đóng'))
    await settle()
    assert.equal(dialogs(page).length, 0)
  })

  it('a call the provider refused (200 `{ ok: false }`) shows "Thất bại" and the error; a failed request shows the server\'s sentence and tells nobody', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/test-call') ? json({ ok: false, model: 'org/flash', durationMs: 31, error: 'Thất bại khi gọi API: hết hạn mức.' }) : undefined)
    const { page, invalidates, settle } = await openTab(t, server)
    await click(button(row(page, 'org/flash'), 'Test'))
    await settle()
    let d = dialog(page, 'Test Call: org/flash')
    assert.equal(spaced(findAll(d, el => el.props['data-slot'] === 'body')[0]!), 'Nhà cung cấp: delify Thất bại Thất bại khi gọi API: hết hạn mức.')
    assert.equal(invalidates.count, 1)
    await click(button(d, 'Đóng'))
    await settle()

    server.state.override = call => (call.url.pathname.endsWith('/test-call') ? h3Error(401, 'Unauthorized: Session revoked') : undefined)
    await click(button(row(page, 'org/flash'), 'Test'))
    await settle()
    d = dialog(page, 'Test Call: org/flash')
    assert.match(spaced(d), /Thất bại Unauthorized: Session revoked/)
    assert.doesNotMatch(page.html(), OFETCH_LINE)
    assert.equal(invalidates.count, 1)
  })

  it('the Delify card alone offers the sync; it locks, reports the counts, reloads and tells the parent', async (t) => {
    const server = aiServer()
    const { page, calls, toasts, invalidates, settle } = await openTab(t, server)
    assert.equal(buttonsWith(card(page, 'OpenAI'), 'Tải model & giá từ Delify API').length, 0)
    server.state.override = call => (call.url.pathname.endsWith('/sync') ? HOLD : undefined)
    const pending = click(button(card(page, 'Delify Router'), '⚡ Tải model & giá từ Delify API'))
    await settle()
    assert.equal(button(card(page, 'Delify Router'), 'Đang đồng bộ...').props.disabled, true)
    server.state.override = () => undefined
    server.answer(calls.at(-1)!)
    await pending
    await settle()
    assert.deepEqual(sent(calls, 2), ['POST /api/admin/ai/delify/sync', ...RELOAD])
    assert.equal(lastToast(toasts, 'success'), 'Đã đồng bộ 3 model và 2 cuộc gọi từ Delify Router.')
    assert.ok(row(page, 'claude-opus-5'))
    assert.equal(invalidates.count, 1)

    server.state.override = call => (call.url.pathname.endsWith('/sync') ? h3Error(502, 'Delify API trả lỗi HTTP 500.') : undefined)
    await click(button(card(page, 'Delify Router'), '⚡ Tải model & giá từ Delify API'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Delify API trả lỗi HTTP 500.')
    assert.equal(invalidates.count, 1)
  })

  it('a reload that fails after a write replaces the list with the error branch, and "Thử lại" brings it back', async (t) => {
    const server = aiServer()
    const { page, settle } = await openTab(t, server)
    server.state.override = call => (call.method === 'GET' ? h3Error(503, 'Cơ sở dữ liệu tạm thời không phản hồi.') : undefined)
    await click(button(row(page, 'org/flash'), 'Xoá'))
    await settle()
    assert.deepEqual(alerts(page), ['Lỗi: Cơ sở dữ liệu tạm thời không phản hồi. Thử lại'])
    server.state.override = () => undefined
    await click(button(page, 'Thử lại'))
    await settle()
    assert.equal(cards(page).length, 2)
  })
})
