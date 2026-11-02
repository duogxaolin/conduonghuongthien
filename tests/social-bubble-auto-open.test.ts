/**
 * Bảng "Kênh mạng xã hội" (`app/components/SocialBubble.client.vue`) tự mở — chủ đích, nhưng
 * không được che đầu trang chủ và không được mở lại trong cùng phiên.
 *
 * Người dùng báo (2026-11-02, bản build): vào trang là bảng tự bật, che nút ở đầu trang chủ,
 * và đổi ngôn ngữ (= tải lại trang, `setLang` → `location.reload()`) là nó bật lại. Đo trên
 * app của người dùng ở 1366×768: bảng chiếm x 24–339, y 304–688; nút "Về chúng tôi" của hero
 * ở x 95–269, y 615–668 — bị che hẳn.
 *
 * Tự mở là chủ đích: cài đặt `socialAutoOpen` (/admin/settings/social-links, "Tự mở khi tải
 * trang"), mặc định bật. Nhưng `openspec/ui-dna.md`: nút nổi "mặc định đóng để không che chắn
 * nội dung trang". Hợp đồng sau sửa, giữ cả hai:
 *   - tối đa MỘT lần mỗi phiên (sessionStorage `cdkt_social_auto_opened`) — tải lại, đổi ngôn
 *     ngữ, mở tab cùng phiên đều không bật lại; khách tự mở/đóng/thu gọn cũng tính là xong;
 *   - trên trang chủ chỉ mở khi khách đã cuộn qua phần lớn màn hình đầu (hero), hoặc khi rời
 *     trang chủ; trang khác mở ngay khi tải;
 *   - kiểu bảng nổi: điện thoại không bao giờ tự mở (như trước); tắt `socialAutoOpen` thì không
 *     tự mở ở đâu — kể cả kiểu nút tròn rời, trước đây vẫn mở rộng vì `isExpanded` khởi tạo `true`;
 *   - sessionStorage hỏng/bị chặn: không lỗi, coi như đã mở (không làm phiền).
 */
import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import * as Vue from 'vue'

import { json, mountPublic, routes, settle } from './_public-mount-harness.ts'
import { click, findAll, type MiniElement } from './_sfc-mount.ts'

const LINKS = { ok: true, items: [
  { id: 1, platform: 'facebook', label: 'Fanpage', url: 'https://facebook.com/x', icon: 'fa-brands fa-facebook-f', iconType: 'fontawesome', color: '#1877f2', sortOrder: 1 },
  { id: 2, platform: 'youtube', label: 'Kênh YouTube', url: 'https://youtube.com/x', icon: 'fa-brands fa-youtube', iconType: 'fontawesome', color: '#ff0000', sortOrder: 2 },
] }
const KEY = 'cdkt_social_auto_opened'

type Mode = 'popup' | 'floating'
type Env = {
  mode?: Mode
  autoOpen?: boolean
  width?: number
  height?: number
  scrollY?: number
  path?: string
  /** One session's storage, shared by the mounts of a test (a reload keeps it). */
  storage?: Map<string, string> | 'throws'
}

function browser(env: Env) {
  const scroll = new Set<() => void>()
  const doc = new Map<string, Set<(event: unknown) => void>>()
  const storage = env.storage ?? new Map<string, string>()
  const sessionStorage = storage === 'throws'
    ? { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('SecurityError') } }
    : { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, String(v)) } }
  const window = {
    innerWidth: env.width ?? 1366,
    innerHeight: env.height ?? 768,
    scrollY: env.scrollY ?? 0,
    sessionStorage,
    matchMedia: () => ({ matches: false }),
    addEventListener: (type: string, fn: () => void) => { if (type === 'scroll') scroll.add(fn) },
    removeEventListener: (type: string, fn: () => void) => { if (type === 'scroll') scroll.delete(fn) },
  }
  const document = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { if (!doc.has(type)) doc.set(type, new Set()); doc.get(type)!.add(fn) },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { doc.get(type)?.delete(fn) },
  }
  return {
    window, document, scroll, storage,
    /** The visitor scrolls the page to `y`. */
    scrollTo: async (y: number) => { window.scrollY = y; for (const fn of [...scroll]) fn(); await settle() },
    key: async (key: string) => { for (const fn of [...(doc.get('keydown') ?? [])]) fn({ key }); await settle() },
    clickOutside: async () => { for (const fn of [...(doc.get('click') ?? [])]) fn({ target: {} }); await settle() },
  }
}

async function mountBubble(t: TestContext, env: Env = {}) {
  const b = browser(env)
  const config = Vue.computed(() => ({ socialDisplayMode: env.mode ?? 'popup', socialAutoOpen: env.autoOpen ?? true }))
  const ctx = await mountPublic(t, {
    file: 'components/SocialBubble.client.vue',
    responder: routes({ 'GET /api/public/social-links': () => json(LINKS) }),
    route: { path: env.path ?? '/' },
    auto: { useLayoutConfig: () => ({ config }) },
    modules: { '~/composables/useLayoutConfig': { useLayoutConfig: () => ({ config }) } },
    globals: { window: b.window, document: b.document },
  })
  await settle()
  // The click-outside handler asks the bubble's root `contains(target)`; a click from
  // `clickOutside()` lands outside it. Not enumerable: not part of the element's data.
  for (const el of findAll(ctx.page.root, e => typeof e.props.class === 'string' && e.props.class.startsWith('fixed '))) {
    Object.defineProperty(el, 'contains', { value: () => false, configurable: true, writable: true })
  }
  return { ...ctx, browser: b }
}

/**
 * Popup mode: the launcher's `aria-expanded` is `open`. Read there, not from the panel's
 * presence: the panel sits in a `<Transition>`, whose enter/leave hooks need `classList` and
 * `getComputedStyle`, which the mini DOM does not have — a leaving panel stays in the tree.
 */
const panelOpen = (root: MiniElement) => {
  const launcher = findAll(root, el => el.tag === 'button' && el.props['aria-haspopup'] === 'dialog')
  assert.equal(launcher.length, 1, 'the popup launcher is not rendered')
  return launcher[0]!.props['aria-expanded'] === true
}
/** Floating mode: expanded = the "open" capsule (`v-if="!isExpanded"`, no transition) is absent. */
const floatingExpanded = (root: MiniElement) => findAll(root, el => el.tag === 'button' && el.props['aria-label'] === 'Mở kết nối mạng xã hội và liên hệ hỗ trợ').length === 0
/** Errors from the component's own code (not Vue's `<Transition>` hooks on the mini DOM, see above). */
const ownErrors = (errors: unknown[]) => errors.filter(err => !/runtime-dom/.test(String((err as Error)?.stack)))
const byAria = (root: MiniElement, label: string) => {
  const found = findAll(root, el => el.tag === 'button' && el.props['aria-label'] === label)
  assert.ok(found.length >= 1, `no button "${label}"`)
  return found[0]!
}

describe('SocialBubble popup (desktop): not over the home hero, once per session', () => {
  it('home, top of the page: stays closed on load; scrolling past most of the first screen opens it once', async (t) => {
    const ctx = await mountBubble(t, { path: '/' })
    assert.equal(panelOpen(ctx.page.root), false, 'opened over the hero')
    assert.equal(ctx.browser.scroll.size, 1, 'waits for the visitor to scroll')
    await ctx.browser.scrollTo(200)
    assert.equal(panelOpen(ctx.page.root), false, 'a small scroll still has the hero buttons under it')
    await ctx.browser.scrollTo(500)
    assert.equal(panelOpen(ctx.page.root), true)
    assert.equal(ctx.browser.storage instanceof Map && ctx.browser.storage.get(KEY), '1')
    assert.equal(ctx.browser.scroll.size, 0, 'the scroll listener is gone once it opened')
  })

  it('another page: opens on load (the admin setting), and marks the session', async (t) => {
    const ctx = await mountBubble(t, { path: '/news' })
    assert.equal(panelOpen(ctx.page.root), true)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('home already scrolled down on load (a reload keeps the position): opens on load', async (t) => {
    const ctx = await mountBubble(t, { path: '/', scrollY: 900 })
    assert.equal(panelOpen(ctx.page.root), true)
  })

  it('closed with X, then the page reloads (a language change does): it stays closed', async (t) => {
    const storage = new Map<string, string>()
    const first = await mountBubble(t, { path: '/news', storage })
    assert.equal(panelOpen(first.page.root), true)
    await click(byAria(first.page.root, 'Đóng bảng mạng xã hội'))
    await settle()
    assert.equal(panelOpen(first.page.root), false)
    first.close()
    const again = await mountBubble(t, { path: '/news', storage })
    assert.equal(panelOpen(again.page.root), false, 'reopened after a reload in the same session')
    // Nor on the home page after a scroll.
    again.close()
    const home = await mountBubble(t, { path: '/', storage })
    await home.browser.scrollTo(900)
    assert.equal(panelOpen(home.page.root), false)
  })

  it('auto-opened and left open, the next load does not open it again (one auto-open per session)', async (t) => {
    const storage = new Map<string, string>()
    const first = await mountBubble(t, { path: '/news', storage })
    assert.equal(panelOpen(first.page.root), true)
    first.close()
    const again = await mountBubble(t, { path: '/about', storage })
    assert.equal(panelOpen(again.page.root), false)
  })

  for (const [how, act] of [
    ['Escape', (ctx: Awaited<ReturnType<typeof mountBubble>>) => ctx.browser.key('Escape')],
    ['a click outside', (ctx: Awaited<ReturnType<typeof mountBubble>>) => ctx.browser.clickOutside()],
  ] as const) {
    it(`closed with ${how}: remembered for the session too`, async (t) => {
      const storage = new Map<string, string>()
      const first = await mountBubble(t, { path: '/news', storage })
      assert.equal(panelOpen(first.page.root), true)
      await act(first)
      assert.equal(panelOpen(first.page.root), false)
      first.close()
      const again = await mountBubble(t, { path: '/news', storage })
      assert.equal(panelOpen(again.page.root), false)
    })
  }

  it('the visitor opens and closes it themselves before scrolling: no auto-open on top of that, nor after a reload', async (t) => {
    const storage = new Map<string, string>()
    const ctx = await mountBubble(t, { path: '/', storage })
    await click(byAria(ctx.page.root, 'Kênh mạng xã hội C11'))
    await settle()
    assert.equal(panelOpen(ctx.page.root), true)
    await click(byAria(ctx.page.root, 'Kênh mạng xã hội C11'))
    await settle()
    assert.equal(panelOpen(ctx.page.root), false)
    await ctx.browser.scrollTo(900)
    assert.equal(panelOpen(ctx.page.root), false, 'auto-opened after the visitor had closed it')
    assert.equal(ctx.browser.scroll.size, 0)
    // It never auto-opened, so only the visitor's own close marks the session: a reload (a
    // language change) back at the top of home must not wait to pop it open again.
    ctx.close()
    const again = await mountBubble(t, { path: '/', storage })
    assert.equal(again.browser.scroll.size, 0, 'waits to auto-open after the visitor already closed it')
    await again.browser.scrollTo(900)
    assert.equal(panelOpen(again.page.root), false)
  })

  it('floating: the visitor expands then collapses the buttons before scrolling; a reload keeps them collapsed', async (t) => {
    const storage = new Map<string, string>()
    const ctx = await mountBubble(t, { mode: 'floating', path: '/', storage })
    // The phone capsule (the desktop one listens on its wrapper, not on the button).
    await click(byAria(ctx.page.root, 'Hỗ trợ 24/7. Mở kết nối mạng xã hội và liên hệ hỗ trợ'))
    await settle()
    assert.equal(floatingExpanded(ctx.page.root), true)
    await click(byAria(ctx.page.root, 'Thu gọn mạng xã hội'))
    await settle()
    ctx.close()
    const again = await mountBubble(t, { mode: 'floating', path: '/', storage })
    await again.browser.scrollTo(900)
    assert.equal(floatingExpanded(again.page.root), false)
  })

  it('leaving the home page before scrolling (client-side navigation) opens it on the next page', async (t) => {
    const ctx = await mountBubble(t, { path: '/' })
    assert.equal(panelOpen(ctx.page.root), false)
    ctx.route.path = '/news'
    await settle()
    assert.equal(panelOpen(ctx.page.root), true)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('a phone never auto-opens the popup panel (it would cover the page)', async (t) => {
    const ctx = await mountBubble(t, { path: '/news', width: 390, height: 844 })
    assert.equal(panelOpen(ctx.page.root), false)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('socialAutoOpen off: never opens, not even after a scroll', async (t) => {
    const ctx = await mountBubble(t, { path: '/', autoOpen: false })
    await ctx.browser.scrollTo(900)
    assert.equal(panelOpen(ctx.page.root), false)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('sessionStorage blocked: no error, and no auto-open (it could not be remembered)', async (t) => {
    const ctx = await mountBubble(t, { path: '/news', storage: 'throws' })
    assert.deepEqual(ownErrors(ctx.page.errors), [])
    assert.equal(panelOpen(ctx.page.root), false)
    await click(byAria(ctx.page.root, 'Kênh mạng xã hội C11'))
    await settle()
    assert.equal(panelOpen(ctx.page.root), true, 'the launcher still works')
    assert.deepEqual(ownErrors(ctx.page.errors), [])
  })

  it('unmounting while it waits for a scroll removes the listener', async (t) => {
    const ctx = await mountBubble(t, { path: '/' })
    assert.equal(ctx.browser.scroll.size, 1)
    const { scroll } = ctx.browser
    ctx.close()
    assert.equal(scroll.size, 0)
  })
})

describe('SocialBubble floating buttons: the same rules', () => {
  it('home on a phone: collapsed until the visitor scrolls, then expanded once', async (t) => {
    const ctx = await mountBubble(t, { mode: 'floating', path: '/', width: 390, height: 844 })
    assert.equal(floatingExpanded(ctx.page.root), false, 'expanded over the hero')
    await ctx.browser.scrollTo(600)
    assert.equal(floatingExpanded(ctx.page.root), true)
  })

  it('collapsed by the visitor, then reloaded: stays collapsed', async (t) => {
    const storage = new Map<string, string>()
    const first = await mountBubble(t, { mode: 'floating', path: '/news', storage })
    assert.equal(floatingExpanded(first.page.root), true)
    await click(byAria(first.page.root, 'Thu gọn mạng xã hội'))
    await settle()
    assert.equal(floatingExpanded(first.page.root), false)
    first.close()
    const again = await mountBubble(t, { mode: 'floating', path: '/news', storage })
    assert.equal(floatingExpanded(again.page.root), false)
  })

  it('socialAutoOpen off: collapsed (it used to start expanded whatever the setting said)', async (t) => {
    const ctx = await mountBubble(t, { mode: 'floating', path: '/news', autoOpen: false })
    assert.equal(floatingExpanded(ctx.page.root), false)
  })
})
