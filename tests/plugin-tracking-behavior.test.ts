import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { fakeNitroApp, loadPlugin } from './_nitro-plugin-harness.ts'

/**
 * `server/plugins/tracking.ts` — CHẠY plugin thật (hook `render:html`) với DB giả.
 *
 * Bất biến: (1) chỉ trang công khai được chèn — `/admin` và `/api` thật thì không, còn slug
 * trang tuỳ biến chỉ BẮT ĐẦU bằng chữ đó (`/admin-huong-dan`) thì có; (2) công tắc tổng
 * `tracking_enabled === '1'`; (3) mọi ID có cấu trúc qua danh sách cho phép chặt — ID dị dạng bị
 * bỏ HẲN, không bao giờ lọt vào chuỗi JS (stored XSS); (4) mã tuỳ biến chỉ khi bật; (5) lỗi DB
 * không bao giờ ném và không chèn gì; (6) có bộ đệm 30 giây.
 */

let rows: Array<{ key: string, value: string | null }> = []
let dbFailure: Error | null = null
let dbReads = 0
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({
        from: async () => {
          dbReads += 1
          if (dbFailure) throw dbFailure
          return rows
        },
      }),
    }),
  },
})

const plugin = await loadPlugin('server/plugins/tracking.ts')

type Html = { head: string[], bodyPrepend: string[] }
const CACHE_MS = 30_000

/** Dựng bộ nhớ đệm mới: đẩy đồng hồ giả qua TTL rồi gọi hook như Nitro. */
async function render(
  _t: unknown,
  path: string,
  settings: Record<string, string | null> | null,
): Promise<Html> {
  mock.timers.tick(CACHE_MS + 1)
  if (settings) rows = Object.entries(settings).map(([key, value]) => ({ key, value }))
  const nitro = fakeNitroApp()
  await plugin(nitro.app)
  const html: Html = { head: [], bodyPrepend: [] }
  await nitro.fire('render:html', html, { event: { path } })
  return html
}

const on = (extra: Record<string, string>) => ({ tracking_enabled: '1', ...extra })
const all = (h: Html) => [...h.head, ...h.bodyPrepend].join('\n')

// Đồng hồ giả bật MỘT lần và chỉ đi tới: bộ đệm của plugin sống qua các test, nên đồng hồ lùi lại
// giữa hai test sẽ làm bộ đệm cũ trông như còn hạn.
mock.timers.enable({ apis: ['Date'], now: 1_000_000 })

test.beforeEach(() => {
  rows = []
  dbFailure = null
  dbReads = 0
})

test('đăng ký đúng một hook render:html', async () => {
  const nitro = fakeNitroApp()
  await plugin(nitro.app)
  assert.deepEqual(nitro.names(), ['render:html'])
})

test('/admin và /api thật không bị chèn và không chạm DB; slug chỉ trùng chữ đầu thì có chèn', async (t) => {
  const settings = on({ ga4_measurement_id: 'G-ABC123' })
  // `event.path` mang cả query/fragment: `/admin?x=1` từng không khớp `path === '/admin'` và trang quản trị bị chèn mã.
  for (const path of ['/admin', '/admin/', '/admin/content/articles', '/api', '/api/public/x', '/admin?x=1', '/admin#a', '/admin/content?page=2', '/api?x=1',
    // Router không phân biệt hoa thường và giải mã %: các dạng này dựng đúng trang quản trị / API.
    '/ADMIN', '/Admin/content?x=1', '/API/x', '/%61dmin', '/%41dmin/content', '//admin', '/admin%2Fcontent']) {
    dbReads = 0
    const html = await render(t, path, settings)
    assert.equal(all(html), '', `${path} bị chèn`)
    assert.equal(dbReads, 0, `${path} không được đọc DB`)
  }
  for (const path of ['/', '/about', '/admin-huong-dan', '/api-tin-tuc', '/news/bai-1', '/news?page=2', '/admin-huong-dan?x=1']) {
    const html = await render(t, path, settings)
    assert.match(all(html), /G-ABC123/, `${path} phải được chèn`)
  }
})

test('công tắc tổng: chỉ đúng chuỗi "1" mới bật', async (t) => {
  for (const flag of ['0', '', 'true', 'on', ' 1', '1 ']) {
    const html = await render(t, '/', { tracking_enabled: flag, ga4_measurement_id: 'G-ABC123' })
    assert.equal(all(html), '', `tracking_enabled=${JSON.stringify(flag)} vẫn chèn`)
  }
  assert.match(all(await render(t, '/', on({ ga4_measurement_id: 'G-ABC123' }))), /G-ABC123/)
  assert.equal(all(await render(t, '/', { ga4_measurement_id: 'G-ABC123' })), '', 'thiếu khoá tracking_enabled')
  assert.equal(all(await render(t, '/', { tracking_enabled: null, ga4_measurement_id: 'G-ABC123' })), '', 'giá trị null')
})

test('ID hợp lệ: mỗi nhà cung cấp chèn đúng đoạn mã chính thức, noscript vào bodyPrepend', async (t) => {
  const html = await render(t, '/', on({
    ga4_measurement_id: 'G-AB12CD',
    gtm_container_id: 'GTM-XYZ789',
    facebook_pixel_id: '1234567890',
    tiktok_pixel_id: 'C1A2B3',
    clarity_project_id: 'abc123xy',
    google_site_verification: 'tok_en-1',
  }))
  const head = html.head.join('\n')
  const body = html.bodyPrepend.join('\n')
  assert.match(head, /<meta name="google-site-verification" content="tok_en-1">/)
  assert.match(head, /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-AB12CD"><\/script>/)
  assert.match(head, /gtag\('config', 'G-AB12CD'\);/)
  assert.match(head, /j\.src='https:\/\/www\.googletagmanager\.com\/gtm\.js\?id='\+i\+dl/)
  assert.match(head, /\(window,document,'script','dataLayer','GTM-XYZ789'\)/)
  assert.match(head, /fbq\('init','1234567890'\);fbq\('track','PageView'\)/)
  assert.match(head, /ttq\.load\('C1A2B3'\);ttq\.page\(\)/)
  assert.match(head, /"clarity","script","abc123xy"/)
  assert.match(body, /<noscript><iframe src="https:\/\/www\.googletagmanager\.com\/ns\.html\?id=GTM-XYZ789"/)
  assert.match(body, /facebook\.com\/tr\?id=1234567890&ev=PageView&noscript=1/)
  // Đoạn nào thuộc head thì không nằm ở body và ngược lại.
  assert.doesNotMatch(body, /<script/)
  assert.doesNotMatch(head, /<noscript/)
})

test('ID có khoảng trắng hai đầu được cắt rồi mới kiểm (cán bộ dán thừa dấu cách)', async (t) => {
  const html = await render(t, '/', on({ ga4_measurement_id: '  G-ABC123 \n' }))
  assert.match(all(html), /gtag\('config', 'G-ABC123'\)/)
})

test('ID dị dạng bị bỏ HẲN — không có ký tự nào của giá trị xấu lọt vào đầu ra', async (t) => {
  const evil = {
    ga4_measurement_id: "G-ABC');alert(1)//",
    gtm_container_id: 'GTM-abc',
    google_ads_id: 'AW-1<script>',
    google_ads_conversion_label: 'lab el"',
    google_site_verification: 'x"><script>alert(1)</script>',
    facebook_pixel_id: "12';fetch('//evil')//",
    tiktok_pixel_id: 'a b',
    clarity_project_id: 'a/../b',
  }
  const html = await render(t, '/', on(evil))
  assert.equal(all(html), '', 'ID dị dạng vẫn sinh đầu ra')
  for (const [key, value] of Object.entries(evil)) {
    const lone = await render(t, '/', on({ [key]: value }))
    assert.equal(all(lone), '', `${key} dị dạng vẫn sinh đầu ra`)
  }
  // Chữ thường / sai tiền tố từng ID có cấu trúc.
  for (const [key, bad] of [
    ['ga4_measurement_id', 'g-abc123'], ['ga4_measurement_id', 'GTM-ABC'], ['ga4_measurement_id', 'G-'],
    ['gtm_container_id', 'G-ABC'], ['gtm_container_id', 'GTM-'],
    ['google_ads_id', 'AW_123'], ['google_ads_id', 'aw-123'],
  ] as const) {
    assert.equal(all(await render(t, '/', on({ [key]: bad }))), '', `${key}=${bad}`)
  }
})

test('nhãn chuyển đổi Ads chỉ sinh biến toàn cục khi có cả ID Ads hợp lệ', async (t) => {
  const withBoth = all(await render(t, '/', on({ google_ads_id: 'AW-555', google_ads_conversion_label: 'lab_el-9' })))
  assert.match(withBoth, /window\.__gAdsConversion='AW-555\/lab_el-9';/)
  assert.match(withBoth, /gtag\/js\?id=AW-555/, 'chỉ có Ads thì thư viện gtag nạp bằng ID Ads')
  const labelOnly = all(await render(t, '/', on({ google_ads_conversion_label: 'lab_el-9' })))
  assert.equal(labelOnly, '')
  const badLabel = all(await render(t, '/', on({ google_ads_id: 'AW-555', google_ads_conversion_label: "x';alert(1)" })))
  assert.doesNotMatch(badLabel, /__gAdsConversion|alert/)
  assert.match(badLabel, /gtag\('config', 'AW-555'\)/)
})

test('GA4 + Ads cùng bật: thư viện gtag.js nạp đúng MỘT lần, hai lệnh config', async (t) => {
  const html = await render(t, '/', on({ ga4_measurement_id: 'G-AAA111', google_ads_id: 'AW-222' }))
  const head = html.head.join('\n')
  assert.equal((head.match(/gtag\/js\?id=/g) ?? []).length, 1)
  assert.match(head, /gtag\/js\?id=G-AAA111/)
  assert.match(head, /gtag\('config', 'G-AAA111'\);gtag\('config', 'AW-222'\);/)
})

test('mã tuỳ biến: chèn nguyên văn khi bật, bỏ khi rỗng/chỉ khoảng trắng, không chèn khi công tắc tắt', async (t) => {
  const custom = { tracking_custom_head: '<script>window.a=1</script>', tracking_custom_body: '<div id="x"></div>' }
  const html = await render(t, '/', on(custom))
  assert.deepEqual(html.head, [custom.tracking_custom_head])
  assert.deepEqual(html.bodyPrepend, [custom.tracking_custom_body])

  const blank = await render(t, '/', on({ tracking_custom_head: '   \n', tracking_custom_body: '' }))
  assert.deepEqual(blank, { head: [], bodyPrepend: [] })

  const off = await render(t, '/', { tracking_enabled: '0', ...custom })
  assert.deepEqual(off, { head: [], bodyPrepend: [] })

  const admin = await render(t, '/admin/x', on(custom))
  assert.deepEqual(admin, { head: [], bodyPrepend: [] })
})

test('lỗi DB: không ném, không chèn gì, và tự hồi phục khi DB sống lại', async (t) => {
  await render(t, '/', on({ ga4_measurement_id: 'G-ABC123' }))
  dbFailure = new Error('ECONNREFUSED')
  const html = await render(t, '/', null)
  assert.deepEqual(html, { head: [], bodyPrepend: [] })
  dbFailure = null
  assert.match(all(await render(t, '/', null)), /G-ABC123/)
})

test('bộ đệm 30 giây: hai lượt dựng trong TTL chỉ đọc DB một lần; qua TTL thì đọc lại giá trị mới', async (t) => {
  await render(t, '/', on({ ga4_measurement_id: 'G-OLD111' }))
  assert.equal(dbReads, 1)
  // Trong TTL: đổi hàng DB nhưng không đẩy đồng hồ → vẫn giá trị cũ, không đọc DB.
  rows = [{ key: 'tracking_enabled', value: '1' }, { key: 'ga4_measurement_id', value: 'G-NEW222' }]
  const nitro = fakeNitroApp()
  await plugin(nitro.app)
  const within: Html = { head: [], bodyPrepend: [] }
  await nitro.fire('render:html', within, { event: { path: '/' } })
  assert.equal(dbReads, 1)
  assert.match(all(within), /G-OLD111/)
  // Qua TTL: đọc lại.
  mock.timers.tick(CACHE_MS + 1)
  const after: Html = { head: [], bodyPrepend: [] }
  await nitro.fire('render:html', after, { event: { path: '/' } })
  assert.equal(dbReads, 2)
  assert.match(all(after), /G-NEW222/)
})

test('thiếu event.path (gọi không có event) không ném và được coi là trang công khai', async () => {
  mock.timers.tick(CACHE_MS + 1)
  rows = [{ key: 'tracking_enabled', value: '1' }, { key: 'ga4_measurement_id', value: 'G-ABC123' }]
  const nitro = fakeNitroApp()
  await plugin(nitro.app)
  const html: Html = { head: [], bodyPrepend: [] }
  await nitro.fire('render:html', html, {})
  assert.match(all(html), /G-ABC123/)
})

test.after(() => { mock.timers.reset() })
