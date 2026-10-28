/**
 * Four bugs of the "Nhà cung cấp & Models" tab (`app/components/admin/ai/AiProvidersTab.vue`)
 * found while writing tests/admin-ai-providers-tab.test.ts before the wave3 4.2 split, and
 * fixed after it. Every test here was RED on the original (`AI_PROVIDERS_TAB_FILE=<original>`,
 * 7/7) and on the pure split; the fixes are described in docs/decisions/refactor-large-files.md.
 * Same harness as the behaviour suite (tests/_ai-providers-tab-harness.ts).
 *
 *   P1 "Test kết nối" on a card: the result never showed on the card (the banner waited for
 *      that provider's settings dialog to be open — only "Cài đặt" sets it), the answer of
 *      one provider's probe landed in the dialog of another provider opened meanwhile, and
 *      the first of two probes in flight ended the second's "Đang test...". Root cause: the
 *      result and the in-flight mark were not tied to the provider they belong to.
 *   P2 a provider or model deleted on its own stayed selected: "Đã chọn 1 nhà cung cấp"
 *      for a row that no longer exists (the bulk delete then answered 404), and a re-added
 *      model came back ticked. Root cause: the selection was never reconciled with the
 *      reloaded lists.
 *   P3 the model action bar of ONE provider deleted the models ticked under EVERY provider,
 *      while its label and its "Bỏ chọn" counted that provider's only.
 *   P4 the first click on a card's "Thu gọn models" did nothing: the panel state starts
 *      unset and is read as open, and the toggle flipped unset (falsy) to OPEN.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HOLD, aiServer, button, card, checkboxes, dialog, field, findAll, openTab, row, sent, spaced, tick,
} from './_ai-providers-tab-harness.ts'
import { click, input, isShown, type MiniElement } from './_sfc-mount.ts'

const statusLines = (from: MiniElement) => findAll(from, el => el.props.role === 'status').map(spaced)
const trash = (c: MiniElement) =>
  findAll(c, el => el.tag === 'button' && findAll(el, i => String(i.props.class).includes('fa-trash')).length > 0)[0]!

describe('FINDING-P1 — "Test kết nối" belongs to the provider it tested', () => {
  it('the result shows on the card that was tested', async (t) => {
    const { page, calls, settle } = await openTab(t)
    await click(button(card(page, 'Delify Router'), 'Test kết nối'))
    await settle()
    assert.deepEqual(sent(calls, 2), ['POST /api/admin/ai/providers/1/test'])
    assert.deepEqual(statusLines(card(page, 'Delify Router')), ['Kết nối thành công (model: glm-5.3)'])
    assert.deepEqual(statusLines(card(page, 'OpenAI')), [])
  })

  it('an answer that arrives after another provider\'s settings opened does not show there', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/test') ? HOLD : undefined)
    const { page, calls, settle } = await openTab(t, server)
    const pending = click(button(card(page, 'Delify Router'), 'Test kết nối'))
    await settle()
    const probe = calls.at(-1)!
    await click(button(card(page, 'OpenAI'), 'Cài đặt'))
    await settle()
    server.answer(probe)
    await pending
    await settle()
    assert.deepEqual(statusLines(dialog(page, 'Cài đặt kết nối: OpenAI')), [])
  })

  it('two probes in flight — the first answer does not end the second\'s "Đang test..."', async (t) => {
    const server = aiServer()
    server.state.override = call => (call.url.pathname.endsWith('/test') ? HOLD : undefined)
    const { page, calls, settle } = await openTab(t, server)
    const first = click(button(card(page, 'Delify Router'), 'Test kết nối'))
    await settle()
    const second = click(button(card(page, 'OpenAI'), 'Test kết nối'))
    await settle()
    const [probe1, probe2] = calls.slice(2)
    server.answer(probe1!)
    await first
    await settle()
    assert.equal(button(card(page, 'OpenAI'), 'Đang test...').props.disabled, true)
    server.answer(probe2!)
    await second
    await settle()
    assert.deepEqual(statusLines(card(page, 'OpenAI')), ['Kết nối thành công (model: glm-5.3)'])
    assert.deepEqual(statusLines(card(page, 'Delify Router')), [], 'the older probe was overtaken')
  })
})

describe('FINDING-P2 — the selection follows the reloaded lists', () => {
  it('a provider deleted on its own does not stay selected', async (t) => {
    const { page, settle } = await openTab(t)
    await tick(checkboxes(card(page, 'OpenAI'))[0]!)
    await settle()
    await click(trash(card(page, 'OpenAI')))
    await settle()
    assert.equal(findAll(page.root, el => el.tag === 'h2').length, 1)
    assert.doesNotMatch(spaced(page), /Đã chọn \d+ nhà cung cấp/)
  })

  it('a model deleted on its own does not come back ticked when re-added', async (t) => {
    const { page, settle } = await openTab(t)
    await tick(checkboxes(row(page, 'glm-5.3'))[0]!)
    await settle()
    await click(button(row(page, 'glm-5.3'), 'Xoá'))
    await settle()
    await click(button(card(page, 'Delify Router'), 'Thêm Model'))
    await settle()
    await input(field(dialog(page), 'Mã Model (ID gọi API)'), 'glm-5.3')
    await click(button(dialog(page), 'Thêm Model'))
    await settle()
    assert.equal(checkboxes(row(page, 'glm-5.3'))[0]!.props.checked, false)
    assert.doesNotMatch(spaced(card(page, 'Delify Router')), /Đã chọn/)
  })
})

describe('FINDING-P3 — a provider\'s model bar acts on that provider only', () => {
  it('deletes only that provider\'s ticked models, and the other provider keeps its selection', async (t) => {
    const server = aiServer()
    server.state.models.push({ model: 'gpt-4o', provider: 'openai', label: null, isActive: true, promptCostPerMillion: 2.5, completionCostPerMillion: 10 })
    const { page, calls, confirms, toasts, settle } = await openTab(t, server)
    await tick(checkboxes(row(page, 'org/flash'))[0]!)
    await tick(checkboxes(row(page, 'gpt-4o'))[0]!)
    await settle()
    await click(button(card(page, 'Delify Router'), 'Xoá 1 model đã chọn'))
    await settle()
    assert.deepEqual(confirms.at(-1), { title: 'Xoá nhiều Model', message: 'Bạn có chắc muốn xoá 1 model đã chọn?', danger: true, confirmLabel: 'Xoá 1 model' })
    assert.deepEqual(sent(calls, 2)[0], { wire: 'POST /api/admin/ai/pricing/bulk-delete', body: { models: ['org/flash'] } })
    assert.equal(toasts.at(-1)?.message, 'Đã xoá 1 model.')
    assert.match(spaced(card(page, 'OpenAI')), /Đã chọn 1 model của OpenAI/)
    assert.doesNotMatch(spaced(card(page, 'Delify Router')), /Đã chọn/)
  })
})

describe('FINDING-P4 — folding a card\'s models', () => {
  it('the first click on "Thu gọn models" folds the panel; the next unfolds it; other cards keep theirs', async (t) => {
    const { page, settle } = await openTab(t)
    const chevron = () => findAll(card(page, 'Delify Router'), el => el.tag === 'button' && String(el.props.title).endsWith('models'))[0]!
    const panel = (label: string) => findAll(card(page, label), el => el.shown !== undefined)[0]!
    assert.equal(isShown(panel('Delify Router')), true)
    assert.equal(chevron().props.title, 'Thu gọn models')
    await click(chevron())
    await settle()
    assert.equal(isShown(panel('Delify Router')), false)
    assert.equal(chevron().props.title, 'Mở rộng models')
    assert.equal(isShown(panel('OpenAI')), true)
    await click(chevron())
    await settle()
    assert.equal(isShown(panel('Delify Router')), true)
  })
})
