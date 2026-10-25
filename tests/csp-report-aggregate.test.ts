import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { after, beforeEach } from 'node:test'

/**
 * Gộp báo cáo CSP trong bộ nhớ trước bộ giới hạn CSDL (wave3 D-CSP giai đoạn 1, kiểm chứng
 * độc lập W1/W4/S2). Một báo cáo LẶP LẠI (cùng chỉ thị, nguồn bị chặn, disposition, nhóm
 * đường dẫn, tiền tố mẫu) chỉ được ĐẾM — không log, không đụng CSDL; lần ĐẦU của một khoá
 * được log ngay (vi phạm mới không bao giờ bị mất); mỗi khoá một dòng tổng kết mỗi cửa sổ.
 * Phần thuần: `server/utils/csp-report.ts`; phần có trạng thái: `server/utils/csp-report-log.ts`.
 */

const { cspAggregateKey, cspLogEntry, cspPathGroup, parseCspReportBody } = await import('../server/utils/csp-report')
const {
  CSP_REPORT_MAX_KEYS,
  CSP_REPORT_SUMMARY_WINDOW_SECONDS,
  CspViolationAggregator,
  noteCspHostsUnconfigured,
} = await import('../server/utils/csp-report-log')

type Emitted = { level: 'info' | 'warn', fields: Record<string, unknown> }

function aggregator(options: { maxKeys?: number, windowMs?: number } = {}) {
  let now = 1_000_000
  const emitted: Emitted[] = []
  const instance = new CspViolationAggregator({
    windowMs: options.windowMs ?? 600_000,
    maxKeys: options.maxKeys ?? 100,
    now: () => now,
    emit: (level, fields) => { emitted.push({ level, fields }) },
  })
  return { instance, emitted, advance: (ms: number) => { now += ms } }
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

// ─── Path groups (aggregation key) ────────────────────────────────────────────

test('path group: the first segment is kept, the rest becomes *', () => {
  assert.equal(cspPathGroup('/'), '/')
  assert.equal(cspPathGroup('/news'), '/news')
  assert.equal(cspPathGroup('/news/'), '/news')
  assert.equal(cspPathGroup('/news/tin-tuc/bai-viet'), '/news/*')
  assert.equal(cspPathGroup('/admin/content/articles/12'), '/admin/*')
  assert.equal(cspPathGroup('/media/abc123'), '/media/*')
  assert.equal(cspPathGroup('about:'), 'about:')
  assert.equal(cspPathGroup('unknown'), 'unknown')
  assert.ok(cspPathGroup(`/${'x'.repeat(500)}/y`).length <= 70, 'the group is bounded too')
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
  const notices = lines.filter(line => line.includes('csp_report.hosts_unconfigured'))
  assert.equal(notices.length, 1)
})

// ─── Aggregation (W1) ─────────────────────────────────────────────────────────

test('the stated window and key cap', () => {
  assert.equal(CSP_REPORT_SUMMARY_WINDOW_SECONDS, 600)
  assert.equal(CSP_REPORT_MAX_KEYS, 500)
})

test('1 000 identical reports: one first-sighting line at once, then one summary line with count 999 after the window', () => {
  const { instance, emitted, advance } = aggregator()
  const entry = entryOf(legacy())
  assert.equal(instance.observe(entry), 'new')
  assert.equal(instance.logFirst(entry), true)
  for (let index = 1; index < 1000; index += 1) {
    const repeat = entryOf(legacy({ 'document-uri': `https://portal.example.vn/news/bai-${index}` }))
    assert.equal(instance.observe(repeat), 'repeat')
  }
  assert.equal(emitted.length, 1, 'repeats are only counted')
  assert.deepEqual(emitted[0], { level: 'info', fields: { event: 'security.csp_violation', kind: 'first', ...entry, count: 1 } })

  advance(600_000)
  instance.flush()
  assert.equal(emitted.length, 2)
  const summary = emitted[1]!.fields
  assert.equal(summary.kind, 'repeats')
  assert.equal(summary.count, 999)
  assert.equal(summary.windowSeconds, 600)
  assert.equal(summary.pathGroup, '/news/*')
  assert.equal(summary.path, '/news/bai-999', 'a sample path — the last one seen')
  assert.equal(summary.directive, 'script-src-elem')
  instance.stop()
})

test('a new key in the middle of a flood is logged at once', () => {
  const { instance, emitted } = aggregator()
  const flood = entryOf(legacy())
  instance.observe(flood)
  instance.logFirst(flood)
  for (let index = 0; index < 500; index += 1) instance.observe(flood)
  const fresh = entryOf(legacy({ 'blocked-uri': 'https://unknown-cdn.example/x.js', 'script-sample': '' }))
  assert.equal(instance.observe(fresh), 'new')
  assert.equal(instance.logFirst(fresh), true)
  assert.equal(emitted.length, 2)
  assert.equal(emitted[1]!.fields.blocked, 'unknown-cdn.example')
  instance.stop()
})

test('the window rolls on its own: a report after the window flushes the previous one first', () => {
  const { instance, emitted, advance } = aggregator({ windowMs: 1000 })
  const entry = entryOf(legacy())
  instance.observe(entry)
  instance.logFirst(entry)
  instance.observe(entry)
  advance(1000)
  assert.equal(instance.observe(entry), 'new', 'a new window starts empty')
  assert.deepEqual(emitted.map(line => [line.fields.kind, line.fields.count]), [['first', 1], ['repeats', 1]])
  instance.stop()
})

test('the key map is capped; reports beyond it are counted as overflow in the window summary', () => {
  const { instance, emitted } = aggregator({ maxKeys: 3 })
  for (let index = 0; index < 3; index += 1) {
    const entry = entryOf(legacy({ 'blocked-uri': `https://h${index}.example/x.js`, 'script-sample': '' }))
    assert.equal(instance.observe(entry), 'new')
    instance.logFirst(entry)
  }
  const extra = entryOf(legacy({ 'blocked-uri': 'https://h3.example/x.js', 'script-sample': '' }))
  assert.equal(instance.observe(extra), 'overflow')
  assert.equal(instance.observe(extra), 'overflow')
  // A key already known is still counted while the map is full.
  assert.equal(instance.observe(entryOf(legacy({ 'blocked-uri': 'https://h0.example/x.js', 'script-sample': '' }))), 'repeat')
  instance.countLimited()
  instance.flush()
  const dropped = emitted.find(line => line.fields.event === 'csp_report.dropped')
  assert.ok(dropped, 'no dropped summary')
  assert.equal(dropped.level, 'warn', 'a full map is worth a warning')
  assert.deepEqual({ overflow: dropped.fields.overflow, limited: dropped.fields.limited }, { overflow: 2, limited: 1 })
  instance.stop()
})

test('a first sighting registered meanwhile by a concurrent request is counted, not logged twice', () => {
  const { instance, emitted } = aggregator()
  const entry = entryOf(legacy())
  assert.equal(instance.observe(entry), 'new')
  assert.equal(instance.observe(entry), 'new', 'not registered until logged')
  assert.equal(instance.logFirst(entry), true)
  assert.equal(instance.logFirst(entry), false)
  instance.flush()
  assert.deepEqual(emitted.map(line => [line.fields.kind, line.fields.count]), [['first', 1], ['repeats', 1]])
  instance.stop()
})

test('an enforced violation is a warning in both lines; a quiet window writes nothing', () => {
  const { instance, emitted } = aggregator()
  const entry = entryOf(legacy({ disposition: 'enforce' }))
  instance.observe(entry)
  instance.logFirst(entry)
  instance.observe(entry)
  instance.flush()
  instance.flush()
  assert.deepEqual(emitted.map(line => line.level), ['warn', 'warn'])
  instance.stop()
})

test('the flush timer starts with the window and is unref’d — it never keeps the process alive', () => {
  const { instance } = aggregator()
  assert.equal(instance.flushTimer, null)
  const entry = entryOf(legacy())
  instance.observe(entry)
  assert.ok(instance.flushTimer, 'no timer was started')
  assert.equal(instance.flushTimer.hasRef(), false)
  instance.flush()
  assert.equal(instance.flushTimer, null, 'the timer goes with the window')
  instance.observe(entry)
  instance.stop()
  assert.equal(instance.flushTimer, null)
})

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
    const entry = entryOf(legacy({ 'blocked-uri': 'https://close-hook.example/x.js' }))
    cspViolationLog.observe(entry)
    cspViolationLog.logFirst(entry)
    cspViolationLog.observe(entry)
    cspViolationLog.observe(entry)
    await hooks.get('close')!()
  } finally {
    console.log = realInfo
  }
  const summary = written.map(text => JSON.parse(text) as Record<string, unknown>).find(line => line.kind === 'repeats')
  assert.equal(summary?.count, 2)
  assert.equal(cspViolationLog.flushTimer, null, 'nothing left scheduled after close')
})

const lines: string[] = []
const realLog = console.log
beforeEach(() => { lines.length = 0 })
after(() => { console.log = realLog })
test('the default sink writes structured logger lines (no sample text, no query)', async () => {
  const { cspViolationLog } = await import('../server/utils/csp-report-log')
  console.log = (line: unknown) => { lines.push(String(line)) }
  try {
    const entry = entryOf(legacy({ 'document-uri': 'https://portal.example.vn/about?secret=1' }))
    cspViolationLog.observe(entry)
    cspViolationLog.logFirst(entry)
  } finally {
    console.log = realLog
    cspViolationLog.stop()
  }
  const [line] = lines.map(text => JSON.parse(text) as Record<string, unknown>)
  assert.equal(line?.event, 'security.csp_violation')
  assert.equal(line?.kind, 'first')
  assert.equal(line?.path, '/about')
  assert.ok(typeof line?.sampleSha256 === 'string', 'sampleSha256 must not be redacted by the logger')
  assert.ok(!lines.join('').includes('secret=1') && !lines.join('').includes('__NUXT__'))
})
