import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const reportingPath = new URL('../server/services/analytics-reporting.ts', import.meta.url)

test('live reporting SQL references only live aggregate and NOC tables and every query is bounded', async () => {
  const source = await readFile(reportingPath, 'utf8')
  const liveSection = source.slice(source.indexOf('function liveWindowBounds'))
  assert.doesNotMatch(liveSection, /analytics_page_view_events|analytics_live_deduplication|visitor_token|raw user agent|referrer|cookie|request_body/i)
  const tables = [...liveSection.matchAll(/(?:FROM|INTO)\s+([a-z_]+)/gi)].map(match => match[1])
  assert.ok(tables.length > 0)
  assert.ok(tables.every(table => ['analytics_live_minute_buckets', 'analytics_noc_minute_aggregates'].includes(table)), tables.join(', '))
  assert.match(liveSection, /bucket_start >= \? AND bucket_start < \?/)
  assert.match(liveSection, /LIMIT 60/)
  assert.match(liveSection, /LIMIT \?/)
})
