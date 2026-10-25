import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import {
  baselineProblems, compare, describeRegressions, measureFiles, runUpdate, serializeBaseline, trackedFiles,
  updateBaseline, type Baseline, type FileRatchet,
} from './_ratchet'

/**
 * The ratchet engine itself (tests/ratchets/_ratchet.ts): fails only on regressions,
 * reports improvements, rejects stale entries, and an update never raises an entry
 * unless that path is named.
 */

const LINES: FileRatchet = {
  name: 'lines',
  unit: 'lines',
  defaultForNewFiles: 3,
  inScope: file => file.endsWith('.ts') && !file.startsWith('tests/'),
  measure: text => text.split('\n').length - 1,
  hint: 'Split it.',
}

const roots: string[] = []
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd } })

/** A throwaway git repo: `files` are committed, `untracked` are only written to disk. */
function repo(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ratchet-engine-'))
  roots.push(root)
  git(root, 'init', '-q')
  const write = (entries: Record<string, string>) => {
    for (const [file, text] of Object.entries(entries)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), text)
    }
  }
  write(files)
  git(root, 'add', '-A')
  write(untracked)
  return root
}

const lines = (n: number) => 'x\n'.repeat(n)

test('compare: only a file above its entry, or a new file above the default, is a regression', () => {
  const baseline: Baseline = { 'a.ts': 10, 'b.ts': { value: 10, reason: 'pinned by a guard' }, 'c.ts': 10, 'gone.ts': 8 }
  const current = new Map([['a.ts', 11], ['b.ts', 10], ['c.ts', 7], ['new-small.ts', 3], ['new-big.ts', 4]])
  const result = compare(LINES, current, baseline)
  assert.deepEqual(result.worse, [{ file: 'a.ts', value: 11, baseline: 10 }])
  assert.deepEqual(result.newOverDefault, [{ file: 'new-big.ts', value: 4 }])
  assert.deepEqual(result.lowerable, [{ file: 'c.ts', value: 7, baseline: 10 }])
  assert.deepEqual(result.stale, ['gone.ts'])
  const message = describeRegressions(LINES, result)
  assert.match(message, /a\.ts: 11 lines, baseline 10 \(\+1\)/)
  assert.match(message, /new-big\.ts: 4 lines, not in the baseline \(a new file may have at most 3\)/)
  assert.match(message, /--update --raise a\.ts --raise new-big\.ts/)
})

test('update: lowers and removes on its own, but raises or adds only the paths named with --raise', () => {
  const baseline: Baseline = {
    'a.ts': 10, // grew to 12
    'b.ts': { value: 10, reason: 'pinned' }, // dropped to 6: lowered, reason kept
    'c.ts': 10, // dropped to the default: removed
    'd.ts': { value: 9, reason: 'pinned' }, // grew to 11
    'gone.ts': 8, // stale: removed
  }
  const current = new Map([['a.ts', 12], ['b.ts', 6], ['c.ts', 3], ['d.ts', 11], ['new.ts', 5]])

  const plain = updateBaseline(LINES, current, baseline)
  assert.deepEqual(plain.baseline, { 'a.ts': 10, 'b.ts': { value: 6, reason: 'pinned' }, 'd.ts': { value: 9, reason: 'pinned' } })
  assert.deepEqual(plain.refused.map(item => item.file), ['a.ts', 'd.ts', 'new.ts'])
  assert.ok(plain.changes.some(line => line.startsWith('lowered: b.ts 10→6')))
  assert.ok(plain.changes.some(line => line.includes('c.ts')))
  assert.ok(plain.changes.some(line => line.includes('gone.ts')))

  const raised = updateBaseline(LINES, current, baseline, new Set(['d.ts', 'new.ts', 'c.ts']))
  assert.deepEqual(raised.baseline, { 'a.ts': 10, 'b.ts': { value: 6, reason: 'pinned' }, 'd.ts': { value: 11, reason: 'pinned' }, 'new.ts': 5 })
  assert.deepEqual(raised.refused.map(item => item.file), ['a.ts'])
  assert.deepEqual(raised.unusedRaises, ['c.ts'])
})

test('exempt entries: growth never fails, a gone file is stale, and --update copies them unchanged', () => {
  const baseline: Baseline = {
    'capped.ts': { value: 10, reason: 'unsplittable' },
    'data.ts': { exempt: true, reason: 'append-only seed data' },
    'gone-data.ts': { exempt: true, reason: 'append-only seed data' },
    'small-data.ts': { exempt: true, reason: 'append-only seed data' },
  }
  const current = new Map([['capped.ts', 11], ['data.ts', 9000], ['small-data.ts', 1]])
  const result = compare(LINES, current, baseline)
  assert.deepEqual(result.worse.map(item => item.file), ['capped.ts'], 'only the capped entry grew into a regression')
  assert.deepEqual(result.exempt, [{ file: 'data.ts', value: 9000 }, { file: 'small-data.ts', value: 1 }])
  assert.deepEqual(result.stale, ['gone-data.ts'], 'an exempt entry still goes stale when its file is gone')
  assert.deepEqual(result.lowerable, [])

  const update = updateBaseline(LINES, current, baseline, new Set(['data.ts', 'capped.ts']))
  for (const file of ['data.ts', 'gone-data.ts', 'small-data.ts']) assert.deepEqual(update.baseline[file], baseline[file], file)
  assert.deepEqual(update.staleExempt, ['gone-data.ts'])
  assert.deepEqual(update.unusedRaises, ['data.ts'])
  assert.deepEqual(update.baseline['capped.ts'], { value: 11, reason: 'unsplittable' }, '--raise never turns a capped entry exempt')
})

test('baseline shape: sorted by path, integers above the default, reasons non-empty', () => {
  assert.deepEqual(baselineProblems(LINES, { 'a.ts': 4, 'b.ts': { value: 5, reason: 'why' } }), [])
  const problems = baselineProblems(LINES, { 'b.ts': 4, 'a.ts': 3, 'c.ts': 4.5, 'd.ts': { value: 9, reason: ' ' }, 'e.ts': { value: 9, reason: 'x', extra: 1 } })
  assert.equal(problems.length, 5, problems.join('\n'))
  assert.match(problems.join('\n'), /not sorted/)
  assert.match(problems.join('\n'), /a\.ts: 3 is not above the default/)
  assert.match(problems.join('\n'), /c\.ts: 4\.5 is not a non-negative integer/)
  assert.match(problems.join('\n'), /d\.ts: an object entry needs a non-empty "reason"/)
  assert.match(problems.join('\n'), /e\.ts: unknown keys extra/)
  assert.deepEqual(baselineProblems(LINES, []), ['the baseline is not a JSON object'])
  // Serialising sorts, so a regenerated baseline is always well-formed.
  assert.equal(serializeBaseline({ 'b.ts': 4, 'B.ts': 5, 'a.ts': 6 }), '{\n  "B.ts": 5,\n  "a.ts": 6,\n  "b.ts": 4\n}\n')
})

test('files come from git ls-files: untracked files never count, a deleted tracked file is gone', () => {
  const root = repo({ 'src/a.ts': lines(5), 'src/b.ts': lines(2), 'tests/t.ts': lines(9), 'src/doomed.ts': lines(7) }, { 'src/untracked.ts': lines(50) })
  rmSync(path.join(root, 'src/doomed.ts'))
  assert.ok(trackedFiles(root).includes('src/doomed.ts'), 'still in the index')
  assert.deepEqual([...measureFiles(LINES, root)], [['src/a.ts', 5], ['src/b.ts', 2]])
})

test('outside a git checkout the ratchet fails loudly instead of walking the directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ratchet-nogit-'))
  roots.push(root)
  writeFileSync(path.join(root, 'a.ts'), lines(50))
  assert.throws(() => trackedFiles(root), /git ls-files/)
})

test('--init / --update / --raise on a real tree, end to end', () => {
  const root = repo({ 'a.ts': lines(6), 'b.ts': lines(5), 'small.ts': lines(1) })
  mkdirSync(path.join(root, 'tests/ratchets'), { recursive: true })
  const file = path.join(root, 'tests/ratchets/lines.baseline.json')
  const log: string[] = []
  const run = (...argv: string[]) => runUpdate(LINES, argv, root, line => log.push(line))

  assert.equal(run('--init'), 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'a.ts': 6, 'b.ts': 5 })
  assert.equal(run('--init'), 2, '--init never overwrites')

  writeFileSync(path.join(root, 'a.ts'), lines(4)) // improved
  writeFileSync(path.join(root, 'b.ts'), lines(8)) // regressed
  log.length = 0
  assert.equal(run('--update'), 1, 'a regression without --raise exits non-zero')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'a.ts': 4, 'b.ts': 5 }, 'the improvement is kept, the regression is not')
  assert.match(log.join('\n'), /NOT raised[\s\S]*b\.ts: 8 lines, baseline 5[\s\S]*--raise b\.ts/)

  log.length = 0
  assert.equal(run('--update', '--raise', 'b.ts'), 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'a.ts': 4, 'b.ts': 8 })
  assert.match(log.join('\n'), /RAISED \(--raise\): b\.ts 5→8/)
  assert.equal(run('--update', '--raise'), 2, '--raise without a path is a usage error')

  // An exempt entry is a hand edit: --update keeps it byte for byte, even when its file is gone.
  const exempt = { 'a.ts': 4, 'b.ts': { exempt: true, reason: 'seed data' }, 'removed.ts': { exempt: true, reason: 'seed data' } }
  writeFileSync(file, serializeBaseline(exempt))
  writeFileSync(path.join(root, 'b.ts'), lines(80))
  log.length = 0
  assert.equal(run('--update'), 1, 'a gone exempt entry needs a hand edit')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), exempt)
  assert.match(log.join('\n'), /Exempt entries whose file is gone[\s\S]*removed\.ts/)
})
