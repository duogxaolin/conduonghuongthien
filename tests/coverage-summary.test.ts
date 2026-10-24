import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  codeLineCount, directoryGroups, inCoverageScope, normalizeSourcePath, parseLcov, percent,
  renderCoverageSummary, summarize, withUnloadedSources,
} from '../scripts/coverage-summary'

/**
 * Coverage counts every source file, including the ones no test loads, and merges
 * the duplicate lcov records a `mock.module`-ed file produces. It reports and never
 * blocks: no threshold exists yet, because a number picked before anyone has seen the
 * baseline is just a new way to be red.
 */

const SCRIPT = fileURLToPath(new URL('../scripts/coverage-summary.ts', import.meta.url))

// One file loaded twice under different module keys (a real import and a mocked
// one, in two test processes), plus the all-zero stub Node 26's include-all adds.
// Function names `anonymous_N` and branch block ids are per-record counters: the
// same function/branch carries different ids in the two records.
const DUPLICATES = `TN:
SF:server/utils/a.ts
FN:2,run
FN:3,anonymous_0
FNDA:1,run
FNDA:0,anonymous_0
BRDA:3,0,0,1
BRDA:3,1,0,0
DA:1,1
DA:2,1
DA:3,0
DA:4,0
end_of_record
SF:server/utils/a.ts
FN:2,run
FN:3,anonymous_5
FNDA:0,run
FNDA:4,anonymous_5
BRDA:3,7,0,0
BRDA:3,8,0,3
DA:1,1
DA:2,0
DA:3,2
DA:4,0
end_of_record
SF:server/utils/a.ts
DA:1,0
DA:2,0
DA:3,0
DA:4,0
end_of_record
`

// Records the source set excludes, and one absolute path.
const OUT_OF_SCOPE = `SF:tests/_helper.ts
DA:1,1
end_of_record
SF:node_modules/pkg/index.ts
DA:1,1
end_of_record
SF:server/db/schema-tables/core.ts
DA:1,0
end_of_record
SF:server/types.d.ts
DA:1,0
end_of_record
SF:/repo/app/utils/b.ts
DA:1,1
DA:2,1
end_of_record
`

const UNLOADED_SOURCE = '// header comment\n\nexport function f() {\n  return 1\n}\n'

test('duplicate records of one file merge: covered if any record covers it, never lowered by an all-zero stub', () => {
  const files = parseLcov(DUPLICATES)
  assert.deepEqual([...files.keys()], ['server/utils/a.ts'])
  const a = files.get('server/utils/a.ts')!
  assert.deepEqual([...a.lines], [[1, 1], [2, 1], [3, 2], [4, 0]])
  assert.equal(a.loaded, true)
  // `run` ran in one record; the anonymous function ran in the other under another index.
  assert.deepEqual([...a.functions.values()], [1, 4])
  // Both branches on line 3 taken, each in a different record, under different block ids.
  assert.deepEqual([...a.branches.values()], [1, 3])
})

test('a record where no line ran is not a loaded file', () => {
  const files = parseLcov('SF:server/utils/stub.ts\nDA:1,0\nDA:2,0\nend_of_record\n')
  assert.equal(files.get('server/utils/stub.ts')!.loaded, false)
})

test('only the source set is measured: tests, dependencies, DDL and declaration files are dropped; absolute paths are made relative', () => {
  const files = parseLcov(OUT_OF_SCOPE, '/repo')
  assert.deepEqual([...files.keys()], ['app/utils/b.ts'])
  for (const file of ['server/api/x.get.ts', 'shared/permissions.ts', 'app/utils/a/b.ts', 'app/composables/useX.ts']) assert.ok(inCoverageScope(file), file)
  for (const file of ['server/db/schema-tables/core.ts', 'server/x.d.ts', 'server/x.test.ts', 'app/pages/index.ts', 'app/components/X.ts', 'scripts/x.ts', 'tests/x.ts', 'server/x.js']) assert.ok(!inCoverageScope(file), file)
  assert.equal(normalizeSourcePath('C:\\repo\\server\\a.ts', 'C:\\repo'), 'server/a.ts')
  assert.equal(normalizeSourcePath('./server/a.ts', ''), 'server/a.ts')
})

test('code lines: blank and comment-only lines do not count; strings, templates and regexes are not comments', () => {
  assert.equal(codeLineCount(''), 0)
  assert.equal(codeLineCount('a'), 1)
  assert.equal(codeLineCount('a\r\n\r\nb\r\n'), 2)
  assert.equal(codeLineCount(UNLOADED_SOURCE), 3)
  assert.equal(codeLineCount('/**\n * doc\n */\nconst a = 1 /* x */\n/* c */ const b = 2\n'), 2, 'block comments, alone or around code')
  assert.equal(codeLineCount("const url = 'https://x.test' // trailing\n// only a comment\n"), 1, 'a // inside a string is not a comment')
  assert.equal(codeLineCount('const s = `\n  // part of the template\n\n  end`\n'), 3, 'a template literal spans lines; its blank line has no code')
  assert.equal(codeLineCount(String.raw`const q = s.replace(/'/g, "\\'") // done` + '\n' + String.raw`const r = /\/\//.test(u)` + '\n// c\n'), 2, 'a quote or slashes inside a regex literal')
  assert.equal(codeLineCount('const d = a / b // half\n// c\n'), 1, 'a division is not a regex')
})

test('a file no test loads is added at 0 % with its code lines', () => {
  const files = withUnloadedSources(parseLcov(DUPLICATES + OUT_OF_SCOPE, '/repo'), [
    { path: 'server/api/x.get.ts', text: UNLOADED_SOURCE },
    { path: 'server/utils/a.ts', text: 'already in the report\n' },
    { path: 'server/db/schema-tables/core.ts', text: 'out of scope\n' },
  ])
  assert.deepEqual(files.map(file => file.path), ['app/utils/b.ts', 'server/api/x.get.ts', 'server/utils/a.ts'])
  const padded = files.find(file => file.path === 'server/api/x.get.ts')!
  assert.equal(padded.loaded, false)
  assert.deepEqual([...padded.lines.values()], [0, 0, 0])
  assert.equal(padded.functions.size + padded.branches.size, 0, 'functions and branches of an unparsed file are unknown')
  assert.equal(files.find(file => file.path === 'server/utils/a.ts')!.lines.size, 4, 'a loaded file keeps its own record')
})

test('totals per directory, for all files and for loaded files only', () => {
  assert.deepEqual(directoryGroups('server/api/admin/x.ts'), ['server', 'server/api'])
  assert.deepEqual(directoryGroups('shared/p.ts'), ['shared'])
  assert.deepEqual(directoryGroups('app/utils/blocks/types.ts'), ['app/utils'])

  const groups = summarize(withUnloadedSources(parseLcov(DUPLICATES + OUT_OF_SCOPE, '/repo'), [{ path: 'server/api/x.get.ts', text: UNLOADED_SOURCE }]))
  const all = groups.get('all')!
  assert.deepEqual({ files: all.files, neverLoaded: all.neverLoaded, lines: all.lines, loadedLines: all.loadedLines }, {
    files: 3, neverLoaded: 1, lines: { hit: 5, total: 9 }, loadedLines: { hit: 5, total: 6 },
  })
  assert.deepEqual(all.functions, { hit: 2, total: 2 })
  assert.deepEqual(all.branches, { hit: 2, total: 2 })
  assert.deepEqual(groups.get('server')!.lines, { hit: 3, total: 7 })
  assert.deepEqual(groups.get('server')!.loadedLines, { hit: 3, total: 4 })
  assert.deepEqual(groups.get('server/api')!.lines, { hit: 0, total: 3 })
  assert.equal(percent(groups.get('server/api')!.loadedLines), '—', 'no loaded file in the directory')
  assert.deepEqual(groups.get('server/utils')!.lines, { hit: 3, total: 4 })
  assert.deepEqual(groups.get('app/utils')!.lines, { hit: 2, total: 2 })
})

test('the summary is markdown with both totals, a row per directory and the files no test loads', () => {
  const markdown = renderCoverageSummary(withUnloadedSources(parseLcov(DUPLICATES + OUT_OF_SCOPE, '/repo'), [{ path: 'server/api/x.get.ts', text: UNLOADED_SOURCE }]))
  assert.match(markdown, /### Test coverage/)
  assert.match(markdown, /\*\*55\.56% of lines across all 3 source files\*\* \(1 never loaded/)
  assert.match(markdown, /83\.33% of lines in loaded files/)
  assert.match(markdown, /\| \*\*all files\*\* \| 3 \| 1 \| 55\.56% \(5\/9\) \| 83\.33% \|/)
  assert.match(markdown, /\| `server\/api\/` \| 1 \| 1 \| 0\.00% \(0\/3\) \| — \|/)
  assert.match(markdown, /- `server\/api\/x\.get\.ts` \(3 code lines\)/)
  assert.match(markdown, /\| `server\/utils\/a\.ts` \| 75\.00% \|/, 'least-covered loaded files are listed')
  assert.match(markdown, /report only/i, 'it must say that nothing is enforced')
  assert.match(renderCoverageSummary([]), /no coverage data/i)
})

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env } })
}

function sampleRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coverage-summary-'))
  for (const [file, text] of Object.entries({
    'server/utils/a.ts': 'export const a = 1\nexport const b = 2\nexport const c = 3\nexport const d = 4\n',
    'server/api/x.get.ts': UNLOADED_SOURCE,
    'server/db/schema-tables/core.ts': 'export {}\n',
    'app/utils/untracked.ts': 'export const u = 1\n',
  })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  writeFileSync(path.join(root, 'lcov.info'), DUPLICATES)
  return root
}

test('CLI: the source list comes from git, the summary goes to stdout and to $GITHUB_STEP_SUMMARY', () => {
  const root = sampleRepo()
  try {
    const git = (...args: string[]) => assert.equal(spawnSync('git', args, { cwd: root }).status, 0, `git ${args.join(' ')}`)
    git('init', '-q')
    git('add', 'server')
    const summaryFile = path.join(root, 'summary.md')
    const result = runCli([path.join(root, 'lcov.info'), '--root', root], { GITHUB_STEP_SUMMARY: summaryFile })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(summaryFile, 'utf8'), result.stdout)
    // a.ts 3 of 4 lines + x.get.ts 0 of 3 code lines = 3 of 7.
    assert.match(result.stdout, /\*\*42\.86% of lines across all 2 source files\*\* \(1 never loaded/)
    assert.match(result.stdout, /- `server\/api\/x\.get\.ts` \(3 code lines\)/)
    assert.doesNotMatch(result.stdout, /`app\/utils\/untracked\.ts`|`server\/db\/schema-tables\/core\.ts`/, 'untracked and excluded files are not sources')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: without git it walks the directories; a missing report is a note, not a failure', () => {
  const root = sampleRepo()
  try {
    const walked = runCli([path.join(root, 'lcov.info'), '--root', root], { PATH: '' })
    assert.equal(walked.status, 0, walked.stderr)
    assert.match(walked.stdout, /across all 3 source files\*\* \(2 never loaded/)
    assert.match(walked.stdout, /- `app\/utils\/untracked\.ts` \(1 code lines\)/)

    const missing = runCli([path.join(root, 'nope.info'), '--root', root])
    assert.equal(missing.status, 0)
    assert.match(missing.stdout, /No lcov report at/)
    assert.equal(runCli([]).status, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
