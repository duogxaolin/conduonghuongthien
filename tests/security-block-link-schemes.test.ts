import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import { createEvent, getCookie, getQuery, getRouterParam, type H3Event } from 'h3'
import { renderSfcTemplate } from './_render-sfc-template'

/**
 * One URL policy for block and navigation link fields (spec page-builder-links,
 * design D3).
 *
 * A delegated page editor (`pages.update`) could store `javascript:…` in any
 * block link — the Links block's `links[].url`, a hero/CTA/documents button — and
 * the public page rendered it as `<a href>`: script in the portal's origin for
 * every visitor (and every admin previewing) who clicked. The navigation save
 * accepted anything starting with `/`, which includes protocol-relative `//host`.
 *
 * Now `shared/link-policy.ts` decides, on a NORMALISED value (entities decoded,
 * control characters and whitespace stripped, lower-cased), and allows only
 * `/path` (not `//`), `#…`, `http:`, `https:`, `mailto:`, `tel:`:
 *  - write: `normalizeBlocks` (draft/publish/version paths) and
 *    `settings/navigation.put.ts` answer 400 naming the field;
 *  - public read: `pages/[slug]` blanks unsafe values in rows stored before the
 *    rule;
 *  - render: LinksBlock/HeroBlock bind `href` through the same helper.
 */

const UNSAFE: readonly string[] = [
  'javascript:alert(1)',
  'JaVa\tScRiPt:alert(1)',
  '  javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'java\nscript:alert(1)',
  'javascript\r:alert(1)',
  '&#106;avascript:alert(1)',
  '&#106avascript:alert(1)',
  '&#x6A;avascript:alert(1)',
  '&#0000106;avascript:alert(1)',
  'javascript&colon;alert(1)',
  'java&Tab;script:alert(1)',
  'java&NewLine;script:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'DATA:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//evil.example/path',
  '/\\evil.example/path',
  '/\t/evil.example',
  '/&#47;evil.example',
  '&#47;&#47;evil.example',
  'about:blank',
  'file:///etc/passwd',
  'news/relative-without-slash',
]
const SAFE: readonly string[] = ['/about', '/', '#tro-giup', '#', 'https://example.gov.vn/x', 'http://example.gov.vn', 'HTTPS://EXAMPLE.GOV.VN/Y', 'mailto:a@b.vn', 'tel:+84123', 'tel:+84 123 456']

// ─── The shared policy itself ─────────────────────────────────────────────────

test('safeLinkOrNull: every unsafe form is null, every allowed form comes back unchanged', async () => {
  const { safeLinkOrNull } = await import('../shared/link-policy.ts')
  for (const value of UNSAFE) assert.equal(safeLinkOrNull(value), null, `${JSON.stringify(value)} was allowed`)
  for (const value of SAFE) assert.equal(safeLinkOrNull(value), value, `${JSON.stringify(value)} was refused or rewritten`)
  for (const value of ['', '   ', null, undefined, 42, {}, ['/a']]) assert.equal(safeLinkOrNull(value), null)
})

test('assertSafeLink: an empty link is fine, an unsafe one throws a 400 naming the field', async () => {
  const { assertSafeLink, UnsafeLinkError } = await import('../shared/link-policy.ts')
  for (const value of [undefined, null, '', '  ', ...SAFE]) assert.doesNotThrow(() => assertSafeLink(value, 'btnLink'))
  for (const value of [...UNSAFE, 42, { url: '/x' }]) {
    assert.throws(() => assertSafeLink(value, 'links[3].url'), (error: unknown) =>
      error instanceof UnsafeLinkError && error.statusCode === 400 && error.field === 'links[3].url' && error.message.includes('links[3].url'))
  }
})

test('the shared entity decoder agrees with server/utils/decode-html-entities on the forms both know', async () => {
  const { decodeLinkEntities } = await import('../shared/link-policy.ts')
  const { decodeHtmlEntities } = await import('../server/utils/decode-html-entities.ts')
  for (const input of [
    '&#106;avascript:', '&#x6A;avascript:', '&#X6a;avascript:', '&#0000106;', '&#58;', '&#x3A;', '&#x3a;',
    'a&amp;b', '&lt;x&gt;', '&quot;q&quot;', '&apos;', '&#47;&#47;evil', 'plain/text', '&unknownname;', '&#0;', '&#xD800;', '&#1114112;',
  ]) {
    assert.equal(decodeLinkEntities(input), decodeHtmlEntities(input), `disagree on ${input}`)
  }
  // Forms only the link decoder handles: HTML5 names and semicolon-less numeric
  // references that a browser still decodes inside an attribute.
  assert.equal(decodeLinkEntities('javascript&colon;'), 'javascript:')
  assert.equal(decodeLinkEntities('java&Tab;script&NewLine;'), 'java\tscript\n')
  assert.equal(decodeLinkEntities('&#106avascript'), 'javascript')
  // Hex digits run as far as they go, exactly as in a browser: `&#x2F/` ends at `/`.
  assert.equal(decodeLinkEntities('&#x2F/evil'), '//evil')
  assert.equal(decodeLinkEntities('/&sol;evil &bsol;'), '//evil \\')
})

// ─── Write side: normalizeBlocks (draft save, publish, version save/restore) ───

const { normalizeBlocks } = await import('../server/utils/page-versions.ts')

const tree = (leaf: Record<string, unknown>) => [{
  blockType: 'section', data: {}, children: [{
    blockType: 'row', data: {}, children: [{ blockType: 'column', colSpan: 6, data: {}, children: [leaf] }],
  }],
}]

function rejection(input: unknown): { statusCode?: number, message: string } | null {
  try {
    normalizeBlocks(input)
    return null
  } catch (error) {
    const e = error as { statusCode?: number, statusMessage?: string, message?: string }
    return { statusCode: e.statusCode, message: `${e.statusMessage ?? ''} ${e.message ?? ''}` }
  }
}

test('normalizeBlocks: the spec example — a Links item `JaVa\\tScRiPt:alert(1)` nested in containers is a 400 naming the field', () => {
  const result = rejection(tree({ blockType: 'links', data: { links: [{ label: 'ok', url: '/a' }, { label: 'x', url: 'JaVa\tScRiPt:alert(1)' }] } }))
  assert.ok(result, 'the unsafe link was accepted')
  assert.equal(result.statusCode, 400)
  assert.match(result.message, /links\[1\]\.url/)
})

test('normalizeBlocks: every unsafe form in every registry link field, at top level and inside translations, is refused', () => {
  const placements: Array<[string, (url: string) => Record<string, unknown>, RegExp]> = [
    ['hero.btnHelpLink', url => ({ blockType: 'hero', data: { btnHelpLink: url } }), /btnHelpLink/],
    ['hero.btnAboutLink', url => ({ blockType: 'hero', data: { btnAboutLink: url } }), /btnAboutLink/],
    ['cta.btnLink', url => ({ blockType: 'cta', data: { btnLink: url } }), /btnLink/],
    ['documents.btnLink', url => ({ blockType: 'documents', data: { btnLink: url } }), /btnLink/],
    ['links[0].url', url => ({ blockType: 'links', data: { links: [{ url }] } }), /links\[0\]\.url/],
    ['translations.en.btnLink', url => ({ blockType: 'cta', data: { btnLink: '/ok', translations: { en: { btnLink: url } } } }), /translations\.en\.btnLink/],
    ['translations.en.links[0].url', url => ({ blockType: 'links', data: { translations: { en: { links: [{ url: '/ok' }, { url }] } } } }), /translations\.en\.links\[1\]\.url/],
  ]
  for (const [name, place, field] of placements) {
    for (const url of UNSAFE) {
      const result = rejection(tree(place(url)))
      assert.ok(result, `${name} = ${JSON.stringify(url)} was accepted`)
      assert.equal(result.statusCode, 400, `${name}: ${result.message}`)
      assert.match(result.message, field)
    }
  }
})

test('normalizeBlocks: allowed and empty links are stored unchanged; image fields are not link fields', () => {
  const data = {
    links: [...SAFE.map(url => ({ label: 'x', url })), { label: 'blank', url: '' }],
  }
  const [out] = normalizeBlocks([{ blockType: 'links', data }])
  assert.deepEqual(out!.data.links, data.links)
  const [cta] = normalizeBlocks([{ blockType: 'cta', data: { btnText: 'Xem', btnLink: '' } }])
  assert.equal(cta!.data.btnLink, '')
  // `gallery.items[].url` and `image.url` are `type: 'image'` (rendered as src,
  // never as href) — out of this policy's scope, so they are left alone.
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const [gallery] = normalizeBlocks([{ blockType: 'gallery', data: { items: [{ url: png }] } }])
  assert.equal((gallery!.data.items as Array<{ url: string }>)[0]!.url, png)
  const [image] = normalizeBlocks([{ blockType: 'image', data: { url: png } }])
  assert.equal(image!.data.url, png)
})

// ─── Read side: the public page blanks rows stored before the rule ────────────

let storedPage: Record<string, unknown> | null = null
let storedFlatRows: Array<Record<string, unknown>> = []
const fakeDb = {
  select: () => ({
    from: (table: { [key: symbol]: unknown }) => {
      const isPages = Object.getOwnPropertySymbols(table).some(sym => String(sym).includes('Name') && (table[sym] === 'pages'))
      const rows = () => (isPages ? (storedPage ? [storedPage] : []) : storedFlatRows)
      return {
        where: () => ({
          limit: async () => rows(),
          orderBy: async () => rows(),
        }),
      }
    },
  }),
}
const nav: { written: unknown[] } = { written: [] }
const navTx = {
  insert: () => ({
    values: (value: Record<string, unknown>) => {
      if ('action' in value) return Promise.resolve()
      return { onDuplicateKeyUpdate: async () => { nav.written.push(JSON.parse(String(value.value))) } }
    },
  }),
}
const pageAndNavDb = { ...fakeDb, transaction: async (fn: (t: typeof navTx) => Promise<unknown>) => fn(navTx) }
let activeDb: unknown = pageAndNavDb
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => activeDb,
    getPool: () => null,
  },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getQuery = getQuery
globals.getCookie = getCookie
globals.getRouterParam = getRouterParam
globals.readBody = async (event: { body?: unknown }) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

function pageEvent(url: string, slug: string): H3Event {
  const req = new IncomingMessage(new Socket())
  req.url = url
  req.method = 'GET'
  req.headers = { host: 'localhost' }
  const event = createEvent(req, new ServerResponse(req))
  event.context.params = { slug }
  return event
}
type PublicNode = { blockType: string, data: Record<string, unknown>, children?: PublicNode[] }
const publicPage = (await import('../server/api/public/pages/[slug].get.ts')).default as unknown as (event: H3Event) => Promise<{ ok: boolean, blocks: PublicNode[] }>

const flatten = (nodes: PublicNode[]): PublicNode[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])])

test('public page: a legacy published tree with script links is served with those links blanked', async () => {
  storedPage = {
    id: 1, slug: 'home', title: 'Trang chủ', seoTitle: null, seoDescription: null,
    publishedBlocks: [
      { blockType: 'hero', isVisible: true, data: { btnHelpText: 'Trợ giúp', btnHelpLink: 'javascript:alert(1)', btnAboutLink: '/about', translations: { en: { btnHelpLink: 'JaVa\tScRiPt:alert(2)' } } } },
      ...tree({ blockType: 'links', isVisible: true, data: { links: [{ label: 'a', url: '&#106;avascript:alert(3)' }, { label: 'b', url: 'https://example.gov.vn/x' }] } }),
      { blockType: 'cta', isVisible: true, data: { btnLink: '//evil.example/path' } },
    ],
  }
  for (const lang of ['vi', 'en']) {
    const response = await publicPage(pageEvent(`/api/public/pages/home?lang=${lang}`, 'home'))
    const text = JSON.stringify(response)
    assert.doesNotMatch(text, /script:alert|avascript|evil\.example/i, `${lang}: an unsafe link reached the public JSON`)
    const nodes = flatten(response.blocks)
    const hero = nodes.find(node => node.blockType === 'hero')!
    assert.equal(hero.data.btnHelpLink, '', `${lang}: hero button link is blanked, not dropped`)
    assert.equal(hero.data.btnAboutLink, '/about')
    const links = nodes.find(node => node.blockType === 'links')!
    assert.deepEqual((links.data.links as Array<{ url: string }>).map(link => link.url), ['', 'https://example.gov.vn/x'])
    assert.equal(nodes.find(node => node.blockType === 'cta')!.data.btnLink, '')
  }
})

test('public page: legacy flat rows (no published tree) are blanked the same way', async () => {
  storedPage = { id: 2, slug: 'about', title: 'Giới thiệu', seoTitle: null, seoDescription: null, publishedBlocks: null }
  storedFlatRows = [
    { id: 10, blockType: 'links', displayOrder: 1, data: { links: [{ url: 'vbscript:msgbox(1)' }, { url: 'mailto:a@b.vn' }] } },
    { id: 11, blockType: 'documents', displayOrder: 2, data: { btnLink: 'data:text/html,x' } },
  ]
  const response = await publicPage(pageEvent('/api/public/pages/about', 'about'))
  assert.deepEqual((response.blocks[0]!.data.links as Array<{ url: string }>).map(link => link.url), ['', 'mailto:a@b.vn'])
  assert.equal(response.blocks[1]!.data.btnLink, '')
})

// ─── Navigation save (legacy `nav_menu` endpoint) ─────────────────────────────

const navigationPut = (await import('../server/api/admin/settings/navigation.put.ts')).default as unknown as (event: { body: unknown, context: Record<string, unknown> }) => Promise<{ ok: boolean }>
const saveNav = (menu: unknown) => navigationPut({ body: { menu }, context: { adminUser: { id: 1 } } })

test('navigation save: the spec example `//evil.example/path` is a 400, and nothing is stored', async () => {
  for (const url of UNSAFE) {
    nav.written = []
    await assert.rejects(saveNav([{ id: 'a', label: 'Trang chủ', url: '/' }, { id: 'b', label: 'X', url }]),
      (error: { statusCode?: number, statusMessage?: string }) => error.statusCode === 400 && /menu\[1\]\.url/.test(error.statusMessage ?? ''),
      `${JSON.stringify(url)} was not refused with 400`)
    assert.deepEqual(nav.written, [], 'a refused save must store nothing')
  }
  nav.written = []
  await assert.rejects(saveNav([{ id: 'a', label: 'A', url: '/', children: [{ id: 'c', label: 'C', url: '//evil.example' }] }]),
    (error: { statusCode?: number, statusMessage?: string }) => error.statusCode === 400 && /menu\[0\]\.children\[0\]\.url/.test(error.statusMessage ?? ''))
  assert.deepEqual(nav.written, [])
})

test('navigation save: ordinary links are stored unchanged', async () => {
  nav.written = []
  const menu = SAFE.map((url, i) => ({ id: `i${i}`, label: `Mục ${i}`, url }))
  assert.equal((await saveNav(menu)).ok, true)
  assert.deepEqual((nav.written[0] as Array<{ url: string }>).map(item => item.url), SAFE)
})

// ─── The navigation endpoints the admin UI actually calls ─────────────────────
//
// `/admin/content/navigation/navbar.vue` and `mobile.vue` save through
// `settings/navigation/navbar.put.ts` (`nav_menu_navbar`) and
// `settings/navigation/mobile.put.ts` (`nav_menu_mobile`) — not the legacy
// `navigation.put.ts`. The spec scenario "save `//evil.example/path` → 400" is
// only met when THESE refuse it.

const navbarPut = (await import('../server/api/admin/settings/navigation/navbar.put.ts')).default as unknown as (event: { body: unknown, context: Record<string, unknown> }) => Promise<{ ok: boolean }>
const mobilePut = (await import('../server/api/admin/settings/navigation/mobile.put.ts')).default as unknown as (event: { body: unknown, context: Record<string, unknown> }) => Promise<{ ok: boolean }>
const asAdmin = (menu: unknown) => ({ body: { menu }, context: { adminUser: { id: 1 } } })
const isNamed400 = (field: RegExp) => (error: { statusCode?: number, statusMessage?: string }) => error.statusCode === 400 && field.test(error.statusMessage ?? '')

test('navbar save (UI path): an unsafe top-level or child URL is a 400 naming it, and nothing is stored', async () => {
  for (const url of UNSAFE) {
    nav.written = []
    await assert.rejects(navbarPut(asAdmin([{ id: 'a', label: 'A', url: '/' }, { id: 'b', label: 'B', url }])), isNamed400(/menu\[1\]\.url/), `${JSON.stringify(url)} was not refused`)
    await assert.rejects(navbarPut(asAdmin([{ id: 'a', label: 'A', url: '/', children: [{ id: 'c', label: 'C', url }] }])), isNamed400(/menu\[0\]\.children\[0\]\.url/))
    assert.deepEqual(nav.written, [], 'a refused save must store nothing')
  }
})

test('navbar save (UI path): ordinary links are stored unchanged', async () => {
  nav.written = []
  assert.equal((await navbarPut(asAdmin(SAFE.map((url, i) => ({ id: `i${i}`, label: `Mục ${i}`, url }))))).ok, true)
  assert.deepEqual((nav.written[0] as Array<{ url: string }>).map(item => item.url), SAFE)
})

test('mobile tab bar save (UI path): an unsafe link-tab URL is a 400 naming it, and nothing is stored', async () => {
  for (const url of UNSAFE) {
    nav.written = []
    await assert.rejects(mobilePut(asAdmin([{ id: 'h', label: 'Home', type: 'link', url: '/' }, { id: 'x', label: 'X', type: 'link', url }])), isNamed400(/menu\[1\]\.url/), `${JSON.stringify(url)} was not refused`)
    assert.deepEqual(nav.written, [])
  }
})

test('mobile tab bar save (UI path): ordinary links are stored; chatbot/drawer tabs store no URL at all', async () => {
  nav.written = []
  const links = SAFE.slice(0, 5)
  assert.equal((await mobilePut(asAdmin(links.map((url, i) => ({ id: `t${i}`, label: `Tab ${i}`, type: 'link', url }))))).ok, true)
  assert.deepEqual((nav.written[0] as Array<{ url: string }>).map(item => item.url), links)
  nav.written = []
  await mobilePut(asAdmin([{ id: 'chat', label: 'Hỏi AI', type: 'chatbot', url: 'javascript:alert(1)' }, { id: 'more', label: 'Thêm', type: 'drawer', url: '' }]))
  assert.deepEqual((nav.written[0] as Array<{ url: string }>).map(item => item.url), ['', ''], 'a non-navigating tab never stores the value')
})

// ─── The flat page-block write endpoints ──────────────────────────────────────
//
// `pages/[id]/blocks/index.post.ts` and `blocks/[blockId].put.ts` write
// `page_blocks.data` directly. No admin page calls them today, but they answer to
// anyone with `pages.create`/`pages.update`, so they apply the same rule.

const { pages: flatPagesTable, pageBlocks: pageBlocksTable } = await import('../server/db/schema')
const flatPost = (await import('../server/api/admin/pages/[id]/blocks/index.post.ts')).default as unknown as (event: { body: unknown, params: Record<string, string>, context: Record<string, unknown> }) => Promise<{ ok: boolean }>
const flatPut = (await import('../server/api/admin/pages/[id]/blocks/[blockId].put.ts')).default as unknown as (event: { body: unknown, params: Record<string, string>, context: Record<string, unknown> }) => Promise<{ ok: boolean }>

async function withFlatDb(existingType: string, run: (written: Array<Record<string, unknown>>) => Promise<void>) {
  const written: Array<Record<string, unknown>> = []
  const flatDb = {
    select: (projection?: Record<string, unknown>) => ({
      from: (table: unknown) => chain(() => {
        if (table === flatPagesTable) return [{ id: 7, slug: 'p' }]
        if (projection && 'maxOrder' in projection) return [{ maxOrder: 0 }]
        if (table === pageBlocksTable) return [{ id: 11, pageId: 7, blockType: existingType, data: {} }]
        return []
      }),
    }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => { if (table === pageBlocksTable) written.push(values); return chain(() => [{ insertId: 12 }]) } }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => { if (table === pageBlocksTable) written.push(values); return chain(() => []) } }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(flatDb),
  }
  activeDb = flatDb
  globals.getRouterParam = (event: { params: Record<string, string> }, key: string) => event.params[key]
  try {
    await run(written)
  } finally {
    activeDb = pageAndNavDb
    globals.getRouterParam = getRouterParam
  }
}

test('flat block create: an unsafe link is a 400 naming the field and nothing is inserted; a safe one is stored unchanged', async () => {
  await withFlatDb('links', async (written) => {
    for (const url of UNSAFE) {
      written.length = 0
      await assert.rejects(flatPost({ body: { blockType: 'links', data: { links: [{ url: '/a' }, { url }] } }, params: { id: '7' }, context: { adminUser: { id: 1 } } }),
        isNamed400(/links\[1\]\.url/), `${JSON.stringify(url)} was accepted`)
      assert.deepEqual(written, [])
    }
    written.length = 0
    await flatPost({ body: { blockType: 'cta', data: { btnLink: 'mailto:a@b.vn', translations: { en: { btnLink: '/en/x' } } } }, params: { id: '7' }, context: { adminUser: { id: 1 } } })
    assert.equal(written.length, 1)
    assert.equal((written[0]!.data as Record<string, unknown>).btnLink, 'mailto:a@b.vn')
  })
})

test('flat block update: the stored block type decides the link fields; unsafe → 400, nothing updated', async () => {
  await withFlatDb('cta', async (written) => {
    for (const url of UNSAFE) {
      written.length = 0
      await assert.rejects(flatPut({ body: { data: { btnLink: url } }, params: { id: '7', blockId: '11' }, context: { adminUser: { id: 1 } } }),
        isNamed400(/btnLink/), `${JSON.stringify(url)} was accepted`)
      await assert.rejects(flatPut({ body: { data: { btnLink: '/ok', translations: { en: { btnLink: url } } } }, params: { id: '7', blockId: '11' }, context: { adminUser: { id: 1 } } }),
        isNamed400(/translations\.en\.btnLink/))
      assert.deepEqual(written, [])
    }
    written.length = 0
    await flatPut({ body: { data: { btnLink: 'https://example.gov.vn/x' } }, params: { id: '7', blockId: '11' }, context: { adminUser: { id: 1 } } })
    assert.equal((written[0]!.data as Record<string, unknown>).btnLink, 'https://example.gov.vn/x')
  })
})

// ─── Publish over a live tree that still holds a legacy unsafe link ──────────
//
// Publish snapshots the CURRENT live tree into an auto version before replacing
// it. Run through the rejecting check, that snapshot would 400 on the very link
// the editor is publishing a fix for — the page could never be repaired.

const { pages: pagesTable } = await import('../server/db/schema')
const publish = (await import('../server/api/admin/pages/[id]/publish.post.ts')).default as unknown as (event: { body: unknown, params: Record<string, string>, context: Record<string, unknown> }) => Promise<unknown>

/** A drizzle-ish chain: every call returns itself; awaiting it yields `rows()`. */
function chain(rows: () => unknown[]): unknown {
  const proxy: unknown = new Proxy(function chainTarget() {}, {
    get: (_target, prop) => (prop === 'then' ? (resolve: (value: unknown) => void) => resolve(rows()) : proxy),
    apply: () => proxy,
  })
  return proxy
}

test('publish: a clean tree replaces a live tree holding a legacy unsafe link (the fix is never blocked)', async () => {
  const live = [{ blockType: 'cta', isVisible: true, displayOrder: 1, data: { btnLink: 'javascript:alert(1)' } }]
  const writes: Array<Record<string, unknown>> = []
  const publishDb = {
    select: () => ({ from: (table: unknown) => chain(() => (table === pagesTable ? [{ id: 7, publishedBlocks: live, draftBlocks: null }] : [])) }),
    insert: () => ({ values: (values: Record<string, unknown>) => { writes.push({ insert: values }); return chain(() => [{ insertId: 1 }]) } }),
    update: () => ({ set: (values: Record<string, unknown>) => { writes.push({ update: values }); return chain(() => []) } }),
    delete: () => chain(() => []),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(publishDb),
  }
  activeDb = publishDb
  globals.getRouterParam = (event: { params: Record<string, string> }, key: string) => event.params[key]
  try {
    const fixed = [{ blockType: 'section', isVisible: true, data: {}, children: [{ blockType: 'cta', isVisible: true, data: { btnLink: '/about' } }] }]
    await publish({ body: { blocks: fixed }, params: { id: '7' }, context: { adminUser: { id: 1 } } })
    const published = writes.find(write => write.update && 'publishedBlocks' in (write.update as object))
    assert.ok(published, 'the clean tree was not published')
    assert.match(JSON.stringify(published), /"btnLink":"\/about"/)

    // …while a NEW unsafe link in the incoming tree is still refused.
    await assert.rejects(
      publish({ body: { blocks: [{ blockType: 'cta', data: { btnLink: 'javascript:alert(2)' } }] }, params: { id: '7' }, context: { adminUser: { id: 1 } } }),
      (error: { statusCode?: number }) => error.statusCode === 400,
    )
  } finally {
    activeDb = pageAndNavDb
    globals.getRouterParam = getRouterParam
  }
})

// ─── Render side (defence in depth) ───────────────────────────────────────────

test('LinksBlock and HeroBlock never render an unsafe href', async () => {
  const { safeLinkOrNull } = await import('../shared/link-policy.ts')
  const links = await renderSfcTemplate(new URL('../app/components/blocks/LinksBlock.vue', import.meta.url).pathname, {
    d: { title: 'Liên kết', subtitle: '' },
    links: [{ icon: '·', label: 'Xấu', url: 'javascript:alert(1)' }, { icon: '·', label: 'Tốt', url: 'https://example.gov.vn/x' }],
    t: (key: string) => key,
    safeLinkOrNull,
  })
  assert.doesNotMatch(links, /javascript:/i)
  assert.match(links, /href="https:\/\/example\.gov\.vn\/x"/)

  const hero = await renderSfcTemplate(new URL('../app/components/blocks/HeroBlock.vue', import.meta.url).pathname, {
    d: { badge: 'B', titleLine1: 'T1', titleLine2: 'T2', subtitle: 'S', btnAboutText: 'Về', btnAboutLink: 'javascript:alert(1)', btnHelpText: 'Giúp', btnHelpLink: 'JaVa\tScRiPt:alert(2)' },
    bgImage: '/assets/hero_banner.jpg',
    isDefaultHero: true,
    t: (key: string) => key,
    safeLinkOrNull,
  })
  assert.doesNotMatch(hero, /script:alert/i)
  assert.match(hero, /href="#tro-giup"/, 'an unsafe help link falls back to the default anchor')
})
