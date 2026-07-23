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
