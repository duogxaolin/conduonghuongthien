/**
 * D-FETCH lot G — the home-page blocks, the news rails, the public forms and the two widgets
 * after their casts became `publicFetch<T>()`. Each view mounted for real
 * (tests/_public-mount-harness.ts), REAL ofetch on a fake network that answers like the
 * handlers (`articles.get.ts`, `categories.get.ts`, `submissions.post.ts`, `social-links`).
 *
 * Pinned, for each: the `useAsyncData` registration (key, `lazy`, `default()`, watch count)
 * or its absence (after-mount reads), that the read is made inside the handler (`via`), the
 * wire — the blocks still send `params` (ofetch's alias of `query`), and what renders for a
 * good and a failed answer (BlockLoadError + "thử lại" calls the same read again). Green on
 * the base tree (5f1bb07d, casts) and on lot G — except the tests named FINDING G-1, red on
 * base: since 30b87195 two blocks read `a.category?.name`, a shape only a hand-written cast
 * ever had (`category` is the legacy text column); the category badge never showed.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as Vue from 'vue'

import { findAll, fire, input, textOf, type MiniElement } from './_sfc-mount.ts'
import { alerts, buttons, byTag, dropped, h3Error, HOLD, json, mountPublic, routes, sent, settle, words, type NetCall } from './_public-mount-harness.ts'

const article = (n: number, over: Record<string, unknown> = {}) => ({
  id: n, type: 'news', category: null, categoryId: 2, categoryName: 'Hà Nội', categorySlug: 'ha-noi',
  title: `Bài số ${n}`, slug: `bai-${n}`, excerpt: `Tóm tắt ${n}`, thumbnailUrl: null,
  publishedAt: '2026-10-20T03:00:00.000Z', createdAt: '2026-10-19T03:00:00.000Z', authorName: null, ...over,
})
const list = (count: number, over: Record<string, unknown> = {}) =>
  ({ ok: true, articles: Array.from({ length: count }, (_, i) => article(i + 1, over)), pagination: { page: 1, limit: count, total: count, totalPages: 1 } })
const unavailable = () => json({ ok: false, articles: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } }, 503)

const BROWSER = {
  window: { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {} },
  document: { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' },
}

// ─── The four article blocks ─────────────────────────────────────────────────

const BLOCKS = [
  { file: 'components/blocks/NewsBlock.vue', type: 'news', key: 'block-news-5-vi', limit: 3 },
  { file: 'components/blocks/DocumentsBlock.vue', type: 'document', key: 'block-documents-5-ha-noi-vi', limit: 3 },
  { file: 'components/blocks/ReintegrationBlock.vue', type: 'reintegration', key: 'block-reintegration-5-ha-noi-vi', limit: 3 },
  { file: 'components/blocks/RoleModelsBlock.vue', type: 'role_model', key: 'block-role-models-5-ha-noi-vi', limit: 3 },
] as const

async function openBlock(t: Parameters<typeof mountPublic>[0], file: string, answer: (call: NetCall) => Response | Error, lang = 'vi') {
  // RoleModelsBlock starts a 3.5 s autoplay interval in the browser; mocked, it never runs.
  t.mock.timers.enable({ apis: ['setInterval'] })
  const ctx = await mountPublic(t, {
    file,
    lang,
    props: { block: { id: 5, data: { maxItems: 3, categorySlug: 'ha-noi' } } },
    responder: routes({ 'GET /api/public/articles': answer }),
    suspense: true,
    globals: BROWSER,
  })
  await settle()
  return ctx
}

for (const block of BLOCKS) {
  describe(`${block.file} over publicFetch`, () => {
    it('one lazy SSR read (key with id/category/lang, default { articles: [] }); `params` on the wire', async (t) => {
      const ctx = await openBlock(t, block.file, () => json(list(3)))
      assert.deepEqual(ctx.registrations, [
        { key: block.key, lazy: true, server: undefined, immediate: undefined, default: '{"articles":[]}', watch: 0, getCachedData: false },
      ])
      assert.deepEqual(sent(ctx.calls), [`asyncData: GET /api/public/articles?type=${block.type}&limit=${block.limit}&lang=vi&categorySlug=ha-noi`])
      for (const n of [1, 2, 3]) assert.match(words(ctx.page), new RegExp(`Bài số ${n}`))
      assert.deepEqual(alerts(ctx.page), [])
    })

    it('a 503 shows BlockLoadError (role=alert); "thử lại" reads again, the articles come back', async (t) => {
      let up = false
      const ctx = await openBlock(t, block.file, () => (up ? json(list(2)) : unavailable()))
      assert.equal(alerts(ctx.page).length, 1)
      assert.doesNotMatch(words(ctx.page), /Bài số 1/)
      // An SSR failure in the HTML is retried once after mount (`onMounted` → refresh) — on
      // the cast and on lot G alike. ofetch retries a 503 GET once more each time.
      const before = ctx.calls.length
      up = true
      await fire(buttons(alerts(ctx.page)[0]!, '')[0]!, 'click')
      await settle()
      assert.ok(ctx.calls.length > before)
      assert.match(words(ctx.page), /Bài số 1/)
      assert.deepEqual(alerts(ctx.page), [])
    })

    it('English: the key and the query carry `en`', async (t) => {
      const ctx = await openBlock(t, block.file, () => json(list(1)), 'en')
      assert.equal(ctx.registrations[0]!.key, block.key.replace(/-vi$/, '-en'))
      assert.ok(sent(ctx.calls).every(line => typeof line === 'string' && line.includes('lang=en')))
    })
  })
}

describe('FINDING G-1: the category badge of RoleModelsBlock / ReintegrationBlock', () => {
  for (const file of ['components/blocks/RoleModelsBlock.vue', 'components/blocks/ReintegrationBlock.vue']) {
    it(`${file}: shows the article's category name (API \`categoryName\`), absent when none`, async (t) => {
      const ctx = await openBlock(t, file, () => json({
        ...list(2),
        articles: [article(1, { categoryName: 'Hải Phòng' }), article(2, { categoryName: null, category: 'van-ban-cu' })],
      }))
      const badges = findAll(ctx.page.root, el => el.tag === 'span' && textOf(el) === 'Hải Phòng')
      assert.equal(badges.length, 1, 'the category name of article 1 is on its card')
      assert.doesNotMatch(words(ctx.page), /van-ban-cu/, 'the legacy text column is never shown')
    })
  }
})

// ─── News rail + content-type list ───────────────────────────────────────────

describe('components/NewsCategoryList.vue over publicFetch', () => {
  async function open(t: Parameters<typeof mountPublic>[0], answer: (call: NetCall) => Response | Error) {
    const ctx = await mountPublic(t, {
      file: 'components/NewsCategoryList.vue',
      props: { categorySlug: 'tin-hoat-dong', title: 'Tin hoạt động', limit: 4 },
      responder: routes({ 'GET /api/public/articles': answer }),
      suspense: true,
    })
    await settle()
    return ctx
  }
  it('two lazy SSR reads (the list, "Đọc nhiều"); `query` with lang; the list renders', async (t) => {
    const ctx = await open(t, call => json(list(call.url.searchParams.get('sort') === 'views' ? 2 : 4)))
    assert.deepEqual(ctx.registrations.map(r => [r.key, r.lazy, r.watch]), [
      ['public-articles-most-read:{"type":"news","limit":6,"sort":"views","lang":"vi"}', true, 1],
      ['news-category-tin-hoat-dong-vi', true, 3],
    ].sort((a, b) => ctx.registrations.findIndex(r => r.key === a[0]) - ctx.registrations.findIndex(r => r.key === b[0])))
    assert.ok(sent(ctx.calls).includes('asyncData: GET /api/public/articles?type=news&categorySlug=tin-hoat-dong&limit=4&lang=vi'))
    assert.match(words(ctx.page), /Bài số 4/)
  })
  it('the list shows EVERY article of the answer, in order (lot H: read as `data.value?.articles`, no cast)', async (t) => {
    // "Đọc nhiều" titled apart, so a title on screen is the list's own.
    const mostRead = list(2)
    const ctx = await open(t, call => json(call.url.searchParams.get('sort') === 'views'
      ? { ...mostRead, articles: mostRead.articles.map(a => ({ ...a, title: `Đọc nhiều ${a.id}` })) }
      : list(4)))
    assert.deepEqual([...new Set(words(ctx.page).match(/Bài số \d/g))], ['Bài số 1', 'Bài số 2', 'Bài số 3', 'Bài số 4'])
  })
  it('the list failing (503) says so (role=alert), not "no news"', async (t) => {
    const ctx = await open(t, call => (call.url.searchParams.get('sort') === 'views' ? json(list(2)) : unavailable()))
    assert.ok(alerts(ctx.page).length >= 1)
  })
})

describe('components/ContentTypeListSection.vue over publicFetch (categories)', () => {
  it('categories: lazy SSR read, key + query in the page language, watched; pills from the answer', async (t) => {
    const ctx = await mountPublic(t, {
      file: 'components/ContentTypeListSection.vue',
      route: { path: '/hoc-nghe' },
      props: { typeSlug: 'hoc-nghe', typeName: 'Học nghề' },
      responder: routes({
        'GET /api/public/categories': () => json({ ok: true, items: [
          { id: 1, name: 'Cơ khí', slug: 'co-khi', parentId: null, type: 'hoc-nghe', description: null, displayOrder: 1 },
          { id: 2, name: 'May mặc', slug: 'may-mac', parentId: null, type: 'hoc-nghe', description: null, displayOrder: 2 },
        ] }),
        'GET /api/public/articles': () => json(list(2)),
      }),
      suspense: true,
      components: { PageHero: Vue.defineComponent({ setup: (_p, { slots }) => () => Vue.h('page-hero', null, slots.default?.()) }) },
    })
    await settle()
    const cats = ctx.registrations.find(r => r.key.startsWith('content-type-cats-'))!
    assert.deepEqual(cats, { key: 'content-type-cats-hoc-nghe-vi', lazy: true, server: undefined, immediate: undefined, default: '{"ok":true,"items":[]}', watch: 2, getCachedData: false })
    assert.ok(sent(ctx.calls).includes('asyncData: GET /api/public/categories?type=hoc-nghe&lang=vi'))
    assert.match(words(ctx.page), /Cơ khí/)
    assert.match(words(ctx.page), /May mặc/)
  })
})

// ─── Top-level `await`: the setup waits for the read (the server's HTML carries the data) ──

describe('top-level `await useAsyncData` is kept (NewsCategoryList, ContentTypeListSection)', () => {
  // Tags, not the elements: a failing deepEqual over mini-DOM nodes (circular `parent`) would
  // spend minutes rendering its diff.
  const elements = (ctx: Awaited<ReturnType<typeof mountPublic>>) => findAll(ctx.page.root, el => el !== ctx.page.root).map(el => el.tag)

  it('NewsCategoryList: nothing renders while its list read is open; the answer releases it', async (t) => {
    const held: NetCall[] = []
    const ctx = await mountPublic(t, {
      file: 'components/NewsCategoryList.vue',
      props: { categorySlug: 'tin-hoat-dong', title: 'Tin hoạt động', limit: 4 },
      responder: routes({ 'GET /api/public/articles': call => (call.url.searchParams.get('sort') === 'views' ? json(list(2)) : (held.push(call), HOLD)) }),
      suspense: true,
    })
    await settle()
    assert.equal(held.length, 1)
    assert.deepEqual(elements(ctx), [], 'the setup is still awaiting the read')
    held[0]!.respond(json(list(4)))
    await settle()
    assert.match(words(ctx.page), /Bài số 4/)
  })

  it('ContentTypeListSection: nothing renders while its categories read is open; the answer releases it', async (t) => {
    const held: NetCall[] = []
    const ctx = await mountPublic(t, {
      file: 'components/ContentTypeListSection.vue',
      route: { path: '/hoc-nghe' },
      props: { typeSlug: 'hoc-nghe', typeName: 'Học nghề' },
      responder: routes({
        'GET /api/public/categories': call => (held.push(call), HOLD),
        'GET /api/public/articles': () => json(list(2)),
      }),
      suspense: true,
    })
    await settle()
    assert.equal(held.length, 1)
    assert.deepEqual(elements(ctx), [], 'the setup is still awaiting the categories')
    held[0]!.respond(json({ ok: true, items: [{ id: 1, name: 'Cơ khí', slug: 'co-khi', parentId: null, type: 'hoc-nghe', description: null, displayOrder: 1 }] }))
    await settle()
    assert.match(words(ctx.page), /Cơ khí/)
  })
})

// ─── The two public forms ────────────────────────────────────────────────────

const fieldsOf = (root: MiniElement) => findAll(root, el => el.tag === 'input' || el.tag === 'textarea')

describe('blocks/SupportFormBlock.vue + ContactFormBlock.vue — the citizen\'s form over publicFetch', () => {
  async function openForm(t: Parameters<typeof mountPublic>[0], file: string, data: Record<string, unknown>, answer: (call: NetCall) => Response | Error) {
    return mountPublic(t, {
      file,
      props: { block: { id: 9, data: { title: 'Hỗ trợ', recipientEmail: 'canbo@example.vn', ...data } } },
      responder: routes({ 'POST /api/submissions': answer }),
      globals: { document: { getElementById: () => null } },
    })
  }

  it('SupportFormBlock: POST /api/submissions with the four fields + formTitle/recipientEmail; success thanks by name', async (t) => {
    const ctx = await openForm(t, 'components/blocks/SupportFormBlock.vue', {}, () => json({ ok: true, id: 41 }))
    const [name, phone, city, message] = fieldsOf(ctx.page.root)
    await input(name!, 'Nguyễn Văn B')
    await input(phone!, '0912345678')
    await input(city!, 'Hà Nội')
    await input(message!, 'Cần hỗ trợ học nghề')
    await fire(byTag(ctx.page, 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(ctx.calls), [{ at: 'direct: POST /api/submissions', body: {
      type: 'support', formTitle: 'Hỗ trợ', recipientEmail: 'canbo@example.vn', name: 'Nguyễn Văn B', phone: '0912345678', city: 'Hà Nội', message: 'Cần hỗ trợ học nghề',
    } }])
    assert.match(words(ctx.page), /Nguyễn Văn B/)
    assert.deepEqual(alerts(ctx.page), [])
  })

  it('SupportFormBlock: a refusal shows the SERVER sentence (role=alert), a dropped connection the fallback — never ofetch\'s line', async (t) => {
    let answer: () => Response | Error = () => h3Error(429, 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.')
    const ctx = await openForm(t, 'components/blocks/SupportFormBlock.vue', {}, () => answer())
    await fire(byTag(ctx.page, 'form')[0]!, 'submit')
    await settle()
    assert.equal(words(alerts(ctx.page)[0]!), 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.')
    answer = () => dropped()
    await fire(byTag(ctx.page, 'form')[0]!, 'submit')
    await settle()
    const text = words(alerts(ctx.page)[0]!)
    assert.doesNotMatch(text, /\[POST\]|fetch failed|<no response>/)
    assert.ok(text.length > 0)
    assert.equal(ctx.calls.length, 2, 'a POST is not retried')
  })

  it('ContactFormBlock: the configured fields go as `answers`; a refusal shows the server sentence', async (t) => {
    let answer: () => Response | Error = () => json({ ok: true, id: 42 })
    const fields = [
      { id: 'f_name', label: 'Họ và tên', type: 'text', required: true, map: 'name' },
      { id: 'f_note', label: 'Ghi chú', type: 'textarea', required: false, map: 'message' },
    ]
    const ctx = await openForm(t, 'components/blocks/ContactFormBlock.vue', { fields }, () => answer())
    const [name, note] = fieldsOf(ctx.page.root)
    await input(name!, '  Trần Thị C ')
    await input(note!, 'Xin tư vấn')
    await fire(byTag(ctx.page, 'form')[0]!, 'submit')
    await settle()
    assert.deepEqual(sent(ctx.calls), [{ at: 'direct: POST /api/submissions', body: {
      type: 'support', formTitle: 'Hỗ trợ', recipientEmail: 'canbo@example.vn', answers: [
        { id: 'f_name', label: 'Họ và tên', value: 'Trần Thị C', map: 'name', type: 'text', required: true },
        { id: 'f_note', label: 'Ghi chú', value: 'Xin tư vấn', map: 'message', type: 'textarea', required: false },
      ],
    } }])
    assert.match(words(ctx.page), /Trần Thị C/)
    answer = () => h3Error(400, 'Thiếu thông tin bắt buộc.')
    await input(fieldsOf(ctx.page.root)[0]!, 'Trần Thị C')
    await fire(byTag(ctx.page, 'form')[0]!, 'submit')
    await settle()
    assert.equal(words(alerts(ctx.page)[0]!), 'Thiếu thông tin bắt buộc.')
  })
})

// ─── SocialBubble ────────────────────────────────────────────────────────────

describe('components/SocialBubble.client.vue over publicFetch', () => {
  const LINKS = { ok: true, items: [
    { id: 1, platform: 'facebook', label: 'Fanpage', url: 'https://facebook.com/x', icon: 'fa-brands fa-facebook-f', iconType: 'fontawesome', color: '#1877f2', sortOrder: 1 },
    { id: 2, platform: 'zalo', label: 'Zalo OA', url: 'https://zalo.me/x', icon: '/uploads/zalo.png', iconType: 'image', color: '#0068ff', sortOrder: 2 },
  ] }
  async function open(t: Parameters<typeof mountPublic>[0], answer: () => Response | Error) {
    const ctx = await mountPublic(t, {
      file: 'components/SocialBubble.client.vue',
      responder: routes({ 'GET /api/public/social-links': answer }),
      auto: { useLayoutConfig: () => ({ config: Vue.computed(() => ({ socialDisplayMode: 'floating', socialAutoOpen: true })) }) },
      modules: { '~/composables/useLayoutConfig': { useLayoutConfig: () => ({ config: Vue.computed(() => ({ socialDisplayMode: 'floating', socialAutoOpen: true })) }) } },
      globals: { window: { innerWidth: 1280, matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} }, document: { addEventListener: () => {}, removeEventListener: () => {} } },
    })
    await settle()
    return ctx
  }
  it('reads the links once after mount (never in the cached HTML) and shows them', async (t) => {
    const ctx = await open(t, () => json(LINKS))
    assert.deepEqual(ctx.registrations, [])
    assert.deepEqual(sent(ctx.calls), ['direct: GET /api/public/social-links'])
    assert.ok(findAll(ctx.page.root, el => el.tag === 'a' && el.props.href === 'https://facebook.com/x').length >= 1)
    assert.ok(findAll(ctx.page.root, el => el.tag === 'a' && el.props.href === 'https://zalo.me/x').length >= 1)
  })
  it('a failure is swallowed: no link, no alert, no error', async (t) => {
    const ctx = await open(t, () => h3Error(503, 'Service Unavailable'))
    assert.equal(findAll(ctx.page.root, el => el.tag === 'a' && String(el.props.href ?? '').startsWith('https://')).length, 0)
    assert.deepEqual(alerts(ctx.page), [])
    assert.deepEqual(ctx.page.errors, [])
  })
})
