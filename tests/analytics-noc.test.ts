import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANALYTICS_NOC_ERROR_CODES,
  normalizeAnalyticsNocErrorCode,
  normalizeAnalyticsNocEvent,
  serializeAnalyticsNocDetails,
} from '../server/utils/analytics-noc'

test('normalizes only allowlisted NOC event identity and error codes', () => {
  const event = normalizeAnalyticsNocEvent({
    eventType: 'ingestion_rejected',
    severity: 'warning',
    component: 'collector',
    status: 'rejected',
    errorCode: 'invalid_payload',
    details: { reasonCode: 'invalid_payload' },
  })
  assert.equal(event.errorCode, 'invalid_payload')
  assert.equal(event.detailsJson, '{"reasonCode":"invalid_payload"}')
  assert.equal(normalizeAnalyticsNocErrorCode('arbitrary-stack-trace'), 'unknown')
  assert.ok(ANALYTICS_NOC_ERROR_CODES.includes(event.errorCode))
  assert.throws(() => normalizeAnalyticsNocEvent({
    eventType: 'arbitrary_event', severity: 'info', component: 'collector', status: 'success',
  }), /invalid NOC event type/)
})

test('rejects prohibited or unbounded NOC detail fields', () => {
  assert.throws(() => serializeAnalyticsNocDetails('ingestion_rejected', { message: 'request body' }), /unsupported NOC detail/)
  assert.throws(() => serializeAnalyticsNocDetails('ingestion_accepted', { scopeCount: 7 }), /invalid NOC detail/)
  assert.throws(() => serializeAnalyticsNocDetails('reporting_success', { windowMinutes: 61 }), /invalid NOC detail/)
  assert.throws(() => serializeAnalyticsNocDetails('retention_cleanup', { details: 'raw payload' }), /unsupported NOC detail/)
  assert.throws(() => serializeAnalyticsNocDetails('maintenance_failure', { processedDays: -1 }), /invalid NOC detail/)
})

test('serializes bounded safe scalar details deterministically', () => {
  assert.equal(
    serializeAnalyticsNocDetails('retention_cleanup', {
      nocRetentionDays: 30,
      purgedNocRows: 2,
      purgedLiveBuckets: 3,
      purgedDedupRows: 4,
      liveRetentionHours: 48,
    }),
    '{"liveRetentionHours":48,"nocRetentionDays":30,"purgedDedupRows":4,"purgedLiveBuckets":3,"purgedNocRows":2}',
  )
  assert.equal(serializeAnalyticsNocDetails('ingestion_accepted'), null)
  assert.equal(serializeAnalyticsNocDetails('maintenance_complete', { stale: false, processedDays: 1 }), '{"processedDays":1,"stale":false}')
})
