/**
 * D-FETCH lot G — the two public views that read `/api/public/settings` (and, for the print
 * page, the article) through `publicFetch<T>()` now: `/in-bai/<slug>` (the newspaper print
 * page) and the public layout `layouts/default.vue`. Mounted for real
 * (tests/_public-mount-harness.ts) over REAL ofetch on a fake network.
 *
 * Both reads are SSR reads — inside `useAsyncData`, not lazy — so the HTML the server sends
 * (and the SWR cache replays) already carries the article / the site's contact details and
 * layout. Pinned: the registrations (key, flags, `default()`), that each request is made
 * inside its `useAsyncData` handler (`via: 'asyncData'`), the wire, and what renders for a
 * good and a failed answer. Green on the base tree (5f1bb07d, casts) and on lot G alike.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Vue from 'vue'

import { byTag, h3Error, json, mountPublic, routes, sent, settle, Stub, words, type NetCall } from './_public-mount-harness.ts'

const ARTICLE = {
  ok: true,
  article: {
    id: 7, type: 'news', category: null, categoryId: 2, categoryName: 'Tin hoạt động', categorySlug: 'tin-hoat-dong',
    title: 'Hành trình trở về', slug: 'hanh-trinh', excerpt: 'Sapo của bài', content: '<p>Thân bài</p>',
    thumbnailUrl: null, publishedAt: '2026-10-20T03:00:00.000Z', createdAt: '2026-10-19T03:00:00.000Z', authorName: 'bientap', viewTotal: 1234,
  },
}
const SETTINGS = {
  ok: true,
  settings: {
    hotline: '0912 345 678', email: 'lienhe@example.vn', address: 'Hà Nội',
    logo_url: '/uploads/logo.png', main_logo_url: ' /uploads/chu-quan.png ',
    layout_config: JSON.stringify({ containerWidth: 'custom', containerCustom: 1366 }),
  },
}

// ─── /in-bai/<slug> ──────────────────────────────────────────────────────────

async function openPrint(t: Parameters<typeof mountPublic>[0], table: Record<string, (call: NetCall) => Response | Error | undefined>, lang = 'vi') {
  // The page prints 400 ms after mount through the global `window`: mocked timers keep one
  // test's timer from firing into the next test's window (they are dropped with the test).
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let printed = 0
  const ctx = await mountPublic(t, {
    file: 'pages/in-bai/[slug].vue',
    route: { path: '/in-bai/hanh-trinh', params: { slug: 'hanh-trinh' }, query: { back: '/news' } },
    lang,
    responder: routes(table),
    auto: { useBrokenImageFallback: () => {} },
    components: { PublicEmail: Stub },
    globals: { window: { print: () => { printed += 1 }, location: { origin: 'http://portal.test' } } },
  })
  await settle()
  return { ...ctx, printed: () => printed }
}
const headline = (page: Parameters<typeof byTag>[0]) => words(byTag(page, 'h1').find(el => el.props.class === 'print-headline')!)

describe('/in-bai/<slug> over publicFetch', () => {
  it('two SSR reads (not lazy): the article in the page language, and the site settings', async (t) => {
    const ctx = await openPrint(t, {
      'GET /api/public/articles/hanh-trinh': () => json(ARTICLE),
      'GET /api/public/settings': () => json(SETTINGS),
    })
    assert.deepEqual(ctx.registrations, [
      { key: 'article-print-hanh-trinh-vi', lazy: undefined, server: undefined, immediate: undefined, default: undefined, watch: 2, getCachedData: false },
      { key: 'article-print-settings', lazy: undefined, server: undefined, immediate: undefined, default: 'null', watch: 0, getCachedData: false },
    ])
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/articles/hanh-trinh?lang=vi', 'asyncData: GET /api/public/settings'])
    assert.equal(headline(ctx.page), 'Hành trình trở về')
    assert.match(words(ctx.page), /Tin hoạt động/)
    assert.match(words(ctx.page), /Hà Nội · Đường dây nóng: 0912 345 678/)
    assert.deepEqual(byTag(ctx.page, 'img').map(img => img.props.src), ['/uploads/chu-quan.png', '/uploads/logo.png'])
    assert.equal(ctx.seo().title, 'Hành trình trở về | Con Đường Hướng Thiện (Bản in)')
  })

  it('switching the language reads the article again with ?lang=, settings stay', async (t) => {
    const ctx = await openPrint(t, {
      'GET /api/public/articles/hanh-trinh': call => json({ ...ARTICLE, article: { ...ARTICLE.article, title: call.url.searchParams.get('lang') === 'en' ? 'The way home' : ARTICLE.article.title } }),
      'GET /api/public/settings': () => json(SETTINGS),
    })
    ctx.currentLang.value = 'en'
    await settle()
    assert.deepEqual(sent(ctx.calls).slice(2), ['asyncData: GET /api/public/articles/hanh-trinh?lang=en'])
    assert.equal(headline(ctx.page), 'The way home')
  })

  it('a failed article read shows the error block (role=alert), never an empty sheet; settings failing falls back', async (t) => {
    const ctx = await openPrint(t, {
      'GET /api/public/articles/hanh-trinh': () => h3Error(404, 'Bài viết không tồn tại hoặc chưa xuất bản.'),
      'GET /api/public/settings': () => h3Error(503, 'Service Unavailable'),
    })
    const alerts = byTag(ctx.page, 'div').filter(el => el.props.role === 'alert')
    assert.equal(alerts.length, 1)
    assert.equal(byTag(ctx.page, 'article').length, 0)
    assert.equal(byTag(ctx.page, 'h1').length, 0)
  })

  it('prints once the article is there (after mount, 400 ms)', async (t) => {
    const ok = await openPrint(t, {
      'GET /api/public/articles/hanh-trinh': () => json(ARTICLE),
      'GET /api/public/settings': () => json(SETTINGS),
    })
    t.mock.timers.tick(399)
    assert.equal(ok.printed(), 0)
    t.mock.timers.tick(1)
    assert.equal(ok.printed(), 1)
  })

  it('does not print when the article failed', async (t) => {
    const failed = await openPrint(t, {
      'GET /api/public/articles/hanh-trinh': () => h3Error(500, 'Lỗi máy chủ'),
      'GET /api/public/settings': () => json(SETTINGS),
    })
    t.mock.timers.tick(400)
    assert.equal(failed.printed(), 0)
  })
})

// ─── layouts/default.vue ─────────────────────────────────────────────────────

async function openLayout(t: Parameters<typeof mountPublic>[0], settings: () => Response | Error) {
  const navCalls: string[] = []
  const toast = { error: () => {}, success: () => {}, info: () => {}, warning: () => {} }
  const ctx = await mountPublic(t, {
    file: 'layouts/default.vue',
    route: { path: '/news' },
    responder: routes({ 'GET /api/public/settings': settings }),
    suspense: true,
    auto: { useToast: () => toast, resolveComponent: () => 'nuxt-link' },
    modules: {
      '~/composables/useLiveSearch': {
        useLiveSearch: () => ({
          searchQuery: Vue.ref(''), isSearchActive: Vue.ref(false), liveSearchResults: Vue.ref([]), isSearchingLive: Vue.ref(false),
          showLivePreview: Vue.ref(false), searchInputRef: Vue.ref(null), searchBarRef: Vue.ref(null),
          onSearchInput: () => {}, clearSearch: () => {}, closeSearchAndNavigate: () => {}, toggleSearch: () => {}, handleSearch: () => {},
        }),
      },
      '~/composables/useMobileMenu': {
        useMobileMenu: () => ({
          clientMounted: Vue.ref(false), isSticky: Vue.ref(false), isMobileMenuOpen: Vue.ref(false), mobileOpenSubmenu: Vue.ref(null),
          toggleMobileMenu: () => {}, toggleMobileSubmenu: () => {}, onNavClick: () => {},
        }),
      },
      '~/composables/useReaderMenu': {
        useReaderMenu: () => ({
          reader: Vue.ref(null), readerLoaded: Vue.ref(false), loadReader: () => {}, readerSignIn: () => {}, readerSignOut: async () => {},
          readerSignInMessage: () => null, isReaderMenuOpen: Vue.ref(false), unreadCount: Vue.ref(0), notifLoaded: Vue.ref(false),
          loadNotifications: async () => {}, resetNotifications: () => {},
        }),
      },
      '~/composables/useLayoutNav': {
        useLayoutNav: () => ({
          navMenu: Vue.computed(() => []), bottomNav: Vue.computed(() => []), navItemLabel: () => '',
          setNavMenu: (raw: string) => { navCalls.push(`navbar:${raw}`) }, setBottomNav: (raw: string) => { navCalls.push(`mobile:${raw}`) },
        }),
      },
    },
    globals: {
      window: { addEventListener: () => {}, removeEventListener: () => {}, scrollY: 0 },
      document: { addEventListener: () => {}, removeEventListener: () => {}, body: { style: {} }, activeElement: null },
      // useLayoutConfig (through the REAL useSiteSettings) reads Nuxt's auto-imports
      // `computed` and `useState` as bare globals.
      computed: Vue.computed,
      useState: (() => {
        const store = new Map<string, Vue.Ref<unknown>>()
        return <T>(key: string, init?: () => T) => {
          if (!store.has(key)) store.set(key, Vue.ref(init ? init() : undefined))
          return store.get(key) as Vue.Ref<T>
        }
      })(),
    },
  })
  await settle()
  return { ...ctx, navCalls }
}
const prop = (el: { props: Record<string, unknown> }, kebab: string) => {
  const camel = kebab.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())
  return el.props[kebab] ?? el.props[camel]
}

describe('layouts/default.vue over publicFetch', () => {
  it('one SSR read of the settings (awaited, not lazy, default null), shared key with ArticleDetail', async (t) => {
    const ctx = await openLayout(t, () => json({ ...SETTINGS, settings: { ...SETTINGS.settings, nav_menu_navbar: '[{"label":"A"}]', nav_menu_mobile: '[{"label":"B"}]' } }))
    assert.deepEqual(ctx.registrations, [
      { key: 'public-settings-nav', lazy: undefined, server: undefined, immediate: undefined, default: 'null', watch: 0, getCachedData: false },
    ])
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/settings'])
    const top = byTag(ctx.page, 'LayoutDefaultTopBar')[0]!
    assert.equal(prop(top, 'site-hotline'), '0912 345 678')
    const header = byTag(ctx.page, 'LayoutDefaultHeader')[0]!
    assert.equal(prop(header, 'site-logo'), '/uploads/logo.png')
    assert.equal(prop(header, 'site-main-logo'), '/uploads/chu-quan.png')
    assert.deepEqual(byTag(ctx.page, 'div')[0]!.props.style, { '--container-max': '1366px' })
    assert.deepEqual(ctx.navCalls, ['navbar:[{"label":"A"}]', 'mobile:[{"label":"B"}]'])
  })

  it('a failed read leaves the fallbacks (hotline, logo, default width) — the layout still renders', async (t) => {
    const ctx = await openLayout(t, () => h3Error(503, 'Service Unavailable'))
    assert.equal(prop(byTag(ctx.page, 'LayoutDefaultTopBar')[0]!, 'site-hotline'), '0903.480.985')
    assert.equal(prop(byTag(ctx.page, 'LayoutDefaultHeader')[0]!, 'site-logo'), '/Logo.png')
    assert.equal(ctx.navCalls.length, 0)
    assert.deepEqual(ctx.page.errors, [])
  })
})
