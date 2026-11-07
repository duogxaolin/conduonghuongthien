import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

import { byTag, h3Error, json, mountPublic, routes, settle, words } from './_public-mount-harness.ts'

/**
 * `/in-bai/<slug>` (app/pages/in-bai/[slug].vue) — the newspaper print page — takes a `?back=`
 * query that anyone can write into a link. It becomes the page's "back" link and the base of the
 * printed source URL, so it must pass through `safeInternalPath`: `//evil.example` or
 * `/\evil.example` as an `href` is a link off the site, under the portal's own address
 * (open redirect).
 *
 * The page is mounted for real (tests/_public-mount-harness.ts) with a hostile `back`, and what
 * is asserted is what a visitor gets: the `href` of the link in the error block and the source
 * URL printed in the footer. Before this file the claim was `safeInternalPath\(route\.query\.back`
 * and `:href="backPath"` matched in the page's source (`tests/safe-path.test.ts`); that file keeps
 * the unit table of `safeInternalPath` itself.
 */

const ARTICLE = {
  ok: true,
  article: {
    id: 7, type: 'news', category: null, categoryId: 2, categoryName: 'Tin hoạt động', categorySlug: 'tin-hoat-dong',
    title: 'Hành trình trở về', slug: 'hanh-trinh', excerpt: 'Sapo', content: '<p>Thân bài</p>',
    thumbnailUrl: null, publishedAt: '2026-10-20T03:00:00.000Z', createdAt: '2026-10-19T03:00:00.000Z', authorName: 'bientap', viewTotal: 1,
  },
}
const ORIGIN = 'http://portal.test'

const timersOn = new WeakSet<TestContext>()

async function openPrint(t: TestContext, back: unknown, articleOk: boolean) {
  // The page prints 400 ms after mount through the global `window`; mocked timers keep that
  // from firing into another test.
  if (!timersOn.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timersOn.add(t) }
  const ctx = await mountPublic(t, {
    file: 'pages/in-bai/[slug].vue',
    route: { path: '/in-bai/hanh-trinh', params: { slug: 'hanh-trinh' }, query: { back } },
    responder: routes({
      'GET /api/public/articles/hanh-trinh': () => (articleOk ? json(ARTICLE) : h3Error(404, 'Bài viết không tồn tại hoặc chưa xuất bản.')),
      'GET /api/public/settings': () => json({ ok: true, settings: {} }),
    }),
    auto: { useBrokenImageFallback: () => {}, useRequestURL: () => new URL(`${ORIGIN}/in-bai/hanh-trinh`) },
    components: {},
    globals: { window: { print: () => {}, location: { origin: ORIGIN } } },
  })
  await settle()
  return ctx
}

/** The `href` of the "back" link in the error block. */
async function backHref(t: TestContext, back: unknown): Promise<unknown> {
  const ctx = await openPrint(t, back, false)
  const links = byTag(ctx.page, 'a').filter(el => words(el).includes('Quay lại trang bài viết'))
  assert.equal(links.length, 1, 'the error block has one back link')
  const href = links[0]!.props.href
  ctx.close() // one mount at a time: the next one replaces the same globals
  return href
}

/** The source URL printed in the footer of a loaded sheet. */
async function printedUrl(t: TestContext, back: unknown): Promise<string> {
  const ctx = await openPrint(t, back, true)
  const foot = byTag(ctx.page, 'div').find(el => el.props.class === 'printFoot-url')
  assert.ok(foot, 'the sheet has a source line')
  const text = words(foot)
  ctx.close()
  return text.slice(text.indexOf('http'))
}

const HOSTILE: Array<[string, unknown]> = [
  ['network-path //evil.example', '//evil.example'],
  ['many slashes', '///evil.example'],
  ['backslash /\\evil.example', '/\\evil.example'],
  ['absolute https URL', 'https://evil.example/news'],
  ['javascript: scheme', 'javascript:alert(1)'],
  ['no leading slash (would become a host)', 'evil.example'],
  ['encoded slash /%2Fevil.example', '/%2Fevil.example'],
  ['tab inside (a browser drops it → //)', '/\t/evil.example'],
  ['an array whose first element is hostile', ['//evil.example', '/news']],
  ['nothing at all', undefined],
]

describe('/in-bai/<slug>: the back link and the printed source URL are same-site paths', () => {
  it('a normal back path is used as given (and not doubled into //news)', async (t) => {
    assert.equal(await backHref(t, '/news'), '/news')
    assert.equal(await printedUrl(t, '/news'), `${ORIGIN}/news/hanh-trinh`)
    assert.equal(await backHref(t, '/reintegration-models'), '/reintegration-models')
  })

  for (const [label, back] of HOSTILE) {
    it(`hostile back (${label}): the link falls back to / and the printed URL stays on the portal`, async (t) => {
      assert.equal(await backHref(t, back), '/', 'the back link must not leave the site')
      const url = await printedUrl(t, back)
      assert.equal(url, `${ORIGIN}/hanh-trinh`, 'the printed source URL is the portal origin plus the article, nothing from `back`')
      assert.equal(new URL(url).origin, ORIGIN)
    })
  }
})
