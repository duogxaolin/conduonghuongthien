/**
 * `app/utils/latest-only.ts` — of overlapping calls, only the most recently STARTED one settles.
 * Used by `AiDashboardTab.vue` for its usage read (verifier W3: two budget saves inside one
 * re-read, the older read answering last put the old cap back). The dashboard behaviour itself
 * is pinned in tests/admin-ai-budget-editor-ui.test.ts; this pins the rule on its own.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { latestOnly } from '../app/utils/latest-only.ts'

/** A call whose answers the test releases by hand, in any order. */
function controllable() {
  const pending: Array<{ arg: number, resolve: (v: string) => void, reject: (e: Error) => void }> = []
  const call = (arg: number) => new Promise<string>((resolve, reject) => { pending.push({ arg, resolve, reject }) })
  return { pending, call }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

describe('latestOnly', () => {
  it('one call at a time: every call settles with its own answer, arguments passed through', async () => {
    const { pending, call } = controllable()
    const read = latestOnly(call)
    const first = read(1)
    assert.equal(pending[0]!.arg, 1)
    pending[0]!.resolve('a')
    assert.equal(await first, 'a')
    const second = read(2)
    pending[1]!.reject(new Error('boom'))
    await assert.rejects(second, /boom/)
  })

  it('an older call answering AFTER a newer one started never settles — the newer one does', async () => {
    const { pending, call } = controllable()
    const read = latestOnly(call)
    const settled: string[] = []
    void read(1).then(v => settled.push(`old:${v}`), () => settled.push('old:rejected'))
    void read(2).then(v => settled.push(`new:${v}`), () => settled.push('new:rejected'))
    pending[1]!.resolve('fresh') // the newer read answers first
    await tick()
    pending[0]!.resolve('stale') // the older one last
    await tick()
    assert.deepEqual(settled, ['new:fresh'])
  })

  it('the older call answering FIRST is dropped too: only the newest started call counts', async () => {
    const { pending, call } = controllable()
    const read = latestOnly(call)
    const settled: string[] = []
    void read(1).then(v => settled.push(`old:${v}`))
    void read(2).then(v => settled.push(`new:${v}`))
    pending[0]!.resolve('stale')
    await tick()
    assert.deepEqual(settled, [], 'not applied: a newer read is on its way')
    pending[1]!.resolve('fresh')
    await tick()
    assert.deepEqual(settled, ['new:fresh'])
  })

  it('a superseded failure is not reported; the newest failure is', async () => {
    const { pending, call } = controllable()
    const read = latestOnly(call)
    const settled: string[] = []
    void read(1).then(() => settled.push('old:ok'), (e: Error) => settled.push(`old:${e.message}`))
    void read(2).then(() => settled.push('new:ok'), (e: Error) => settled.push(`new:${e.message}`))
    pending[0]!.reject(new Error('stale failure'))
    pending[1]!.reject(new Error('fresh failure'))
    await tick()
    assert.deepEqual(settled, ['new:fresh failure'])
  })

  it('each wrapper counts its own calls', async () => {
    const a = controllable()
    const b = controllable()
    const readA = latestOnly(a.call)
    const readB = latestOnly(b.call)
    const fromA = readA(1)
    void readB(2) // another wrapper: does not supersede A's call
    a.pending[0]!.resolve('a')
    assert.equal(await fromA, 'a')
  })
})
