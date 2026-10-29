/**
 * D-FETCH lot G — the public PAGES after their casts became `publicFetch<T>()`: `/`, `/about`,
 * `/contact` and the catch-all `[slug]` (Page Builder), `/news/<X>` (category or article),
 * `/search`, `/qa-documents`, `/legal-qa`, `/media/<shortId>`. Each mounted for real
 * (tests/_public-mount-harness.ts) over REAL ofetch on a fake network.
 *
 * Several are `swr` routes (`/`, `/about`, `/contact`, `/qa-documents`, `/news/**`, `/media/**`):
 * their HTML is replayed to every visitor, so WHERE each request is made is the contract —
 * inside `useAsyncData` (rendered on the server, Vietnamese, anonymous) or after mount (the
 * browser only: the view counter, the related videos). Pinned per page: the registrations
 * (key, `lazy`, `default()`, watch count), `via` and the wire of every request, the server-only
 * `await` (run with `import.meta.server`), the SSR failure hook (`useSsrFailureStatus`), and
 * what renders for a good and a failed answer. Green on the base tree (5f1bb07d, casts) and on
 * lot G alike. The KNOWN tests pin FINDING G-2 (no `lang` on the catch-all / news category
 * reads) as it is — documented in docs/decisions/fetch-rollout-d-fetch.md, not changed here.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Vue from 'vue'

import { findAll, fire, textOf } from './_sfc-mount.ts'
import { alerts, buttons, byTag, dropped, h3Error, json, mountPublic, routes, sent, settle, words, type NetCall } from './_public-mount-harness.ts'

const PREVIEW = { usePagePreview: () => ({ isPreview: Vue.ref(false), previewBlocks: Vue.ref(null), selectedId: Vue.ref(null) }) }
const BLOCKS = [{ id: 1, blockType: 'rich_text', data: { html: '<p>Xin chào</p>' } }]
const PAGE = (slug: string) => ({ ok: true, page: { slug, title: `Trang ${slug}`, seoTitle: `SEO ${slug}`, seoDescription: `Mô tả ${slug}` }, blocks: BLOCKS })
const MISS = { ok: false, page: null, blocks: [] }
const renderer = (ctx: { page: { root: Parameters<typeof findAll>[0] } }) => findAll(ctx.page.root, el => el.tag === 'PageRenderer')[0]
const prop = (el: { props: Record<string, unknown> }, kebab: string) => el.props[kebab] ?? el.props[kebab.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())]

// ─── /, /about, /contact ─────────────────────────────────────────────────────

for (const [file, slug] of [['pages/index.vue', 'home'], ['pages/about.vue', 'about'], ['pages/contact.vue', 'contact']] as const) {
  describe(`${file} over publicFetch`, () => {
    async function open(t: Parameters<typeof mountPublic>[0], answer: (call: NetCall) => Response | Error, lang = 'vi') {
      const ctx = await mountPublic(t, { file, lang, responder: routes({ [`GET /api/public/pages/${slug}`]: answer }), auto: PREVIEW })
      await settle()
      return ctx
    }

    it(`one lazy SSR read, key page-${slug}-<lang>, ?lang= on the wire, blocks to PageRenderer, SEO from the page`, async (t) => {
      const ctx = await open(t, () => json(PAGE(slug)))
      assert.deepEqual(ctx.registrations, [{ key: `page-${slug}-vi`, lazy: true, server: undefined, immediate: undefined, default: JSON.stringify(MISS), watch: 0, getCachedData: false }])
      assert.deepEqual(sent(ctx.calls), [`asyncData: GET /api/public/pages/${slug}?lang=vi`])
      assert.deepEqual(prop(renderer(ctx)!, 'blocks'), BLOCKS)
      assert.equal(ctx.seo().title, `SEO ${slug}`)
      assert.equal(ctx.ssrStatus.length, 1)
      assert.equal(ctx.ssrStatus[0]!.failed(), false)
    })

    it('a 503 goes to PageRenderer as load-error, and the SSR hook reports the failure (503 + no-store)', async (t) => {
      const ctx = await open(t, () => h3Error(503, 'Service Unavailable'))
      assert.ok(prop(renderer(ctx)!, 'load-error'))
      assert.equal(ctx.ssrStatus[0]!.failed(), true)
    })

    it('switching the language reads the same key again, now with ?lang=en', async (t) => {
      const ctx = await open(t, call => json({ ...PAGE(slug), page: { ...PAGE(slug).page, seoTitle: `SEO ${call.url.searchParams.get('lang')}` } }))
      ctx.currentLang.value = 'en'
      await settle()
      assert.deepEqual(sent(ctx.calls), [`asyncData: GET /api/public/pages/${slug}?lang=vi`, `asyncData: GET /api/public/pages/${slug}?lang=en`])
      assert.equal(ctx.seo().title, 'SEO en')
    })
  })
}

// ─── [slug] (catch-all) ──────────────────────────────────────────────────────

const TYPES = { ok: true, items: [{ id: 3, name: 'Học nghề', slug: 'hoc-nghe', icon: 'fa-solid fa-tools', description: 'Mô tả học nghề', displayOrder: 1 }] }
const CATS = (type: string) => ({ ok: true, items: [{ id: 9, name: 'Cơ khí', slug: 'co-khi', parentId: null, type, description: null, displayOrder: 1 }] })

async function openSlug(t: Parameters<typeof mountPublic>[0], params: Record<string, string>, table: Record<string, (call: NetCall) => Response | Error>, server = false) {
  const shown: unknown[] = []
  const ctx = await mountPublic(t, {
    file: 'pages/[slug].vue',
    route: { path: `/${Object.values(params).join('/')}`, params },
    responder: routes(table),
    auto: { ...PREVIEW, showError: (err: unknown) => { shown.push(err) } },
    importMeta: { server, client: !server },
    // A top-level `await` (inside `if (import.meta.server)`) makes setup async on both sides.
    suspense: true,
  })
  await settle()
  return { ...ctx, shown }
}

describe('pages/[slug].vue over publicFetch', () => {
  it('a Page Builder page: three lazy SSR reads (page, content types, category check), PageRenderer', async (t) => {
    const ctx = await openSlug(t, { slug: 'gioi-thieu' }, {
      'GET /api/public/pages/gioi-thieu': () => json(PAGE('gioi-thieu')),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': call => json(CATS(call.url.searchParams.get('type')!)),
    })
    assert.deepEqual(ctx.registrations.map(r => [r.key, r.lazy, r.default, r.watch]), [
      ['page-gioi-thieu', true, JSON.stringify(MISS), 1],
      ['content-types-catchall-gioi-thieu', true, '{"ok":false,"items":[]}', 1],
      ['cat-check-gioi-thieu-', true, '{"ok":true,"items":[]}', 2],
    ])
    // Paths and places only — the page's `?lang=` is FINDING G-2's, pinned by its own tests below.
    assert.deepEqual(ctx.calls.map(call => `${call.via}: ${call.method} ${call.url.pathname}`), [
      'asyncData: GET /api/public/pages/gioi-thieu',
      'asyncData: GET /api/public/content-types',
      'asyncData: GET /api/public/categories',
    ])
    assert.equal(ctx.calls[2]!.url.search, '?type=gioi-thieu')
    assert.deepEqual(prop(renderer(ctx)!, 'blocks'), BLOCKS)
    assert.deepEqual(ctx.shown, [])
  })

  it('page miss + a content type of that slug → the type list (ContentTypeListSection), no 404', async (t) => {
    const ctx = await openSlug(t, { slug: 'hoc-nghe' }, {
      'GET /api/public/pages/hoc-nghe': () => json(MISS),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': call => json(CATS(call.url.searchParams.get('type')!)),
    })
    const list = findAll(ctx.page.root, el => el.tag === 'ContentTypeListSection')
    assert.equal(list.length, 1)
    assert.equal(prop(list[0]!, 'type-name'), 'Học nghề')
    assert.deepEqual(ctx.shown, [])
  })

  it('page miss + type miss → a client-side 404 (showError); a FAILED page read never is a 404', async (t) => {
    const missing = await openSlug(t, { slug: 'khong-co' }, {
      'GET /api/public/pages/khong-co': () => json(MISS),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': () => json({ ok: true, items: [] }),
    })
    assert.equal((missing.shown[0] as { statusCode?: number } | undefined)?.statusCode, 404)
    missing.close()
    const failed = await openSlug(t, { slug: 'co-that' }, {
      'GET /api/public/pages/co-that': () => h3Error(503, 'Service Unavailable'),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': () => json({ ok: true, items: [] }),
    })
    assert.deepEqual(failed.shown, [])
    assert.ok(prop(renderer(failed)!, 'load-error'))
    assert.equal(failed.ssrStatus[0]!.failed(), true)
  })

  it('server render: awaits the page read, then (miss) the types read, and throws the 404 there', async (t) => {
    const ctx = await openSlug(t, { slug: 'khong-co' }, {
      'GET /api/public/pages/khong-co': () => json(MISS),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': () => json({ ok: true, items: [] }),
    }, true)
    assert.ok(ctx.calls.every(call => call.via === 'asyncData'))
    const thrown = ctx.page.errors.find(err => (err as { statusCode?: number }).statusCode === 404)
    assert.ok(thrown, 'the server branch threw the 404 after awaiting the reads')
  })

  it('2-segment /<type>/<X>: the category check reads ?type=<type>; a category → the list, a failed check → BlockLoadError + retry', async (t) => {
    const hit = await openSlug(t, { slug: 'hoc-nghe', id: 'co-khi' }, {
      'GET /api/public/pages/hoc-nghe': () => json(MISS),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': call => json(CATS(call.url.searchParams.get('type')!)),
    })
    assert.ok(sent(hit.calls).includes('asyncData: GET /api/public/categories?type=hoc-nghe'))
    assert.equal(hit.registrations.find(r => r.key.startsWith('cat-check-'))!.key, 'cat-check-hoc-nghe-co-khi')
    assert.equal(findAll(hit.page.root, el => el.tag === 'ContentTypeListSection').length, 1)
    hit.close()
    let up = false
    const failed = await openSlug(t, { slug: 'hoc-nghe', id: 'co-khi' }, {
      'GET /api/public/pages/hoc-nghe': () => json(MISS),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': call => (up ? json(CATS(call.url.searchParams.get('type')!)) : json({ ok: false, items: [] }, 503)),
    })
    assert.equal(alerts(failed.page).length, 1)
    assert.equal(failed.ssrStatus[1]!.failed(), true)
    up = true
    await fire(buttons(alerts(failed.page)[0]!, '')[0]!, 'click')
    await settle()
    assert.equal(findAll(failed.page.root, el => el.tag === 'ContentTypeListSection').length, 1)
  })

  it('FINDING G-2: the page is read in the reader\'s language (`?lang=`), and again when it changes — blocks follow', async (t) => {
    const ctx = await openSlug(t, { slug: 'gioi-thieu' }, {
      'GET /api/public/pages/gioi-thieu': call => json({ ...PAGE('gioi-thieu'), blocks: [{ id: 1, blockType: 'rich_text', data: { html: `<p>${call.url.searchParams.get('lang') ?? 'none'}</p>` } }] }),
      'GET /api/public/content-types': () => json(TYPES),
      'GET /api/public/categories': () => json({ ok: true, items: [] }),
    })
    assert.equal(sent(ctx.calls)[0], 'asyncData: GET /api/public/pages/gioi-thieu?lang=vi')
    ctx.currentLang.value = 'en'
    await settle()
    assert.deepEqual(sent(ctx.calls).filter(line => typeof line === 'string' && line.includes('/pages/')), [
      'asyncData: GET /api/public/pages/gioi-thieu?lang=vi',
      'asyncData: GET /api/public/pages/gioi-thieu?lang=en',
    ])
    assert.deepEqual(prop(renderer(ctx)!, 'blocks'), [{ id: 1, blockType: 'rich_text', data: { html: '<p>en</p>' } }])
    assert.deepEqual(ctx.shown, [], 'reading again is not a 404')
    // The routing reads localise nothing shown here (content types have no translation; the
    // category check only matches slugs) and stay as they were.
    assert.ok(ctx.calls.filter(call => !call.url.pathname.startsWith('/api/public/pages/')).every(call => !call.url.searchParams.has('lang')))
  })

  it('FINDING G-2: an English reader\'s first (server) render asks the page in English', async (t) => {
    const ctx = await mountPublic(t, {
      file: 'pages/[slug].vue',
      lang: 'en',
      route: { path: '/gioi-thieu', params: { slug: 'gioi-thieu' } },
      responder: routes({
        'GET /api/public/pages/gioi-thieu': () => json(PAGE('gioi-thieu')),
        'GET /api/public/content-types': () => json(TYPES),
        'GET /api/public/categories': () => json({ ok: true, items: [] }),
      }),
      auto: { ...PREVIEW, showError: () => {} },
      importMeta: { server: true, client: false },
      suspense: true,
    })
    await settle()
    assert.equal(sent(ctx.calls)[0], 'asyncData: GET /api/public/pages/gioi-thieu?lang=en')
  })
})

// ─── /news/<X> ───────────────────────────────────────────────────────────────

describe('pages/news/[category]/index.vue over publicFetch', () => {
  async function open(t: Parameters<typeof mountPublic>[0], answer: () => Response | Error, server = false) {
    const ctx = await mountPublic(t, {
      file: 'pages/news/[category]/index.vue',
      route: { path: '/news/tin-noi-bat', params: { category: 'tin-noi-bat' } },
      responder: routes({ 'GET /api/public/categories': answer }),
      importMeta: { server, client: !server },
      suspense: true,
    })
    await settle()
    return ctx
  }
  const CATEGORY = { ok: true, items: [{ id: 1, name: 'Tin nổi bật', slug: 'tin-noi-bat', parentId: null, type: 'news', description: null, displayOrder: 1 }] }

  it('the category check: one lazy SSR read (?type=news), awaited on the server; a category → the list, title from its name', async (t) => {
    for (const server of [false, true]) {
      const ctx = await open(t, () => json(CATEGORY), server)
      assert.deepEqual(ctx.registrations, [{ key: 'news-cat-check-tin-noi-bat', lazy: true, server: undefined, immediate: undefined, default: '{"ok":true,"items":[]}', watch: 0, getCachedData: false }])
      assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/categories?type=news'])
      assert.equal(findAll(ctx.page.root, el => el.tag === 'ContentTypeListSection').length, 1, `server=${server}`)
      assert.equal(ctx.seo().title, 'Tin nổi bật | Con Đường Hướng Thiện')
      ctx.close()
    }
  })

  it('not a category → ArticleDetail; a failed check → BlockLoadError, never ArticleDetail, SSR hook reports it', async (t) => {
    const article = await open(t, () => json({ ok: true, items: [] }))
    assert.equal(findAll(article.page.root, el => el.tag === 'ArticleDetail').length, 1)
    article.close()
    const failed = await open(t, () => dropped())
    assert.equal(findAll(failed.page.root, el => el.tag === 'ArticleDetail').length, 0)
    assert.equal(alerts(failed.page).length, 1)
    assert.equal(failed.ssrStatus[0]!.failed(), true)
  })

  it('KNOWN (FINDING G-2): the check sends no `lang`; a language switch does not read again (title stays in the language of the first read)', async (t) => {
    const ctx = await open(t, () => json(CATEGORY))
    ctx.currentLang.value = 'en'
    await settle()
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/categories?type=news'])
  })
})

// ─── /search ─────────────────────────────────────────────────────────────────

describe('pages/search.vue over publicFetch', () => {
  const ITEM = { id: 3, kind: 'article', type: 'news', typeLabel: 'Bản tin', typeIcon: 'fa-solid fa-newspaper', typeBadgeClass: '', title: 'Kết quả một', excerpt: 'Tóm tắt', url: '/news/ket-qua', thumbnailUrl: null, publishedAt: null, categoryName: null }
  const ANSWER = { ok: true, items: [ITEM], total: 1, counts: { all: 1, news: 1 }, pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } }
  async function open(t: Parameters<typeof mountPublic>[0], answer: () => Response | Error) {
    const ctx = await mountPublic(t, { file: 'pages/search.vue', route: { path: '/search', query: { q: 'ket qua' } }, responder: routes({ 'GET /api/public/search': answer }), suspense: true })
    await settle()
    return ctx
  }
  it('one SSR read (awaited, not lazy), query q/type/page/limit, key from the URL; results and counts render', async (t) => {
    const ctx = await open(t, () => json(ANSWER))
    assert.deepEqual(ctx.registrations, [{ key: 'search-ket qua-all-1', lazy: undefined, server: undefined, immediate: undefined, default: undefined, watch: 3, getCachedData: false }])
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/search?q=ket+qua&type=all&page=1&limit=10'])
    assert.match(words(ctx.page), /Kết quả một/)
    assert.match(words(ctx.page), /Tìm thấy 1 kết quả/)
  })
  it('a failed search is an error (role=alert) with a retry that reads again', async (t) => {
    let up = false
    const ctx = await open(t, () => (up ? json(ANSWER) : h3Error(500, 'Lỗi máy chủ')))
    assert.equal(alerts(ctx.page).length, 1)
    up = true
    await fire(byTag(alerts(ctx.page)[0]!, 'button')[0]!, 'click')
    await settle()
    assert.match(words(ctx.page), /Kết quả một/)
  })
})

// ─── /qa-documents ───────────────────────────────────────────────────────────

describe('pages/qa-documents.vue over publicFetch', () => {
  const ANSWER = {
    ok: true,
    items: [{ id: 11, question: 'Xoá án tích thế nào?', answer: 'Theo Điều 70…', topic: 'Xóa án tích', source: null }],
    topics: [{ topic: 'Xóa án tích', total: 1 }, { topic: 'Vay vốn', total: 4 }],
    pagination: { page: 1, perPage: 20, total: 1, totalPages: 1 },
  }
  async function open(t: Parameters<typeof mountPublic>[0], answer: () => Response | Error, query: Record<string, string> = {}) {
    const ctx = await mountPublic(t, { file: 'pages/qa-documents.vue', route: { path: '/qa-documents', query }, responder: routes({ 'GET /api/public/chatbot/knowledge': answer }) })
    await settle()
    return ctx
  }
  it('one lazy SSR read keyed by the URL query; topics render by `topic`/`total` (the handler\'s shape)', async (t) => {
    const ctx = await open(t, () => json(ANSWER), { q: 'án tích', topic: 'Xóa án tích' })
    assert.deepEqual(ctx.registrations.map(r => [r.key, r.lazy, r.watch]), [['qa-documents-{"page":1,"perPage":20,"search":"án tích","topic":"Xóa án tích"}', true, 1]])
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/chatbot/knowledge?page=1&perPage=20&search=%C3%A1n+t%C3%ADch&topic=X%C3%B3a+%C3%A1n+t%C3%ADch'])
    assert.match(words(ctx.page), /Xoá án tích thế nào\?/)
    assert.ok(findAll(ctx.page.root, el => el.tag === 'button' && textOf(el).includes('Vay vốn')).length >= 1)
  })
  it('a failed read (`ok: false` 503) is an alert with retry, not "no documents"', async (t) => {
    let up = false
    const ctx = await open(t, () => (up ? json(ANSWER) : json({ ok: false, items: [], topics: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 } }, 503)))
    assert.equal(alerts(ctx.page).length, 1)
    up = true
    await fire(byTag(alerts(ctx.page)[0]!, 'button')[0]!, 'click')
    await settle()
    assert.match(words(ctx.page), /Xoá án tích thế nào\?/)
  })
})

// ─── /legal-qa ───────────────────────────────────────────────────────────────

describe('pages/legal-qa/index.vue over publicFetch', () => {
  const FAQ = { ok: true, articles: [{ id: 21, type: 'faq', category: null, categoryId: null, categoryName: null, categorySlug: null, title: 'Vay vốn ưu đãi', slug: 'vay-von', excerpt: 'Điều kiện vay', thumbnailUrl: null, publishedAt: null, createdAt: '2026-10-01T00:00:00.000Z', authorName: null }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } }
  async function open(t: Parameters<typeof mountPublic>[0], answer: (call: NetCall) => Response | Error) {
    const ctx = await mountPublic(t, { file: 'pages/legal-qa/index.vue', route: { path: '/legal-qa' }, responder: routes({ 'GET /api/public/articles': answer }) })
    await settle()
    return ctx
  }
  it('one lazy SSR read (?type=faq&limit=50&lang=), keyed and watched by language; the FAQs render', async (t) => {
    const ctx = await open(t, () => json(FAQ))
    assert.deepEqual(ctx.registrations.map(r => [r.key, r.lazy, r.watch, r.default]), [['public-faq-articles-vi', true, 1, '{"ok":true,"articles":[],"pagination":{}}']])
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/articles?type=faq&limit=50&lang=vi'])
    assert.match(words(ctx.page), /Vay vốn ưu đãi/)
    ctx.currentLang.value = 'en'
    await settle()
    assert.equal(sent(ctx.calls).at(-1), 'asyncData: GET /api/public/articles?type=faq&limit=50&lang=en')
  })
  it('a 503 is an alert, and the SSR hook reports it', async (t) => {
    const ctx = await open(t, () => json({ ok: false, articles: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }, 503))
    assert.equal(alerts(ctx.page).length, 1)
    assert.equal(ctx.ssrStatus[0]!.failed(), true)
  })
})

// ─── /media/<shortId> ────────────────────────────────────────────────────────

describe('pages/media/[shortId].vue over publicFetch', () => {
  const ITEM = {
    id: 5, shortId: 'abc123', slug: 'video-mot', title: 'Video một', description: 'Mô tả', kind: 'upload', status: 'ready', playable: true,
    streamUrl: '/api/public/media/abc123/stream/master.m3u8', youtubeVideoId: null, thumbnailUrl: null, durationSeconds: 65,
    viewCount: 3, categorySlug: 'phap-luat', categoryName: 'Pháp luật', publishedAt: '2026-10-20T03:00:00.000Z', commentsEnabled: false,
  }
  const RELATED = { ok: true, items: [{ ...ITEM, id: 5 }, { ...ITEM, id: 6, shortId: 'def456', title: 'Video hai' }], categories: [], pagination: { page: 1, limit: 6, total: 2, totalPages: 1 } }
  async function open(t: Parameters<typeof mountPublic>[0], table: Record<string, (call: NetCall) => Response | Error>) {
    const ctx = await mountPublic(t, { file: 'pages/media/[shortId].vue', route: { path: '/media/abc123', params: { shortId: 'abc123' } }, responder: routes(table) })
    await settle()
    return ctx
  }
  it('detail: one lazy SSR read; then IN THE BROWSER ONLY one view ping (POST, keepalive) and the related list (?category=&limit=6)', async (t) => {
    const ctx = await open(t, {
      'GET /api/public/media/abc123': () => json({ ok: true, item: ITEM }),
      'POST /api/public/media/abc123/view': () => json({ accepted: true }, 202),
      'GET /api/public/media': () => json(RELATED),
    })
    assert.deepEqual(ctx.registrations, [{ key: 'media-detail-abc123', lazy: true, server: undefined, immediate: undefined, default: '{"ok":false,"item":null}', watch: 0, getCachedData: false }])
    assert.deepEqual(sent(ctx.calls), [
      'asyncData: GET /api/public/media/abc123',
      'direct: POST /api/public/media/abc123/view',
      'direct: GET /api/public/media?category=phap-luat&limit=6',
    ])
    assert.equal(ctx.calls[1]!.keepalive, true)
    assert.match(words(ctx.page), /Video hai/)
    assert.doesNotMatch(words(ctx.page).replace('Video một', ''), /Video một/, 'the video itself is not in its own related list')
  })
  it('server render: no view ping and no related read (the browser-only guard)', async (t) => {
    const ctx = await mountPublic(t, {
      file: 'pages/media/[shortId].vue',
      route: { path: '/media/abc123', params: { shortId: 'abc123' } },
      responder: routes({ 'GET /api/public/media/abc123': () => json({ ok: true, item: ITEM }) }),
      importMeta: { server: true, client: false },
    })
    await settle()
    assert.deepEqual(sent(ctx.calls), ['asyncData: GET /api/public/media/abc123'])
  })
  it('related 503: asked once (`retry: 0`), its own alert; a failed view ping is swallowed', async (t) => {
    const ctx = await open(t, {
      'GET /api/public/media/abc123': () => json({ ok: true, item: ITEM }),
      'POST /api/public/media/abc123/view': () => dropped(),
      'GET /api/public/media': () => h3Error(503, 'Service Unavailable'),
    })
    assert.equal(ctx.calls.filter(c => c.url.pathname === '/api/public/media').length, 1)
    assert.equal(alerts(ctx.page).length, 1)
    assert.deepEqual(ctx.page.errors, [])
  })
  it('detail 503 → the error branch (role=alert) with retry; no ping, no related', async (t) => {
    const ctx = await open(t, { 'GET /api/public/media/abc123': () => h3Error(503, 'Service Unavailable') })
    assert.equal(alerts(ctx.page).length, 1)
    assert.ok(ctx.calls.every(call => call.url.pathname === '/api/public/media/abc123' && call.method === 'GET'))
  })
})
