import assert from 'node:assert/strict'
import test from 'node:test'

import { fakeNitroApp, loadPlugin, withEnv, type NitroPlugin } from './_nitro-plugin-harness.ts'
import { TICK_INTERVAL_MS as ANALYTICS_TICK, stopAnalyticsScheduler } from '../server/services/analytics-scheduler.ts'
import { TICK_INTERVAL_MS as BOOST_TICK, stopViewBoostScheduler } from '../server/services/view-boost-scheduler.ts'
import {
  TICK_INTERVAL_MS as REAPER_TICK, WARMUP_DELAY_MS as REAPER_WARMUP, stopMediaProcessingReaper,
} from '../server/services/media-processing-reaper.ts'

/**
 * Ba plugin khởi động bộ hẹn giờ trong tiến trình: `analytics-scheduler`, `view-boost-scheduler`,
 * `media-processing-reaper` — CHẠY plugin thật cùng service thật, chỉ thay `setInterval`/
 * `setTimeout` bằng bản ghi lại (không hẹn giờ thật, không chạm DB: không nhịp nào được bắn).
 *
 * Bất biến:
 *  - cổng môi trường (cùng luật với `RETENTION_SCHEDULER`): `0|false|off|no` tắt, kể cả ở
 *    production; `1|true|on|yes` bật ngoài production; không đặt → chỉ bật ở production;
 *    giá trị lạ không bật được ngoài production và không tắt được ở production;
 *  - mọi timer được `unref()` (không giữ tiến trình sống qua lượt tắt máy);
 *  - `media-processing-reaper` gỡ cả interval lẫn warm-up khi Nitro `close`.
 */

type Recorded = { kind: 'interval' | 'timeout', ms: number, unref: boolean, handle: object }
type Observation = { timers: Recorded[], cleared: object[] }

/** Chạy `fn` với timer toàn cục bị thay bằng bản ghi; luôn khôi phục. */
async function observeTimers(fn: () => unknown | Promise<unknown>): Promise<Observation> {
  const g = globalThis as Record<string, unknown>
  const originals = { si: g.setInterval, st: g.setTimeout, ci: g.clearInterval, ct: g.clearTimeout }
  const observation: Observation = { timers: [], cleared: [] }
  const make = (kind: Recorded['kind']) => (_cb: unknown, ms: number) => {
    const record: Recorded = { kind, ms, unref: false, handle: {} }
    const handle = Object.assign(record.handle, { unref() { record.unref = true; return handle } })
    observation.timers.push(record)
    return handle
  }
  g.setInterval = make('interval')
  g.setTimeout = make('timeout')
  g.clearInterval = (h: object) => { observation.cleared.push(h) }
  g.clearTimeout = (h: object) => { observation.cleared.push(h) }
  try {
    await fn()
  } finally {
    g.setInterval = originals.si
    g.setTimeout = originals.st
    g.clearInterval = originals.ci
    g.clearTimeout = originals.ct
  }
  return observation
}

type SwitchCase = { name: string, env: Record<string, string | undefined>, expectStart: boolean }
const switchCases = (variable: string): SwitchCase[] => {
  const off = (value: string | undefined, nodeEnv: string) => ({ [variable]: value, NODE_ENV: nodeEnv })
  return [
    { name: 'dev, không đặt biến', env: off(undefined, 'development'), expectStart: false },
    { name: 'test, không đặt biến', env: off(undefined, 'test'), expectStart: false },
    { name: 'production, không đặt biến', env: off(undefined, 'production'), expectStart: true },
    { name: 'dev, =1', env: off('1', 'development'), expectStart: true },
    { name: 'dev, =true', env: off('true', 'development'), expectStart: true },
    { name: 'dev, =ON (hoa + khoảng trắng)', env: off('  ON ', 'development'), expectStart: true },
    { name: 'dev, =yes', env: off('yes', 'development'), expectStart: true },
    { name: 'dev, giá trị lạ', env: off('maybe', 'development'), expectStart: false },
    { name: 'production, =0', env: off('0', 'production'), expectStart: false },
    { name: 'production, =false', env: off('false', 'production'), expectStart: false },
    { name: 'production, =OFF (hoa + khoảng trắng)', env: off(' OFF ', 'production'), expectStart: false },
    { name: 'production, =no', env: off('no', 'production'), expectStart: false },
    { name: 'production, giá trị lạ vẫn bật', env: off('maybe', 'production'), expectStart: true },
  ]
}

const PLUGINS = [
  { file: 'server/plugins/analytics-scheduler.ts', variable: 'ANALYTICS_SCHEDULER', tick: ANALYTICS_TICK, warmup: 90_000, stop: stopAnalyticsScheduler },
  { file: 'server/plugins/view-boost-scheduler.ts', variable: 'VIEW_BOOST_SCHEDULER', tick: BOOST_TICK, warmup: 60_000, stop: stopViewBoostScheduler },
  { file: 'server/plugins/media-processing-reaper.ts', variable: 'MEDIA_REAPER_SCHEDULER', tick: REAPER_TICK, warmup: REAPER_WARMUP, stop: stopMediaProcessingReaper },
] as const

const loaded = new Map<string, NitroPlugin>()
for (const entry of PLUGINS) {
  const plugin = await loadPlugin(entry.file)
  loaded.set(entry.file, plugin)
  const cases = switchCases(entry.variable)

  test(`${entry.file}: cổng ${entry.variable} (${cases.length} tổ hợp), timer unref, interval đúng nhịp`, async () => {
    for (const { name, env, expectStart } of cases) {
      entry.stop()
      const nitro = fakeNitroApp()
      const observed = await withEnv(env, () => observeTimers(() => plugin(nitro.app)))
      const label = `${entry.variable} · ${name}`
      if (!expectStart) {
        assert.deepEqual(observed.timers, [], `${label}: không được hẹn giờ`)
        continue
      }
      const interval = observed.timers.find(timer => timer.kind === 'interval')
      const warmup = observed.timers.find(timer => timer.kind === 'timeout')
      assert.ok(interval, `${label}: phải có interval`)
      assert.equal(interval.ms, entry.tick, `${label}: nhịp`)
      assert.ok(warmup, `${label}: phải có lượt khởi động hoãn`)
      assert.equal(warmup.ms, entry.warmup, `${label}: độ hoãn`)
      for (const timer of observed.timers) assert.equal(timer.unref, true, `${label}: ${timer.kind} chưa unref`)
    }
    entry.stop()
  })

  test(`${entry.file}: bật hai lần chỉ có một interval (idempotent, không nhân đôi nhịp)`, async () => {
    entry.stop()
    const env = { [entry.variable]: '1', NODE_ENV: 'development' }
    const observed = await withEnv(env, () => observeTimers(async () => {
      await plugin(fakeNitroApp().app)
      await plugin(fakeNitroApp().app)
    }))
    assert.equal(observed.timers.filter(timer => timer.kind === 'interval').length, 1)
    entry.stop()
  })
}

test('media-processing-reaper: Nitro close gỡ cả interval lẫn warm-up; cổng đóng thì không đăng ký close', async () => {
  const plugin = loaded.get('server/plugins/media-processing-reaper.ts')!
  stopMediaProcessingReaper()

  const closed = fakeNitroApp()
  const off = await withEnv({ MEDIA_REAPER_SCHEDULER: '0', NODE_ENV: 'production' }, () => observeTimers(() => plugin(closed.app)))
  assert.deepEqual(off.timers, [])
  assert.equal(closed.hooks.has('close'), false, 'cổng đóng mà vẫn đăng ký close')

  const nitro = fakeNitroApp()
  const observed = await withEnv({ MEDIA_REAPER_SCHEDULER: '1', NODE_ENV: 'development' }, () => observeTimers(async () => {
    await plugin(nitro.app)
    assert.equal(nitro.hooks.get('close')?.length, 1, 'phải đăng ký đúng một hook close')
    await nitro.fire('close')
  }))
  const handles = observed.timers.map(timer => timer.handle)
  assert.equal(handles.length, 2)
  for (const handle of handles) assert.ok(observed.cleared.includes(handle), 'một timer không bị gỡ khi close')

  // Sau close, bật lại phải hẹn giờ mới (trạng thái đã dọn sạch, không kẹt "đã chạy").
  const again = await withEnv({ MEDIA_REAPER_SCHEDULER: '1', NODE_ENV: 'development' }, () => observeTimers(() => plugin(fakeNitroApp().app)))
  assert.equal(again.timers.filter(timer => timer.kind === 'interval').length, 1)
  stopMediaProcessingReaper()
})
