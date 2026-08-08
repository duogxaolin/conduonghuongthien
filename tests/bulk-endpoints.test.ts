/**
 * The shared plumbing behind every admin bulk endpoint.
 *
 * `parseBulkIds` and `runBulk` (server/utils/bulk.ts) carry 15 of the 16 bulk
 * routes — articles, categories, content-types, media, pages, submissions, users,
 * and four chatbot lots. Until now **not one** of them was named in any test, which
 * matters more here than for a single-row route: a bulk endpoint multiplies each
 * chance of a mistake by the number of records an officer ticked, and the project
 * has already paid for exactly that. `chatbot/sessions/bulk-delete` reported
 * "đã xoá 0" while the rows were gone, because `affectedRows` was read off an
 * undestructured array — the officer's screen and the audit row both said nothing
 * happened.
 *
 * These are pure functions, so this suite runs them for real rather than reading
 * their source text. What is pinned is the set of decisions a future refactor could
 * quietly invert:
 *
 *   1. A malformed list is REJECTED WHOLE, never partially applied.
 *   2. A blocked row does NOT cancel the rest of the lot.
 *   3. The operation runs SEQUENTIALLY, in the order given.
 *   4. The cap is enforced, so one request cannot sweep a table.
 *
 * (1) and (2) look contradictory and are not, which is the thing most at risk of
 * being "tidied" into consistency. A bad *request shape* is a client bug and
 * deleting some of what it asked for would hide it; a blocked *row* is a fact about
 * real data ("this category still holds 3 articles"), and aborting nineteen valid
 * deletions over it would make bulk actions useless on a live table.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BULK_MAX_IDS, parseBulkIds, runBulk } from '../server/utils/bulk.ts'

/** h3's createError puts the HTTP status on `statusCode`. */
function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number } | null)?.statusCode
}

describe('parseBulkIds — a malformed list is rejected whole', () => {
  it('accepts a plain list of positive integers', () => {
    assert.deepEqual(parseBulkIds({ ids: [3, 1, 2] }), [3, 1, 2])
  })

  it('preserves the order it was given', () => {
    // runBulk reports succeededIds so the client can drop exactly those from its
    // selection; reordering here would scramble that mapping for no reason.
    assert.deepEqual(parseBulkIds({ ids: [9, 4, 7] }), [9, 4, 7])
  })

  it('collapses duplicates instead of failing on them', () => {
    // The same row ticked twice is a UI artefact. Failing would block a real
    // operator over something harmless; running the delete twice would turn the
    // second pass into a "row not found" failure in the report.
    assert.deepEqual(parseBulkIds({ ids: [5, 5, 6, 5] }), [5, 6])
  })

  it('rejects the WHOLE request when any entry is unusable', () => {
    // The important half of the contract. `["3", null, 4]` is a client bug, and
    // silently deleting row 4 while dropping the rest would hide it behind a
    // successful-looking response.
    for (const ids of [
      ['3', null, 4],
      [1, 'two'],
      [1, null],
      [1, undefined],
      [1, 2.5],
      [1, -3],
      [1, 0],
      [1, Number.NaN],
      [1, Number.POSITIVE_INFINITY],
      [1, 1e999],
      [{ id: 1 }],
      [[1]],
      [true],
    ]) {
      assert.throws(
        () => parseBulkIds({ ids }),
        (error: unknown) => statusOf(error) === 400,
        `${JSON.stringify(ids)} must be rejected outright, not partially applied`,
      )
    }
  })

  it('rejects a missing, empty or non-array ids field', () => {
    for (const body of [
      undefined,
      null,
      {},
      { ids: [] },
      { ids: null },
      { ids: 'all' },
      { ids: 42 },
      { ids: {} },
    ]) {
      assert.throws(
        () => parseBulkIds(body),
        (error: unknown) => statusOf(error) === 400,
        `${JSON.stringify(body)} must not be read as "everything"`,
      )
    }
  })

  it('enforces the per-request cap', () => {
    // Without this, one request could ask the server to sweep an entire table.
    const atCap = Array.from({ length: BULK_MAX_IDS }, (_, i) => i + 1)
    assert.equal(parseBulkIds({ ids: atCap }).length, BULK_MAX_IDS)

    assert.throws(
      () => parseBulkIds({ ids: [...atCap, BULK_MAX_IDS + 1] }),
      (error: unknown) => statusOf(error) === 400,
      'one over the cap must be refused',
    )
  })

  it('counts the cap before de-duplicating', () => {
    // A list of 500 copies of the same id is still a 500-entry request. Collapsing
    // first would let a caller past the cap with a payload the server still has to
    // parse.
    const flood = Array.from({ length: BULK_MAX_IDS + 50 }, () => 7)
    assert.throws(
      () => parseBulkIds({ ids: flood }),
      (error: unknown) => statusOf(error) === 400,
    )
  })
})

describe('runBulk — one blocked row does not cancel the lot', () => {
  it('reports every id when all succeed', async () => {
    const seen: number[] = []
    const result = await runBulk([1, 2, 3], async (id) => { seen.push(id) })

    assert.deepEqual(result, {
      ok: true,
      requested: 3,
      succeeded: 3,
      succeededIds: [1, 2, 3],
      failed: [],
    })
    assert.deepEqual(seen, [1, 2, 3])
  })

  it('keeps going after a failure and still processes later ids', async () => {
    // The decision worth defending: selecting twenty categories where one is
    // blocked should remove nineteen and explain the twentieth.
    const seen: number[] = []
    const result = await runBulk([1, 2, 3], async (id) => {
      seen.push(id)
      if (id === 2) throw new Error('bị chặn')
    })

    assert.deepEqual(seen, [1, 2, 3], 'a failure must not abort the remaining ids')
    assert.deepEqual(result.succeededIds, [1, 3])
    assert.equal(result.succeeded, 2)
    assert.equal(result.requested, 3)
    assert.deepEqual(result.failed, [{ id: 2, message: 'bị chặn' }])
  })

  it('never lists an id as both succeeded and failed', async () => {
    // The client drops `succeededIds` from its selection. An id in both lists would
    // make it drop a row whose failure it is also showing.
    const result = await runBulk([1, 2, 3, 4], async (id) => {
      if (id % 2 === 0) throw new Error('nope')
    })

    const failedIds = result.failed.map(entry => entry.id)
    assert.deepEqual(result.succeededIds, [1, 3])
    assert.deepEqual(failedIds, [2, 4])
    assert.equal(
      result.succeededIds.filter(id => failedIds.includes(id)).length,
      0,
    )
    assert.equal(result.succeeded + result.failed.length, result.requested)
  })

  it('runs sequentially, not concurrently', async () => {
    // Not Promise.all on purpose: media deletion does network I/O against R2, and
    // the relational guards count rows that earlier iterations may have removed.
    // Asserted by observing that no two operations overlap.
    let inFlight = 0
    let maxInFlight = 0
    const order: number[] = []

    await runBulk([1, 2, 3, 4], async (id) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      order.push(id)
      inFlight -= 1
    })

    assert.equal(maxInFlight, 1, 'operations overlapped — the guards and R2 calls would race')
    assert.deepEqual(order, [1, 2, 3, 4], 'ids must be processed in the order given')
  })

  it('surfaces statusMessage in preference to message', async () => {
    // Services raise createError({ statusMessage }) with the sentence an operator
    // should read ("Danh mục còn 3 bài viết"). h3 also sets a generic `message`, so
    // preferring the wrong one would replace every explanation with boilerplate.
    const result = await runBulk([1], async () => {
      throw { statusCode: 409, statusMessage: 'Danh mục còn 3 bài viết.', message: 'Conflict' }
    })

    assert.deepEqual(result.failed, [{ id: 1, message: 'Danh mục còn 3 bài viết.' }])
  })

  it('falls back to the caller sentence for anything unexpected', async () => {
    // A TypeError from a bug in the service must not be shown to an officer as if
    // it were an explanation of why their row was refused.
    for (const thrown of [new TypeError(''), null, undefined, 'boom', 42, {}, { statusMessage: '' }]) {
      const result = await runBulk(
        [1],
        async () => { throw thrown },
        'Không thể xóa người dùng này.',
      )
      assert.equal(
        result.failed[0]?.message,
        'Không thể xóa người dùng này.',
        `${JSON.stringify(thrown)} must fall back to the caller's sentence`,
      )
    }
  })

  it('uses a generic default when the caller supplies no sentence', async () => {
    const result = await runBulk([1], async () => { throw new Error('') })
    assert.equal(result.failed[0]?.message, 'Không thể xử lý mục này.')
  })

  it('reports an empty lot without calling the operation', async () => {
    // parseBulkIds rejects an empty list, so this is only reachable by a direct
    // caller — but it must not report success for work it never did.
    let calls = 0
    const result = await runBulk([], async () => { calls += 1 })

    assert.equal(calls, 0)
    assert.deepEqual(result, { ok: true, requested: 0, succeeded: 0, succeededIds: [], failed: [] })
  })

  it('does not reject when every row fails', async () => {
    // The endpoint returns 200 with a report; the caller decides how to present it.
    // Throwing here would turn a fully-explained refusal into an opaque 500.
    const result = await runBulk([1, 2], async () => { throw new Error('bị chặn') })

    assert.equal(result.ok, true)
    assert.equal(result.succeeded, 0)
    assert.equal(result.failed.length, 2)
  })
})
