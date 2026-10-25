import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseLcov, withUnloadedSources } from '../../scripts/coverage-summary'
import {
  compareCoverage, coverageBaselineProblems, DEFAULT_BASELINE, describeRow, directoryCoverage, isFailure,
  ratchetDirectory, runCoverageRatchet, TOLERANCE, trackedCoverageDirectories, updateCoverageBaseline,
  type CoverageBaseline,
} from '../../scripts/coverage-ratchet'

/**
 * Coverage ratchet per directory (wave3-long-term D-R, task 1.4).
 *
 * The comparison runs after the coverage run — `npm run test:coverage` locally, the
 * "Coverage ratchet" step in CI's unit job — on the lcov report, against
 * tests/ratchets/coverage.baseline.json. These tests drive that comparison with
 * simulated lcov, without running coverage; the last two check the checked-in baseline
 * against the tracked tree, so a renamed or removed directory goes red in `npm test`.
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = path.join(REPO, 'scripts/coverage-ratchet.ts')

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** One lcov record with `total` lines, the first `hit` of them run. */
function record(file: string, hit: number, total: number): string {
  const lines = Array.from({ length: total }, (_, i) => `DA:${i + 1},${i < hit ? 1 : 0}`)
  return ['TN:', `SF:${file}`, ...lines, `LH:${hit}`, `LF:${total}`, 'end_of_record'].join('\n')
}

/** server/utils at `hit`/1000 (two records, merged), server/services at 300/400 plus one file no test loads. */
function simulated(hit: number) {
  const lcov = [record('server/utils/a.ts', Math.min(hit, 600), 600), record('server/utils/b.ts', hit - Math.min(hit, 600), 400),
    record('server/services/x.ts', 300, 300), record('tests/helper.ts', 5, 5)].join('\n')
  // A source no test loads: its code lines count as uncovered (100 of them).
  const unloaded = { path: 'server/services/never.ts', text: 'export const a = 1\n'.repeat(100) }
  return directoryCoverage(withUnloadedSources(parseLcov(lcov), [unloaded]))
}

const BASELINE: CoverageBaseline = { 'server/services': 75, 'server/utils': 50 }

test('the simulated report measures what the real one would: merged records, unloaded files at 0 %, tests ignored', () => {
  assert.deepEqual([...simulated(500)], [['server/services', { hit: 300, total: 400 }], ['server/utils', { hit: 500, total: 1000 }]])
})

test('a drop of 0.6 point in one directory fails', () => {
  const rows = compareCoverage(BASELINE, simulated(494)) // 49.40 %
  const utils = rows.find(row => row.directory === 'server/utils')!
  assert.equal(utils.status, 'drop')
  assert.ok(rows.some(isFailure))
  assert.match(describeRow(utils), /^DROP {2}server\/utils: 50\.00% → 49\.40% \(−0\.60\) \(494\/1000 lines\) — more than 0\.5 point below/)
})

test('a drop of 0.4 point passes, and says it is within the tolerance', () => {
  const rows = compareCoverage(BASELINE, simulated(496)) // 49.60 %
  const utils = rows.find(row => row.directory === 'server/utils')!
  assert.equal(utils.status, 'within')
  assert.ok(!rows.some(isFailure))
  assert.match(describeRow(utils), /within the 0\.5-point tolerance/)
  // Exactly the tolerance is not "more than" it.
  assert.equal(compareCoverage(BASELINE, simulated(495))[1]!.status, 'within')
  assert.equal(TOLERANCE, 0.5)
})

test('a rise passes and prints the new value', () => {
  const rows = compareCoverage(BASELINE, simulated(523)) // 52.30 %
  const utils = rows.find(row => row.directory === 'server/utils')!
  assert.equal(utils.status, 'rise')
  assert.ok(!rows.some(isFailure))
  assert.match(describeRow(utils), /RISE {2}server\/utils: 50\.00% → 52\.30% \(\+2\.30\).*new value 52\.30/)
})

test('a baseline directory that is no longer measured fails as stale; a new directory passes with a note', () => {
  const rows = compareCoverage({ ...BASELINE, 'server/gone': 80 }, simulated(500))
  assert.equal(rows.find(row => row.directory === 'server/gone')!.status, 'stale')
  assert.ok(rows.some(isFailure))
  const fresh = compareCoverage({ 'server/utils': 50 }, simulated(500))
  assert.equal(fresh.find(row => row.directory === 'server/services')!.status, 'new')
  assert.ok(!fresh.some(isFailure))
})

test('--update raises, adds and drops stale entries, and lowers only a directory named with --allow-drop', () => {
  const current = simulated(494) // utils 49.40 (drop), services 75.00 (same)
  const plain = updateCoverageBaseline({ ...BASELINE, 'server/gone': 1, 'server/services': 70 }, current)
  assert.deepEqual(plain.baseline, { 'server/services': 75, 'server/utils': 50 })
  assert.deepEqual(plain.refused, ['server/utils: 49.40%, baseline 50.00%'])
  const allowed = updateCoverageBaseline(BASELINE, current, new Set(['server/utils']))
  assert.deepEqual(allowed.baseline, { 'server/services': 75, 'server/utils': 49.4 })
  assert.deepEqual(allowed.refused, [])
  // Raised values are rounded DOWN: 2/3 = 66.666… is stored as 66.66.
  const third = directoryCoverage([...parseLcov(record('server/utils/a.ts', 2, 3)).values()])
  assert.deepEqual(updateCoverageBaseline({ 'server/utils': 10 }, third).baseline, { 'server/utils': 66.66 })
})

test('the command line: exit 1 on a drop, a missing report or an empty one; exit 0 on a rise', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coverage-ratchet-'))
  roots.push(root)
  mkdirSync(path.join(root, 'server/utils'), { recursive: true })
  writeFileSync(path.join(root, 'server/utils/a.ts'), 'export const a = 1\n')
  const baselineFile = path.join(root, 'baseline.json')
  writeFileSync(baselineFile, JSON.stringify({ 'server/utils': 50 }))
  const lcov = (name: string, hit: number) => {
    const file = path.join(root, name)
    writeFileSync(file, record('server/utils/a.ts', hit, 1000))
    return file
  }
  const run = (...argv: string[]) => {
    const log: string[] = []
    const code = runCoverageRatchet([...argv, '--root', root, '--baseline', baselineFile], line => log.push(line))
    return { code, out: log.join('\n') }
  }

  const drop = run(lcov('drop.lcov', 494))
  assert.equal(drop.code, 1, drop.out)
  assert.match(drop.out, /DROP {2}server\/utils[\s\S]*--allow-drop server\/utils/)
  const rise = run(lcov('rise.lcov', 523))
  assert.equal(rise.code, 0, rise.out)
  assert.match(rise.out, /new value 52\.30/)
  assert.equal(run(path.join(root, 'missing.lcov')).code, 1, 'no report is a failure, not a pass')
  writeFileSync(path.join(root, 'empty.lcov'), '')
  assert.match(run(path.join(root, 'empty.lcov')).out, /no record for any measured source file/)
  assert.equal(run(path.join(root, 'empty.lcov')).code, 1)

  // --update records the rise; the drop is refused without --allow-drop.
  assert.equal(run(lcov('rise.lcov', 523), '--update').code, 0)
  assert.deepEqual(JSON.parse(readFileSync(baselineFile, 'utf8')), { 'server/utils': 52.3 })
  assert.equal(run(lcov('drop.lcov', 494), '--update').code, 1)
  assert.deepEqual(JSON.parse(readFileSync(baselineFile, 'utf8')), { 'server/utils': 52.3 })

  // The real entry point, as CI calls it.
  const cli = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, path.join(root, 'missing.lcov'), '--root', root, '--baseline', baselineFile], { encoding: 'utf8' })
  assert.equal(cli.status, 1, cli.stdout + cli.stderr)
  assert.match(cli.stdout, /no lcov report/)
})

test('directories are the finest rows of the coverage report', () => {
  assert.equal(ratchetDirectory('server/api/admin/users/index.get.ts'), 'server/api')
  assert.equal(ratchetDirectory('server/services/backup.ts'), 'server/services')
  assert.equal(ratchetDirectory('shared/blocks/registry.ts'), 'shared')
  assert.equal(ratchetDirectory('app/utils/blocks/types.ts'), 'app/utils')
  assert.equal(ratchetDirectory('app/composables/useI18n.ts'), 'app/composables')
  assert.equal(ratchetDirectory('app/components/Foo.vue'), undefined)
})

test('the checked-in coverage baseline is well-formed and names exactly the measured directories', (t) => {
  const baseline = JSON.parse(readFileSync(path.join(REPO, DEFAULT_BASELINE), 'utf8')) as CoverageBaseline
  assert.deepEqual(coverageBaselineProblems(baseline), [])
  const tracked = trackedCoverageDirectories(REPO)
  const stale = Object.keys(baseline).filter(directory => !tracked.has(directory))
  assert.deepEqual(stale, [], `stale coverage baseline directories (no tracked source there any more) — run the coverage and update: npm run test:coverage, then node --experimental-strip-types scripts/coverage-ratchet.ts node_modules/.cache/cdkt-coverage/lcov.info --update`)
  for (const directory of tracked) {
    if (!(directory in baseline)) t.diagnostic(`new coverage directory without a baseline yet: ${directory} — record it with --update after the next coverage run`)
  }
})
