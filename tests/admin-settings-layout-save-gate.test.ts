/**
 * R8 (b): the two admin pages that save site-wide settings from a form filled by a GET —
 * `pages/admin/settings/general.vue` ("Lưu Cài Đặt": eleven `settings` keys; "Lưu bố cục":
 * the whole `settings.layout_config` row) and `pages/admin/settings/social-links.vue` ("Lưu
 * kiểu hiển thị": the SAME whole `layout_config` row) — mounted for real (template + script,
 * tests/_admin-page-harness.ts) over real ofetch on a fake network.
 *
 * FINDINGS, RED on the base (a7f312c1) — the menu editor's F-1 (D-FETCH lot F), three more
 * times: each form starts from hard-coded DEFAULTS and each save button was disabled only
 * while saving, so
 *   - R8-1 "Lưu Cài Đặt" sits in the page header, outside the loading/error chain: while the
 *     first GET was in flight, or after it FAILED (the alert on screen), a click PUT the
 *     defaults (site name, hotline 0903.480.985, logo…) over the site's real settings;
 *   - R8-2 "Lưu bố cục": a failed layout GET was swallowed (`catch {}` "chưa cấu hình → giữ
 *     default" — the GET never fails for "not configured", it answers the defaults), the
 *     section showed the defaults with the button enabled → PUT the default layout;
 *   - R8-3 "Lưu kiểu hiển thị" (social links): enabled even WHILE the layout GET was in flight,
 *     and after a failed one — PUT the default layout_config, container width and article
 *     grid included, from a page that only shows the social-button mode.
 * Saving now needs a POSITIVE flag (false until a load filled the form, never reset), enforced
 * twice, each with its own test: the button is disabled, and the save handler returns without
 * a request when a click reaches it anyway (`fire` skips the browser's refusal of a disabled
 * control). A failed layout load is said (`role="alert"` + "Thử lại" re-running that GET).
 * R8-4 (the server half: the GET answered the defaults with `ok: true` when the database read
 * FAILED) is pinned in tests/settings-layout-behavior.test.ts.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import * as Vue from 'vue'

import * as layoutConfigModule from '../app/composables/useLayoutConfig.ts'
import { fire, findAll, textOf, type MiniElement } from './_sfc-mount.ts'
import {
  alertText, h3Error, json, mountAdminPage, OFETCH_LINE, routes, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined

const LAYOUT = { containerWidth: 'wide', containerCustom: 1366, articleGrid: 'list', articleGridCols: 4, socialDisplayMode: 'floating', socialAutoOpen: false }
const SITE = { site_name: 'Cổng C11', site_description: 'Mô tả thật', hotline: '1900 0000', email: 'c11@bocongan.gov.vn', address: 'Hà Nội', facebook_url: 'https://facebook.com/c11', main_logo_url: '', logo_url: '/uploads/logo.png', hero_banner_url: '/uploads/hero.jpg', favicon_url: '', og_image_url: '' }
const HELD = () => undefined

function harnessFor(saved: unknown[]) {
  const useLayoutConfig = () => ({ setConfig: (config: unknown) => { saved.push(config) } })
  return {
    auto: {
      useLayoutConfig,
      DEFAULT_LAYOUT_CONFIG: layoutConfigModule.DEFAULT_LAYOUT_CONFIG,
      useImagePicker: () => ({ openPicker: () => {} }),
      useUpload: () => ({ uploading: Vue.ref(false), uploadFile: async () => null }),
    },
    modules: { '~/composables/useLayoutConfig': { ...layoutConfigModule, useLayoutConfig } },
  }
}

async function open(page: string, table: Record<string, Route>) {
  const saved: unknown[] = []
  const opened = await mountAdminPage(page, routes(table) as Responder, harnessFor(saved))
  return Object.assign(opened, { saved })
}

const button = (opened: MountedAdminPage, label: RegExp): MiniElement => {
  const found = findAll(opened.page.root, el => el.tag === 'button' && label.test(textOf(el)))
  assert.equal(found.length, 1, `one button ${label}`)
  return found[0]!
}
const disabled = (el: MiniElement) => el.props.disabled === true || el.props.disabled === ''
const puts = (opened: MountedAdminPage) => opened.calls.filter(call => call.method === 'PUT')
const held = (opened: MountedAdminPage, at: string) => opened.calls.filter(call => wire(call) === at)

// ─── settings/general.vue ────────────────────────────────────────────────────

const GENERAL = 'pages/admin/settings/general.vue'
const SAVE_GENERAL = /Lưu Cài Đặt|Đang lưu\.\.\./
const SAVE_LAYOUT = /Lưu bố cục|Đang lưu…/
const general = (over: Record<string, Route> = {}) => open(GENERAL, {
  'GET /api/admin/settings': () => json({ ok: true, settings: SITE, needsReentry: [] }),
  'PUT /api/admin/settings': () => json({ ok: true }),
  'GET /api/admin/settings/layout': () => json({ ok: true, config: LAYOUT }),
  'PUT /api/admin/settings/layout': call => json({ ok: true, config: call.body }),
  ...over,
})

describe(GENERAL, () => {
  it('loaded: "Lưu Cài Đặt" is enabled and PUTs the eleven keys as loaded', async () => {
    const opened = await general()
    assert.equal(disabled(button(opened, SAVE_GENERAL)), false)
    await fire(button(opened, SAVE_GENERAL), 'click')
    await settle()
    assert.equal(puts(opened).length, 1)
    assert.deepEqual((puts(opened)[0]!.body as { settings: unknown }).settings, SITE)
  })

  it('FINDING-R8-1: after a FAILED load, "Lưu Cài Đặt" is disabled and a click that gets through PUTs nothing', async () => {
    const opened = await general({ 'GET /api/admin/settings': () => h3Error(500, 'Không đọc được cài đặt.') })
    assert.match(alertText(opened.page), /Không đọc được cài đặt\./)
    assert.equal(disabled(button(opened, SAVE_GENERAL)), true, 'save locked while the form holds the defaults')
    await fire(button(opened, SAVE_GENERAL), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(wire), [], 'no PUT of the hard-coded defaults')
  })

  it('FINDING-R8-1: while the first load is in flight, "Lưu Cài Đặt" is disabled and PUTs nothing', async () => {
    const opened = await general({ 'GET /api/admin/settings': HELD })
    assert.equal(disabled(button(opened, SAVE_GENERAL)), true)
    await fire(button(opened, SAVE_GENERAL), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(wire), [])
    // The answer arrives: the form holds the real settings, and saving is possible.
    held(opened, 'GET /api/admin/settings')[0]!.respond(json({ ok: true, settings: SITE, needsReentry: [] }))
    await settle()
    assert.equal(disabled(button(opened, SAVE_GENERAL)), false)
    await fire(button(opened, SAVE_GENERAL), 'click')
    await settle()
    assert.equal((puts(opened)[0]!.body as { settings: { site_name: string } }).settings.site_name, 'Cổng C11')
  })

  it('a failed load, then "thử lại" that succeeds: save is open, and PUTs the real values', async () => {
    let fail = true
    const opened = await general({ 'GET /api/admin/settings': () => (fail ? h3Error(503, 'Tạm thời không đọc được.') : json({ ok: true, settings: SITE, needsReentry: [] })) })
    fail = false
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'thử lại')[0]!, 'click')
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(disabled(button(opened, SAVE_GENERAL)), false)
    await fire(button(opened, SAVE_GENERAL), 'click')
    await settle()
    assert.deepEqual((puts(opened)[0]!.body as { settings: unknown }).settings, SITE)
  })

  it('layout loaded: "Lưu bố cục" PUTs the loaded layout (with the edit) and hands the answer to the shared state', async () => {
    const opened = await general()
    assert.equal(disabled(button(opened, SAVE_LAYOUT)), false)
    const cols = findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === '2 cột')[0]!
    await fire(cols, 'click')
    await fire(button(opened, SAVE_LAYOUT), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(call => [wire(call), call.body]), [['PUT /api/admin/settings/layout', { ...LAYOUT, articleGridCols: 2 }]])
    assert.deepEqual(opened.saved, [{ ...LAYOUT, articleGridCols: 2 }])
  })

  it('FINDING-R8-2: a failed layout load is said (alert + "Thử lại"); "Lưu bố cục" stays locked; "Thử lại" re-runs that GET', async () => {
    let fail = true
    const opened = await general({ 'GET /api/admin/settings/layout': () => (fail ? h3Error(500, 'Không đọc được cấu hình bố cục.') : json({ ok: true, config: LAYOUT })) })
    assert.match(alertText(opened.page), /Không đọc được cấu hình bố cục\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
    assert.equal(disabled(button(opened, SAVE_LAYOUT)), true)
    await fire(button(opened, SAVE_LAYOUT), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(wire), [], 'no PUT of the default layout')

    fail = false
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!, 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/settings/layout'])
    assert.equal(alertText(opened.page), '')
    assert.equal(disabled(button(opened, SAVE_LAYOUT)), false)
    await fire(button(opened, SAVE_LAYOUT), 'click')
    await settle()
    assert.deepEqual(puts(opened)[0]!.body, LAYOUT)
  })

  it('FINDING-R8-2: a dropped layout load reads the page\'s own sentence, never ofetch\'s line', async () => {
    const opened = await general({ 'GET /api/admin/settings/layout': () => new TypeError('fetch failed') })
    assert.match(alertText(opened.page), /Không tải được cấu hình bố cục\./)
    assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
  })
})

// ─── settings/social-links.vue ───────────────────────────────────────────────

const SOCIAL = 'pages/admin/settings/social-links.vue'
const SAVE_SOCIAL = /Lưu kiểu hiển thị|Đang lưu\.\.\./
const social = (over: Record<string, Route> = {}) => open(SOCIAL, {
  'GET /api/admin/social-links': () => json({ ok: true, items: [] }),
  'GET /api/admin/settings/layout': () => json({ ok: true, config: LAYOUT }),
  'PUT /api/admin/settings/layout': call => json({ ok: true, config: call.body }),
  ...over,
})

describe(SOCIAL, () => {
  it('layout loaded: "Lưu kiểu hiển thị" PUTs the loaded layout_config with the edit', async () => {
    const opened = await social()
    assert.equal(disabled(button(opened, SAVE_SOCIAL)), false)
    const popup = findAll(opened.page.root, el => el.tag === 'button' && textOf(el).startsWith('Bảng nổi đang mở'))[0]!
    await fire(popup, 'click')
    await fire(button(opened, SAVE_SOCIAL), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(call => [wire(call), call.body]), [['PUT /api/admin/settings/layout', { ...LAYOUT, socialDisplayMode: 'popup' }]])
    assert.deepEqual(opened.saved, [{ ...LAYOUT, socialDisplayMode: 'popup' }])
  })

  it('FINDING-R8-3: while the layout load is in flight, "Lưu kiểu hiển thị" is disabled and PUTs nothing', async () => {
    const opened = await social({ 'GET /api/admin/settings/layout': HELD })
    assert.equal(disabled(button(opened, SAVE_SOCIAL)), true)
    await fire(button(opened, SAVE_SOCIAL), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(wire), [], 'no PUT of the default layout_config')
    held(opened, 'GET /api/admin/settings/layout')[0]!.respond(json({ ok: true, config: LAYOUT }))
    await settle()
    assert.equal(disabled(button(opened, SAVE_SOCIAL)), false)
  })

  it('FINDING-R8-3: a failed layout load is said; the button stays locked; "Thử lại" re-runs that GET', async () => {
    let fail = true
    const opened = await social({ 'GET /api/admin/settings/layout': () => (fail ? h3Error(403, 'Bạn không có quyền xem cấu hình.') : json({ ok: true, config: LAYOUT })) })
    assert.match(alertText(opened.page), /Bạn không có quyền xem cấu hình\./)
    assert.equal(disabled(button(opened, SAVE_SOCIAL)), true)
    await fire(button(opened, SAVE_SOCIAL), 'click')
    await settle()
    assert.deepEqual(puts(opened).map(wire), [])
    fail = false
    const before = opened.calls.length
    await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!, 'click')
    await settle()
    assert.deepEqual(opened.calls.slice(before).map(wire), ['GET /api/admin/settings/layout'])
    assert.equal(disabled(button(opened, SAVE_SOCIAL)), false)
  })
})

// ─── Both pages: the layout load's other failure shapes (useLayoutSettingsForm) ──

const PAGES = [
  { name: GENERAL, open: general, save: SAVE_LAYOUT },
  { name: SOCIAL, open: social, save: SAVE_SOCIAL },
]

for (const { name, open: openPage, save } of PAGES) {
  describe(`${name} — layout load`, () => {
    it('a 200 answer that is not a layout (`ok: false`) is a failed load: save locked, a click PUTs nothing, alert + "Thử lại"', async () => {
      // Verifier R8 V01: nothing pinned this branch — `loaded = true` there survived every test.
      let answer = () => json({ ok: false })
      const opened = await openPage({ 'GET /api/admin/settings/layout': () => answer() })
      assert.match(alertText(opened.page), /Không tải được cấu hình bố cục\./)
      assert.equal(disabled(button(opened, save)), true)
      await fire(button(opened, save), 'click')
      await settle()
      assert.deepEqual(puts(opened).map(wire), [], 'no PUT of the default layout')
      answer = () => json({ ok: true, config: LAYOUT })
      await fire(findAll(opened.page.root, el => el.tag === 'button' && textOf(el) === 'Thử lại')[0]!, 'click')
      await settle()
      assert.equal(alertText(opened.page), '')
      assert.equal(disabled(button(opened, save)), false)
    })

    it('the layout GET\'s 500 (layout.get.ts, a failed database read) shows its Vietnamese sentence with "Thử lại"', async () => {
      const opened = await openPage({ 'GET /api/admin/settings/layout': () => h3Error(500, 'Không đọc được cấu hình bố cục. Vui lòng thử lại.') })
      assert.match(alertText(opened.page), /^Không đọc được cấu hình bố cục\. Vui lòng thử lại\. Thử lại$/)
      assert.equal(findAll(opened.page.root, el => el.props.role === 'alert' && findAll(el, b => b.tag === 'button' && textOf(b) === 'Thử lại').length === 1).length, 1)
      assert.equal(disabled(button(opened, save)), true)
    })
  })
}
