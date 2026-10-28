/**
 * The shared article detail view (`app/components/ArticleDetail.vue`) — behaviour, through
 * its own controls.
 *
 * Wave 3 task 4.2 splits the 730-line component. Written BEFORE the split and run the same
 * way on both versions: the REAL component mounted on a minimal DOM with real ofetch over a
 * fake `/api/public/articles/**` (tests/_article-detail-harness.ts). The source-text guards
 * (tests/article-related-content, article-toc, public-pages-structure,
 * public-detail-ssr-status…) pin how it is written; this file pins what it does.
 *
 * Pinned (green on the base e444621 and after the split):
 *   - breadcrumb, the announced skeleton, the load-failure alert whose "thử lại" re-reads THE
 *     ARTICLE (and the SSR decision: failed → 503, missing → 404, both from the same reading),
 *     the not-found branch;
 *   - the header: category badge by precedence (categoryName → typeLabels[type] →
 *     categoryFallback → i18n), FontAwesome vs emoji icon, the date and the view count in
 *     the reader's locale, the author fallback "Ban biên tập", title, sapo, thumbnail;
 *   - the outline (≥ 3 headings): anchors match the ids stamped into the body, toggles;
 *   - the share bar: Facebook/Zalo share windows, copy link (toast + label for 2.5 s,
 *     refusal toast), print opens `/in-bai/<slug>?back=<list>` in a new window;
 *   - "Bài viết khác": its own skeleton, its own alert + "thử lại" that re-reads ONLY the
 *     related list, one link per item, topic chips only on /news for a news article, the
 *     whole aside gone when there is nothing to show;
 *   - after mount: ONE view ping (`POST …/view` with the source category, errors swallowed),
 *     the reading history entry once the article is in, SEO meta, a language switch re-reads.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classifySource } from '../app/utils/analytics-collector.ts'
import { click, findAll, isShown, textOf } from './_sfc-mount.ts'
import {
  HOLD, alertTexts, article, articleServer, aside, busy, buttonsWith, byTag, dropped, h3Error, links,
  mountDetail, openDetail, relatedItem, sent, tocNav, type NetCall,
} from './_article-detail-harness.ts'

const ARTICLE = 'GET /api/public/articles/hanh-trinh?lang=vi'
const RELATED = 'GET /api/public/articles/hanh-trinh/related?lang=vi'
const VIEW = 'POST /api/public/articles/hanh-trinh/view'
const reads = (ctx: { calls: NetCall[] }, line: string) => sent(ctx.calls).filter(c => c === line).length

describe('states of the main read', () => {
  it('breadcrumb at once; the announced skeleton while the article is on its way', async (t) => {
    const server = articleServer()
    server.state.override = call => (call.url.pathname === '/api/public/articles/hanh-trinh' ? HOLD : undefined)
    const ctx = await openDetail(t, server)
    const crumb = byTag(ctx.detail, 'nav')[0]!
    assert.equal(crumb.props['aria-label'], 'Đường dẫn')
    assert.deepEqual(links(crumb), [{ to: '/', text: 'Trang chủ' }, { to: '/news', text: 'Bản tin' }])
    assert.match(textOf(crumb), /Chi tiết tin tức$/)
    const [skeleton] = busy(ctx.detail)
    assert.ok(skeleton)
    assert.match(textOf(skeleton), /Đang tải nội dung bài viết/)
    assert.equal(byTag(ctx.detail, 'article').length, 0)
    assert.equal(aside(ctx.detail), null, 'the related column lives inside the article branch')
  })

  it('a failed read is an alert whose "thử lại" re-reads the article; the SSR decision says 503', async (t) => {
    const server = articleServer()
    server.state.override = call => (call.url.pathname === '/api/public/articles/hanh-trinh' ? h3Error(503, 'CSDL tạm ngưng') : undefined)
    const ctx = await openDetail(t, server)
    assert.deepEqual(alertTexts(ctx.detail), ['Không thể tải nội dung. Vui lòng thử lại.'])
    assert.equal(ctx.ssr.length, 1)
    assert.equal(ctx.ssr[0]!.failed(), true)
    assert.equal(ctx.ssr[0]!.notFound?.(), false)

    server.state.override = () => undefined
    const before = reads(ctx, ARTICLE)
    await click(buttonsWith(ctx.detail, 'thử lại')[0]!)
    await ctx.settle()
    assert.equal(reads(ctx, ARTICLE), before + 1)
    assert.deepEqual(alertTexts(ctx.detail), [])
    assert.equal(byTag(ctx.detail, 'h1')[0] && textOf(byTag(ctx.detail, 'h1')[0]!), 'Hành trình hoàn lương của anh A')
    assert.equal(ctx.ssr[0]!.failed(), false)
  })

  it('a dropped connection is the same alert', async (t) => {
    const server = articleServer()
    server.state.override = call => (call.url.pathname === '/api/public/articles/hanh-trinh' ? dropped() : undefined)
    const ctx = await openDetail(t, server)
    assert.deepEqual(alertTexts(ctx.detail), ['Không thể tải nội dung. Vui lòng thử lại.'])
  })

  it('a missing article (404) is "not found" with the back link, no retry; the SSR decision says 404', async (t) => {
    const server = articleServer()
    server.state.article = null
    const ctx = await openDetail(t, server, { variant: 'role', backTo: '/role-models' })
    assert.deepEqual(alertTexts(ctx.detail), [])
    assert.match(textOf(ctx.detail.root), /Không tìm thấy câu chuyện yêu cầu/)
    assert.deepEqual(links(ctx.detail).at(-1), { to: '/role-models', text: 'Quay lại danh sách' })
    assert.equal(buttonsWith(ctx.detail, 'thử lại').length, 0)
    assert.equal(ctx.ssr[0]!.failed(), false)
    assert.equal(ctx.ssr[0]!.notFound?.(), true)
  })
})

describe('the article', () => {
  it('header: category, date, author, views, title, sapo, thumbnail', async (t) => {
    const ctx = await openDetail(t)
    const badge = findAll(ctx.detail.root, el => el.tag === 'span' && String(el.props.class).startsWith('text-[0.85rem] font-bold'))[0]!
    // (Sibling elements' text joins without the whitespace the compiler drops between tags.)
    assert.equal(textOf(badge), '📰 Tin địa phương• Ngày đăng: 20/10/2026• Nguyễn Văn B• 1.234 lượt xem')
    assert.equal(textOf(byTag(ctx.detail, 'h1')[0]!), 'Hành trình hoàn lương của anh A')
    assert.match(textOf(ctx.detail.root), /Sapo của bài viết\./)
    const img = byTag(ctx.detail, 'SafeImg')[0]!
    assert.equal(img.props.src, '/uploads/2026/10/anh.webp')
    assert.equal(img.props.alt, 'Hành trình hoàn lương của anh A')
    assert.deepEqual(byTag(ctx.detail, 'ArticleComments').map(el => el.props.slug), ['hanh-trinh'])
    assert.deepEqual(ctx.reads, [['hanh-trinh', 'Hành trình hoàn lương của anh A']], 'the reading history gets the article once it is in')
  })

  it('FINDING-D1: the broken-image watch is on the rendered body, also when the article arrives after mount', async (t) => {
    // RED on the base: the watch was attached when ArticleDetail mounted — on a client-side
    // navigation (and after a language switch) the article arrives AFTER that, the body did
    // not exist yet, and no 404 image in it was ever hidden (the old CMS's dead
    // `/UserFile/editor/images/…` show as broken frames). SSR-hydrated pages were fine.
    const body = (ctx: Awaited<ReturnType<typeof openDetail>>) =>
      findAll(ctx.detail.root, el => String(el.props.class ?? '').startsWith('article-body'))[0]
    const ctx = await openDetail(t)
    assert.ok(body(ctx))
    assert.ok(ctx.brokenRoots.includes(body(ctx)), `watched: ${JSON.stringify(ctx.brokenRoots.map(r => (r ? 'element' : r)))}`)
    ctx.currentLang.value = 'en'
    await ctx.settle()
    assert.ok(body(ctx))
    assert.ok(ctx.brokenRoots.includes(body(ctx)), 'the body rendered after a language switch is watched too')
  })

  it('the category badge follows its precedence; a FontAwesome icon renders as an icon', async (t) => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, string]> = [
      [{ categoryName: null, type: 'faq' }, { typeLabels: { faq: 'Giải đáp' } }, 'Giải đáp'],
      [{ categoryName: null, type: 'faq' }, { categoryFallback: 'Dự phòng' }, 'Dự phòng'],
      [{ categoryName: null, type: undefined }, { variant: 'reintegration' }, 'Mô hình tiêu biểu'],
    ]
    for (const [over, props, label] of cases) {
      const server = articleServer()
      server.state.article = article(over)
      const ctx = await openDetail(t, server, props)
      const badge = findAll(ctx.detail.root, el => el.tag === 'span' && String(el.props.class).startsWith('text-[0.85rem] font-bold'))[0]!
      assert.match(textOf(badge), new RegExp(`^📰 ${label}•`), JSON.stringify(props))
      ctx.close()
    }
    const ctx = await openDetail(t, articleServer(), { metaIcon: 'fa-solid fa-folder' })
    const icon = findAll(ctx.detail.root, el => el.tag === 'i' && el.props.class === 'fa-solid fa-folder')
    assert.equal(icon.length, 1)
  })

  it('an author-less article is by "Ban biên tập"; no excerpt, no thumbnail → neither block', async (t) => {
    const server = articleServer()
    server.state.article = article({ authorName: null, excerpt: null, thumbnailUrl: null, viewTotal: 0 })
    const ctx = await openDetail(t, server)
    assert.match(textOf(ctx.detail.root), /Ban biên tập• 0 lượt xem/)
    assert.equal(byTag(ctx.detail, 'SafeImg').length, 0)
    assert.doesNotMatch(textOf(ctx.detail.root), /Sapo/)
  })

  it('the outline lists the headings with anchors the body carries, and folds', async (t) => {
    const ctx = await openDetail(t)
    const toc = tocNav(ctx.detail)
    assert.ok(toc, 'three headings → outline')
    const anchors = byTag(toc, 'a').map(a => [a.props.href, textOf(a)])
    assert.deepEqual(anchors, [['#boi-canh', 'Bối cảnh'], ['#dien-bien', 'Diễn biến'], ['#chi-tiet', 'Chi tiết'], ['#ket-qua', 'Kết quả']])
    const body = findAll(ctx.detail.root, el => String(el.props.class ?? '').startsWith('article-body'))[0]!
    const html = String((body.children[0] as { props: Record<string, unknown> }).props.innerHTML)
    for (const [href] of anchors) assert.match(html, new RegExp(`id="${String(href).slice(1)}"`))
    assert.doesNotMatch(html, /^<p>Mở đầu\.<\/p><h2>Bối cảnh<\/h2>/, 'the body renders the id-stamped HTML, not the raw content')

    const toggle = byTag(toc, 'button')[0]!
    assert.equal(toggle.props['aria-expanded'], true)
    assert.equal(textOf(toggle), 'Thu gọn')
    const list = () => findAll(tocNav(ctx.detail)!, el => el.props.id === 'muc-luc-list')[0]!
    assert.equal(toggle.props['aria-controls'], 'muc-luc-list')
    assert.equal(isShown(list()), true)
    await click(toggle)
    await ctx.settle()
    assert.equal(isShown(list()), false, 'folded, not removed: the anchors stay in the page')
    assert.equal(byTag(tocNav(ctx.detail)!, 'button')[0]!.props['aria-expanded'], false)
    assert.equal(textOf(byTag(tocNav(ctx.detail)!, 'button')[0]!), 'Mở rộng')
  })

  it('a short article has no outline', async (t) => {
    const server = articleServer()
    server.state.article = article({ content: '<p>Ngắn.</p><h2>Một</h2><h2>Hai</h2>' })
    const ctx = await openDetail(t, server)
    assert.equal(tocNav(ctx.detail), null)
  })
})

describe('share bar', () => {
  it('Facebook and Zalo open a share window for this address', async (t) => {
    const ctx = await openDetail(t)
    await click(buttonsWith(ctx.detail, 'Facebook')[0]!)
    await click(buttonsWith(ctx.detail, 'Zalo')[0]!)
    const href = encodeURIComponent('http://portal.test/news/hanh-trinh')
    assert.deepEqual(ctx.opened, [
      [`https://www.facebook.com/sharer/sharer.php?u=${href}`, '_blank', 'noopener,noreferrer,width=600,height=400'],
      [`https://sp.zalo.me/share_inline?link=${href}`, '_blank', 'noopener,noreferrer,width=600,height=400'],
    ])
  })

  it('copy link: clipboard, toast, the label for 2.5 s; a refusal is an error toast', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const ctx = await openDetail(t)
    await click(buttonsWith(ctx.detail, 'Sao chép link')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.clipboard, ['http://portal.test/news/hanh-trinh'])
    assert.deepEqual(ctx.toasts, [{ type: 'success', message: 'Đã sao chép liên kết bài viết vào bộ nhớ tạm!' }])
    assert.equal(buttonsWith(ctx.detail, 'Đã sao chép').length, 1)
    t.mock.timers.tick(2500)
    await ctx.settle()
    assert.equal(buttonsWith(ctx.detail, 'Đã sao chép').length, 0)

    ctx.clipboardAnswer.fails = true
    await click(buttonsWith(ctx.detail, 'Sao chép link')[0]!)
    await ctx.settle()
    assert.deepEqual(ctx.toasts.at(-1), { type: 'error', message: 'Không thể sao chép liên kết.' })
  })

  it('print opens the newspaper page for this article in a new window, with the list to go back to', async (t) => {
    const ctx = await openDetail(t, articleServer(), { backTo: '/role-models' })
    await click(buttonsWith(ctx.detail, 'In bài')[0]!)
    assert.deepEqual(ctx.opened, [['/in-bai/hanh-trinh?back=%2Frole-models', '_blank', 'noopener,noreferrer,width=900,height=700']])
  })
})

describe('"Bài viết khác"', () => {
  it('its own skeleton while the list is on its way, the article already readable', async (t) => {
    const server = articleServer()
    // Every related read held: the setup read AND the mount-time rescue read (a client-side
    // navigation sends both; the newest one wins).
    server.state.override = call => (call.url.pathname.endsWith('/related') ? HOLD : undefined)
    const ctx = await openDetail(t, server)
    assert.ok(byTag(ctx.detail, 'h1').length === 1)
    const column = aside(ctx.detail)!
    const [skeleton] = findAll(column, el => el.props.role === 'status')
    assert.match(textOf(skeleton!), /Đang tải bài viết khác/)
    assert.equal(findAll(skeleton!, el => el.props['aria-hidden'] === 'true').length, 5)
  })

  it('one link per item to <list>/<slug>, a fallback thumbnail, the UTC date; topics for a news article on /news', async (t) => {
    const ctx = await openDetail(t)
    const column = aside(ctx.detail)!
    assert.equal(textOf(byTag(column, 'h2')[0]!), 'Bài viết khác')
    const items = byTag(column, 'li')
    assert.equal(items.length, 2)
    for (const li of items) assert.equal(byTag(li, 'nuxt-link').length, 1, 'one tab stop per item')
    assert.deepEqual(links(items[0]!), [{ to: '/news/lien-quan-21', text: 'Bài liên quan 2118/10/2026' }])
    assert.deepEqual(byTag(column, 'img').map(img => img.props.src), ['/uploads/lq-21.webp', '/assets/hero_banner.jpg'])
    const chips = links(column).slice(2)
    assert.deepEqual(chips, [{ to: '/news/tin-dia-phuong', text: 'Tin địa phương (12)' }, { to: '/news/hoat-dong', text: 'Hoạt động (5)' }])
    const current = byTag(column, 'nuxt-link').find(el => el.props.to === '/news/tin-dia-phuong')!
    assert.match(String(current.props.class), /bg-brand-600/)
  })

  it('no topic chips outside /news, nor for a non-news article on /news', async (t) => {
    const role = await openDetail(t, articleServer(), { backTo: '/role-models' })
    assert.equal(links(aside(role.detail)!).length, 2, 'items only')
    role.close()
    const server = articleServer()
    server.state.article = article({ type: 'document' })
    const doc = await openDetail(t, server)
    assert.equal(links(aside(doc.detail)!).length, 2)
  })

  it('a failed related read is its own alert; "thử lại" re-reads only the list; the article stays', async (t) => {
    const server = articleServer()
    server.state.related = { ok: false, articles: [], topics: [] }
    const ctx = await openDetail(t, server)
    assert.deepEqual(alertTexts(ctx.detail), ['Không thể tải bài viết khác. Vui lòng thử lại.'])
    assert.equal(byTag(ctx.detail, 'h1').length, 1, 'a broken side block does not take the article down')

    server.state.related = { ok: true, articles: [relatedItem(31)], topics: [] }
    const article = reads(ctx, ARTICLE)
    const related = reads(ctx, RELATED)
    await click(buttonsWith(aside(ctx.detail)!, 'thử lại')[0]!)
    await ctx.settle()
    assert.equal(reads(ctx, ARTICLE), article)
    assert.equal(reads(ctx, RELATED), related + 1)
    assert.deepEqual(alertTexts(ctx.detail), [])
    assert.equal(byTag(aside(ctx.detail)!, 'li').length, 1)
  })

  it('a transport failure of the related read is the same alert', async (t) => {
    const server = articleServer()
    server.state.override = call => (call.url.pathname.endsWith('/related') ? h3Error(500, 'Lỗi') : undefined)
    const ctx = await openDetail(t, server)
    assert.deepEqual(alertTexts(ctx.detail), ['Không thể tải bài viết khác. Vui lòng thử lại.'])
  })

  it('nothing related and no topics: the whole aside is gone', async (t) => {
    const server = articleServer()
    server.state.related = { ok: true, articles: [], topics: [] }
    const ctx = await openDetail(t, server)
    assert.equal(aside(ctx.detail), null)
  })
})

describe('after mount', () => {
  it('one view ping with the source category, never twice for the same slug; a failure is swallowed', async (t) => {
    const server = articleServer()
    server.state.override = call => (call.method === 'POST' ? h3Error(500, 'Lỗi') : undefined)
    const ctx = await openDetail(t, server, {}, { referrer: 'https://www.facebook.com/' })
    const pings = sent(ctx.calls).filter(c => typeof c === 'object')
    assert.deepEqual(pings, [{ wire: VIEW, body: { sourceCategory: classifySource('https://www.facebook.com/', 'portal.test') } }])
    assert.deepEqual(ctx.detail.errors, [], 'a failed view ping never reaches the page')
    assert.deepEqual(alertTexts(ctx.detail), [])
  })

  it('SEO meta: the article title and sapo, the thumbnail as og:image; before it lands, the fallbacks', async (t) => {
    const server = articleServer()
    const held: NetCall[] = []
    server.state.override = call => { if (call.url.pathname === '/api/public/articles/hanh-trinh') { held.push(call); return HOLD } }
    const ctx = await openDetail(t, server, { seoFallbackTitle: 'Tin tức | Cổng' })
    assert.equal(ctx.seo().title, 'Tin tức | Cổng')
    assert.equal(ctx.seo().description, 'Tin tức và hoạt động hỗ trợ hoàn lương, tái hòa nhập cộng đồng.')
    assert.equal(ctx.seo().ogImage, '/uploads/og-mac-dinh.jpg')
    server.state.override = () => undefined
    for (const call of held) server.answer(call)
    await ctx.settle()
    assert.deepEqual(ctx.seo(), {
      title: 'Hành trình hoàn lương của anh A | Con Đường Hướng Thiện',
      description: 'Sapo của bài viết.',
      ogTitle: 'Hành trình hoàn lương của anh A | Con Đường Hướng Thiện',
      ogDescription: 'Sapo của bài viết.',
      ogImage: '/uploads/2026/10/anh.webp',
      ogType: 'article',
    })
  })

  it('switching language re-reads both lists in that language and formats in its locale', async (t) => {
    const ctx = await openDetail(t)
    ctx.currentLang.value = 'en'
    await ctx.settle()
    assert.ok(reads(ctx, 'GET /api/public/articles/hanh-trinh?lang=en') >= 1)
    assert.ok(reads(ctx, 'GET /api/public/articles/hanh-trinh/related?lang=en') >= 1)
    assert.match(textOf(ctx.detail.root), /1,234 views/)
    assert.match(textOf(ctx.detail.root), /10\/20\/2026/)
  })

  it('the settings read is shared with the layout (same key), and the og image falls back to the hero', async (t) => {
    const server = articleServer()
    server.state.settings = { settings: {} }
    server.state.article = article({ thumbnailUrl: null })
    const ctx = await openDetail(t, server)
    assert.ok(ctx.asyncKeys.includes('public-settings-nav'))
    assert.equal(ctx.seo().ogImage, '/assets/hero_banner.jpg')
  })
})

describe('the mount sequence', () => {
  it('reads article and related on setup and once more on mount while still empty (the cached-payload rescue)', async (t) => {
    const ctx = await mountDetail(t)
    await ctx.settle()
    assert.ok(reads(ctx, ARTICLE) >= 1)
    assert.ok(reads(ctx, RELATED) >= 1)
    assert.equal(sent(ctx.calls).filter(c => typeof c === 'object').length, 1, 'one view ping')
  })
})
