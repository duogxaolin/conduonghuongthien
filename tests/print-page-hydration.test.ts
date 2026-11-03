/**
 * `/in-bai/<slug>` (trang in) dựng RA CÙNG MỘT CHỮ ở máy chủ và ở trình duyệt — điều kiện
 * để hydrate không lệch. Trang không đệm (`cache: false`), dựng ở máy chủ mỗi lượt.
 *
 * Hai chỗ từng lệch (đo trên bản build, CHANGELOG § 69):
 *  - ngày đăng + "ngày in" gọi `toLocaleDateString` không `timeZone`: container
 *    `TZ=Asia/Ho_Chi_Minh`, trình duyệt khác múi giờ → hai ngày khác nhau;
 *  - "Nguồn" đọc `window.location.origin`: máy chủ không có `window` → chuỗi rỗng, trình
 *    duyệt có URL → lệch ở MỌI múi giờ. Nay lấy từ `useRequestURL()` (cả hai phía).
 *
 * Mount trang THẬT (tests/_public-mount-harness.ts) dưới từng múi giờ máy (`process.env.TZ`
 * đổi giữa chừng) và ở dạng "máy chủ" (không `window`, `import.meta.server`) lẫn "trình duyệt".
 */
import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'

import { byTag, json, mountPublic, routes, settle, Stub, words } from './_public-mount-harness.ts'

const ARTICLE = {
  ok: true,
  article: {
    id: 7, type: 'news', category: null, categoryId: 2, categoryName: 'Tin hoạt động', categorySlug: 'tin-hoat-dong',
    // 20:59Z on 05/10 is 03:59 on 06/10 in Vietnam — the article the mismatch was measured on.
    title: 'Hành trình trở về', slug: 'hanh-trinh', excerpt: null, content: '<p>Thân bài</p>',
    thumbnailUrl: null, publishedAt: '2026-10-05T20:59:44.000Z', createdAt: null, authorName: 'bientap', viewTotal: 0,
  },
}
const ZONES = ['Asia/Ho_Chi_Minh', 'Europe/London', 'America/Los_Angeles']
const REQUEST = 'https://conduonghuongthien.vn/in-bai/hanh-trinh?back=/news'

async function withZone<T>(zone: string, run: () => Promise<T>): Promise<T> {
  const saved = process.env.TZ
  process.env.TZ = zone
  try {
    return await run()
  } finally {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  }
}

/** The printed sheet's date line, "printed on" line and source line, as one side renders them. */
async function sheet(t: TestContext, side: 'server' | 'browser') {
  const ctx = await mountPublic(t, {
    file: 'pages/in-bai/[slug].vue',
    route: { path: '/in-bai/hanh-trinh', params: { slug: 'hanh-trinh' }, query: { back: '/news' } },
    responder: routes({ 'GET /api/public/articles/hanh-trinh': () => json(ARTICLE), 'GET /api/public/settings': () => json({ ok: true, settings: {} }) }),
    auto: { useBrokenImageFallback: () => {}, useRequestURL: () => new URL(REQUEST) },
    components: { PublicEmail: Stub },
    // The server has no `window`; the browser's `location` is on another origin here on
    // purpose, to show the page no longer reads it.
    globals: side === 'browser' ? { window: { print: () => {}, location: { origin: 'http://elsewhere.test', href: 'http://elsewhere.test/' } } } : {},
    importMeta: side === 'server' ? { server: true, client: false } : { server: false, client: true },
  })
  await settle()
  const text = (cls: string) => words(byTag(ctx.page, 'p').find(el => el.props.class === cls) ?? byTag(ctx.page, 'div').find(el => el.props.class === cls)!)
  // Read before unmounting: the tree is gone after `close()`.
  const got = {
    printedOn: text('masthead-date'),
    published: words(byTag(ctx.page, 'span').filter(el => !el.props.class).find(el => /tháng/.test(words(el)))!),
    source: text('printFoot-url'),
  }
  ctx.close()
  return got
}

// "Now" = 2026-11-02T18:05Z: 03/11 in Vietnam, 02/11 in London and Los Angeles. Timers too:
// the page prints 400 ms after mount, and a mocked clock keeps that from firing.
const freezeClock = (t: TestContext) => t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-02T18:05:00.000Z') })

describe('/in-bai/<slug>: the server HTML and the browser render the same text', () => {
  it('dates: Vietnam date on every machine zone (published 06/10, printed on Thứ Ba 03/11)', async (t) => {
    freezeClock(t)
    for (const zone of ZONES) {
      const got = await withZone(zone, () => sheet(t, 'browser'))
      assert.equal(got.published, '06 tháng 10, 2026', zone)
      assert.equal(got.printedOn, 'Thứ Ba, 03 tháng 11, 2026', zone)
    }
  })

  it('source URL: the request origin on BOTH sides — never empty on the server, never the browser\'s own guess', async (t) => {
    freezeClock(t)
    const server = await withZone('Asia/Ho_Chi_Minh', () => sheet(t, 'server'))
    const browser = await withZone('Europe/London', () => sheet(t, 'browser'))
    assert.match(server.source, /https:\/\/conduonghuongthien\.vn\/news\/hanh-trinh$/)
    assert.deepEqual(browser, server)
  })
})
