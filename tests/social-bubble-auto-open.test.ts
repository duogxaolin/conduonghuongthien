/**
 * Bảng "Kênh mạng xã hội" (`app/components/SocialBubble.client.vue`) tự mở — chủ đích, nhưng
 * không được che đầu trang và không được mở lại trong cùng phiên.
 *
 * Người dùng báo (2026-11-02, bản build): vào trang là bảng tự bật, che nút ở đầu trang chủ,
 * và đổi ngôn ngữ (= tải lại trang, `setLang` → `location.reload()`) là nó bật lại. Đo trên
 * app của người dùng ở 1366×768: bảng chiếm x 24–339, y 304–688; nút "Về chúng tôi" của hero
 * ở x 95–269, y 615–668 — bị che hẳn. Kiểm chứng độc lập (W1): bản sửa đầu chỉ đợi ở trang
 * chủ — /news, /about, /contact vẫn mở ngay và che h1, ô tìm kiếm, dòng thông tin ở 1366–1440.
 *
 * Tự mở là chủ đích: cài đặt `socialAutoOpen` (/admin/settings/social-links, "Tự mở khi tải
 * trang"), mặc định bật. Nhưng `openspec/ui-dna.md`: nút nổi "mặc định đóng để không che chắn
 * nội dung trang". Hợp đồng sau sửa, giữ cả hai:
 *   - MỌI trang: chỉ mở khi khách đã cuộn qua 60% màn hình đầu (đầu trang trôi khỏi vùng bảng);
 *     điều hướng phía client không mở — trang mới về đầu, khách cuộn ở đó thì mở; tải lại ở vị
 *     trí đã cuộn quá ngưỡng thì mở;
 *   - tối đa MỘT lần mỗi phiên (sessionStorage `cdkt_social_auto_opened`) — tải lại, đổi ngôn
 *     ngữ, mở tab cùng phiên đều không bật lại; khách tự mở/đóng/thu gọn cũng tính là xong;
 *   - kiểu bảng nổi: điện thoại không bao giờ tự mở; tắt `socialAutoOpen` thì không tự mở ở đâu
 *     (kể cả khi cài đặt tới SAU lúc gắn) — kể cả kiểu nút tròn rời, trước đây vẫn mở rộng vì
 *     `isExpanded` khởi tạo `true`;
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
/** 60% of 768: the first screen is passed at scrollY ≥ 460.8. */
const PAST = 900

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
  // A ref, so a test can deliver the layout settings after mount (they are fetched).
  const autoOpen = Vue.ref(env.autoOpen ?? true)
  const config = Vue.computed(() => ({ socialDisplayMode: env.mode ?? 'popup', socialAutoOpen: autoOpen.value }))
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
  return { ...ctx, browser: b, autoOpen }
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
/**
 * The popup launcher is found by `aria-haspopup="dialog"`, not by an `aria-label`: it has none on purpose —
 * its name comes from its visible text, because a label that did not contain that text failed axe's
 * `label-content-name-mismatch` (WCAG 2.5.3) on every public page (2026-11-07).
 */
const popupLauncher = (root: MiniElement) => {
  const found = findAll(root, el => el.tag === 'button' && el.props['aria-haspopup'] === 'dialog')
  assert.equal(found.length, 1, 'the popup launcher is not rendered')
  return found[0]!
}
const byAria = (root: MiniElement, label: string) => {
  const found = findAll(root, el => el.tag === 'button' && el.props['aria-label'] === label)
  assert.ok(found.length >= 1, `no button "${label}"`)
  return found[0]!
}
/** Mount at the top of `path`, then scroll past the first screen: auto-opened (it has to be). */
async function opened(t: TestContext, env: Env) {
  const ctx = await mountBubble(t, env)
  await ctx.browser.scrollTo(PAST)
  assert.equal(env.mode === 'floating' ? floatingExpanded(ctx.page.root) : panelOpen(ctx.page.root), true, 'did not auto-open after the scroll')
  return ctx
}

describe('SocialBubble popup (desktop): never over the top of a page, once per session', () => {
  for (const path of ['/', '/news/activity-news', '/about', '/contact']) {
    it(`${path}, top of the page: stays closed on load; scrolling past most of the first screen opens it once`, async (t) => {
      const ctx = await mountBubble(t, { path })
      assert.equal(panelOpen(ctx.page.root), false, 'opened over the top of the page')
      assert.equal(ctx.browser.scroll.size, 1, 'waits for the visitor to scroll')
      await ctx.browser.scrollTo(200)
      assert.equal(panelOpen(ctx.page.root), false, 'a small scroll still has the top of the page under it')
      await ctx.browser.scrollTo(500)
      assert.equal(panelOpen(ctx.page.root), true)
      assert.equal(ctx.browser.storage instanceof Map && ctx.browser.storage.get(KEY), '1')
      assert.equal(ctx.browser.scroll.size, 0, 'the scroll listener is gone once it opened')
    })
  }

  it('the threshold is 60% of the window height: 0.59 does not open, 0.61 does (768 px and 1080 px)', async (t) => {
    for (const height of [768, 1080]) {
      const ctx = await mountBubble(t, { path: '/news', height })
      await ctx.browser.scrollTo(Math.floor(height * 0.59))
      assert.equal(panelOpen(ctx.page.root), false, `${height}: opened at 59%`)
      await ctx.browser.scrollTo(Math.ceil(height * 0.61))
      assert.equal(panelOpen(ctx.page.root), true, `${height}: still closed at 61%`)
      ctx.close()
    }
  })

  it('already scrolled down on load (a reload keeps the position): opens on load', async (t) => {
    const ctx = await mountBubble(t, { path: '/news', scrollY: PAST })
    assert.equal(panelOpen(ctx.page.root), true)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('client-side navigation while waiting does not open it at the top of the next page; a scroll there does', async (t) => {
    const ctx = await mountBubble(t, { path: '/' })
    ctx.route.path = '/news'
    await settle()
    assert.equal(panelOpen(ctx.page.root), false, 'opened on arrival, over the next page\'s h1')
    assert.equal(ctx.browser.scroll.size, 1, 'stopped waiting')
    await ctx.browser.scrollTo(0) // the router puts the new page at its top
    assert.equal(panelOpen(ctx.page.root), false)
    await ctx.browser.scrollTo(PAST)
    assert.equal(panelOpen(ctx.page.root), true)
  })

  it('closed with X, then the page reloads (a language change does): it stays closed', async (t) => {
    const storage = new Map<string, string>()
    const first = await opened(t, { path: '/news', storage })
    await click(byAria(first.page.root, 'Đóng bảng mạng xã hội'))
    await settle()
    assert.equal(panelOpen(first.page.root), false)
    first.close()
    const again = await mountBubble(t, { path: '/news', storage })
    assert.equal(again.browser.scroll.size, 0, 'waits to auto-open again in the same session')
    await again.browser.scrollTo(PAST)
    assert.equal(panelOpen(again.page.root), false, 'reopened after a reload in the same session')
    again.close()
    const home = await mountBubble(t, { path: '/', storage, scrollY: PAST })
    assert.equal(panelOpen(home.page.root), false)
  })

  it('auto-opened and left open, the next load does not open it again (one auto-open per session)', async (t) => {
    const storage = new Map<string, string>()
    const first = await opened(t, { path: '/news', storage })
    first.close()
    const again = await mountBubble(t, { path: '/about', storage, scrollY: PAST })
    assert.equal(panelOpen(again.page.root), false)
  })

  for (const [how, act] of [
    ['Escape', (ctx: Awaited<ReturnType<typeof mountBubble>>) => ctx.browser.key('Escape')],
    ['a click outside', (ctx: Awaited<ReturnType<typeof mountBubble>>) => ctx.browser.clickOutside()],
  ] as const) {
    it(`closed with ${how}: remembered for the session too`, async (t) => {
      const storage = new Map<string, string>()
      const first = await opened(t, { path: '/news', storage })
      await act(first)
      assert.equal(panelOpen(first.page.root), false)
      first.close()
      const again = await mountBubble(t, { path: '/news', storage, scrollY: PAST })
      assert.equal(panelOpen(again.page.root), false)
    })
  }

  it('the visitor opens and closes it themselves before scrolling: no auto-open on top of that, nor after a reload', async (t) => {
    const storage = new Map<string, string>()
    const ctx = await mountBubble(t, { path: '/', storage })
    await click(popupLauncher(ctx.page.root))
    await settle()
    assert.equal(panelOpen(ctx.page.root), true)
    await click(popupLauncher(ctx.page.root))
    await settle()
    assert.equal(panelOpen(ctx.page.root), false)
    await ctx.browser.scrollTo(PAST)
    assert.equal(panelOpen(ctx.page.root), false, 'auto-opened after the visitor had closed it')
    assert.equal(ctx.browser.scroll.size, 0)
    // It never auto-opened, so only the visitor's own close marks the session: a reload (a
    // language change) back at the top of the page must not wait to pop it open again.
    ctx.close()
    const again = await mountBubble(t, { path: '/', storage })
    assert.equal(again.browser.scroll.size, 0, 'waits to auto-open after the visitor already closed it')
    await again.browser.scrollTo(PAST)
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
    await again.browser.scrollTo(PAST)
    assert.equal(floatingExpanded(again.page.root), false)
  })

  it('a phone never auto-opens the popup panel (it would cover the page), not even scrolled', async (t) => {
    const ctx = await mountBubble(t, { path: '/news', width: 390, height: 844, scrollY: PAST })
    assert.equal(panelOpen(ctx.page.root), false)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('the window shrinks to a phone width while waiting: the scroll past the threshold does not open the panel', async (t) => {
    const ctx = await mountBubble(t, { path: '/news' })
    ctx.browser.window.innerWidth = 390
    await ctx.browser.scrollTo(PAST)
    assert.equal(panelOpen(ctx.page.root), false)
  })

  it('socialAutoOpen off: never opens, not even after a scroll', async (t) => {
    const ctx = await mountBubble(t, { path: '/', autoOpen: false })
    await ctx.browser.scrollTo(PAST)
    assert.equal(panelOpen(ctx.page.root), false)
    assert.equal(ctx.browser.scroll.size, 0)
  })

  it('socialAutoOpen turned off by settings that arrive after mount: the scroll does not open it', async (t) => {
    const ctx = await mountBubble(t, { path: '/news' })
    assert.equal(ctx.browser.scroll.size, 1)
    ctx.autoOpen.value = false
    await settle()
    await ctx.browser.scrollTo(PAST)
    assert.equal(panelOpen(ctx.page.root), false)
    assert.equal(ctx.browser.storage instanceof Map && ctx.browser.storage.has(KEY), false, 'a refusal is not an auto-open')
  })

  it('sessionStorage blocked: no error, and no auto-open (it could not be remembered)', async (t) => {
    const ctx = await mountBubble(t, { path: '/news', storage: 'throws', scrollY: PAST })
    assert.deepEqual(ownErrors(ctx.page.errors), [])
    assert.equal(panelOpen(ctx.page.root), false)
    await click(popupLauncher(ctx.page.root))
    await settle()
    assert.equal(panelOpen(ctx.page.root), true, 'the launcher still works')
    assert.deepEqual(ownErrors(ctx.page.errors), [])
  })

  it('unmounting while it waits for a scroll removes the listener', async (t) => {
    const ctx = await mountBubble(t, { path: '/news' })
    assert.equal(ctx.browser.scroll.size, 1)
    const { scroll } = ctx.browser
    ctx.close()
    assert.equal(scroll.size, 0)
  })
})

describe('SocialBubble floating buttons: the same rules', () => {
  for (const path of ['/', '/news']) {
    it(`${path} on a phone: collapsed until the visitor scrolls, then expanded once`, async (t) => {
      const ctx = await mountBubble(t, { mode: 'floating', path, width: 390, height: 844 })
      assert.equal(floatingExpanded(ctx.page.root), false, 'expanded over the top of the page')
      await ctx.browser.scrollTo(600)
      assert.equal(floatingExpanded(ctx.page.root), true)
    })
  }

  it('collapsed by the visitor, then reloaded: stays collapsed', async (t) => {
    const storage = new Map<string, string>()
    const first = await opened(t, { mode: 'floating', path: '/news', storage })
    await click(byAria(first.page.root, 'Thu gọn mạng xã hội'))
    await settle()
    assert.equal(floatingExpanded(first.page.root), false)
    first.close()
    const again = await mountBubble(t, { mode: 'floating', path: '/news', storage, scrollY: PAST })
    assert.equal(floatingExpanded(again.page.root), false)
  })

  it('socialAutoOpen off: collapsed (it used to start expanded whatever the setting said)', async (t) => {
    const ctx = await mountBubble(t, { mode: 'floating', path: '/news', autoOpen: false, scrollY: PAST })
    assert.equal(floatingExpanded(ctx.page.root), false)
  })
})
