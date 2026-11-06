import assert from 'node:assert/strict'
import test, { describe, mock } from 'node:test'

import { fakeNitroApp, loadPlugin } from './_nitro-plugin-harness.ts'

/**
 * `server/plugins/og-image.ts` và `server/plugins/favicon.ts` — CHẠY hai plugin thật (hook
 * `render:html`) qua bộ đọc cấu hình thật (`og-image-setting`, `favicon-setting`) với DB giả.
 *
 * Hai plugin cố ý KHÁC nhau (xem docblock từng tệp), nên test canh đúng chỗ khác:
 *  - og:image bỏ `/admin/**` và `/api`; favicon chỉ bỏ `/api` (tab admin vẫn cần icon);
 *  - DB hỏng: og:image không chèn gì, favicon chèn bộ MẶC ĐỊNH;
 *  - cả hai: bộ đệm 30 giây (kể cả giá trị lùi), `clear*Cache` bỏ đệm, URL được `escapeHtml`.
 */

let settingRows: Record<string, string | null> = {}
let dbFailure: Error | null = null
let dbReads = 0

type Selection = Record<string, unknown> | undefined
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: (selection: Selection) => {
        const wantsKey = !!selection && 'key' in selection
        const run = async () => {
          dbReads += 1
          if (dbFailure) throw dbFailure
          if (wantsKey) return Object.entries(settingRows).map(([key, value]) => ({ key, value }))
          const og = settingRows.og_image_url
          return og === undefined ? [] : [{ value: og }]
        }
        const from = () => ({
          where: run,
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject),
        })
        return { from }
      },
    }),
  },
})

const { clearOgImageSettingCache } = await import('../server/utils/og-image-setting.ts')
const { clearFaviconSettingCache, loadFaviconSetting } = await import('../server/utils/favicon-setting.ts')
// Import động SAU mock `utils/db` ở trên: một import tĩnh ở đầu tệp nạp module `db` thật trước khi mock áp.
const { OG_IMAGE_SETTING_KEY } = await import('../server/utils/og-image-setting')
const ogPlugin = await loadPlugin('server/plugins/og-image.ts')
const faviconPlugin = await loadPlugin('server/plugins/favicon.ts')

// Đồng hồ giả chỉ đi tới: bộ đệm sống qua các test.
mock.timers.enable({ apis: ['Date'], now: 5_000_000 })
test.after(() => { mock.timers.reset() })
const TTL = 30_000

type Html = { head: string[], bodyPrepend: string[] }
async function render(plugin: typeof ogPlugin, path: string | undefined, opts: { expire?: boolean } = {}): Promise<Html> {
  if (opts.expire !== false) mock.timers.tick(TTL + 1)
  const nitro = fakeNitroApp()
  await plugin(nitro.app)
  const html: Html = { head: [], bodyPrepend: [] }
  await nitro.fire('render:html', html, { event: path === undefined ? undefined : { path } })
  return html
}

function reset(rows: Record<string, string | null> = {}) {
  settingRows = rows
  dbFailure = null
  dbReads = 0
  clearOgImageSettingCache()
  clearFaviconSettingCache()
}

describe('og-image', () => {
  const OG = 'https://cdn.example.vn/og/share.jpg'

  test('đăng ký đúng một hook render:html', async () => {
    const nitro = fakeNitroApp()
    await ogPlugin(nitro.app)
    assert.deepEqual(nitro.names(), ['render:html'])
  })

  test('có URL: đúng năm thẻ og/twitter, 1200x630, summary_large_image', async () => {
    reset({ og_image_url: OG })
    const html = await render(ogPlugin, '/about')
    assert.deepEqual(html.head, [
      `<meta property="og:image" content="${OG}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:image" content="${OG}">`,
    ])
    assert.deepEqual(html.bodyPrepend, [])
  })

  test('bỏ /admin/** và /api thật, không chạm DB; slug chỉ trùng chữ đầu thì có chèn', async () => {
    reset({ og_image_url: OG })
    for (const path of ['/admin/', '/admin/content', '/api', '/api/public/x', '/admin/content?page=2', '/api?x=1', '/ADMIN/content', '/%61dmin/x', '/API/x']) {
      dbReads = 0
      assert.deepEqual((await render(ogPlugin, path)).head, [], `${path} không được chèn`)
      assert.equal(dbReads, 0, `${path} không được đọc DB`)
    }
    for (const path of ['/', '/news/bai-1', '/api-tin-tuc', '/admin-huong-dan', '/news?page=2']) {
      assert.equal((await render(ogPlugin, path)).head.length, 5, `${path} phải được chèn`)
    }
  })

  test('chưa đặt / rỗng / chỉ khoảng trắng → không chèn gì (không có fallback cứng)', async () => {
    for (const rows of [{}, { og_image_url: '' }, { og_image_url: '   ' }, { og_image_url: null }]) {
      reset(rows)
      assert.deepEqual((await render(ogPlugin, '/')).head, [], JSON.stringify(rows))
    }
  })

  test('URL được cắt khoảng trắng và escapeHtml (dấu nháy không đóng thuộc tính, & thành &amp;)', async () => {
    reset({ og_image_url: '  https://cdn.vn/a.png?x=1&y="><script>alert(1)</script>  ' })
    const html = (await render(ogPlugin, '/')).head.join('\n')
    assert.match(html, /content="https:\/\/cdn\.vn\/a\.png\?x=1&amp;y=&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/)
    assert.doesNotMatch(html, /<script/)
  })

  test('lỗi DB: không ném, không chèn gì; giá trị lùi cũng được đệm; hồi phục sau TTL', async () => {
    reset({ og_image_url: OG })
    dbFailure = new Error('ECONNREFUSED')
    assert.deepEqual((await render(ogPlugin, '/')).head, [])
    assert.equal(dbReads, 1)
    // Trong TTL: không hỏi DB lần nữa dù DB đã sống lại (tránh một sự cố thành hai).
    dbFailure = null
    assert.deepEqual((await render(ogPlugin, '/', { expire: false })).head, [])
    assert.equal(dbReads, 1, 'lượt lùi phải được đệm')
    assert.equal((await render(ogPlugin, '/')).head.length, 5, 'sau TTL phải hồi phục')
  })

  test('bộ đệm 30 giây và clearOgImageSettingCache() cho thấy giá trị mới ngay', async () => {
    reset({ og_image_url: OG })
    await render(ogPlugin, '/')
    settingRows = { og_image_url: 'https://cdn.vn/new.png' }
    const stale = await render(ogPlugin, '/', { expire: false })
    assert.match(stale.head[0]!, /share\.jpg/)
    assert.equal(dbReads, 1)
    clearOgImageSettingCache()
    const fresh = await render(ogPlugin, '/', { expire: false })
    assert.match(fresh.head[0]!, /new\.png/)
  })

  test('thiếu event (không có path) không ném và được coi là trang công khai', async () => {
    reset({ og_image_url: OG })
    assert.equal((await render(ogPlugin, undefined)).head.length, 5)
  })
})

describe('favicon', () => {
  const linkTags = (html: Html) => html.head.filter(tag => tag.startsWith('<link'))
  const DEFAULT_TAGS = [
    '<link rel="icon" type="image/png" href="/favicon-32.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png">',
  ]

  test('đăng ký đúng một hook render:html', async () => {
    const nitro = fakeNitroApp()
    await faviconPlugin(nitro.app)
    assert.deepEqual(nitro.names(), ['render:html'])
  })

  test('chưa đặt favicon: bộ mặc định (icon + apple-touch 180)', async () => {
    reset({})
    assert.deepEqual((await render(faviconPlugin, '/')).head, DEFAULT_TAGS)
  })

  test('/admin KHÔNG bị bỏ (tab admin cần icon); chỉ /api thật bị bỏ; /api-tin-tuc có icon', async () => {
    reset({})
    for (const path of ['/admin/login', '/admin/content/articles', '/api-tin-tuc', '/']) {
      assert.deepEqual((await render(faviconPlugin, path)).head, DEFAULT_TAGS, path)
    }
    for (const path of ['/api', '/api/public/social-links', '/api?x=1', '/API/x', '/%61pi/x']) {
      dbReads = 0
      assert.deepEqual((await render(faviconPlugin, path)).head, [], path)
      assert.equal(dbReads, 0)
    }
  })

  test('URL cấu hình hợp lệ (tương đối hoặc https) được dùng; apple-touch đi theo favicon tuỳ biến', async () => {
    reset({ favicon_url: '/uploads/2026/08/icon.png' })
    assert.deepEqual((await render(faviconPlugin, '/')).head, [
      '<link rel="icon" type="image/png" href="/uploads/2026/08/icon.png">',
      '<link rel="apple-touch-icon" sizes="180x180" href="/uploads/2026/08/icon.png">',
    ])
    reset({ favicon_url: 'https://cdn.example.vn/i.webp?v=2' })
    assert.deepEqual(linkTags(await render(faviconPlugin, '/'))[0], '<link rel="icon" type="image/webp" href="https://cdn.example.vn/i.webp?v=2">')
  })

  test('URL không an toàn lùi về MẶC ĐỊNH, không bao giờ vào thẻ', async () => {
    for (const bad of ['javascript:alert(1)', '//evil.com/x.png', 'http://x.vn/a.png', 'data:image/svg+xml,<svg/>', '/a"onerror="x', '/a b.png']) {
      reset({ favicon_url: bad })
      const html = await render(faviconPlugin, '/')
      assert.deepEqual(html.head, DEFAULT_TAGS, bad)
    }
  })

  test('href được escapeHtml (& trong query thành &amp;)', async () => {
    reset({ favicon_url: 'https://cdn.vn/i.png?a=1&b=2' })
    assert.match((await render(faviconPlugin, '/')).head[0]!, /href="https:\/\/cdn\.vn\/i\.png\?a=1&amp;b=2"/)
  })

  test('lỗi DB: không ném và chèn bộ MẶC ĐỊNH (khác og:image); lượt lùi được đệm', async () => {
    reset({ favicon_url: '/uploads/x.png' })
    dbFailure = new Error('ECONNREFUSED')
    assert.deepEqual((await render(faviconPlugin, '/')).head, DEFAULT_TAGS)
    assert.equal(dbReads, 1)
    dbFailure = null
    assert.deepEqual((await render(faviconPlugin, '/', { expire: false })).head, DEFAULT_TAGS)
    assert.equal(dbReads, 1)
    assert.match((await render(faviconPlugin, '/')).head[0]!, /uploads\/x\.png/, 'sau TTL phải lấy lại cấu hình thật')
  })

  test('bộ đệm 30 giây và clearFaviconSettingCache() cho thấy icon mới ngay', async () => {
    reset({ favicon_url: '/old.png' })
    await render(faviconPlugin, '/')
    settingRows = { favicon_url: '/new.png' }
    assert.match((await render(faviconPlugin, '/', { expire: false })).head[0]!, /old\.png/)
    clearFaviconSettingCache()
    assert.match((await render(faviconPlugin, '/', { expire: false })).head[0]!, /new\.png/)
  })

  // Bộ đọc dùng chung cả `routes/favicon.ico.ts`, nên lớp `safeFaviconUrl` của chính nó phải đứng được
  // một mình — thẻ <link> của plugin còn một lớp nữa, tuyến /favicon.ico thì không.
  test('bộ đọc dùng chung tự lọc: favicon_url xấu → mặc định, favicon_ico_url xấu → null, hợp lệ được giữ', async () => {
    reset({ favicon_url: 'javascript:alert(1)', favicon_ico_url: '//evil.com/f.ico' })
    assert.deepEqual(await loadFaviconSetting(), { iconUrl: '/favicon-32.png', icoUrl: null })
    reset({ favicon_url: '/uploads/i.png', favicon_ico_url: 'https://cdn.vn/f.ico' })
    assert.deepEqual(await loadFaviconSetting(), { iconUrl: '/uploads/i.png', icoUrl: 'https://cdn.vn/f.ico' })
    reset({})
    assert.deepEqual(await loadFaviconSetting(), { iconUrl: '/favicon-32.png', icoUrl: null })
  })
})

// Mock DB ở trên bỏ qua đối số `.where()`, nên khoá `settings` mà plugin đọc phải được ghim riêng: đổi nó thành khoá
// khác thì mọi test ở đây vẫn xanh trong khi trang công khai đọc nhầm cấu hình. `settings/index.put.ts` xoá đệm theo
// đúng chuỗi này (`applied.includes('og_image_url')`).
test('khoá cấu hình mà og-image đọc là og_image_url — cùng khoá mà settings PUT xoá đệm theo', () => {
  assert.equal(OG_IMAGE_SETTING_KEY, 'og_image_url')
})
