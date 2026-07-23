import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'

const componentPath = new URL('../app/components/admin/AnalyticsLiveDashboard.client.vue', import.meta.url)
const pagePath = new URL('../app/pages/admin/analytics.vue', import.meta.url)
const source = readFileSync(componentPath, 'utf8')
const pageSource = readFileSync(pagePath, 'utf8')
const parsed = parse(source, { filename: componentPath.pathname })
const parsedPage = parse(pageSource, { filename: pagePath.pathname })
const script = parsed.descriptor.scriptSetup?.content || ''
const pageScript = parsedPage.descriptor.scriptSetup?.content || ''
const template = parsed.descriptor.template?.content || ''

function occurrences(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length
}

function requireAll(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) assert.match(value, pattern)
}

function runtimeNormalizeFilter(scope: string, value: unknown) {
  const match = script.match(/function normalizeFilter\([^)]*\): string \| null \{\n([\s\S]*?)\n\}\nfunction initialPanelSnapshot/)
  assert.ok(match)
  const normalize = Function(`"use strict"; return function normalizeFilter(scope, value) {\n${match[1]}\n}`)() as (scope: string, value: unknown) => string | null
  return normalize(scope, value)
}

test('actual analytics dashboard SFCs parse and compile', () => {
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsedPage.errors, [])
  for (const [descriptor, filename, id] of [
    [parsed.descriptor, componentPath.pathname, 'analytics-live-dashboard-ui-test'],
    [parsedPage.descriptor, pagePath.pathname, 'analytics-page-ui-test'],
  ] as const) {
    assert.ok(descriptor.scriptSetup)
    assert.ok(descriptor.template)
    assert.doesNotThrow(() => compileScript(descriptor, { id }))
    const compiledTemplate = compileTemplate({
      id,
      filename,
      source: descriptor.template.content,
    })
    assert.deepEqual(compiledTemplate.errors, [])
  }
})

test('constructs exactly three isolated panel pollers with distinct data and retry handlers', () => {
  assert.equal(occurrences(script, /createAnalyticsPanelPoller\s*</g), 3)
  requireAll(script, [
    /onSuccess:\s*response\s*=>\s*\{\s*liveData\.value\s*=\s*response\s*\}/,
    /onSuccess:\s*response\s*=>\s*\{\s*breakdownData\.value\s*=\s*response\s*\}/,
    /onSuccess:\s*response\s*=>\s*\{\s*nocData\.value\s*=\s*response\s*\}/,
    /function retryLivePanel\(\)\s*\{\s*livePoller\.retry\(\)\s*\}/,
    /function retryBreakdownPanel\(\)\s*\{\s*breakdownPoller\.retry\(\)\s*\}/,
    /function retryNocPanel\(\)\s*\{\s*nocPoller\.retry\(\)\s*\}/,
  ])
  assert.doesNotMatch(script, /new\s+AbortController/)
  assert.doesNotMatch(script, /consecutiveFailures\s*=\s*ref/)
  assert.doesNotMatch(script, /setTimeout|analyticsPollDelaySeconds|normalizeAnalyticsPollSeconds/)
})

test('historical query updates preserve live and unrelated keys without stale owned keys', () => {
  requireAll(pageScript, [
    /const preservedQuery = \{ \.\.\.route\.query \}/,
    /delete preservedQuery\.start\s*delete preservedQuery\.end\s*delete preservedQuery\.view\s*delete preservedQuery\.value\s*delete preservedQuery\.day/,
    /query:\s*\{\s*\.\.\.preservedQuery,\s*start: start\.value,\s*end: end\.value,\s*view: selectedDrill\.value,/s,
    /\.\.\.\(selectedValue\.value \? \{ value: selectedValue\.value \} : \{\}\)/,
    /\.\.\.\(selectedDay\.value \? \{ day: selectedDay\.value \} : \{\}\)/,
  ])
  assert.doesNotMatch(pageScript, /const query:\s*Record<string, string>\s*=\s*\{ start:/)
})

test('normalizes live filters with the strict scope-specific server contract', () => {
  requireAll(script, [
    /normalizeFilter\(scope: BreakdownScope, value: unknown\): string \| null/,
    /const candidate = value\s*\n\s*if \(typeof candidate !== 'string'\) return null/,
    /candidate\.trim\(\)\.split\(\/\[\?#\]\/\, 1\)\[0\]/,
    /trimmed\.length > 512/,
    /!trimmed\.startsWith\('\/'\)/,
    /trimmed\.startsWith\('\/\/'\)/,
    /trimmed\.includes\('\\\\'\)/,
    /char\.charCodeAt\(0\) < 32 \|\| char\.charCodeAt\(0\) === 127/,
    /\['direct', 'search', 'social', 'referral', 'email', 'other'\]\.includes\(normalized\)/,
    /\['desktop', 'mobile', 'tablet', 'bot', 'unknown', 'other'\]\.includes\(normalized\)/,
    /normalized !== 'OTHER' && !\/\^\[A-Z\]\{2\}\$\/\.test\(normalized\)/,
    /return normalized === 'OTHER' \? 'other' : normalized/,
    /trimmed !== 'other' && !\/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,15\}\$\/\.test\(trimmed\)/,
  ])
  assert.doesNotMatch(script, /slice\(0,\s*160\)/)
})

test('accepts canonical bounded values and nulls invalid URL filters before requests', () => {
  const maximumPath = `/${'a'.repeat(511)}`
  assert.equal(maximumPath.length, 512)
  assert.equal(runtimeNormalizeFilter('path', `  ${maximumPath}?secret=removed#fragment  `), maximumPath)
  assert.equal(runtimeNormalizeFilter('source_category', ' SOCIAL '), 'social')
  assert.equal(runtimeNormalizeFilter('device_class', 'OTHER'), 'other')
  assert.equal(runtimeNormalizeFilter('country_code', 'vn'), 'VN')
  assert.equal(runtimeNormalizeFilter('country_code', 'OtHeR'), 'other')
  assert.equal(runtimeNormalizeFilter('region_code', 'Vn-HN_1'), 'Vn-HN_1')
  for (const [scope, value] of [
    ['path', `/${'a'.repeat(512)}`],
    ['path', '//external.example'],
    ['path', '/bad\\path'],
    ['path', '/badpath'],
    ['source_category', 'affiliate'],
    ['device_class', 'watch'],
    ['country_code', 'VNM'],
    ['region_code', 'vn ho-chi-minh'],
    ['path', ['/valid', '/repeated']],
  ] as const) assert.equal(runtimeNormalizeFilter(scope, value), null)
})

test('normalizes URL identity before route replacement and breakdown requests', () => {
  requireAll(script, [
    /const initialScope = normalizeScope\(route\.query\.liveScope\)\s*\nconst selectedScope = ref<BreakdownScope>\(initialScope\)\s*\nconst selectedFilter = ref<string \| null>\(normalizeFilter\(initialScope, route\.query\.liveFilter\)\)/,
    /const filter = normalizeFilter\(scope, filterValue\)/,
    /const normalizedFilter = normalizeFilter\(normalizedScope, filter\)/,
    /query: \{ scope, window: 60, limit: 10, value: filter \|\| undefined \}/,
    /const currentScope = route\.query\.liveScope\s*\n\s*const currentFilter = route\.query\.liveFilter/,
    /const preservedQuery = \{ \.\.\.route\.query \}\s*delete preservedQuery\.liveScope\s*delete preservedQuery\.liveFilter/,
    /query:\s*\{\s*\.\.\.preservedQuery,\s*liveScope: scope,\s*\.\.\.\(filter \? \{ liveFilter: filter \} : \{\}\)/s,
    /breakdownData\.value\s*=\s*null\s*\n\s*breakdownPoller\.stop\(\)\s*\n\s*breakdownPoller\s*=\s*createBreakdownPoller\(\)/,
  ])
})

test('pauses, resumes, and stops all panel pollers through lifecycle events', () => {
  requireAll(script, [
    /if \(hidden\.value\) \{\s*livePoller\.pause\(\)\s*breakdownPoller\.pause\(\)\s*nocPoller\.pause\(\)/s,
    /else \{\s*livePoller\.resume\(\)\s*breakdownPoller\.resume\(\)\s*nocPoller\.resume\(\)/s,
    /onBeforeUnmount\(\(\)\s*=>\s*\{[\s\S]*livePoller\.stop\(\)\s*breakdownPoller\.stop\(\)\s*nocPoller\.stop\(\)/,
  ])
})

test('renders independent panel busy, complete, and last-success UTC status contracts', () => {
  for (const panel of ['live', 'breakdown', 'noc']) {
    const title = panel === 'live' ? 'live' : panel === 'breakdown' ? 'breakdown' : 'noc'
    assert.match(template, new RegExp(`:aria-busy="${title}PanelState\\.inFlight"`))
    assert.match(template, new RegExp(`${title}PanelState\\.loading`))
    assert.match(template, new RegExp(`${title}PanelState\\.denied`))
    assert.match(template, new RegExp(`${title}PanelState\\.connectionState === 'disconnected'`))
    assert.match(template, new RegExp(`${title}PanelError`))
    assert.match(template, new RegExp(`${title}PanelState\\.stale`))
    assert.match(template, new RegExp(`Lần cập nhật thành công \\(UTC\\):\\s*<time v-if="${title}PanelState\\.lastSuccessfulAt" :datetime="utcDateTime\\(${title}PanelState\\.lastSuccessfulAt\\)">\\{\\{ formatUtc\\(${title}PanelState\\.lastSuccessfulAt\\) \\}\\}</time><span v-else>Chưa có</span>`))
  }
  requireAll(template, [
    /role="status"\s+aria-live="polite"/,
    /@click="retryLivePanel"/,
    /@click="retryBreakdownPanel"/,
    /@click="retryNocPanel"/,
  ])
  requireAll(script, [
    /function formatUtc\(value: string \| number \| null \| undefined\)/,
    /timeZone: 'UTC'/,
    /return new Date\(value\)\.toISOString\(\)/,
  ])
  assert.equal(occurrences(template, /Lần cập nhật thành công \(UTC\):/g), 3)
  assert.equal(occurrences(template, /role="status"\s+aria-live="polite"/g), 3)
})

test('live chart exposes visible UTC labels and full semantic table parity', () => {
  requireAll(template, [
    /<time\s+v-if="index === 0 \|\| index === \(liveData\?\.points\.length \|\| 0\) - 1 \|\| index % 10 === 0"/,
    /\{\{ formatUtc\(point\.bucketStart\) \}\}/,
    /point\.pageViews === 0 \? '0%'/,
    /point\.approximateUniqueVisitors === 0 \? '0%'/,
    /point\.pageViews \/ maxLiveMetric \* 100/,
    /point\.approximateUniqueVisitors \/ maxLiveMetric \* 100/,
    /Dữ liệu đầy đủ tương ứng biểu đồ trực tiếp/,
    /<td class="px-3 py-2">\{\{ point\.pageViews \}\}<\/td>/,
    /<td class="px-3 py-2">\{\{ point\.approximateUniqueVisitors \}\}<\/td>/,
    /<td class="px-3 py-2">\{\{ point\.uniqueVisitorSemantics \}\}<\/td>/,
  ])
})

test('NOC and scope controls provide non-color and keyboard-operable semantics', () => {
  requireAll(template, [
    /:aria-pressed="selectedScope === scope\.value"/,
    /<i class="fa-solid"[^>]*aria-hidden="true"><\/i><span>\{\{ row\.severity \}\}<\/span>/,
    /<details\s+v-if="row\.details"/,
    /<summary[^>]*>Xem chi tiết an toàn<\/summary>/,
    /\{\{ safeDetails\(row\.details\) \}\}/,
  ])
  assert.doesNotMatch(template, /v-html/)
})

test('does not render prohibited analytics identity fields', () => {
  const prohibitedBindings = [
    /\{\{[^}]*visitorToken/i,
    /\{\{[^}]*visitorId/i,
    /\{\{[^}]*ipAddress/i,
    /\{\{[^}]*userAgent/i,
    /\{\{[^}]*referrer/i,
    /\{\{[^}]*query(?:String|Params)?/i,
  ]
  for (const pattern of prohibitedBindings) assert.doesNotMatch(template, pattern)
})
