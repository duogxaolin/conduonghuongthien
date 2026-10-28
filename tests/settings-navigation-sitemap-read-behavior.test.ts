import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * Four read-only `settings` routes of the admin, all `settings.read`:
 *   - `GET /api/admin/settings/navigation` (navigation.get.ts) — the stored menu,
 *     `nav_menu`;
 *   - `GET /api/admin/settings/navigation/navbar` (navbar.get.ts) — the desktop
 *     menu, `nav_menu_navbar`, falling back to `nav_menu`;
 *   - `GET /api/admin/settings/navigation/mobile` (mobile.get.ts) — the bottom bar,
 *     `nav_menu_mobile`, with NO fallback (another shape);
 *   - `POST /api/admin/settings/sitemap/generate` (generate.post.ts) — a fresh
 *     sitemap from the database, for the officer to review and save; nothing saved.
 *
 * The invariants:
 *   - `settings.read`; without it nothing is read;
 *   - a stored menu comes back parsed; a missing or unreadable one is `null` (the
 *     page then starts from its default), never a 500;
 *   - the sitemap is built on the base URL the browser used (host from our own
 *     proxy's forwarded headers), lists published articles only, and lists each URL
 *     once — `/qa-documents` was listed twice whenever a Q&A was published, the
 *     second copy with the latest Q&A date (FINDING-R5-15).
 *
 * Real h3 app + `admin-auth`, the real `generateSitemap` on SQL run by SQLite
 * (`_ai-route-harness.ts` — no AI here, the harness is the same h3 + SQLite one).
 */

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: schema => [schema.pages, schema.articles, schema.categories, schema.contentTypes, schema.chatbotKnowledge],
  routes: async load => [
    { method: 'get', path: '/api/admin/settings/navigation', handler: await load('../server/api/admin/settings/navigation.get') },
    { method: 'get', path: '/api/admin/settings/navigation/navbar', handler: await load('../server/api/admin/settings/navigation/navbar.get') },
    { method: 'get', path: '/api/admin/settings/navigation/mobile', handler: await load('../server/api/admin/settings/navigation/mobile.get') },
    { method: 'post', path: '/api/admin/settings/sitemap/generate', handler: await load('../server/api/admin/settings/sitemap/generate.post') },
  ],
})
after(() => h.server.close())
const { settings, articles, contentTypes, chatbotKnowledge, categories, pages } = h.schema

let reader: Awaited<ReturnType<typeof h.account>>
beforeEach(async () => {
  h.reset()
  reader = await h.account([{ resource: 'settings', canRead: true }], 'caidat')
})
const store = (key: string, value: string) => h.harness.db.insert(settings).values({ key, value })
const menuAt = async (path: string) => {
  const response = await h.request('GET', `/api/admin/settings/navigation${path}`, reader)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  return response.body.menu
}
const MAIN = [{ label: 'Tin tức', href: '/news' }]
const NAVBAR = [{ label: 'Thanh trên', href: '/' }]
const MOBILE = { items: [{ icon: 'house', href: '/' }] }

test('settings.read is required by all four: no session → 401, another resource → 403', async () => {
  const editor = await h.account([{ resource: 'news', canRead: true, canUpdate: true }], 'bientap')
  for (const [method, path] of [['GET', '/api/admin/settings/navigation'], ['GET', '/api/admin/settings/navigation/navbar'], ['GET', '/api/admin/settings/navigation/mobile'], ['POST', '/api/admin/settings/sitemap/generate']] as const) {
    assert.equal((await h.request(method, path, null)).status, 401, path)
    assert.equal((await h.request(method, path, editor)).status, 403, path)
  }
})

test('navigation: the stored menu, parsed; missing or unreadable → null', async () => {
  assert.equal(await menuAt(''), null)
  await store('nav_menu', '{not json')
  assert.equal(await menuAt(''), null)
  h.harness.sqlite.prepare('DELETE FROM settings').run()
  await store('nav_menu', JSON.stringify(MAIN))
  assert.deepEqual(await menuAt(''), MAIN)
})

test('navbar: its own key first, the shared menu when it has none, null when neither', async () => {
  assert.equal(await menuAt('/navbar'), null)
  await store('nav_menu', JSON.stringify(MAIN))
  assert.deepEqual(await menuAt('/navbar'), MAIN)
  await store('nav_menu_navbar', JSON.stringify(NAVBAR))
  assert.deepEqual(await menuAt('/navbar'), NAVBAR)
})

test('mobile: its own key only — the shared menu has another shape and is never used', async () => {
  await store('nav_menu', JSON.stringify(MAIN))
  assert.equal(await menuAt('/mobile'), null)
  await store('nav_menu_mobile', JSON.stringify(MOBILE))
  assert.deepEqual(await menuAt('/mobile'), MOBILE)
  h.harness.sqlite.prepare('UPDATE settings SET value = \'[broken\' WHERE key = \'nav_menu_mobile\'').run()
  assert.equal(await menuAt('/mobile'), null)
})

async function seedSite() {
  await h.harness.db.insert(contentTypes).values({ slug: 'tuyen-dung', name: 'Tuyển dụng', isSystem: false, createdAt: new Date('2026-09-01T00:00:00Z') })
  await h.harness.db.insert(pages).values({ slug: 'gioi-thieu-them', title: 'Giới thiệu thêm', updatedAt: new Date('2026-10-02T00:00:00Z') })
  await h.harness.db.insert(categories).values({ slug: 'an-ninh', name: 'An ninh', type: 'news', parentId: null, createdAt: new Date('2026-08-01T00:00:00Z') })
  await h.harness.db.insert(articles).values([
    { slug: 'bai-da-dang', title: 'Đã đăng', type: 'news', status: 'published', publishedAt: new Date('2026-10-20T03:00:00Z'), updatedAt: new Date('2026-10-21T00:00:00Z') },
    { slug: 'bai-nhap', title: 'Bản nháp', type: 'news', status: 'draft', updatedAt: new Date('2026-10-22T00:00:00Z') },
    { slug: 'tin-tuyen-dung', title: 'Tuyển', type: 'tuyen-dung', status: 'published', publishedAt: new Date('2026-10-23T00:00:00Z') },
  ])
}
const generate = (headers: Record<string, string> = {}) =>
  h.server.request('POST', '/api/admin/settings/sitemap/generate', { cookie: h.cookieFor(reader), headers })
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]!)

test('sitemap: built from the database on the host the browser used — published articles only — and not saved', async () => {
  await seedSite()
  const response = await generate({ 'x-forwarded-host': 'conduonghuongthien.example', 'x-forwarded-proto': 'https' })
  assert.equal(response.status, 200)
  const xml = String(response.body.xml)
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset /)
  const urls = locs(xml)
  for (const path of ['/', '/news', '/tuyen-dung', '/gioi-thieu-them', '/news/an-ninh', '/news/bai-da-dang', '/tuyen-dung/tin-tuyen-dung']) {
    assert.ok(urls.includes(`https://conduonghuongthien.example${path}`), `${path} in\n${urls.join('\n')}`)
  }
  assert.ok(!urls.some(url => url.includes('bai-nhap')), 'a draft is not in the sitemap')
  assert.match(xml, /<loc>https:\/\/conduonghuongthien\.example\/news\/bai-da-dang<\/loc>\n {4}<lastmod>2026-10-20<\/lastmod>/)
  assert.deepEqual(h.harness.rows(settings), [], 'nothing saved')
})

test('FINDING-R5-15: each URL is listed once — /qa-documents carries the latest published Q&A date', async () => {
  await h.harness.db.insert(chatbotKnowledge).values([
    { canonicalQuestion: 'Hỏi 1', normalizedQuestion: 'hoi 1', approvedAnswer: 'Đáp 1', topic: 'chung', status: 'published', publishedAt: new Date('2026-10-05T00:00:00Z') },
    { canonicalQuestion: 'Hỏi 2', normalizedQuestion: 'hoi 2', approvedAnswer: 'Đáp 2', topic: 'chung', status: 'published', publishedAt: new Date('2026-10-25T00:00:00Z') },
    { canonicalQuestion: 'Hỏi 3', normalizedQuestion: 'hoi 3', approvedAnswer: 'Đáp 3', topic: 'chung', status: 'draft', updatedAt: new Date('2026-10-27T00:00:00Z') },
  ])
  const xml = String((await generate()).body.xml)
  const urls = locs(xml)
  assert.equal(new Set(urls).size, urls.length, `duplicates in\n${urls.join('\n')}`)
  assert.match(xml, /\/qa-documents<\/loc>\n {4}<lastmod>2026-10-25<\/lastmod>/)
})

test('sitemap: with no Q&A published, /qa-documents is still listed (the page exists), without a date', async () => {
  const xml = String((await generate()).body.xml)
  const at = xml.indexOf('/qa-documents</loc>')
  assert.ok(at > 0)
  assert.doesNotMatch(xml.slice(at, xml.indexOf('</url>', at)), /lastmod/)
})
