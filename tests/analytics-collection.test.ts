import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMinimalPageViewRow,
  deriveDailyVisitorToken,
  normalizePublicPath,
  validateAnalyticsPayload,
} from '../server/utils/analytics-collection'
import {
  createPageViewCollector,
  isEligiblePublicAnalyticsPath,
  normalizeCollectorPath,
} from '../app/utils/analytics-collector'

const SECRET = 'analytics-test-secret-that-is-longer-than-32-characters'

test('normalizes public routes and removes query and fragment data', () => {
  assert.equal(normalizePublicPath('/news/local?campaign=sensitive#section'), '/news/local')
  assert.equal(normalizeCollectorPath('/news/local?campaign=sensitive#section'), '/news/local')
  assert.equal(normalizePublicPath('/admin/users'), null)
  assert.equal(normalizePublicPath('/api/public/articles'), null)
  assert.equal(normalizePublicPath('/assets/site.css'), null)
  assert.equal(normalizePublicPath('news/local'), null)
  assert.equal(normalizePublicPath(`/${'x'.repeat(512)}`), null)
})

test('strictly validates allowlisted payload fields and trusted geography', () => {
  assert.deepEqual(validateAnalyticsPayload({ path: '/news', sourceCategory: 'search', deviceClass: 'mobile' }, { countryCode: 'vn', regionCode: 'HN-1' }), {
    path: '/news', sourceCategory: 'search', deviceClass: 'mobile', countryCode: 'VN', regionCode: 'HN-1',
  })
  assert.throws(() => validateAnalyticsPayload({ path: '/news', visitorId: 'raw' }), /unknown analytics field/)
  assert.throws(() => validateAnalyticsPayload({ path: '/news', sourceCategory: 'campaign-123' }), /invalid source category/)
  assert.throws(() => validateAnalyticsPayload({ path: '/news', deviceClass: 'smart-tv' }), /invalid device class/)
  assert.throws(() => validateAnalyticsPayload({ path: '/news', countryCode: 'VN' }), /trusted infrastructure/)
  assert.throws(() => validateAnalyticsPayload({ path: '/news' }, { countryCode: 'INVALID' }), /invalid trusted country code/)
  assert.throws(() => validateAnalyticsPayload({ path: '/news' }, { regionCode: 'too long region code!' }), /invalid trusted region code/)
})

test('derives stable fixed-length daily HMAC tokens that rotate across UTC days', () => {
  const input = { ip: '203.0.113.42', userAgent: 'Mozilla/5.0 Chrome/126.0', day: '2026-07-22' }
  const first = deriveDailyVisitorToken(SECRET, input)
  assert.equal(first, deriveDailyVisitorToken(SECRET, input))
  assert.equal(first.length, 64)
  assert.notEqual(first, deriveDailyVisitorToken(SECRET, { ...input, day: '2026-07-23' }))
  assert.throws(() => deriveDailyVisitorToken('', input), /secret is unavailable/)
})

test('builds only the minimal persisted event shape', () => {
  const row = buildMinimalPageViewRow({
    payload: { path: '/contact?phone=secret', sourceCategory: 'direct', deviceClass: 'desktop' },
    secret: SECRET,
    ip: '203.0.113.42',
    userAgent: 'Private Browser UA',
    now: new Date('2026-07-22T12:00:00.000Z'),
  })
  assert.deepEqual(Object.keys(row).sort(), ['countryCode', 'deviceClass', 'eventDay', 'occurredAt', 'path', 'regionCode', 'sourceCategory', 'visitorToken'])
  assert.equal(row.path, '/contact')
  assert.ok(!JSON.stringify(row).includes('203.0.113.42'))
  assert.ok(!JSON.stringify(row).includes('Private Browser UA'))
  assert.ok(!JSON.stringify(row).includes('phone=secret'))
})

test('collector emits once for eligible completed navigation and ignores exclusions', async () => {
  const events: unknown[] = []
  const emit = createPageViewCollector({ transport: payload => { events.push(payload) } })
  assert.equal(emit('/news?campaign=one'), true)
  assert.equal(emit('/news?campaign=two'), false)
  assert.equal(emit('/admin'), false)
  assert.equal(emit('/api/public/articles'), false)
  assert.equal(emit('/assets/logo.png'), false)
  assert.equal(emit('/contact', { prefetch: true }), false)
  assert.equal(emit('/contact', { completed: false }), false)
  assert.equal(emit('/contact'), true)
  assert.equal(events.length, 2)
  assert.equal(isEligiblePublicAnalyticsPath('/news'), true)
})

test('collector transport failures never escape or block later navigation', async () => {
  const emit = createPageViewCollector({ transport: () => Promise.reject(new Error('offline')) })
  assert.doesNotThrow(() => emit('/news'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(emit('/contact'), true)
})
