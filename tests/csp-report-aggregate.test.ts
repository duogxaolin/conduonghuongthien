import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Gộp báo cáo CSP trong bộ nhớ (wave3 D-CSP giai đoạn 1; kiểm chứng độc lập W1/W4/S2,
 * rồi W6/W7/W8). Khoá chưa từng thấy → một dòng `first` ngay, một lần cho cả tiến trình;
 * mọi báo cáo khác → chỉ đếm; mỗi cửa sổ một dòng `repeats` mỗi khoá. Ngân sách khoá mới
 * theo mạng, chỗ dành riêng cho khoá mới, khoá thô khi bản đồ đầy.
 * Phần thuần: `server/utils/csp-report.ts`; phần có trạng thái: `server/utils/csp-report-log.ts`.
 */

const {
  CSP_COARSE_GROUP,
  CSP_OTHER_PAGES_GROUP,
  CSP_PAGE_SECTIONS,
  cspAggregateKey,
  cspLogEntry,
  cspPathGroup,
  parseCspReportBody,
} = await import('../server/utils/csp-report')
const {
  CSP_REPORT_COARSE_KEYS,
  CSP_REPORT_COARSE_KNOWN_MAX,
  CSP_REPORT_KNOWN_KEYS_MAX,
  CSP_REPORT_MAX_KEYS,
  CSP_REPORT_NEW_KEYS_PER_NETWORK,
  CSP_REPORT_SEEN_KEYS,
  CSP_REPORT_SOURCES_PER_KEY,
  CSP_REPORT_SUMMARY_WINDOW_SECONDS,
  CspViolationAggregator,
  noteCspHostsUnconfigured,
} = await import('../server/utils/csp-report-log')
const { CspSourceLimiter } = await import('../server/utils/csp-report-source-limiter')

type Emitted = { level: 'info' | 'warn', fields: Record<string, unknown> }
type Limits = ConstructorParameters<typeof CspViolationAggregator>[0]

function aggregator(limits: Limits = {}) {
  let now = 1_000_000
  const emitted: Emitted[] = []
  const instance = new CspViolationAggregator({
    windowMs: 3_600_000,
    ...limits,
    now: () => now,
    emit: (level, fields) => { emitted.push({ level, fields }) },
  })
  /** One report through the same steps the handler takes (limiter always allows). */
  const report = (entry: ReturnType<typeof entryOf>, source = '198.51.100.1', network = '198.51.100.0/24') => {
    const origin = { source, network }
    const result = instance.classify(entry, origin)
    if (result.outcome === 'new') instance.logFirst(result.pending, origin)
    return result.outcome
  }
  const kinds = () => emitted.filter(line => line.fields.event === 'security.csp_violation').map(line => [line.fields.kind, line.fields.count])
  const dropped = () => emitted.find(line => line.fields.event === 'csp_report.dropped')?.fields
  return { instance, emitted, report, kinds, dropped, advance: (ms: number) => { now += ms } }
}

const legacy = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  'csp-report': {
    'document-uri': 'https://portal.example.vn/news/tin-tuc/bai-viet?token=abc',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'inline',
    disposition: 'report',
    'script-sample': 'window.__NUXT__={};window.__NUXT__.con',
    ...overrides,
  },
})

const entryOf = (body: string, isOwnHost: ((host: string) => boolean) | null = null) => {
  const [violation] = parseCspReportBody('csp-report', body)
  assert.ok(violation, 'the report was not parsed')
  return cspLogEntry(violation, isOwnHost)
}
const hostEntry = (host: string, page = '/news/a') => entryOf(legacy({ 'blocked-uri': `https://${host}/x.js`, 'script-sample': '', 'document-uri': `https://portal.example.vn${page}` }))

// ─── Path groups (aggregation key) ────────────────────────────────────────────

test('path group: an app section keeps its name, the rest of the path becomes *', () => {
  assert.equal(cspPathGroup('/'), '/')
  assert.equal(cspPathGroup('/news'), '/news')
  assert.equal(cspPathGroup('/news/'), '/news')
  assert.equal(cspPathGroup('/news/tin-tuc/bai-viet'), '/news/*')
  assert.equal(cspPathGroup('/admin/content/articles/12'), '/admin/*')
  assert.equal(cspPathGroup('/media/abc123'), '/media/*')
  assert.equal(cspPathGroup('/search'), '/search')
  assert.equal(cspPathGroup('about:'), 'about:')
  assert.equal(cspPathGroup('unknown'), 'unknown')
})

test('W6: a first segment that is not an app section collapses — page-builder slugs and 404s are one group', () => {
  assert.equal(CSP_OTHER_PAGES_GROUP, '/:page')
  assert.equal(cspPathGroup('/gioi-thieu-chung'), '/:page')
  assert.equal(cspPathGroup('/trang-go-sai'), '/:page')
  assert.equal(cspPathGroup('/mot-trang/123'), '/:page/*')
  assert.equal(cspPathGroup(`/${'x'.repeat(500)}/y`), '/:page/*')
  assert.equal(cspPathGroup('/News/a'), '/:page/*', 'routes are case-sensitive')
})

test('the section list is exactly the top-level entries of app/pages (minus index and dynamic routes)', () => {
  const entries = readdirSync(new URL('../app/pages/', import.meta.url))
    .map(name => name.replace(/\.vue$/, ''))
    .filter(name => name !== 'index' && !name.startsWith('['))
  assert.deepEqual([...new Set(entries)].sort(), [...CSP_PAGE_SECTIONS].sort(), 'a page section was added or removed: update CSP_PAGE_SECTIONS in server/utils/csp-report.ts')
})

// ─── 'report-sample': a short hash, never the text (S2) ───────────────────────

test('script-sample / sample: only the first 12 hex of SHA-256 is kept, never the text', () => {
  const sample = 'window.__NUXT__={};window.__NUXT__.con'
  const expected = createHash('sha256').update(sample, 'utf8').digest('hex').slice(0, 12)
  const entry = entryOf(legacy({ 'script-sample': sample }))
  assert.equal(entry.sampleSha256, expected)
  assert.ok(!JSON.stringify(entry).includes('__NUXT__'), 'the sample text reached the entry')

  const [fromReportingApi] = parseCspReportBody('reports+json', JSON.stringify([{ type: 'csp-violation', body: {
    documentURL: 'https://portal.example.vn/', effectiveDirective: 'script-src-elem', blockedURL: 'inline', sample,
  } }]))
  assert.equal(fromReportingApi?.sampleSha256, expected)

  assert.equal(entryOf(legacy({ 'script-sample': '' })).sampleSha256, undefined, 'an empty sample (no report-sample) adds nothing')
})

test('distinct inline scripts are distinct keys; the same script on two pages of a section is one key', () => {
  const nuxtConfig = entryOf(legacy({ 'script-sample': 'window.__NUXT__={};window.__NUXT__.con' }))
  const failsafe = entryOf(legacy({ 'script-sample': '(function(){var o=document.getElementById' }))
  const samePageOther = entryOf(legacy({ 'document-uri': 'https://portal.example.vn/news/khac/bai-khac', 'script-sample': 'window.__NUXT__={};window.__NUXT__.con' }))
  assert.notEqual(cspAggregateKey(nuxtConfig), cspAggregateKey(failsafe))
  assert.equal(cspAggregateKey(nuxtConfig), cspAggregateKey(samePageOther))
})

// ─── Foreign pages (W4) ───────────────────────────────────────────────────────

test('a report from a page on another host is labelled foreign:<host> and never logged as a portal path', () => {
  const isOwnHost = (host: string) => host === 'portal.example.vn'
  const foreign = entryOf(legacy({ 'document-uri': 'https://evil.example:8443/news/fake?x=1' }), isOwnHost)
  assert.equal(foreign.path, 'foreign:evil.example:8443')
  assert.equal(foreign.pathGroup, 'foreign:evil.example:8443')
  const own = entryOf(legacy({ 'document-uri': 'https://PORTAL.example.vn:443/news/a/b' }), isOwnHost)
  assert.equal(own.path, '/news/a/b')
  assert.equal(own.pathGroup, '/news/*')
  const longHost = entryOf(legacy({ 'document-uri': `https://${'a'.repeat(60)}.${'b'.repeat(60)}.example/` }), isOwnHost)
  assert.ok(longHost.path.length <= 'foreign:'.length + 100, 'the foreign host is truncated')
})

test('with no portal host configured every page counts as the portal own, and that is said once', () => {
  assert.equal(entryOf(legacy({ 'document-uri': 'https://anything.example/news/a' }), null).path, '/news/a')
  const lines: string[] = []
  const realWarn = console.error
  console.error = (line: unknown) => { lines.push(String(line)) }
  try {
    noteCspHostsUnconfigured()
    noteCspHostsUnconfigured()
    noteCspHostsUnconfigured()
  } finally {
    console.error = realWarn
  }
  assert.equal(lines.filter(line => line.includes('csp_report.hosts_unconfigured')).length, 1)
})

// ─── Aggregation ──────────────────────────────────────────────────────────────

test('the stated limits', () => {
  assert.equal(CSP_REPORT_SUMMARY_WINDOW_SECONDS, 3600)
  assert.equal(CSP_REPORT_MAX_KEYS, 500)
  assert.equal(CSP_REPORT_KNOWN_KEYS_MAX, 400)
  assert.equal(CSP_REPORT_COARSE_KEYS, 100)
  assert.equal(CSP_REPORT_COARSE_KNOWN_MAX, 80)
  assert.equal(CSP_REPORT_SEEN_KEYS, 5000)
  assert.equal(CSP_REPORT_NEW_KEYS_PER_NETWORK, 20)
  assert.equal(CSP_REPORT_SOURCES_PER_KEY, 50)
})

test('1 000 identical reports: one first-sighting line at once, then one summary of 999 when the window closes', () => {
  const { instance, emitted, report } = aggregator()
  const entry = entryOf(legacy())
  assert.equal(report(entry), 'new')
  for (let index = 1; index < 1000; index += 1) {
    assert.equal(report(entryOf(legacy({ 'document-uri': `https://portal.example.vn/news/bai-${index}` }))), 'counted')
  }
  assert.equal(emitted.length, 1, 'repeats are only counted')
  assert.deepEqual(emitted[0], { level: 'info', fields: { event: 'security.csp_violation', kind: 'first', ...entry, count: 1 } })
  instance.flush()
  const summary = emitted[1]!.fields
  assert.deepEqual([summary.kind, summary.count, summary.windowSeconds, summary.pathGroup, summary.path], ['repeats', 999, 3600, '/news/*', '/news/bai-999'])
  instance.stop()
})

test('W7: a known key across 3 windows logs first exactly once, then only repeats', () => {
  const { instance, report, kinds } = aggregator()
  const entry = entryOf(legacy())
  for (const reports of [3, 2, 5]) {
    for (let index = 0; index < reports; index += 1) report(entry)
    instance.flush()
  }
  assert.deepEqual(kinds(), [['first', 1], ['repeats', 2], ['repeats', 2], ['repeats', 5]])
  instance.stop()
})

test('W7: a quiet window writes nothing for a known key; an evicted key just logs first again', () => {
  // A logged key takes two places in the seen set (its own and its coarse key), so 4 = two keys.
  const { instance, report, kinds } = aggregator({ seenKeys: 4 })
  const [a, b, c] = ['a.example', 'b.example', 'c.example'].map(host => hostEntry(host))
  report(a!)
  report(b!)
  instance.flush()
  instance.flush()
  assert.deepEqual(kinds(), [['first', 1], ['first', 1]])
  report(c!) // the seen set holds two keys: `a` (least recently used) is forgotten
  report(b!)
  report(a!)
  assert.deepEqual(kinds().map(([kind]) => kind), ['first', 'first', 'first', 'first'], 'a forgotten key logs first again — once')
  instance.stop()
})

test('W6: each network gets 20 new keys per window; over budget is counted, never inserted, never logged', () => {
  const { instance, report, kinds, dropped } = aggregator()
  for (let index = 0; index < 30; index += 1) report(hostEntry(`n${index}.example`), `203.0.113.${index}`, '203.0.113.0/24')
  assert.equal(kinds().length, 20)
  // Another network has its own budget.
  assert.equal(report(hostEntry('other-network.example'), '198.51.100.9', '198.51.100.0/24'), 'new')
  // A key the network already logged is still counted when the budget is spent.
  assert.equal(report(hostEntry('n0.example'), '203.0.113.200', '203.0.113.0/24'), 'counted')
  instance.flush()
  assert.equal(dropped()?.budget, 10)
  // A new window, a new budget.
  assert.equal(report(hostEntry('n25.example'), '203.0.113.1', '203.0.113.0/24'), 'new')
  instance.stop()
})

test('W6: known keys may fill only 400 of the 500 main slots — the rest is kept for never-seen keys', () => {
  const { instance, emitted, report, kinds } = aggregator({ maxKeys: 5, knownKeysMax: 3, coarseKeys: 2, coarseKnownMax: 1 })
  const junk = Array.from({ length: 5 }, (_, index) => hostEntry(`junk${index}.example`))
  junk.forEach((entry, index) => report(entry, `10.${index}.0.1`, `10.${index}.0.0/24`))
  assert.equal(kinds().length, 5, 'window 1: five new keys fill the map')
  instance.flush()
  // Window 2: the same five, now known — only 3 fit; one more fits the coarse map; the last overflows.
  junk.forEach((entry, index) => report(entry, `10.${index}.0.1`, `10.${index}.0.0/24`))
  const fresh = hostEntry('fresh.example')
  assert.equal(report(fresh, '10.99.0.1', '10.99.0.0/24'), 'new', 'a never-seen key still finds a main slot')
  assert.equal(kinds().filter(([kind]) => kind === 'first').length, 6)
  const freshLine = emitted.at(-1)!.fields
  assert.equal(freshLine.blocked, 'fresh.example')
  assert.equal(freshLine.pathGroup, '/news/*', 'logged with its full identity, not squeezed into a coarse key')
  instance.stop()
})

test('W6: when the main map is full, a newly blocked host is still logged — as a coarse key', () => {
  const { instance, emitted, report, dropped } = aggregator({ maxKeys: 3, knownKeysMax: 3, coarseKeys: 2, coarseKnownMax: 2 })
  ;['a', 'b', 'c'].forEach((host, index) => report(hostEntry(`${host}.example`), `10.${index}.0.1`, `10.${index}.0.0/24`))
  assert.equal(report(hostEntry('new-host.example', '/media/x'), '10.50.0.1', '10.50.0.0/24'), 'new')
  const coarse = emitted.at(-1)!.fields
  assert.deepEqual([coarse.kind, coarse.blocked, coarse.pathGroup, coarse.path], ['first', 'new-host.example', CSP_COARSE_GROUP, '/media/x'])
  // Same host on another page: the coarse key counts it.
  assert.equal(report(hostEntry('new-host.example', '/news/y'), '10.51.0.1', '10.51.0.0/24'), 'counted')
  // Both maps full: only a count survives.
  report(hostEntry('second-new.example'), '10.52.0.1', '10.52.0.0/24')
  assert.equal(report(hostEntry('third-new.example'), '10.53.0.1', '10.53.0.0/24'), 'dropped')
  instance.flush()
  assert.equal(dropped()?.overflow, 1)
  assert.equal(emitted.find(line => line.fields.event === 'csp_report.dropped')?.level, 'warn', 'a lost identity is worth a warning')
  instance.stop()
})

test('distinct sources per key are counted (capped at 50): one source inflating a count shows as sources: 1', () => {
  const { instance, emitted, report } = aggregator()
  const many = hostEntry('many-sources.example')
  const one = hostEntry('one-source.example')
  for (let index = 0; index < 80; index += 1) report(many, `198.18.0.${index}`, `198.18.${index}.0/24`)
  for (let index = 0; index < 200; index += 1) report(one, '198.19.0.1', '198.19.0.0/24')
  instance.flush()
  const repeats = Object.fromEntries(emitted.filter(line => line.fields.kind === 'repeats').map(line => [line.fields.blocked, line.fields.sources]))
  assert.deepEqual(repeats, { 'many-sources.example': 50, 'one-source.example': 1 })
  instance.stop()
})

test('a new key in the middle of a flood is logged at once', () => {
  const { instance, emitted, report } = aggregator()
  const flood = entryOf(legacy())
  for (let index = 0; index < 500; index += 1) report(flood, `198.20.${index % 250}.1`, `198.20.${index % 250}.0/24`)
  assert.equal(report(hostEntry('unknown-cdn.example'), '198.21.0.1', '198.21.0.0/24'), 'new')
  assert.equal(emitted.length, 2)
  assert.equal(emitted[1]!.fields.blocked, 'unknown-cdn.example')
  instance.stop()
})

test('the window rolls on its own: a report after the hour flushes the previous window first', () => {
  const { instance, report, kinds, advance } = aggregator()
  const entry = entryOf(legacy())
  report(entry)
  report(entry)
  advance(3_600_000)
  assert.equal(report(entry), 'counted', 'a known key in a new window is counted, not logged')
  assert.deepEqual(kinds(), [['first', 1], ['repeats', 1]])
  instance.stop()
})

test('a first sighting registered meanwhile by a concurrent request is counted, not logged twice', () => {
  const { instance, kinds } = aggregator()
  const entry = entryOf(legacy())
  const origin = { source: '198.51.100.1', network: '198.51.100.0/24' }
  const first = instance.classify(entry, origin)
  const second = instance.classify(entry, origin)
  assert.equal(first.outcome, 'new')
  assert.equal(second.outcome, 'new', 'not registered until logged')
  assert.ok(first.outcome === 'new' && second.outcome === 'new')
  assert.equal(instance.logFirst(first.pending, origin), true)
  assert.equal(instance.logFirst(second.pending, origin), false)
  instance.flush()
  assert.deepEqual(kinds(), [['first', 1], ['repeats', 1]])
  instance.stop()
})

test('limited and failed reports are counted in the window summary, so the totals reconcile', () => {
  const { instance, dropped } = aggregator()
  instance.countLimited()
  instance.countFailed(3)
  instance.countFailed(0)
  instance.flush()
  assert.deepEqual(dropped(), { event: 'csp_report.dropped', overflow: 0, budget: 0, limited: 1, failed: 3, windowSeconds: 3600 })
  instance.stop()
})

test('an enforced violation is a warning in both lines; a quiet window writes nothing', () => {
  const { instance, emitted, report } = aggregator()
  const entry = entryOf(legacy({ disposition: 'enforce' }))
  report(entry)
  report(entry)
  instance.flush()
  instance.flush()
  assert.deepEqual(emitted.map(line => line.level), ['warn', 'warn'])
  instance.stop()
})

test('the flush timer starts with the window and is unref’d — it never keeps the process alive', () => {
  const { instance, report } = aggregator()
  assert.equal(instance.flushTimer, null)
  report(entryOf(legacy()))
  assert.ok(instance.flushTimer, 'no timer was started')
  assert.equal(instance.flushTimer.hasRef(), false)
  instance.flush()
  assert.equal(instance.flushTimer, null, 'the timer goes with the window')
  report(entryOf(legacy()))
  instance.stop()
  assert.equal(instance.flushTimer, null)
})

test('reset() is for tests only: nothing under server/ calls it', () => {
  const offenders: string[] = []
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.ts') && /cspViolationLog\s*\.\s*reset\s*\(/.test(readFileSync(child, 'utf8'))) offenders.push(child.pathname)
    }
  }
  walk(new URL('../server/', import.meta.url))
  assert.deepEqual(offenders, [])
})

// ─── The source limiter (W8) ──────────────────────────────────────────────────

test('W8: a refused source is remembered until retryAfterSeconds passes, then asked again — and its new key is logged', async () => {
  let now = 5_000_000
  let blocked = true
  const asked: string[] = []
  const limiter = new CspSourceLimiter({
    now: () => now,
    record: async (source) => {
      asked.push(source)
      return { blocked, retryAfterSeconds: 30 }
    },
  })
  assert.equal(await limiter.allow('198.51.100.7'), false)
  assert.equal(asked.length, 1)
  now += 29_000
  assert.equal(await limiter.allow('198.51.100.7'), false, 'still refused inside the window')
  assert.equal(asked.length, 1, 'a remembered refusal costs no database call')
  blocked = false
  now += 1_001
  assert.equal(await limiter.allow('198.51.100.7'), true, 'the refusal expired: the source is heard again')
  assert.equal(asked.length, 2)

  // End to end: the aggregator logs the new key once the limiter allows it again.
  const { instance, report: _report, kinds } = aggregator()
  const origin = { source: '198.51.100.7', network: '198.51.100.0/24' }
  const result = instance.classify(hostEntry('after-expiry.example'), origin)
  assert.ok(result.outcome === 'new')
  if (await limiter.allow(origin.source)) instance.logFirst(result.pending, origin)
  assert.deepEqual(kinds(), [['first', 1]])
  instance.stop()
})

// ─── Nitro close hook and the default sink ────────────────────────────────────

test('Nitro close hook: the open window is flushed on shutdown, not lost with the process', async () => {
  const hooks = new Map<string, () => unknown>()
  const globals = globalThis as unknown as Record<string, unknown>
  globals.defineNitroPlugin = (plugin: unknown) => plugin
  const plugin = (await import('../server/plugins/csp-report-flush')).default as unknown as (app: unknown) => void
  plugin({ hooks: { hook: (name: string, fn: () => unknown) => { hooks.set(name, fn) } } })
  assert.ok(hooks.has('close'), 'the plugin does not hook close')

  const { cspViolationLog } = await import('../server/utils/csp-report-log')
  const written: string[] = []
  const realInfo = console.log
  console.log = (line: unknown) => { written.push(String(line)) }
  try {
    const entry = hostEntry('close-hook.example')
    const origin = { source: '198.51.100.8', network: '198.51.100.0/24' }
    const result = cspViolationLog.classify(entry, origin)
    if (result.outcome === 'new') cspViolationLog.logFirst(result.pending, origin)
    cspViolationLog.classify(entry, origin)
    cspViolationLog.classify(entry, origin)
    await hooks.get('close')!()
  } finally {
    console.log = realInfo
  }
  const summary = written.map(text => JSON.parse(text) as Record<string, unknown>).find(line => line.kind === 'repeats')
  assert.equal(summary?.count, 2)
  assert.equal(cspViolationLog.flushTimer, null, 'nothing left scheduled after close')
  cspViolationLog.reset()
})

test('the default sink writes structured logger lines (no sample text, no query, the prefix not redacted)', async () => {
  const { cspViolationLog } = await import('../server/utils/csp-report-log')
  const lines: string[] = []
  const realLog = console.log
  console.log = (line: unknown) => { lines.push(String(line)) }
  try {
    const entry = entryOf(legacy({ 'document-uri': 'https://portal.example.vn/about?secret=1' }))
    const origin = { source: '198.51.100.9', network: '198.51.100.0/24' }
    const result = cspViolationLog.classify(entry, origin)
    if (result.outcome === 'new') cspViolationLog.logFirst(result.pending, origin)
  } finally {
    console.log = realLog
    cspViolationLog.reset()
  }
  const [line] = lines.map(text => JSON.parse(text) as Record<string, unknown>)
  assert.equal(line?.event, 'security.csp_violation')
  assert.equal(line?.kind, 'first')
  assert.equal(line?.path, '/about')
  assert.ok(typeof line?.sampleSha256 === 'string', 'sampleSha256 must not be redacted by the logger')
  assert.ok(!lines.join('').includes('secret=1') && !lines.join('').includes('__NUXT__'))
})
