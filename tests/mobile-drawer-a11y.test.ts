import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFocusReturn, inertOutside, trapTabTarget, type FocusTargetLike, type InertNodeLike } from '../app/utils/focus-return'
import { renderSfcTemplate } from './_render-sfc-template'
import { readPart } from './_layout-parts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const drawerFile = path.join(root, 'app/components/layout/DefaultMobileDrawer.vue')

/** State tối thiểu để template drawer render được ở SSR. */
function drawerState(isMobileMenuOpen: boolean): Record<string, unknown> {
  return {
    isMobileMenuOpen,
    navMenu: [], t: (k: string) => k, locales: [], currentLang: 'vi', setLang() {},
    getFlagEmoji: () => '', searchQuery: '', siteMainLogo: '', siteLogo: '', siteHotline: '',
    siteHotlineTel: '', reader: null, readerLoaded: false, unreadCount: 0, mobileOpenSubmenu: null,
    navItemLabel: () => '', toggleMobileSubmenu() {}, onNavClick() {}, readerSignIn() {},
    onReaderSignOut() {}, shouldOpenNewTab: () => false, NuxtLink: 'a', onTrapTab() {},
  }
}

/**
 * Thẻ mở của khung ngăn kéo `id="mobile-drawer"` trong HTML đã render. Khung là
 * `<div role="dialog">` (không phải `<nav>`: `role="dialog"` không được phép trên
 * `<nav>`); danh sách điều hướng nằm trong một `<nav>` riêng bên trong.
 */
function drawerOpeningTag(html: string): string {
  const tag = html.match(/<div\b[^>]*id="mobile-drawer"[^>]*>/)?.[0]
  assert.ok(tag, 'không thấy <div id="mobile-drawer"> trong HTML đã render')
  return tag
}

describe('ngăn kéo mobile — trạng thái đóng không với tới được bằng bàn phím/trình đọc màn hình (SSR thật)', () => {
  it('đóng: inert + aria-hidden + invisible, vẫn trượt ra bằng -right-full', async () => {
    const tag = drawerOpeningTag(await renderSfcTemplate(drawerFile, drawerState(false)))
    assert.match(tag, /\sinert(\s|>|=)/, 'ngăn kéo đóng phải inert (loại khỏi thứ tự Tab)')
    assert.match(tag, /aria-hidden="true"/)
    assert.match(tag, /class="[^"]*\binvisible\b/)
    assert.match(tag, /class="[^"]*-right-full/)
  })

  it('mở: không còn inert/aria-hidden/invisible (nếu còn, ngăn kéo mở mà không dùng được)', async () => {
    const tag = drawerOpeningTag(await renderSfcTemplate(drawerFile, drawerState(true)))
    assert.doesNotMatch(tag, /\sinert(\s|>|=)/)
    assert.doesNotMatch(tag, /aria-hidden/)
    assert.doesNotMatch(tag, /\binvisible\b/)
    assert.match(tag, /class="[^"]*\bright-0\b/)
  })

  it('hiệu ứng trượt giữ nguyên: visibility nằm trong transition-property (ẩn sau khi trượt ra xong)', async () => {
    const tag = drawerOpeningTag(await renderSfcTemplate(drawerFile, drawerState(false)))
    assert.match(tag, /transition-\[right,visibility\]/)
    assert.match(tag, /duration-\[380ms\]/)
  })

  it('mở: visibility KHÔNG nằm trong transition-property — hiện ngay để focus() vào được', async () => {
    // Nếu visibility chuyển cả khi mở, ngăn kéo còn `hidden` lúc nextTick và focus()
    // bị bỏ qua (hành vi thật: tests/e2e/mobile-drawer-focus.spec.ts).
    const tag = drawerOpeningTag(await renderSfcTemplate(drawerFile, drawerState(true)))
    assert.match(tag, /class="[^"]*\bvisible\b/)
    assert.match(tag, /transition-\[right\]/)
    assert.doesNotMatch(tag, /transition-\[right,visibility\]/)
    assert.match(tag, /duration-\[380ms\]/)
  })

  it('hộp thoại modal có tên truy cập; danh sách điều hướng vẫn là một <nav> có nhãn', async () => {
    const html = await renderSfcTemplate(drawerFile, drawerState(true))
    const tag = drawerOpeningTag(html)
    assert.match(tag, /role="dialog"/)
    assert.match(tag, /aria-modal="true"/)
    assert.match(tag, /aria-label="menu_dialog_aria"/)
    assert.match(html, /<nav\b[^>]*aria-label="Điều hướng di động"/)
    // `site_search_aria`, không `search_aria`: khoá đó đã có ở nhóm role_models /
    // reintegration của bộ dịch DB ("Tìm kiếm tấm gương") và thắng khi gộp phẳng.
    assert.match(html, /<input\b[^>]*aria-label="site_search_aria"/, 'ô tìm kiếm trong ngăn kéo phải có tên truy cập')
  })

  it('nút đóng có ref focus và vòng focus thấy được', () => {
    const src = readPart('DefaultMobileDrawer.vue')
    const btn = src.match(/<button\s+ref="closeBtn"[\s\S]*?<\/button>/)?.[0] ?? ''
    assert.ok(btn, 'nút đóng phải có ref="closeBtn" để focus vào khi mở')
    assert.match(btn, /focus-visible:ring-2/)
    assert.match(btn, /type="button"/)
  })

  it('nút đóng không transition visibility kế thừa (không transition-all) — nếu có, nó còn hidden lúc focus()', () => {
    // visibility kế thừa từ khung; `transition-all` trên chính nút làm nút tự chuyển
    // hidden → visible trong 150ms, nên focus() lúc mở rơi vào phần tử còn ẩn và bị bỏ
    // qua (đo thật trên Chrome: getAnimations() có "visibility" trên nút).
    const src = readPart('DefaultMobileDrawer.vue')
    const btn = src.match(/<button\s+ref="closeBtn"[\s\S]*?<\/button>/)?.[0] ?? ''
    assert.doesNotMatch(btn, /\btransition-all\b/)
    assert.doesNotMatch(btn, /\btransition\b(?!-)/)
    assert.doesNotMatch(btn, /transition-\[[^\]]*visibility/)
  })
})

describe('nút mở ngăn kéo — trạng thái mở được công bố (kiểm cấu trúc)', () => {
  // STRUCTURAL: đọc source, không mount. Header không có harness DOM riêng.
  const header = readPart('DefaultHeader.vue')
  const burger = header.match(/<button[^>]*@click="\$emit\('toggle-mobile-menu'\)"[\s\S]*?>/)?.[0] ?? ''

  it('aria-expanded gắn với isMobileMenuOpen, không còn cố định "false"', () => {
    assert.ok(burger, 'không tìm thấy nút hamburger')
    assert.match(burger, /:aria-expanded="isMobileMenuOpen"/)
    assert.doesNotMatch(burger, /\saria-expanded="false"/)
  })

  it('aria-controls trỏ đúng id của ngăn kéo', async () => {
    const id = burger.match(/aria-controls="([^"]+)"/)?.[1]
    assert.ok(id, 'thiếu aria-controls')
    const drawer = await renderSfcTemplate(drawerFile, drawerState(false))
    assert.match(drawer, new RegExp(`<div\\b[^>]*id="${id}"`))
  })
})

describe('createFocusReturn — mở nhớ phần tử, đóng trả focus về', () => {
  function fake(extra: Partial<FocusTargetLike> = {}): FocusTargetLike & { calls: number } {
    const el = {
      calls: 0,
      isConnected: true,
      focus() { el.calls += 1 },
      ...extra,
    }
    return el
  }

  it('trả focus về phần tử đã nhớ', () => {
    const trigger = fake()
    const fr = createFocusReturn()
    fr.remember(trigger)
    assert.equal(fr.restore(), true)
    assert.equal(trigger.calls, 1)
  })

  it('không trả focus khi nơi gọi báo người dùng đã chuyển focus sang chỗ khác', () => {
    const trigger = fake()
    const fr = createFocusReturn()
    fr.remember(trigger)
    assert.equal(fr.restore(false), false)
    assert.equal(trigger.calls, 0)
  })

  it('phần tử đã bị gỡ khỏi tài liệu thì bỏ qua, không ném lỗi', () => {
    const trigger = fake({ isConnected: false })
    const fr = createFocusReturn()
    fr.remember(trigger)
    assert.equal(fr.restore(), false)
    assert.equal(trigger.calls, 0)
  })

  it('không nhớ <body> (focus không ở đâu cả)', () => {
    const body = fake()
    const fr = createFocusReturn((el) => el === body)
    fr.remember(body)
    assert.equal(fr.restore(), false)
    assert.equal(body.calls, 0)
  })

  it('null/undefined → không làm gì', () => {
    const fr = createFocusReturn()
    fr.remember(null)
    assert.equal(fr.restore(), false)
    fr.remember(undefined)
    assert.equal(fr.restore(), false)
  })

  it('chỉ trả một lần mỗi lượt mở (restore lần hai là no-op)', () => {
    const trigger = fake()
    const fr = createFocusReturn()
    fr.remember(trigger)
    fr.restore()
    assert.equal(fr.restore(), false)
    assert.equal(trigger.calls, 1)
  })

  it('lượt mở mới ghi đè phần tử cũ', () => {
    const a = fake()
    const b = fake()
    const fr = createFocusReturn()
    fr.remember(a)
    fr.remember(b)
    fr.restore()
    assert.equal(a.calls, 0)
    assert.equal(b.calls, 1)
  })
})

describe('trapTabTarget — Tab quay vòng trong hộp thoại, chỉ can thiệp ở mép', () => {
  it('Tab ở phần tử cuối → về đầu; Shift+Tab ở đầu → về cuối', () => {
    assert.equal(trapTabTarget(5, 4, false), 0)
    assert.equal(trapTabTarget(5, 0, true), 4)
  })
  it('ở giữa → null (để trình duyệt tự chuyển, không chặn)', () => {
    assert.equal(trapTabTarget(5, 2, false), null)
    assert.equal(trapTabTarget(5, 2, true), null)
    assert.equal(trapTabTarget(5, 0, false), null)
    assert.equal(trapTabTarget(5, 4, true), null)
  })
  it('focus nằm ngoài danh sách (vd. trên khung) → kéo về đầu/cuối', () => {
    assert.equal(trapTabTarget(3, -1, false), 0)
    assert.equal(trapTabTarget(3, -1, true), 2)
  })
  it('một phần tử duy nhất: Tab và Shift+Tab đều giữ ở nó', () => {
    assert.equal(trapTabTarget(1, 0, false), 0)
    assert.equal(trapTabTarget(1, 0, true), 0)
  })
  it('không có gì để focus → null', () => {
    assert.equal(trapTabTarget(0, -1, false), null)
  })
})

describe('inertOutside — trang phía sau inert khi mở, trả lại NGUYÊN VẸN khi đóng', () => {
  interface FakeEl extends InertNodeLike {
    attrs: Map<string, string>
    kids: FakeEl[]
  }
  function el(tagName: string, opts: { attrs?: Record<string, string>; text?: string; kids?: FakeEl[] } = {}): FakeEl {
    const node: FakeEl = {
      tagName,
      parentElement: null,
      attrs: new Map(Object.entries(opts.attrs ?? {})),
      kids: opts.kids ?? [],
      get children() { return node.kids },
      get childElementCount() { return node.kids.length },
      get textContent() { return (opts.text ?? '') + node.kids.map(k => k.textContent ?? '').join('') },
      hasAttribute: (n) => node.attrs.has(n),
      getAttribute: (n) => node.attrs.get(n) ?? null,
      setAttribute: (n, v) => { node.attrs.set(n, v) },
      removeAttribute: (n) => { node.attrs.delete(n) },
    }
    for (const kid of node.kids) kid.parentElement = node
    return node
  }

  /** Cây giống layout thật: body > #__nuxt > .app-layout > (skip, toast, nền mờ, topbar, wrapper[header, drawer, desktopnav], main, footer) */
  function page() {
    const drawer = el('DIV', { attrs: { id: 'mobile-drawer' }, kids: [el('BUTTON', { text: 'x' })] })
    const header = el('HEADER', { kids: [el('BUTTON', { text: 'Mở menu' })] })
    const desktopNav = el('DIV', { kids: [el('A', { text: 'Trang chủ' })] })
    const wrapper = el('DIV', { kids: [header, drawer, desktopNav] })
    const backdrop = el('DIV', { attrs: { class: 'fixed inset-0' } })
    const toast = el('DIV', { attrs: { 'aria-live': 'polite' }, kids: [el('DIV', { text: 'Đã lưu' })] })
    const already = el('DIV', { attrs: { inert: '' }, kids: [el('A', { text: 'x' })] })
    const main = el('MAIN', { attrs: { id: 'main-content' }, kids: [el('A', { text: 'Bài viết' })] })
    const footer = el('FOOTER', { kids: [el('A', { text: 'Liên hệ' })] })
    const layout = el('DIV', { kids: [el('A', { text: 'Bỏ qua tới nội dung' }), backdrop, wrapper, main, footer, already] })
    const nuxt = el('DIV', { attrs: { id: '__nuxt' }, kids: [layout] })
    const script = el('SCRIPT', { text: 'window.x=1' })
    const teleports = el('DIV', { attrs: { id: 'teleports' }, kids: [el('DIV', { text: 'chat' })] })
    const body = el('BODY', { kids: [nuxt, toast, teleports, script] })
    const html = el('HTML', { kids: [el('HEAD', { kids: [el('TITLE', { text: 't' })] }), body] })
    return { html, body, drawer, header, desktopNav, backdrop, toast, already, main, footer, layout, teleports, script }
  }

  it('đặt inert lên header/nav/main/footer/teleport — không lên ngăn kéo, tổ tiên, nền mờ, vùng thông báo, script', () => {
    const p = page()
    inertOutside(p.drawer)
    for (const node of [p.header, p.desktopNav, p.main, p.footer, p.teleports]) assert.equal(node.hasAttribute('inert'), true, node.tagName)
    for (const node of [p.drawer, p.layout, p.backdrop, p.toast, p.script]) assert.equal(node.hasAttribute('inert'), false, node.tagName)
  })

  it('gỡ đúng những gì chính nó đặt — phần tử vốn đã inert vẫn inert', () => {
    const p = page()
    const release = inertOutside(p.drawer)
    release()
    for (const node of [p.header, p.desktopNav, p.main, p.footer, p.teleports]) assert.equal(node.hasAttribute('inert'), false, node.tagName)
    assert.equal(p.already.hasAttribute('inert'), true, 'inert có sẵn không phải của ngăn kéo — không được gỡ')
  })

  it('không đi quá <body> (không đụng <head>), và gỡ hai lần là vô hại', () => {
    const p = page()
    const release = inertOutside(p.drawer)
    assert.equal(p.html.kids[0]!.hasAttribute('inert'), false)
    release()
    p.main.setAttribute('inert', '') // một hộp thoại khác đặt sau đó
    release()
    assert.equal(p.main.hasAttribute('inert'), true)
  })
})

describe('ngăn kéo dùng createFocusReturn đúng chỗ (kiểm cấu trúc — không có DOM client để mount)', () => {
  // STRUCTURAL: focus() thật cần trình duyệt; chỉ chứng minh dây nối tồn tại.
  const src = readPart('DefaultMobileDrawer.vue')

  it('theo dõi isMobileMenuOpen, focus nút đóng khi mở, trả focus khi đóng', () => {
    assert.match(src, /createFocusReturn/)
    assert.match(src, /watch\(\s*\(\) => props\.isMobileMenuOpen/)
    assert.match(src, /closeBtn\.value\?\.focus\(\)/)
    assert.match(src, /focusReturn\.restore\(/)
    assert.match(src, /focusReturn\.remember\(/)
  })

  it('Escape vẫn đóng ngăn kéo', () => {
    assert.match(src, /@keydown\.escape="\$emit\('toggle-mobile-menu'\)"/)
  })
})
