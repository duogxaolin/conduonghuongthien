/**
 * The admin shell `app/layouts/admin.vue` — sidebar menu, top bar, mobile drawer — mounted
 * for real (tests/_admin-layout-harness.ts), written BEFORE the layout was split (wave3,
 * D-SPLIT) and green on the original: `ADMIN_LAYOUT_FILE=<copy of the original>` runs this
 * same suite on it.
 *
 * Pinned:
 *   - which menu entries an account sees, from a HAND-WRITTEN table of every entry and the
 *     grant that gates it (never read back from the layout's own menu — that would only test
 *     the menu against itself): each gate alone, none, SuperAdmin, `canRead` that is not
 *     `true`, no account at all;
 *   - what each link hands the router (`to`, `exact`, `active-class`, `exact-active-class`),
 *     the accordion opening itself when the route enters "Hệ thống & Cài đặt", the title of
 *     the current page in the top bar;
 *   - the mobile drawer (hamburger, backdrop, ✕, a navigation closes it) and the body scroll
 *     lock it holds; collapsing the sidebar;
 *   - the quick search (diacritics and `đ` ignored, accordion forced open, empty state, ✕ and
 *     "Xoá bộ lọc");
 *   - "Xoá cache": the request, the server's sentence or the fallback in a toast, the two
 *     buttons disabled while it runs and the function refusing a second purge on its own;
 *   - the four "Đăng xuất" buttons: `POST /api/admin/auth/logout`, then the login page —
 *     also when the request fails;
 *   - the account shown (initial, name, role / "SuperAdmin") and the page width read from
 *     `layout_config`.
 * Not measured here (no browser): CSS, which link the router highlights, focus moving to the
 * search box, hover of the account dropdown.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { click, fire, input } from './_sfc-mount.ts'
import {
  HOLD, account, accordionButton, adminLayoutServer, backdrops, buttonByText, buttonByTitle, container, dropped, findAll,
  groupTitles, h3Error, hasClass, isShown, isVisible, keyListeners, lastToast, linksTo, mainContent, menuLabels, menuLink,
  menuLinks, nav, one, openLayout, searchInput, sent, sidebar, superAdmin, textOf, topbar, words, type Grant, type LayoutCtx,
} from './_admin-layout-harness.ts'

// ─── The menu, written out by hand ───────────────────────────────────────────

type Gate = null | 'superadmin' | { resource: string }
type Entry = { group: string, sub?: string, label: string, icon: string, path: string, gate: Gate }
const read = (resource: string): Gate => ({ resource })

const SETTINGS_GROUP = 'Hệ thống & Cài đặt'
const MENU: Entry[] = [
  { group: 'Tổng quan', label: 'Dashboard', icon: 'fa-solid fa-chart-pie', path: '/admin', gate: null },
  { group: 'Tổng quan', label: 'Thống kê truy cập', icon: 'fa-solid fa-chart-line', path: '/admin/analytics', gate: read('analytics') },
  { group: 'Nội dung biên tập', label: 'Bài viết & Bản tin', icon: 'fa-solid fa-newspaper', path: '/admin/content/articles', gate: null },
  { group: 'Nội dung biên tập', label: 'Quản lý Trang', icon: 'fa-solid fa-file-lines', path: '/admin/content/pages', gate: read('pages') },
  { group: 'Nội dung biên tập', label: 'Thư viện Media', icon: 'fa-solid fa-images', path: '/admin/media', gate: null },
  { group: 'Nội dung biên tập', label: 'Danh mục', icon: 'fa-solid fa-folder-tree', path: '/admin/content/categories', gate: null },
  { group: 'Nội dung biên tập', label: 'Thể loại nội dung', icon: 'fa-solid fa-layer-group', path: '/admin/content/content-types', gate: null },
  { group: 'Nội dung biên tập', label: 'Menu chính (Navbar + ☰)', icon: 'fa-solid fa-bars-staggered', path: '/admin/content/navigation/navbar', gate: null },
  { group: 'Nội dung biên tập', label: 'Thanh nổi dưới (Mobile)', icon: 'fa-solid fa-mobile-screen', path: '/admin/content/navigation/mobile', gate: null },
  { group: 'Media & Livestream', label: 'Thư viện Video', icon: 'fa-solid fa-video', path: '/admin/media-portal', gate: read('media_portal') },
  { group: 'Media & Livestream', label: 'Danh mục Video', icon: 'fa-solid fa-folder-tree', path: '/admin/media-portal/categories', gate: read('media_portal') },
  { group: 'Media & Livestream', label: 'Livestream', icon: 'fa-solid fa-tower-broadcast', path: '/admin/livestream', gate: read('livestream') },
  { group: 'Media & Livestream', label: 'Cài đặt Media Portal', icon: 'fa-solid fa-sliders', path: '/admin/settings/media-portal', gate: read('settings') },
  { group: 'Trợ lý Chatbot', label: 'Kho nội dung Chatbot', icon: 'fa-solid fa-book-open', path: '/admin/chatbot/knowledge', gate: read('chatbot_knowledge') },
  { group: 'Trợ lý Chatbot', label: 'Phiên trò chuyện', icon: 'fa-solid fa-comments', path: '/admin/chatbot/sessions', gate: read('chatbot_knowledge') },
  { group: 'Trợ lý Chatbot', label: 'Cài đặt Chatbot', icon: 'fa-solid fa-robot', path: '/admin/chatbot/settings', gate: read('chatbot_settings') },
  { group: 'Tương tác công dân', label: 'Đơn đăng ký hỗ trợ', icon: 'fa-solid fa-envelope-open-text', path: '/admin/submissions', gate: null },
  { group: 'Tương tác công dân', label: 'Người đọc & bình luận', icon: 'fa-solid fa-user-group', path: '/admin/readers', gate: read('readers') },
  { group: 'Tương tác công dân', label: 'Kiểm duyệt bình luận', icon: 'fa-solid fa-comment-dots', path: '/admin/comments', gate: read('comments') },
  { group: 'AI & Tự động hóa', label: 'AI Panel', icon: 'fa-solid fa-microchip', path: '/admin/ai', gate: read('ai') },
  { group: 'AI & Tự động hóa', label: 'Kiểm duyệt An ninh', icon: 'fa-solid fa-shield-halved', path: '/admin/ai/moderation', gate: read('ai') },
  { group: SETTINGS_GROUP, sub: 'Tài khoản', label: 'Tài khoản của tôi', icon: 'fa-solid fa-user-gear', path: '/admin/profile', gate: null },
  { group: SETTINGS_GROUP, sub: 'Người dùng & Phân quyền', label: 'Người dùng', icon: 'fa-solid fa-users', path: '/admin/users', gate: null },
  { group: SETTINGS_GROUP, sub: 'Người dùng & Phân quyền', label: 'Vai trò & Phân quyền', icon: 'fa-solid fa-user-shield', path: '/admin/users/roles', gate: null },
  { group: SETTINGS_GROUP, sub: 'Người dùng & Phân quyền', label: 'Lịch sử hoạt động', icon: 'fa-solid fa-clock-rotate-left', path: '/admin/users/activity', gate: read('users') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Cài đặt chung', icon: 'fa-solid fa-gear', path: '/admin/settings/general', gate: null },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Cấu hình Email (SMTP)', icon: 'fa-solid fa-envelope', path: '/admin/settings/email', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Tracking & Marketing', icon: 'fa-solid fa-chart-simple', path: '/admin/settings/tracking', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Tự động dọn dữ liệu', icon: 'fa-solid fa-broom', path: '/admin/settings/data-retention', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Sitemap', icon: 'fa-solid fa-sitemap', path: '/admin/settings/sitemap', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Đăng nhập Google', icon: 'fa-solid fa-right-to-bracket', path: '/admin/settings/google-oauth', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Chặn địa chỉ IP', icon: 'fa-solid fa-ban', path: '/admin/settings/ip-bans', gate: read('readers') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Bắt buộc xác thực hai bước', icon: 'fa-solid fa-shield-halved', path: '/admin/settings/security', gate: 'superadmin' },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Ngôn ngữ & Bản dịch', icon: 'fa-solid fa-language', path: '/admin/languages', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Mạng xã hội', icon: 'fa-solid fa-share-nodes', path: '/admin/settings/social-links', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Lưu trữ Media (R2)', icon: 'fa-solid fa-cloud-arrow-up', path: '/admin/settings/media-storage', gate: null },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Sao lưu & Khôi phục', icon: 'fa-solid fa-floppy-disk', path: '/admin/settings/backup', gate: read('settings') },
  { group: SETTINGS_GROUP, sub: 'Cài đặt', label: 'Tài liệu hệ thống', icon: 'fa-solid fa-circle-question', path: '/admin/docs', gate: read('settings') },
]
const GROUPS = [...new Set(MENU.map(e => e.group))]
const RESOURCES = [...new Set(MENU.flatMap(e => (e.gate && e.gate !== 'superadmin' ? [e.gate.resource] : [])))].sort()
const labels = (match: (e: Entry) => boolean) => MENU.filter(match).map(e => e.label)
const ungated = (e: Entry) => e.gate === null

/** The highlight a flat-group link hands the router; the accordion's links use a slimmer bar. */
const FLAT_ACTIVE = '!bg-gradient-to-r !from-brand-700 !to-[#1f5225] !text-white !font-semibold shadow-[0_3px_12px_rgba(44,110,51,0.35)] border border-brand-300/30 before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:bg-brand-300 before:rounded-r-full'
const SUB_ACTIVE = '!bg-gradient-to-r !from-brand-700 !to-[#1f5225] !text-white !font-semibold shadow-[0_2px_8px_rgba(44,110,51,0.35)] border border-brand-300/30 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-brand-300 before:rounded-r-full'

const iconOf = (link: ReturnType<typeof menuLink>) => {
  const icon = findAll(link, el => el.tag === 'i')[0]
  return String(icon?.props.class ?? '').split(/\s+/).filter(c => c.startsWith('fa-')).slice(0, 2).join(' ')
}

describe('menu entries follow the account\'s grants (hand-written table)', () => {
  it('an account with no grant sees exactly the ungated entries, in order, with their icons and targets', async (t) => {
    const ctx = await openLayout(t, { user: account('congtacvien') })
    assert.deepEqual(menuLabels(ctx), labels(ungated))
    for (const entry of MENU.filter(ungated)) {
      const link = menuLink(ctx, entry.label)
      assert.equal(link.props.to, entry.path, entry.label)
      assert.equal(iconOf(link), entry.icon, entry.label)
    }
    // A group whose every entry is gated keeps its heading over an empty list (pinned as is).
    assert.deepEqual(groupTitles(ctx), GROUPS)
  })

  for (const resource of RESOURCES) {
    it(`"${resource}.read" alone adds exactly the entries it gates`, async (t) => {
      const ctx = await openLayout(t, { user: account('bientap', [{ resource }]) })
      assert.deepEqual(menuLabels(ctx), labels(e => ungated(e) || (typeof e.gate === 'object' && e.gate?.resource === resource)))
      for (const entry of MENU.filter(e => typeof e.gate === 'object' && e.gate?.resource === resource)) {
        assert.equal(menuLink(ctx, entry.label).props.to, entry.path, entry.label)
        assert.equal(iconOf(menuLink(ctx, entry.label)), entry.icon, entry.label)
      }
    })
  }

  it('a grant that is not exactly `canRead: true` shows nothing (null, false, or another action only)', async (t) => {
    const grants: Grant[] = RESOURCES.flatMap((resource, i) => [
      { resource, canRead: i % 2 ? null : false, canCreate: true, canUpdate: true, canDelete: true },
    ])
    const ctx = await openLayout(t, { user: account('bientap', grants) })
    assert.deepEqual(menuLabels(ctx), labels(ungated))
  })

  it('every grant short of SuperAdmin shows everything but the MFA policy entry', async (t) => {
    const ctx = await openLayout(t, { user: account('truongphong', RESOURCES.map(resource => ({ resource }))) })
    assert.deepEqual(menuLabels(ctx), labels(e => e.gate !== 'superadmin'))
  })

  it('SuperAdmin sees every entry, the MFA policy entry included', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    assert.deepEqual(menuLabels(ctx), labels(() => true))
    for (const entry of MENU) {
      assert.equal(menuLink(ctx, entry.label).props.to, entry.path, entry.label)
      assert.equal(iconOf(menuLink(ctx, entry.label)), entry.icon, entry.label)
    }
  })

  it('no account (signed out) leaves only the ungated entries and no account card or chip', async (t) => {
    const ctx = await openLayout(t, { user: null })
    assert.deepEqual(menuLabels(ctx), labels(ungated))
    assert.equal(findAll(sidebar(ctx), el => el.tag === 'nuxt-link' && el.props.to === '/admin/profile').length, 1, 'only the menu entry, no account card')
    assert.equal(linksTo(topbar(ctx), '/admin/profile').length, 0)
    assert.equal(findAll(topbar(ctx), el => el.tag === 'button' && textOf(el).includes('Đăng xuất')).length, 0)
  })

  it('the accordion groups its entries under three sub-headings and counts them', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    const subTitles = findAll(nav(ctx), el => el.tag === 'div' && String(el.props.class ?? '').startsWith('text-[0.64rem] uppercase')).map(textOf)
    assert.deepEqual(subTitles, ['Tài khoản', 'Người dùng & Phân quyền', 'Cài đặt'])
    assert.equal(words(accordionButton(ctx)), `${SETTINGS_GROUP} ${MENU.filter(e => e.group === SETTINGS_GROUP).length}`)
    const editor = await openLayout(t, { user: account('bientap') })
    assert.equal(words(accordionButton(editor)), `${SETTINGS_GROUP} ${MENU.filter(e => e.group === SETTINGS_GROUP && ungated(e)).length}`)
  })
})

describe('the route: what each link hands the router, the accordion, the page title', () => {
  it('Dashboard is exact-only; every other flat entry highlights by prefix; accordion entries carry the slim bar', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    for (const entry of MENU) {
      const link = menuLink(ctx, entry.label)
      if (entry.group === SETTINGS_GROUP) {
        assert.equal(link.props['active-class'], SUB_ACTIVE, entry.label)
        assert.equal(link.props['exact-active-class'], undefined, entry.label)
        assert.equal(link.props.exact, undefined, entry.label)
      } else {
        assert.equal(link.props.exact, entry.path === '/admin', entry.label)
        assert.equal(link.props['active-class'], entry.path === '/admin' ? '' : FLAT_ACTIVE, entry.label)
        assert.equal(link.props['exact-active-class'], FLAT_ACTIVE, entry.label)
      }
      assert.equal(link.props.title, entry.label)
    }
  })

  it('the accordion, closed by hand, opens itself when the route enters one of its pages — not for other pages', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    const body = () => accordionButton(ctx).parent!.children.find(c => c.kind === 'element' && c.tag === 'div' && c.shown !== undefined) as Parameters<typeof isShown>[0]
    assert.equal(accordionButton(ctx).props['aria-expanded'], true, 'open by default')
    await click(accordionButton(ctx))
    await ctx.settle()
    assert.equal(accordionButton(ctx).props['aria-expanded'], false)
    assert.equal(isShown(body()), false)
    assert.ok(!menuLabels(ctx).includes('Sao lưu & Khôi phục'))

    await ctx.go('/admin/content/articles', 'admin-content-articles')
    assert.equal(accordionButton(ctx).props['aria-expanded'], false, 'a page outside the group leaves it closed')
    await ctx.go('/admin/content/articles?page=2', 'admin-content-articles')
    assert.equal(accordionButton(ctx).props['aria-expanded'], false)

    await ctx.go('/admin/settings/backup', 'admin-settings-backup')
    assert.equal(accordionButton(ctx).props['aria-expanded'], true)
    assert.equal(isShown(body()), true)

    await click(accordionButton(ctx))
    await ctx.settle()
    await ctx.go('/admin/users/roles/7', undefined)
    assert.equal(accordionButton(ctx).props['aria-expanded'], true, 'a page below an entry counts (prefix + "/")')

    await click(accordionButton(ctx))
    await ctx.settle()
    await ctx.go('/admin/users-export', undefined)
    assert.equal(accordionButton(ctx).props['aria-expanded'], false, 'a mere string prefix does not')
  })

  it('the accordion is open on a first load inside the group, and toggles by hand', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin(), path: '/admin/settings/general', name: 'admin-settings-general' })
    assert.equal(accordionButton(ctx).props['aria-expanded'], true)
    await click(accordionButton(ctx))
    await ctx.settle()
    assert.equal(accordionButton(ctx).props['aria-expanded'], false)
    await click(accordionButton(ctx))
    await ctx.settle()
    assert.equal(accordionButton(ctx).props['aria-expanded'], true)
  })

  it('the top bar names the current page from the route name, with a readable fallback', async (t) => {
    const ctx = await openLayout(t)
    const title = () => textOf(one(findAll(topbar(ctx), el => el.tag === 'span' && String(el.props.class ?? '') === 'text-brand-950 font-bold'), 'page title'))
    assert.equal(title(), 'Dashboard')
    for (const [path, name, expected] of [
      ['/admin/content/articles/12', 'admin-content-articles-id', 'Chỉnh sửa bài viết'],
      ['/admin/settings/security', 'admin-settings-security', 'Bắt buộc xác thực hai bước'],
      ['/admin/ai', 'admin-ai', 'Kiểm duyệt an ninh AI'],
      ['/admin/media/scan', 'admin-media-scan', 'media scan'],
      ['/admin/x', undefined, 'Admin'],
    ] as const) {
      await ctx.go(path, name)
      assert.equal(title(), expected, path)
    }
    assert.match(words(topbar(ctx)), /^Con Đường Hướng Thiện \/ Admin Xoá cache/)
  })
})

describe('the mobile drawer and the collapsed sidebar', () => {
  const hamburger = (ctx: LayoutCtx) => one(findAll(topbar(ctx), el => el.tag === 'button' && findAll(el, i => i.tag === 'i' && String(i.props.class) === 'fa-solid fa-bars').length === 1), 'hamburger')
  const opened = (ctx: LayoutCtx) => hasClass(sidebar(ctx), 'is-open')

  it('the hamburger opens it over a backdrop and locks the page scroll; the backdrop closes it and unlocks', async (t) => {
    const ctx = await openLayout(t)
    assert.equal(opened(ctx), false)
    assert.equal(backdrops(ctx).length, 0)
    assert.deepEqual(ctx.lock(), { body: '', html: '', touch: '' })

    await click(hamburger(ctx))
    await ctx.settle()
    assert.equal(opened(ctx), true)
    assert.equal(backdrops(ctx).length, 1)
    assert.equal(String(backdrops(ctx)[0]!.props.class), 'fixed inset-0 bg-black/50 z-40 lg:hidden')
    assert.ok(backdrops(ctx)[0]!.props.onTouchmove, 'touch scrolling on the backdrop is swallowed')
    assert.deepEqual(ctx.lock(), { body: 'hidden', html: 'hidden', touch: 'none' })

    await click(backdrops(ctx)[0]!)
    await ctx.settle()
    assert.equal(opened(ctx), false)
    assert.equal(backdrops(ctx).length, 0)
    assert.deepEqual(ctx.lock(), { body: '', html: '', touch: '' })
  })

  it('✕ in the drawer and a second tap on the hamburger close it too', async (t) => {
    const ctx = await openLayout(t)
    await click(hamburger(ctx))
    await ctx.settle()
    await click(buttonByTitle(sidebar(ctx), 'Đóng menu'))
    await ctx.settle()
    assert.equal(opened(ctx), false)
    assert.deepEqual(ctx.lock(), { body: '', html: '', touch: '' })

    await click(hamburger(ctx))
    await ctx.settle()
    await click(hamburger(ctx))
    await ctx.settle()
    assert.equal(opened(ctx), false)
    assert.equal(backdrops(ctx).length, 0)
  })

  it('a navigation closes it — also one that only changes the query', async (t) => {
    const ctx = await openLayout(t, { path: '/admin/content/articles', name: 'admin-content-articles' })
    await click(hamburger(ctx))
    await ctx.settle()
    await ctx.go('/admin/content/articles?page=2', 'admin-content-articles')
    assert.equal(opened(ctx), false)
    assert.deepEqual(ctx.lock(), { body: '', html: '', touch: '' })
    await click(hamburger(ctx))
    await ctx.settle()
    await ctx.go('/admin/media', 'admin-media')
    assert.equal(opened(ctx), false)
  })

  it('pinned as is: leaving the layout with the drawer open (no navigation first) leaves the page scroll locked', async (t) => {
    const ctx = await openLayout(t)
    await click(hamburger(ctx))
    await ctx.settle()
    ctx.close()
    assert.deepEqual(ctx.lock(), { body: 'hidden', html: 'hidden', touch: 'none' })
  })

  it('collapsing narrows the sidebar to icons; the brand and the search button expand it again', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    await click(buttonByTitle(sidebar(ctx), 'Thu gọn sidebar'))
    await ctx.settle()
    assert.ok(hasClass(sidebar(ctx), 'collapsed'))
    assert.ok(hasClass(mainContent(ctx), 'sidebar-collapsed'))
    assert.equal(findAll(sidebar(ctx), el => el.tag === 'input').length, 0, 'no search box in the icon rail')
    assert.ok(!textOf(sidebar(ctx)).includes('HƯỚNG THIỆN'))
    // Icons only: no label text, no group heading; the accordion's entries are all shown, flat.
    assert.equal(findAll(nav(ctx), el => el.tag === 'span' && String(el.props.class ?? '').startsWith('truncate')).length, 0)
    assert.deepEqual(groupTitles(ctx), [])
    assert.deepEqual(menuLabels(ctx), labels(() => true))
    assert.equal(textOf(nav(ctx)), '')
    for (const link of menuLinks(ctx)) assert.match(String(link.props.class), /w-10 h-10 mx-auto justify-center/)
    // The account card shrinks to the initial, its title naming account and role.
    const card = one(findAll(sidebar(ctx), el => el.tag === 'nuxt-link' && String(el.props.title ?? '').endsWith('- Tài khoản')), 'collapsed account card')
    assert.equal(card.props.title, 'quantri (SuperAdmin) - Tài khoản')
    assert.equal(textOf(card), 'Q')

    const brand = one(findAll(sidebar(ctx), el => el.tag === 'div' && el.props.title === 'Mở rộng menu'), 'collapsed brand')
    await click(brand)
    await ctx.settle()
    assert.ok(!hasClass(sidebar(ctx), 'collapsed'))
    assert.ok(!hasClass(mainContent(ctx), 'sidebar-collapsed'))

    await click(buttonByTitle(sidebar(ctx), 'Thu gọn sidebar'))
    await ctx.settle()
    await click(buttonByTitle(sidebar(ctx), 'Tìm kiếm chức năng (Mở rộng)'))
    await ctx.settle()
    assert.ok(!hasClass(sidebar(ctx), 'collapsed'))
    assert.equal(findAll(sidebar(ctx), el => el.tag === 'input').length, 1, 'the search box is back (focus is not measured here)')
  })

  it('the layout handles no key at all (Escape does not close the drawer) — pinned as is', async (t) => {
    const ctx = await openLayout(t)
    await click(hamburger(ctx))
    await ctx.settle()
    assert.deepEqual(keyListeners(ctx).map(el => el.tag), [])
  })
})

describe('the quick search over the menu', () => {
  it('matches without diacritics or đ, forces the accordion open and recounts it; hides the public-site link', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    await click(accordionButton(ctx))
    await ctx.settle()
    assert.ok(linksTo(sidebar(ctx), '/').length === 1)

    await input(searchInput(ctx), 'email')
    await ctx.settle()
    assert.deepEqual(menuLabels(ctx), ['Cấu hình Email (SMTP)'])
    assert.deepEqual(groupTitles(ctx), [SETTINGS_GROUP])
    assert.equal(accordionButton(ctx).props['aria-expanded'], true, 'searching opens the closed accordion')
    assert.equal(words(accordionButton(ctx)), `${SETTINGS_GROUP} 1`)
    assert.equal(linksTo(sidebar(ctx), '/').length, 0, 'the public-site link gives way to the results')

    for (const [query, expected] of [
      ['nguoi dung', ['Người dùng']],
      ['ĐĂNG NHẬP', ['Đăng nhập Google']],
      ['dang ky', ['Đơn đăng ký hỗ trợ']],
      ['  kiem duyet  ', ['Kiểm duyệt bình luận', 'Kiểm duyệt An ninh']],
      ['video', ['Thư viện Video', 'Danh mục Video']],
    ] as const) {
      await input(searchInput(ctx), query)
      await ctx.settle()
      assert.deepEqual(menuLabels(ctx), expected, query)
    }
  })

  it('only the account\'s entries are searched', async (t) => {
    const ctx = await openLayout(t, { user: account('bientap') })
    await input(searchInput(ctx), 'video')
    await ctx.settle()
    assert.deepEqual(menuLabels(ctx), [])
  })

  it('no match shows the empty state with the query; "Xoá bộ lọc" and ✕ bring the whole menu back', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    await input(searchInput(ctx), 'zzz')
    await ctx.settle()
    assert.deepEqual(menuLabels(ctx), [])
    assert.equal(words(nav(ctx)), 'Không tìm thấy chức năng "zzz" Xoá bộ lọc')
    await click(buttonByText(nav(ctx), 'Xoá bộ lọc'))
    await ctx.settle()
    assert.equal(searchInput(ctx).model?.value, '')
    assert.deepEqual(menuLabels(ctx), labels(() => true))

    await input(searchInput(ctx), 'sitemap')
    await ctx.settle()
    assert.deepEqual(menuLabels(ctx), ['Sitemap'])
    await click(buttonByTitle(sidebar(ctx), 'Xoá tìm kiếm'))
    await ctx.settle()
    assert.equal(searchInput(ctx).model?.value, '')
    assert.deepEqual(menuLabels(ctx), labels(() => true))
    assert.equal(findAll(sidebar(ctx), el => el.tag === 'button' && el.props.title === 'Xoá tìm kiếm').length, 0, '✕ only while there is a query')
  })

  it('pinned as is: collapsing during a search keeps the icon rail filtered, with no search box left to clear it', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    await input(searchInput(ctx), 'zzz')
    await ctx.settle()
    await click(buttonByTitle(sidebar(ctx), 'Thu gọn sidebar'))
    await ctx.settle()
    assert.equal(findAll(sidebar(ctx), el => el.tag === 'input').length, 0)
    assert.deepEqual(menuLabels(ctx), [])
    assert.equal(words(nav(ctx)), 'Không tìm thấy chức năng "zzz" Xoá bộ lọc', 'the empty state squeezed into the 70 px rail')
  })

  it('a blank query is no search', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    await click(accordionButton(ctx))
    await ctx.settle()
    await input(searchInput(ctx), '   ')
    await ctx.settle()
    assert.equal(accordionButton(ctx).props['aria-expanded'], false)
    assert.deepEqual(menuLabels(ctx), labels(e => e.group !== SETTINGS_GROUP))
  })
})

describe('"Xoá cache" — the public SWR cache purge', () => {
  const topButton = (ctx: LayoutCtx) => one(findAll(topbar(ctx), el => el.tag === 'button' && String(el.props.title ?? '').length > 0 && /cache/i.test(String(el.props.title))), 'top-bar cache button')
  const dropdownButton = (ctx: LayoutCtx) => one(findAll(topbar(ctx), el => el.tag === 'button' && /cache Website|Đang xoá cache…/.test(textOf(el)) && el.props.title === undefined), 'dropdown cache button')

  it('sends the confirmed purge and shows the server\'s sentence; both buttons are busy meanwhile', async (t) => {
    const server = adminLayoutServer()
    server.state.override = call => (call.url.pathname === '/api/admin/cache-clear' ? HOLD : undefined)
    const ctx = await openLayout(t, {}, server)
    assert.equal(textOf(topButton(ctx)), 'Xoá cache')
    assert.equal(topButton(ctx).props.disabled, false)
    const from = ctx.calls.length

    // Not awaited: the handler may return the purge itself, which is held until answered below.
    const purging = click(topButton(ctx))
    await ctx.settle()
    assert.deepEqual(sent(ctx.calls, from), [{ wire: 'POST /api/admin/cache-clear', body: { confirm: true } }])
    assert.equal(topButton(ctx).props.disabled, true)
    assert.equal(dropdownButton(ctx).props.disabled, true)
    assert.equal(textOf(topButton(ctx)), 'Đang xoá…')
    assert.equal(topButton(ctx).props.title, 'Đang xoá cache…')
    assert.match(String(topButton(ctx).props.class), /opacity-60 cursor-wait/)
    assert.equal(textOf(dropdownButton(ctx)), 'Đang xoá cache…')
    assert.match(String(findAll(topButton(ctx), el => el.tag === 'i')[0]!.props.class), /fa-spinner fa-spin/)
    assert.match(String(findAll(dropdownButton(ctx), el => el.tag === 'i')[0]!.props.class), /fa-spinner fa-spin/)

    // The function refuses a second purge by itself, not only through `disabled`.
    await fire(dropdownButton(ctx), 'click')
    await fire(topButton(ctx), 'click')
    await ctx.settle()
    assert.equal(ctx.calls.length - from, 1, 'one purge in flight at a time')

    server.answer(ctx.calls.at(-1)!)
    await purging
    await ctx.settle()
    assert.deepEqual(ctx.toasts, [{ type: 'success', message: 'Đã xoá 3 mục cache. Trang công khai sẽ dựng lại từ dữ liệu mới.' }])
    assert.equal(topButton(ctx).props.disabled, false)
    assert.equal(dropdownButton(ctx).props.disabled, false)
    assert.equal(textOf(topButton(ctx)), 'Xoá cache')
    assert.equal(textOf(dropdownButton(ctx)), 'Xoá cache Website')
    assert.match(String(findAll(topButton(ctx), el => el.tag === 'i')[0]!.props.class), /fa-broom/)
  })

  it('the dropdown entry purges too; an answer without a sentence gets the counted fallback', async (t) => {
    const server = adminLayoutServer()
    server.state.override = call => (call.url.pathname === '/api/admin/cache-clear' ? h3OkWithoutMessage() : undefined)
    const ctx = await openLayout(t, {}, server)
    await click(dropdownButton(ctx))
    await ctx.settle()
    assert.deepEqual(ctx.toasts, [{ type: 'success', message: 'Đã xoá 5 mục cache.' }])
  })

  it('a refusal shows the server\'s sentence; a dropped request the fallback; the buttons come back', async (t) => {
    const server = adminLayoutServer()
    let answer: Response | Error = h3Error(403, 'Bạn không có quyền thực hiện thao tác này')
    server.state.override = call => (call.url.pathname === '/api/admin/cache-clear' ? answer : undefined)
    const ctx = await openLayout(t, {}, server)
    await click(topButton(ctx))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Bạn không có quyền thực hiện thao tác này')
    assert.equal(topButton(ctx).props.disabled, false)

    answer = dropped()
    await click(dropdownButton(ctx))
    await ctx.settle()
    assert.equal(lastToast(ctx.toasts, 'error'), 'Không thể xoá cache. Thử lại sau ít phút.')
    assert.equal(ctx.toasts.filter(x => x.type === 'success').length, 0)
    assert.equal(dropdownButton(ctx).props.disabled, false)
    assert.equal(ctx.layout.errors.length, 0, 'a failed purge is handled, not thrown')
  })
})

function h3OkWithoutMessage() {
  return new Response(JSON.stringify({ ok: true, cleared: 5, message: '' }), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('"Đăng xuất" — four buttons, one sign-out', () => {
  const logoutButtons = (ctx: LayoutCtx) => ({
    sidebarCard: buttonByTitle(sidebar(ctx), 'Đăng xuất khỏi hệ thống'),
    topbarMobile: buttonByTitle(topbar(ctx), 'Đăng xuất'),
    dropdown: buttonByText(topbar(ctx), 'Đăng xuất'),
  })

  for (const which of ['sidebarCard', 'topbarMobile', 'dropdown', 'sidebarCollapsed'] as const) {
    it(`${which}: POST /api/admin/auth/logout, then the login page, and the account is gone from the shell`, async (t) => {
      const ctx = await openLayout(t, { user: account('bientap') })
      if (which === 'sidebarCollapsed') {
        await click(buttonByTitle(sidebar(ctx), 'Thu gọn sidebar'))
        await ctx.settle()
      }
      const from = ctx.calls.length
      const button = which === 'sidebarCollapsed' ? buttonByTitle(sidebar(ctx), 'Đăng xuất') : logoutButtons(ctx)[which]
      await click(button)
      await ctx.settle()
      assert.deepEqual(sent(ctx.calls, from), ['POST /api/admin/auth/logout'])
      assert.deepEqual(ctx.navigations, ['/admin/login'])
      assert.equal(ctx.user.value, null)
      assert.equal(findAll(sidebar(ctx), el => el.tag === 'button' && /Đăng xuất/.test(String(el.props.title ?? ''))).length, 0)
      assert.equal(linksTo(topbar(ctx), '/admin/profile').length, 0)
      assert.deepEqual(ctx.layout.errors, [])
    })
  }

  it('a failed sign-out request still signs out and leaves for the login page (the rejection reaches Vue\'s error handler — pinned as is)', async (t) => {
    const server = adminLayoutServer()
    server.state.override = call => (call.url.pathname === '/api/admin/auth/logout' ? dropped() : undefined)
    const ctx = await openLayout(t, { user: account('bientap') }, server)
    await click(buttonByTitle(sidebar(ctx), 'Đăng xuất khỏi hệ thống'))
    await ctx.settle()
    assert.deepEqual(ctx.navigations, ['/admin/login'])
    assert.equal(ctx.user.value, null)
    assert.equal(ctx.layout.errors.length, 1)
    assert.match(String(ctx.layout.errors[0]), /fetch failed|<no response>/)
  })
})

describe('the account shown, the links around it, the page width', () => {
  it('the sidebar card, the mobile chip and the dropdown name the account and its role', async (t) => {
    const ctx = await openLayout(t, { user: account('bientap', [], { roleName: 'Biên tập viên' }) })
    const card = one(findAll(sidebar(ctx), el => el.tag === 'nuxt-link' && el.props.title === 'Trang tài khoản của tôi'), 'account card')
    assert.equal(card.props.to, '/admin/profile')
    assert.equal(words(card), 'B bientap Biên tập viên')
    const chip = one(findAll(topbar(ctx), el => el.tag === 'nuxt-link' && el.props.title === 'bientap - Tài khoản'), 'mobile chip')
    assert.equal(words(chip), 'B')
    assert.equal(chip.props.to, '/admin/profile')
    assert.equal(words(topbar(ctx)), 'Con Đường Hướng Thiện / Dashboard Xoá cache B B bientap bientap Biên tập viên Tài khoản của tôi Xem Website ↗ Xoá cache Website Đăng xuất')
    // The account page is reachable from the menu, the card, the chip and the dropdown.
    assert.equal(findAll(ctx.layout.root, el => el.tag === 'nuxt-link' && el.props.to === '/admin/profile').length, 4)
    // The public site always opens in a new tab.
    const publicLinks = findAll(ctx.layout.root, el => el.tag === 'nuxt-link' && el.props.to === '/')
    assert.equal(publicLinks.length, 2)
    for (const link of publicLinks) assert.equal(link.props.target, '_blank')
  })

  it('SuperAdmin reads "SuperAdmin" instead of a role; no role reads nothing', async (t) => {
    const ctx = await openLayout(t, { user: superAdmin() })
    assert.equal(words(one(findAll(sidebar(ctx), el => el.tag === 'nuxt-link' && el.props.title === 'Trang tài khoản của tôi'), 'card')), 'Q quantri SuperAdmin')
    assert.match(words(topbar(ctx)), /quantri SuperAdmin Tài khoản của tôi/)
    const none = await openLayout(t, { user: account('khach', [], { roleName: null }) })
    assert.equal(words(one(findAll(sidebar(none), el => el.tag === 'nuxt-link' && el.props.title === 'Trang tài khoản của tôi'), 'card')), 'K khach')
  })

  it('the page width comes from `layout_config` — a preset, a custom width, and the 1240 px default when absent, invalid or unreadable', async (t) => {
    const width = async (layoutConfig: string | undefined, fail = false) => {
      const server = adminLayoutServer()
      server.state.layoutConfig = layoutConfig
      if (fail) server.state.override = call => (call.url.pathname === '/api/public/settings' ? h3Error(503, 'Service Unavailable') : undefined)
      const ctx = await openLayout(t, {}, server)
      assert.deepEqual(ctx.asyncKeys, ['admin-layout-config'])
      assert.equal(ctx.calls.filter(c => c.url.pathname === '/api/public/settings').length >= 1, true)
      return container(ctx).props.style
    }
    assert.deepEqual(await width(JSON.stringify({ containerWidth: 'wide' })), { '--container-max': '1440px' })
    assert.deepEqual(await width(JSON.stringify({ containerWidth: 'custom', containerCustom: 1600 })), { '--container-max': '1600px' })
    assert.deepEqual(await width(JSON.stringify({ containerWidth: 'compact' })), { '--container-max': '1152px' })
    assert.deepEqual(await width(undefined), { '--container-max': '1240px' })
    assert.deepEqual(await width('{not json'), { '--container-max': '1240px' })
    assert.deepEqual(await width(JSON.stringify({ containerWidth: 'wide' }), true), { '--container-max': '1240px' })
  })

  it('the shell renders the toasts, the MFA banner, the page slot and the two global dialogs', async (t) => {
    const ctx = await openLayout(t)
    const tags = findAll(ctx.layout.root, el => /^(ToastContainer|AdminMfaEnrollmentBanner|AdminMediaLibraryModal|AdminConfirmModal)$/.test(el.tag)).map(el => el.tag)
    assert.deepEqual(tags, ['ToastContainer', 'AdminMfaEnrollmentBanner', 'AdminMediaLibraryModal', 'AdminConfirmModal'])
    assert.equal(container(ctx).children.filter(c => c.kind === 'element').map(c => (c as { tag: string }).tag).join(), 'AdminMfaEnrollmentBanner')
    assert.ok(isVisible(container(ctx)))
  })
})
