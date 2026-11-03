import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * The CLI `npm run db:repair-ai-usage-duplicates` (scripts/repair-ai-usage-duplicates.ts):
 * which flags make it DELETE. Only `--apply` writes, only `--apply --include-review` adds the
 * `review` rows; `--include-review` alone, a misspelt flag or any other flag is a preview.
 * Found by independent verification: a script that turned `--include-review` alone into
 * `--apply` (D8), or let `--apply` alone take `review` too (D9), was caught only by a regex
 * over the source — or not at all.
 *
 * Runs the real script (imported fresh per case, `process.argv` set) with the repair service
 * and the database layer mocked at their module boundaries: what is pinned is the options
 * the service receives, and that the run ends with `closeDb()`.
 */

const state = { calls: [] as Array<Record<string, unknown>>, closeDbCalls: 0 }

mock.module('../server/services/ai-usage-duplicates-repair', {
  namedExports: {
    runAiUsageDuplicateRepair: async (options: Record<string, unknown>) => {
      state.calls.push(options)
      return {
        applied: options.apply === true, includeReview: options.includeReview === true, routerRows: 3, written: 0, skipped: 0,
        band: null, bandSource: null, anchorHistogram: {}, exact: [{ id: 1 }], review: [{ id: 2 }], kept: [{ id: 3 }],
        costVnd: { exact: 1, review: 2, kept: 3 },
      }
    },
  },
})
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => { throw new Error('not used') },
    getPool: () => null,
    closeDb: async () => { state.closeDbCalls += 1 },
  },
})

let run = 0
/** Runs the script with `flags` after the script path; returns the options the service got and what it printed. */
async function runScript(flags: string[]) {
  state.calls = []
  state.closeDbCalls = 0
  const printed: string[] = []
  const [originalArgv, originalLog] = [process.argv, console.log]
  process.argv = [originalArgv[0]!, 'scripts/repair-ai-usage-duplicates.ts', ...flags]
  console.log = (...args: unknown[]) => { printed.push(args.map(String).join(' ')) }
  try {
    run += 1
    await import(`../scripts/repair-ai-usage-duplicates.ts?case=${run}`)
  } finally {
    process.argv = originalArgv
    console.log = originalLog
  }
  assert.equal(state.calls.length, 1, `${flags.join(' ')}: the service runs once`)
  assert.equal(state.closeDbCalls, 1, `${flags.join(' ')}: the pool is closed`)
  assert.equal(process.exitCode ?? 0, 0)
  return { options: state.calls[0]!, summary: printed.at(-1) ?? '' }
}

const PREVIEW = { apply: false, includeReview: false }

test('no flag → preview; --apply → only `exact`; --apply --include-review (either order) → both', async () => {
  assert.deepEqual((await runScript([])).options, PREVIEW)
  assert.deepEqual((await runScript(['--apply'])).options, { apply: true, includeReview: false })
  assert.deepEqual((await runScript(['--apply', '--include-review'])).options, { apply: true, includeReview: true })
  assert.deepEqual((await runScript(['--include-review', '--apply'])).options, { apply: true, includeReview: true })
})

test('--include-review WITHOUT --apply is a preview — it never becomes --apply (verifier D8)', async () => {
  const { options, summary } = await runScript(['--include-review'])
  assert.deepEqual(options, { apply: false, includeReview: true })
  assert.match(summary, /^Xem trước thôi/)
})

test('--apply alone does not take the `review` rows (verifier D9)', async () => {
  const { options, summary } = await runScript(['--apply'])
  assert.equal(options.includeReview, false)
  assert.match(summary, /Còn 1 hàng trong `review` chưa xoá/)
})

test('a misspelt or unknown flag is a preview, never a delete', async () => {
  for (const flags of [['--aply'], ['--APPLY'], ['--apply=true'], ['-a'], ['--force'], ['--yes'], ['apply'], ['--dry-run=false']]) {
    const { options, summary } = await runScript(flags)
    assert.deepEqual(options, PREVIEW, flags.join(' '))
    assert.match(summary, /^Xem trước thôi/, flags.join(' '))
  }
  // A misspelt --include-review with --apply: only `exact`, never `review`.
  assert.deepEqual((await runScript(['--apply', '--include-reveiw'])).options, { apply: true, includeReview: false })
  assert.deepEqual((await runScript(['--include-reveiw'])).options, PREVIEW)
})
