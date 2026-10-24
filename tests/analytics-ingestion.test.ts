import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAnalyticsLiveScopes,
  ingestAnalyticsPageView,
  storeAnalyticsPageView,
  type AnalyticsLiveScope,
  type AnalyticsPageViewTransaction,
} from '../server/services/analytics-ingestion'
import type { MinimalPageViewRow } from '../server/utils/analytics-collection'
import type { PersistedAnalyticsNocRecord } from '../server/services/analytics-ingestion-noc'

const SECRET = 'analytics-test-secret-that-is-longer-than-32-characters'
const event = { context: {}, node: { req: { headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.42' }, socket: { remoteAddress: '203.0.113.42' } } } } as any

function row(overrides: Partial<MinimalPageViewRow> = {}): MinimalPageViewRow {
  return {
    occurredAt: new Date('2026-07-22T12:34:56.000Z'),
    eventDay: '2026-07-22',
    path: '/news/local',
    sourceCategory: 'search',
    deviceClass: 'mobile',
    countryCode: 'VN',
    regionCode: 'HN-1',
    visitorToken: 'visitor-token-a',
    ...overrides,
  }
}

function transactionStore(options: { failOn?: string } = {}) {
  const state = {
    raw: [] as MinimalPageViewRow[],
    dedup: new Set<string>(),
    buckets: new Map<string, { scope: AnalyticsLiveScope; pageViews: number; unique: number }>(),
    committed: false,
    rolledBack: false,
  }
  const store = {
    async transaction(callback: (tx: AnalyticsPageViewTransaction) => Promise<void>) {
      const pending = {
        raw: [...state.raw],
        dedup: new Set(state.dedup),
        buckets: new Map([...state.buckets].map(([key, value]) => [key, { ...value }])),
      }
      const tx: AnalyticsPageViewTransaction = {
        async insertRaw(value) {
          if (options.failOn === 'raw') throw new Error('raw failure')
          pending.raw.push(value)
        },
        async insertDeduplication(bucketStart, visitorToken, scope) {
          if (options.failOn === 'dedup') throw new Error('dedup failure')
          const key = `${bucketStart}|${scope.scopeType}|${scope.scopeValueHash}|${visitorToken}`
          const unique = !pending.dedup.has(key)
          pending.dedup.add(key)
          return unique
        },
        async incrementBucket(bucketStart, scope, uniqueIncrement) {
          if (options.failOn === 'bucket') throw new Error('bucket failure')
          const key = `${bucketStart}|${scope.scopeType}|${scope.scopeValueHash}`
          const existing = pending.buckets.get(key) || { scope, pageViews: 0, unique: 0 }
          existing.pageViews += 1
          existing.unique += uniqueIncrement
          pending.buckets.set(key, existing)
        },
      }
      try {
        await callback(tx)
      } catch (error) {
        state.rolledBack = true
        throw error
      }
      state.raw = pending.raw
      state.dedup = pending.dedup
      state.buckets = pending.buckets
      state.committed = true
    },
  }
  return { state, store }
}

test('writes exactly six bounded scopes and preserves only normalized values', async () => {
  const { state, store } = transactionStore()
  await storeAnalyticsPageView(row(), store)
  assert.equal(state.raw.length, 1)
  assert.equal(state.buckets.size, 6)
  assert.deepEqual([...state.buckets.values()].map(value => value.scope.scopeType), [
    'total', 'path', 'source_category', 'device_class', 'country_code', 'region_code',
  ])
  const serialized = JSON.stringify({ raw: state.raw, buckets: [...state.buckets.values()] })
  assert.doesNotMatch(serialized, /203\.0\.113\.42|Private Browser|\?|#|cookie|referrer/i)
})

/**
 * Design D8, as measured (docs/decisions/data-layer.md). Every page view upserts
 * the same `total` bucket row for the current minute, and that row's lock is held
 * until COMMIT. The per-visitor dedupe rows — which no other page view waits on —
 * now all go BEFORE the first shared row is locked, so `total` is held across the
 * bucket upserts only, not the dedupe inserts too (the old order interleaved
 * them: dedupe, bucket, dedupe, bucket …).
 *
 * `total` stays the FIRST bucket upsert. The live tables have an auto-increment
 * PK beside their natural unique key, so each upsert holds an X next-key lock on
 * the PK supremum until commit; `total` first serialises the bucket phase per
 * minute. `total` last — the literal D8 text — rolled back ~37 % of page views
 * with ER_LOCK_DEADLOCK under 10 concurrent requests. This test keeps it first.
 */
test('statement order: raw row, every dedupe insert, then the bucket upserts with total first', async () => {
  const calls: string[] = []
  await storeAnalyticsPageView(row(), {
    async transaction(callback) {
      calls.push('begin')
      const result = await callback({
        async insertRaw() { calls.push('raw') },
        async insertDeduplication(_bucket, _visitor, scope) { calls.push(`dedup:${scope.scopeType}`); return true },
        async incrementBucket(_bucket, scope) { calls.push(`bucket:${scope.scopeType}`) },
      })
      calls.push('commit')
      return result
    },
  })
  assert.deepEqual(calls, [
    'begin',
    'raw',
    'dedup:total', 'dedup:path', 'dedup:source_category', 'dedup:device_class', 'dedup:country_code', 'dedup:region_code',
    'bucket:total', 'bucket:path', 'bucket:source_category', 'bucket:device_class', 'bucket:country_code', 'bucket:region_code',
    'commit',
  ])
})

test('statement order holds when geography is absent (the production shape: four scopes, total first)', async () => {
  const buckets: string[] = []
  await storeAnalyticsPageView(row({ countryCode: null, regionCode: null }), {
    async transaction(callback) {
      return callback({
        async insertRaw() {},
        async insertDeduplication() { return true },
        async incrementBucket(_bucket, scope) { buckets.push(scope.scopeType) },
      })
    },
  })
  assert.deepEqual(buckets, ['total', 'path', 'source_category', 'device_class'])
})

test('a dedupe result still decides the unique increment of its own scope once dedupes run first', async () => {
  const increments: Array<[string, number]> = []
  await storeAnalyticsPageView(row(), {
    async transaction(callback) {
      return callback({
        async insertRaw() {},
        // Only the path scope has seen this visitor before in this minute.
        async insertDeduplication(_bucket, _visitor, scope) { return scope.scopeType !== 'path' },
        async incrementBucket(_bucket, scope, unique) { increments.push([scope.scopeType, unique]) },
      })
    },
  })
  assert.deepEqual(Object.fromEntries(increments), {
    path: 0, region_code: 1, source_category: 1, device_class: 1, country_code: 1, total: 1,
  })
})

test('the NOC aggregate is written only after the ingestion transaction committed', async () => {
  const events: string[] = []
  const store = (value: MinimalPageViewRow) => storeAnalyticsPageView(value, {
    async transaction(callback) {
      const result = await callback({
        async insertRaw() { events.push('raw') },
        async insertDeduplication() { return true },
        async incrementBucket(_bucket, scope) { events.push(`bucket:${scope.scopeType}`) },
      })
      events.push('commit')
      return result
    },
  })
  const outcome = await ingestAnalyticsPageView({
    event,
    payload: { path: '/news', sourceCategory: 'direct', deviceClass: 'desktop' },
    config: { collectionEnabled: true, hmacSecret: SECRET },
    now: new Date('2026-07-22T12:00:00Z'),
    store,
    storeNoc: async (record) => { events.push(`noc:${record.eventType}`) },
  })
  assert.equal(outcome, 'accepted')
  // No geography in this payload: the last bucket is the last dimension.
  assert.deepEqual(events.slice(-3), ['bucket:device_class', 'commit', 'noc:ingestion_accepted'])
  assert.equal(events.filter(event => event.startsWith('noc:')).length, 1)
})

test('increments page views for repeats but approximate unique once per minute and scope', async () => {
  const { state, store } = transactionStore()
  await storeAnalyticsPageView(row(), store)
  await storeAnalyticsPageView(row(), store)
  const total = [...state.buckets.values()].find(value => value.scope.scopeType === 'total')!
  assert.equal(total.pageViews, 2)
  assert.equal(total.unique, 1)
})

test('increments the same visitor independently at the next UTC minute', async () => {
  const { state, store } = transactionStore()
  await storeAnalyticsPageView(row(), store)
  await storeAnalyticsPageView(row({ occurredAt: new Date('2026-07-22T12:35:00.000Z') }), store)
  const totalBuckets = [...state.buckets.values()].filter(value => value.scope.scopeType === 'total')
  assert.equal(totalBuckets.length, 2)
  assert.deepEqual(totalBuckets.map(value => [value.pageViews, value.unique]), [[1, 1], [1, 1]])
})

test('rolls back raw, deduplication, and buckets together on failure', async () => {
  const { state, store } = transactionStore({ failOn: 'bucket' })
  await assert.rejects(storeAnalyticsPageView(row(), store), /bucket failure/)
  assert.equal(state.committed, false)
  assert.equal(state.rolledBack, true)
  assert.equal(state.raw.length, 0)
  assert.equal(state.dedup.size, 0)
  assert.equal(state.buckets.size, 0)
})

test('allows only populated dimensions while preserving six-scope cap', () => {
  const scopes = buildAnalyticsLiveScopes(row({ countryCode: null, regionCode: null }))
  assert.equal(scopes.length, 4)
  assert.deepEqual(scopes.map(scope => scope.scopeType), ['total', 'path', 'source_category', 'device_class'])
})

test('best-effort NOC records accepted, rejected, and bot outcomes without unsafe fields', async () => {
  const noc: PersistedAnalyticsNocRecord[] = []
  const storeNoc = async (record: PersistedAnalyticsNocRecord) => { noc.push(record) }
  const acceptedStore = async () => undefined
  assert.equal(await ingestAnalyticsPageView({ event, payload: { path: '/news?secret=1', sourceCategory: 'direct', deviceClass: 'desktop' }, config: { collectionEnabled: true, hmacSecret: SECRET }, now: new Date('2026-07-22T12:00:00Z'), store: acceptedStore, storeNoc }), 'accepted')
  assert.equal(await ingestAnalyticsPageView({ event, payload: { path: '/news', unexpected: 'private' }, config: { collectionEnabled: true, hmacSecret: SECRET }, now: new Date('2026-07-22T12:00:00Z'), store: acceptedStore, storeNoc }).catch(() => 'rejected'), 'rejected')
  const botEvent = { ...event, node: { req: { headers: { 'user-agent': 'Googlebot' } } } } as any
  assert.equal(await ingestAnalyticsPageView({ event: botEvent, payload: { path: '/news' }, config: { collectionEnabled: true, hmacSecret: SECRET }, store: acceptedStore, storeNoc }), 'bot')
  assert.equal(noc.length, 3)
  assert.doesNotMatch(JSON.stringify(noc), /secret=1|private|Googlebot|203\.0\.113\.42|visitor-token/i)
})
