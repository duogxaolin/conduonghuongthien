/**
 * The delivery schedule for administrator-authorised view inflation.
 *
 * What is being pinned here is a single design choice: the amount due is derived
 * from absolute elapsed time, not accumulated one tick at a time. That is what
 * makes the outcome identical whether the process ticked every minute, missed an
 * hour, or was shut down over the weekend and came back after the job's window
 * had already closed. A per-tick scheme passes the happy path and silently
 * under-delivers everywhere else, which is exactly the failure nobody notices.
 *
 * The other property under test is that cumulative delivery lands on
 * `totalAmount` exactly — never above it, at any intermediate point.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { computeBoostDue, type BoostJob } from '../server/services/view-boost-scheduler.ts'

const START = new Date('2026-08-01T00:00:00Z')
const MINUTE = 60_000

/** A job of `total` views spread over `minutes`, nothing delivered yet. */
function job(total: number, minutes: number, applied = 0): BoostJob {
  return {
    id: 1,
    articleId: 7,
    totalAmount: total,
    appliedAmount: applied,
    startedAt: START,
    endsAt: new Date(START.getTime() + minutes * MINUTE),
  }
}

function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * MINUTE)
}

describe('computeBoostDue — the ordinary progression', () => {
  it('delivers nothing at the instant the job is created', () => {
    assert.deepEqual(computeBoostDue(job(600, 60), START), { deliver: 0, done: false })
  })

  it('delivers the elapsed fraction mid-window', () => {
    // 600 views over 60 minutes: at minute 30, half.
    assert.deepEqual(computeBoostDue(job(600, 60), at(30)), { deliver: 300, done: false })
  })

  it('delivers only the shortfall when part is already applied', () => {
    assert.deepEqual(computeBoostDue(job(600, 60, 290), at(30)), { deliver: 10, done: false })
  })

  it('sums to exactly totalAmount over a full minute-by-minute run', () => {
    let applied = 0
    for (let minute = 1; minute <= 60; minute++) {
      const due = computeBoostDue(job(600, 60, applied), at(minute))
      applied += due.deliver
      // The invariant that matters at every intermediate point, not just at the end.
      assert.ok(applied <= 600, `over-delivered at minute ${minute}: ${applied}`)
      if (minute === 60) assert.equal(due.done, true)
    }
    assert.equal(applied, 600)
  })
})

describe('computeBoostDue — ticks that did not happen on time', () => {
  it('a missed tick is made up by the next one', () => {
    // Ticks at 10 and 30; minute 20 never happened.
    let applied = 0
    applied += computeBoostDue(job(600, 60, applied), at(10)).deliver
    assert.equal(applied, 100)
    applied += computeBoostDue(job(600, 60, applied), at(30)).deliver
    // Not 100 + 100: the target at minute 30 is 300 regardless of how many
    // passes it took to get there.
    assert.equal(applied, 300)
  })

  it('several bunched ticks in the same instant deliver once', () => {
    let applied = 0
    for (let i = 0; i < 5; i++) {
      applied += computeBoostDue(job(600, 60, applied), at(30)).deliver
    }
    assert.equal(applied, 300)
  })

  it('a job whose window closed during downtime delivers the whole remainder', () => {
    // Process was down from minute 10 to two days later.
    const due = computeBoostDue(job(600, 60, 100), new Date(START.getTime() + 2 * 24 * 60 * MINUTE))
    assert.deepEqual(due, { deliver: 500, done: true })
  })

  it('marks a job done exactly at ends_at, not one tick later', () => {
    assert.deepEqual(computeBoostDue(job(600, 60, 590), at(60)), { deliver: 10, done: true })
  })
})

describe('computeBoostDue — degenerate inputs', () => {
  it('a zero-length window delivers everything immediately and finishes', () => {
    assert.deepEqual(computeBoostDue(job(600, 0), START), { deliver: 600, done: true })
  })

  it('an inverted window is treated as zero-length rather than running backwards', () => {
    const inverted: BoostJob = { ...job(600, 60), endsAt: new Date(START.getTime() - MINUTE) }
    assert.deepEqual(computeBoostDue(inverted, START), { deliver: 600, done: true })
  })

  it('an already fully applied job delivers nothing, including past ends_at', () => {
    assert.deepEqual(computeBoostDue(job(600, 60, 600), at(30)), { deliver: 0, done: false })
    assert.deepEqual(computeBoostDue(job(600, 60, 600), at(120)), { deliver: 0, done: true })
  })

  it('an applied count above the total never yields a negative delivery', () => {
    assert.deepEqual(computeBoostDue(job(600, 60, 900), at(30)), { deliver: 0, done: false })
    assert.deepEqual(computeBoostDue(job(600, 60, 900), at(120)), { deliver: 0, done: true })
  })

  it('a clock reading before started_at delivers nothing', () => {
    assert.deepEqual(computeBoostDue(job(600, 60), new Date(START.getTime() - MINUTE)), { deliver: 0, done: false })
  })
})

describe('computeBoostDue — rounding with a small total', () => {
  it('holds back fractional views instead of rounding each tick up', () => {
    // 5 views over 60 minutes: for the first 11 minutes the target floors to 0.
    assert.equal(computeBoostDue(job(5, 60), at(11)).deliver, 0)
    assert.equal(computeBoostDue(job(5, 60), at(12)).deliver, 1)
  })

  it('still lands on the total exactly when the total is smaller than the tick count', () => {
    let applied = 0
    for (let minute = 1; minute <= 60; minute++) {
      const due = computeBoostDue(job(7, 60, applied), at(minute))
      applied += due.deliver
      assert.ok(applied <= 7, `over-delivered at minute ${minute}: ${applied}`)
    }
    assert.equal(applied, 7)
  })

  it('a total of 1 arrives once, at the end', () => {
    let applied = 0
    for (let minute = 1; minute <= 60; minute++) {
      applied += computeBoostDue(job(1, 60, applied), at(minute)).deliver
    }
    assert.equal(applied, 1)
  })
})

describe('computeBoostDue — purity', () => {
  it('returns the same answer for the same arguments', () => {
    const first = computeBoostDue(job(600, 60, 120), at(30))
    const second = computeBoostDue(job(600, 60, 120), at(30))
    assert.deepEqual(first, second)
  })

  it('does not mutate the job it was given', () => {
    const subject = job(600, 60, 120)
    const before = JSON.stringify(subject)
    computeBoostDue(subject, at(30))
    assert.equal(JSON.stringify(subject), before)
  })

  it('reads no clock, database or randomness', () => {
    // The function is the schedule. If it ever reaches for Date.now(), a pool or
    // Math.random(), every case above stops proving anything about production.
    const source = readFileSync(new URL('../server/services/view-boost-scheduler.ts', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('export function computeBoostDue'))
    const fn = body.slice(0, body.indexOf('\n}\n') + 3)
    for (const forbidden of ['Date.now', 'new Date(', 'Math.random', 'getDb', 'getPool', 'await ']) {
      assert.ok(!fn.includes(forbidden), `computeBoostDue must not reference ${forbidden}`)
    }
  })
})
